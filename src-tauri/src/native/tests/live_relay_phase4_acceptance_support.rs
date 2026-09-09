fn exercise_phase_four_viewer(
    viewer: &str,
    relay: &Arc<LiveRelaySession>,
    coordination: &Path,
    duration: Duration,
) -> PhaseFourEndpointReport {
    let started = Instant::now();
    let mut last_frame_id = 0_u64;
    let mut first_frame_id = None;
    let mut frames = 0_u64;
    let mut digests = BTreeSet::new();
    let mut maximum_latency_ms = 0_u64;
    let mut latencies_ms = Vec::new();
    let mut strictly_increasing = true;
    let mut reconnect_requested = false;
    let mut reconnect_started = None;
    let mut reconnect_frame_id = 0_u64;
    let mut reconnect_duration_ms = None;
    let mut errors = Vec::new();
    while started.elapsed() < duration {
        if let Some(descriptor) = relay
            .frames
            .lock()
            .ok()
            .and_then(|buffer| buffer.latest_after(last_frame_id))
        {
            let payload = relay
                .frames
                .lock()
                .ok()
                .and_then(|mut buffer| buffer.take_payload_for(descriptor.frame_id));
            if let Some(payload) = payload {
                strictly_increasing &= descriptor.frame_id > last_frame_id;
                first_frame_id.get_or_insert(descriptor.frame_id);
                last_frame_id = descriptor.frame_id;
                let latency = live_capture_now_ms().saturating_sub(descriptor.capture_timestamp_ms);
                maximum_latency_ms = maximum_latency_ms.max(latency);
                latencies_ms.push(latency);
                digests.insert(Sha256::digest(&payload).to_vec());
                frames = frames.saturating_add(1);
            }
        }
        if frames >= 3 {
            if viewer == "A" {
                coordinate_viewer_a(relay, coordination, &mut errors);
            } else {
                coordinate_viewer_b(relay, coordination, &mut errors);
            }
            if viewer == "B" && !reconnect_requested {
                relay.reconnect.store(true, Ordering::SeqCst);
                reconnect_requested = true;
                reconnect_started = Some(Instant::now());
                reconnect_frame_id = last_frame_id;
            }
        }
        if reconnect_requested && reconnect_duration_ms.is_none() {
            let recovered = relay
                .state
                .lock()
                .map(|state| state.reconnect_count >= 1 && state.last_frame_id > reconnect_frame_id)
                .unwrap_or(false);
            if recovered {
                reconnect_duration_ms =
                    reconnect_started.map(|started| started.elapsed().as_millis());
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let snapshot = relay.snapshot().expect("viewer snapshot");
    if frames < 3 {
        errors.push("viewer consumed fewer than three live frames".to_owned());
    }
    if viewer == "B" && snapshot.reconnect_count < 1 {
        errors.push("viewer B did not reconnect".to_owned());
    }
    if viewer == "B" && reconnect_duration_ms.is_none() {
        errors.push("viewer B reconnected without receiving a newer baseline frame".to_owned());
    }
    if !strictly_increasing {
        errors.push("viewer observed a duplicate or stale frame".to_owned());
    }
    let event_reasons = phase_four_event_reasons(relay).unwrap_or_else(|error| {
        errors.push(error);
        Vec::new()
    });
    let conflict = event_reasons
        .iter()
        .any(|reason| reason.starts_with("controller_rejected_conflict:"));
    let transfer = event_reasons
        .iter()
        .any(|reason| reason.starts_with("controller_acquired:"))
        && event_reasons
            .iter()
            .any(|reason| reason.starts_with("controller_released:"));
    if !conflict {
        errors.push("controller conflict event was not visible".to_owned());
    }
    if !transfer {
        errors.push("controller acquire/release events were not visible".to_owned());
    }
    let input_events_sent = if viewer == "B" && coordination.join("phase5-input-sent").exists() {
        10
    } else {
        0
    };
    let source_reclaim_observed = event_reasons
        .iter()
        .any(|reason| reason.starts_with("controller_revoked_by_source:"));
    let interaction_released = !snapshot.controller_owned;
    if phase_five_enabled()
        && viewer == "B"
        && (input_events_sent != 10 || !source_reclaim_observed || !interaction_released)
    {
        errors.push("Phase 5 viewer did not complete input and source-reclaim flow".to_owned());
    }
    latencies_ms.sort_unstable();
    let p95_latency_ms = latencies_ms
        .get(((latencies_ms.len().saturating_sub(1)) * 95) / 100)
        .copied()
        .unwrap_or_default();
    PhaseFourEndpointReport {
        schema_version: 1,
        role: format!("viewer-{viewer}"),
        duration_ms: started.elapsed().as_millis(),
        frames,
        distinct_frames: digests.len(),
        first_frame_id,
        last_frame_id,
        reconnect_count: snapshot.reconnect_count,
        reconnect_duration_ms,
        strictly_increasing,
        maximum_latency_ms,
        p95_latency_ms,
        controller_conflict_observed: conflict,
        controller_transfer_observed: transfer,
        input_events_sent,
        input_delivered: coordination.join("phase5-reclaimed").exists(),
        source_reclaim_observed,
        interaction_released,
        observation: phase_six_observation_evidence(phase_six_enabled(), &snapshot),
        event_reasons,
        errors,
    }
}

fn coordinate_viewer_a(relay: &LiveRelaySession, root: &Path, errors: &mut Vec<String>) {
    let acquired = root.join("viewer-a-acquired");
    let conflict = root.join("viewer-b-conflict");
    let released = root.join("viewer-a-released");
    if !acquired.exists() {
        match change_live_controller_blocking(relay, LiveRelayControlAction::Acquire, Some(30_000))
        {
            Ok(_) => write_phase_four_marker(&acquired),
            Err(error) => errors.push(error),
        }
    } else if conflict.exists() && !released.exists() {
        match change_live_controller_blocking(relay, LiveRelayControlAction::Release, None) {
            Ok(_) => write_phase_four_marker(&released),
            Err(error) => errors.push(error),
        }
    }
}

fn coordinate_viewer_b(relay: &LiveRelaySession, root: &Path, errors: &mut Vec<String>) {
    let acquired = root.join("viewer-a-acquired");
    let conflict = root.join("viewer-b-conflict");
    let released = root.join("viewer-a-released");
    let transferred = root.join("viewer-b-transferred");
    if acquired.exists() && !conflict.exists() {
        match change_live_controller_blocking(relay, LiveRelayControlAction::Acquire, Some(30_000))
        {
            Err(error) if error.contains("another viewer") => write_phase_four_marker(&conflict),
            Err(error) => errors.push(error),
            Ok(_) => {
                errors.push("viewer B acquired control before viewer A released it".to_owned())
            }
        }
    } else if released.exists() && !transferred.exists() {
        match change_live_controller_blocking(relay, LiveRelayControlAction::Acquire, Some(30_000))
        {
            Ok(_) => {
                if phase_five_enabled() {
                    write_phase_four_marker(&transferred);
                } else if let Err(error) =
                    change_live_controller_blocking(relay, LiveRelayControlAction::Release, None)
                {
                    errors.push(error);
                } else {
                    write_phase_four_marker(&transferred);
                }
            }
            Err(error) => errors.push(error),
        }
    } else if phase_five_enabled()
        && transferred.exists()
        && !root.join("phase5-input-sent").exists()
        && relay
            .state
            .lock()
            .map(|state| state.controller_owned)
            .unwrap_or(false)
    {
        match phase_five_send_inputs(relay) {
            Ok(()) => write_phase_four_marker(&root.join("phase5-input-sent")),
            Err(error) => errors.push(error),
        }
    }
}

fn phase_five_send_inputs(relay: &LiveRelaySession) -> Result<(), String> {
    let ready: serde_json::Value =
        read_phase_four_json(&required_phase_four_path("HOOK_LIVE_PHASE5_FIXTURE_READY"));
    let point = |name: &str| -> Result<(f64, f64), String> {
        let values = ready
            .pointer(&format!("/targets/{name}"))
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| format!("Phase 5 fixture target `{name}` is missing"))?;
        let x = values.first().and_then(serde_json::Value::as_f64);
        let y = values.get(1).and_then(serde_json::Value::as_f64);
        x.zip(y)
            .ok_or_else(|| format!("Phase 5 fixture target `{name}` is invalid"))
    };
    let (action_x, action_y) = point("action")?;
    let (drag_x, drag_y) = point("dragEnd")?;
    let (track_x, track_y) = point("track")?;
    let drag_point = |sequence: u64, fraction: f64| {
        phase_five_mouse(
            sequence,
            "mouse_move",
            action_x + ((drag_x - action_x) * fraction),
            action_y + ((drag_y - action_y) * fraction),
            None,
        )
    };
    let inputs = [
        phase_five_mouse(1, "mouse_button_down", action_x, action_y, Some("left")),
        phase_five_mouse(2, "mouse_button_up", action_x, action_y, Some("left")),
        phase_five_key(3, "key_down", 0x20),
        phase_five_key(4, "key_up", 0x20),
        LiveCaptureInputRequest {
            sequence: 5,
            kind: "mouse_wheel".to_owned(),
            normalized_x: Some(track_x),
            normalized_y: Some(track_y),
            button: None,
            wheel_delta: Some(120),
            wheel_axis: Some("vertical".to_owned()),
            click_count: None,
            virtual_key: None,
        },
        phase_five_mouse(6, "mouse_button_down", action_x, action_y, Some("left")),
        drag_point(7, 0.4),
        drag_point(8, 0.7),
        drag_point(9, 1.0),
        phase_five_mouse(10, "mouse_button_up", drag_x, drag_y, Some("left")),
    ];
    for input in inputs {
        send_live_relay_input_blocking(relay, &input)?;
    }
    Ok(())
}

fn phase_five_mouse(
    sequence: u64,
    kind: &str,
    x: f64,
    y: f64,
    button: Option<&str>,
) -> LiveCaptureInputRequest {
    LiveCaptureInputRequest {
        sequence,
        kind: kind.to_owned(),
        normalized_x: Some(x),
        normalized_y: Some(y),
        button: button.map(str::to_owned),
        wheel_delta: None,
        wheel_axis: None,
        click_count: Some(1),
        virtual_key: None,
    }
}

fn phase_five_key(sequence: u64, kind: &str, virtual_key: u16) -> LiveCaptureInputRequest {
    LiveCaptureInputRequest {
        sequence,
        kind: kind.to_owned(),
        normalized_x: None,
        normalized_y: None,
        button: None,
        wheel_delta: None,
        wheel_axis: None,
        click_count: None,
        virtual_key: Some(virtual_key),
    }
}

fn phase_four_event_reasons(relay: &LiveRelaySession) -> Result<Vec<String>, String> {
    let client =
        crate::network_proxy::blocking_client(&relay.base_url, Some(Duration::from_secs(10)))
            .map_err(|error| format!("build live event client: {error}"))?;
    let mut url = live_relay_session_url(&relay.base_url, &relay.live_session_id, Some("events"))?;
    url.query_pairs_mut().append_pair("after", "0");
    let response = send_live_relay_json_blocking(
        relay.authorization.apply_blocking(client.get(url)),
        "read live controller events",
    )?;
    Ok(response
        .get("events")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|event| {
            event
                .pointer("/payload/reason")
                .and_then(serde_json::Value::as_str)
        })
        .map(str::to_owned)
        .collect())
}

fn phase_four_daemon_ready() -> PhaseFourDaemonReady {
    let path = required_phase_four_path("HOOK_LIVE_PHASE4_DAEMON_READY");
    wait_for_path(&path, Duration::from_secs(45));
    read_phase_four_json(&path)
}

fn phase_four_hwnd() -> HWND {
    let raw = u64::from_str_radix(
        &std::env::var("HOOK_LIVE_PHASE4_HWND")
            .expect("HOOK_LIVE_PHASE4_HWND is required")
            .trim_start_matches("0x"),
        16,
    )
    .expect("Phase 4 HWND must be hexadecimal");
    HWND(raw as *mut std::ffi::c_void)
}

fn phase_four_duration() -> Duration {
    Duration::from_secs(
        std::env::var("HOOK_LIVE_PHASE4_DURATION_SECONDS")
            .expect("HOOK_LIVE_PHASE4_DURATION_SECONDS is required")
            .parse::<u64>()
            .expect("Phase 4 duration must be an integer")
            .clamp(15, 180),
    )
}

fn required_phase_four_path(name: &str) -> PathBuf {
    PathBuf::from(std::env::var(name).unwrap_or_else(|_| panic!("{name} is required")))
}

fn wait_for_path(path: &Path, timeout: Duration) {
    let deadline = Instant::now() + timeout;
    while !path.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(path.exists(), "timed out waiting for {}", path.display());
}

fn read_phase_four_json<T: for<'de> Deserialize<'de>>(path: &Path) -> T {
    serde_json::from_slice(&std::fs::read(path).expect("read Phase 4 JSON"))
        .expect("parse Phase 4 JSON")
}

fn write_phase_four_json(path: &Path, value: &impl Serialize) {
    std::fs::write(
        path,
        serde_json::to_vec_pretty(value).expect("serialize Phase 4 JSON"),
    )
    .expect("write Phase 4 JSON");
}

fn write_phase_four_marker(path: &Path) {
    std::fs::write(path, b"ok\n").expect("write Phase 4 coordination marker");
}

fn phase_five_enabled() -> bool {
    std::env::var("HOOK_LIVE_PHASE5").is_ok_and(|value| value == "1")
}

fn phase_five_fixture_state() -> PhaseFiveFixtureState {
    let path = match std::env::var("HOOK_LIVE_PHASE5_FIXTURE_STATE") {
        Ok(path) => PathBuf::from(path),
        Err(_) => return PhaseFiveFixtureState::default(),
    };
    for _ in 0..3 {
        if let Ok(bytes) = std::fs::read(&path) {
            if let Ok(state) = serde_json::from_slice(&bytes) {
                return state;
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    PhaseFiveFixtureState::default()
}

fn phase_five_source_tick(relay: &LiveRelaySession, coordination: &Path) {
    if !coordination.join("phase5-input-sent").exists()
        || coordination.join("phase5-reclaimed").exists()
    {
        return;
    }
    let fixture = phase_five_fixture_state();
    if fixture.clicks < 1
        || fixture.key_edges < 2
        || fixture.drag_edges < 5
        || fixture.track_value == 40
    {
        return;
    }
    if change_live_controller_blocking(relay, LiveRelayControlAction::Revoke, None).is_err() {
        return;
    }
    let _ = set_live_relay_source_interaction(relay, false);
    if let Ok(mut state) = relay.state.lock() {
        state.remote_control_active = false;
    }
    write_phase_four_marker(&coordination.join("phase5-reclaimed"));
}

fn phase_five_source_outcome(relay: &LiveRelaySession) -> (PhaseFiveFixtureState, bool, bool) {
    if !phase_five_enabled() {
        return (PhaseFiveFixtureState::default(), false, true);
    }
    let reclaimed = required_phase_four_path("HOOK_LIVE_PHASE4_COORDINATION")
        .join("phase5-reclaimed")
        .exists();
    let interaction_released = relay
        .capture
        .as_ref()
        .and_then(|capture| capture.source_window.as_ref())
        .and_then(|source| source.lock().ok())
        .is_some_and(|source| {
            !source.interaction_enabled
                && source.pressed_mouse_buttons == 0
                && source.pressed_virtual_keys.is_empty()
        });
    (phase_five_fixture_state(), reclaimed, interaction_released)
}
