// Tauri command boundary for publishing, discovering, viewing, controlling, and closing relays.
#[tauri::command]
async fn publish_live_capture_to_loom(
    app: tauri::AppHandle,
    captures: tauri::State<'_, SharedLiveCaptureSessions>,
    relays: tauri::State<'_, SharedLiveRelaySessions>,
    request: LiveRelayPublishRequest,
) -> Result<LiveRelaySnapshot, String> {
    validate_live_relay_publish_request(&request)?;
    let capture = captures.get(&request.capture_session_id)?;
    let capture_status = snapshot_live_capture_state(&capture.state, &capture.dropped_frames)?;
    if capture_status.capture_state == "failed" || capture_status.capture_state == "closed" {
        return Err("the local live capture is not publishable".to_owned());
    }
    let (base_url, authorization) = live_relay_context(&app).await?;
    let live_session_id = request
        .live_session_id
        .clone()
        .unwrap_or_else(|| format!("live:{}", uuid::Uuid::new_v4()));
    validate_live_relay_identifier(&live_session_id, "live session id")?;
    let capture_for_probe = Arc::clone(&capture);
    let observation_probe = tokio::task::spawn_blocking(move || {
        probe_live_observation_capabilities(&capture_for_probe)
    })
    .await
    .map_err(|error| format!("live observation capability probe failed: {error}"))?;
    let body = build_live_session_create_body(
        &request,
        &capture_status,
        &authorization.device_id,
        &live_session_id,
        &observation_probe.capabilities,
    );
    let response = create_live_session_http(&base_url, &authorization, &body).await?;
    validate_live_session_snapshot(&response, &live_session_id)?;
    let relay = Arc::new(LiveRelaySession {
        relay_id: next_live_relay_id(LiveRelayRole::Source),
        live_session_id,
        role: LiveRelayRole::Source,
        base_url,
        surface_instance_id: request.surface_instance_id,
        attachment_id: request.source_attachment_id,
        authorization,
        capture: Some(Arc::clone(&capture)),
        state: Arc::new(Mutex::new(LiveRelayRuntimeState::starting(
            1,
            observation_probe.capabilities.clone(),
            observation_probe.unavailable_reason.clone(),
        ))),
        frames: Arc::new(Mutex::new(LiveRelayFrameBuffer::new())),
        stop: Arc::new(AtomicBool::new(false)),
        reconnect: Arc::new(AtomicBool::new(false)),
        join: Mutex::new(None),
        control_join: Mutex::new(None),
        observation_join: Mutex::new(None),
        control_sequence: Mutex::new(1),
        input_sequence: Mutex::new(0),
    });
    let worker = spawn_live_relay_source_worker(Arc::clone(&relay), capture)?;
    *relay
        .join
        .lock()
        .map_err(|_| "live relay worker lock poisoned".to_owned())? = Some(worker);
    let control_worker = match spawn_live_relay_control_worker(Arc::clone(&relay)) {
        Ok(worker) => worker,
        Err(error) => {
            let _ = relay.stop_and_join();
            let _ = close_live_session_blocking(&relay);
            return Err(error);
        }
    };
    *relay
        .control_join
        .lock()
        .map_err(|_| "live relay control worker lock poisoned".to_owned())? = Some(control_worker);
    if observation_probe
        .capabilities
        .iter()
        .any(|capability| capability == "uia_tree")
    {
        let observation_worker = match spawn_live_observation_worker(Arc::clone(&relay)) {
            Ok(worker) => worker,
            Err(error) => {
                let _ = relay.stop_and_join();
                let _ = close_live_session_blocking(&relay);
                return Err(error);
            }
        };
        *relay
            .observation_join
            .lock()
            .map_err(|_| "live observation worker lock poisoned".to_owned())? =
            Some(observation_worker);
    }
    if let Err(error) = relays.insert(Arc::clone(&relay)) {
        let _ = relay.stop_and_join();
        let _ = close_live_session_blocking(&relay);
        return Err(error);
    }
    append_runtime_log_line(&format!(
        "live_relay_source_started :: relay={} session={} observation_capabilities={} semantic_controls={}",
        relay.relay_id,
        relay.live_session_id,
        observation_probe.capabilities.len(),
        observation_probe.semantic_control_count,
    ));
    relay.snapshot()
}

#[tauri::command]
async fn discover_live_relay_sessions(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let (base_url, authorization) = live_relay_context(&app).await?;
    discover_live_sessions_http(&base_url, &authorization).await
}

#[tauri::command]
async fn join_live_relay_session(
    app: tauri::AppHandle,
    relays: tauri::State<'_, SharedLiveRelaySessions>,
    request: LiveRelayJoinRequest,
) -> Result<LiveRelaySnapshot, String> {
    validate_live_relay_join_request(&request)?;
    let (base_url, authorization) = live_relay_context(&app).await?;
    let discovery = discover_live_sessions_http(&base_url, &authorization).await?;
    let preview = find_live_session_snapshot(&discovery, &request.live_session_id)?;
    let epoch = validate_live_session_snapshot(preview, &request.live_session_id)?;
    let remote = attach_live_viewer_http(&base_url, &authorization, &request, epoch).await?;
    let epoch = validate_live_session_snapshot(&remote, &request.live_session_id)?;
    let observation_capabilities = parse_live_observation_capabilities(&remote)?;
    let (trigger_registrations, trigger_audits) = parse_live_trigger_snapshot(&remote)?;
    let mut runtime_state = LiveRelayRuntimeState::starting(
        epoch,
        observation_capabilities.clone(),
        observation_capabilities
            .is_empty()
            .then(|| "source_did_not_advertise_observation".to_owned()),
    );
    runtime_state.trigger_registrations = trigger_registrations;
    runtime_state.trigger_audits = trigger_audits;
    let relay = Arc::new(LiveRelaySession {
        relay_id: next_live_relay_id(LiveRelayRole::Viewer),
        live_session_id: request.live_session_id,
        role: LiveRelayRole::Viewer,
        base_url,
        surface_instance_id: request.surface_instance_id,
        attachment_id: request.attachment_id,
        authorization,
        capture: None,
        state: Arc::new(Mutex::new(runtime_state)),
        frames: Arc::new(Mutex::new(LiveRelayFrameBuffer::new())),
        stop: Arc::new(AtomicBool::new(false)),
        reconnect: Arc::new(AtomicBool::new(false)),
        join: Mutex::new(None),
        control_join: Mutex::new(None),
        observation_join: Mutex::new(None),
        control_sequence: Mutex::new(1),
        input_sequence: Mutex::new(0),
    });
    let worker = spawn_live_relay_viewer_worker(Arc::clone(&relay))?;
    *relay
        .join
        .lock()
        .map_err(|_| "live relay worker lock poisoned".to_owned())? = Some(worker);
    let control_worker = match spawn_live_relay_control_worker(Arc::clone(&relay)) {
        Ok(worker) => worker,
        Err(error) => {
            let _ = relay.stop_and_join();
            return Err(error);
        }
    };
    *relay
        .control_join
        .lock()
        .map_err(|_| "live relay control worker lock poisoned".to_owned())? = Some(control_worker);
    if let Err(error) = relays.insert(Arc::clone(&relay)) {
        let _ = relay.stop_and_join();
        return Err(error);
    }
    append_runtime_log_line(&format!(
        "live_relay_viewer_started :: relay={} session={}",
        relay.relay_id, relay.live_session_id
    ));
    relay.snapshot()
}

#[tauri::command]
fn get_live_relay_status(
    relays: tauri::State<'_, SharedLiveRelaySessions>,
    relay_id: String,
) -> Result<LiveRelaySnapshot, String> {
    validate_live_relay_identifier(&relay_id, "relay id")?;
    relays.get(&relay_id)?.snapshot()
}

#[tauri::command]
async fn configure_live_relay_trigger(
    relays: tauri::State<'_, SharedLiveRelaySessions>,
    request: LiveRelayTriggerConfigureRequest,
) -> Result<LiveRelaySnapshot, String> {
    request.validate()?;
    let relay = relays.get(&request.relay_id)?;
    let worker_relay = Arc::clone(&relay);
    let worker_request = request.clone();
    let response = tokio::task::spawn_blocking(move || {
        configure_live_trigger_blocking(&worker_relay, &worker_request)
    })
    .await
    .map_err(|error| format!("live trigger configuration worker failed: {error}"))??;
    let (registrations, audits) = parse_live_trigger_snapshot(&response)?;
    {
        let mut state = relay
            .state
            .lock()
            .map_err(|_| "live relay state poisoned".to_owned())?;
        state.trigger_registrations = registrations;
        state.trigger_audits = audits;
    }
    relay.snapshot()
}

#[tauri::command]
fn reconnect_live_relay_session(
    relays: tauri::State<'_, SharedLiveRelaySessions>,
    relay_id: String,
) -> Result<LiveRelaySnapshot, String> {
    validate_live_relay_identifier(&relay_id, "relay id")?;
    let relay = relays.get(&relay_id)?;
    if relay.stop.load(Ordering::SeqCst) {
        return Err("live relay session is stopping".to_owned());
    }
    relay.reconnect.store(true, Ordering::SeqCst);
    relay.snapshot()
}

#[tauri::command]
fn poll_live_relay_frame(
    relays: tauri::State<'_, SharedLiveRelaySessions>,
    relay_id: String,
    after_frame_id: u64,
) -> Result<serde_json::Value, String> {
    validate_live_relay_identifier(&relay_id, "relay id")?;
    let relay = relays.get(&relay_id)?;
    if relay.role != LiveRelayRole::Viewer {
        return Err("live relay source sessions do not expose viewer frames".to_owned());
    }
    let frame = relay
        .frames
        .lock()
        .map_err(|_| "live relay frame buffer poisoned".to_owned())?
        .latest_after(after_frame_id);
    Ok(serde_json::json!({
        "status": relay.snapshot()?,
        "frame": frame,
    }))
}

#[tauri::command]
fn read_live_relay_frame(
    relays: tauri::State<'_, SharedLiveRelaySessions>,
    relay_id: String,
    frame_id: u64,
) -> Result<tauri::ipc::Response, String> {
    validate_live_relay_identifier(&relay_id, "relay id")?;
    if frame_id == 0 {
        return Err("live relay frame id must be positive".to_owned());
    }
    let relay = relays.get(&relay_id)?;
    if relay.role != LiveRelayRole::Viewer {
        return Err("live relay source sessions do not expose viewer frames".to_owned());
    }
    let payload = relay
        .frames
        .lock()
        .map_err(|_| "live relay frame buffer poisoned".to_owned())?
        .take_payload_for(frame_id)
        .ok_or_else(|| "live relay frame was evicted".to_owned())?;
    Ok(tauri::ipc::Response::new(payload))
}

#[tauri::command]
fn change_live_relay_controller(
    relays: tauri::State<'_, SharedLiveRelaySessions>,
    request: LiveRelayControlRequest,
) -> Result<LiveRelaySnapshot, String> {
    validate_live_relay_identifier(&request.relay_id, "relay id")?;
    if request
        .lease_duration_ms
        .is_some_and(|duration| !(1_000..=300_000).contains(&duration))
    {
        return Err("live relay controller lease must be between 1000 and 300000 ms".to_owned());
    }
    let relay = relays.get(&request.relay_id)?;
    change_live_controller_blocking(&relay, request.action, request.lease_duration_ms)?;
    relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned".to_owned())?
        .controller_owned = matches!(request.action, LiveRelayControlAction::Acquire);
    relay.snapshot()
}

#[tauri::command]
fn send_live_relay_input(
    relays: tauri::State<'_, SharedLiveRelaySessions>,
    request: LiveRelayInputRequest,
) -> Result<LiveRelaySnapshot, String> {
    validate_live_relay_identifier(&request.relay_id, "relay id")?;
    let relay = relays.get(&request.relay_id)?;
    send_live_relay_input_blocking(&relay, &request.input)?;
    relay.snapshot()
}

#[tauri::command]
fn reclaim_live_relay_control(
    relays: tauri::State<'_, SharedLiveRelaySessions>,
    relay_id: String,
) -> Result<LiveRelaySnapshot, String> {
    validate_live_relay_identifier(&relay_id, "relay id")?;
    let relay = relays.get(&relay_id)?;
    change_live_controller_blocking(&relay, LiveRelayControlAction::Revoke, None)?;
    set_live_relay_source_interaction(&relay, false)?;
    if let Ok(mut state) = relay.state.lock() {
        state.remote_control_active = false;
    }
    relay.snapshot()
}

#[tauri::command]
fn stop_live_relay_session(
    relays: tauri::State<'_, SharedLiveRelaySessions>,
    relay_id: String,
) -> Result<(), String> {
    validate_live_relay_identifier(&relay_id, "relay id")?;
    let relay = relays.remove(&relay_id)?;
    if relay.role == LiveRelayRole::Viewer
        && relay
            .state
            .lock()
            .map(|state| state.controller_owned)
            .unwrap_or(false)
    {
        let _ = change_live_controller_blocking(&relay, LiveRelayControlAction::Release, None);
    }
    if relay.role == LiveRelayRole::Source {
        let _ = change_live_controller_blocking(&relay, LiveRelayControlAction::Revoke, None);
    }
    let stop_result = relay.stop_and_join();
    let close_result = close_live_session_blocking(&relay);
    append_runtime_log_line(&format!(
        "live_relay_stopped :: relay={relay_id} worker_ok={} close_ok={}",
        stop_result.is_ok(),
        close_result.is_ok()
    ));
    stop_result.and(close_result)
}

fn shutdown_live_relay_sessions(app: &tauri::AppHandle) {
    if let Some(relays) = app.try_state::<SharedLiveRelaySessions>() {
        relays.shutdown_all();
    }
}

fn validate_live_relay_publish_request(request: &LiveRelayPublishRequest) -> Result<(), String> {
    validate_live_capture_session_id(&request.capture_session_id)?;
    validate_live_relay_identifier(&request.surface_instance_id, "Surface instance id")?;
    validate_live_relay_identifier(&request.source_attachment_id, "source attachment id")?;
    validate_live_relay_identifier(&request.source_hook_id, "source Hook id")?;
    if let Some(session_id) = &request.live_session_id {
        validate_live_relay_identifier(session_id, "live session id")?;
    }
    Ok(())
}

fn validate_live_relay_join_request(request: &LiveRelayJoinRequest) -> Result<(), String> {
    validate_live_relay_identifier(&request.live_session_id, "live session id")?;
    validate_live_relay_identifier(&request.surface_instance_id, "Surface instance id")?;
    validate_live_relay_identifier(&request.attachment_id, "viewer attachment id")
}

fn validate_live_session_snapshot(
    value: &serde_json::Value,
    expected_session_id: &str,
) -> Result<u64, String> {
    if value
        .pointer("/session/protocolVersion")
        .and_then(serde_json::Value::as_str)
        != Some(LIVE_RELAY_PROTOCOL_VERSION)
        || value
            .pointer("/session/sessionId")
            .and_then(serde_json::Value::as_str)
            != Some(expected_session_id)
        || value
            .get("closed")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true)
    {
        return Err("Loom live session response has an invalid identity or is closed".to_owned());
    }
    value
        .get("epoch")
        .and_then(serde_json::Value::as_u64)
        .filter(|epoch| *epoch > 0)
        .ok_or_else(|| "Loom live session response has no valid epoch".to_owned())
}

fn find_live_session_snapshot<'a>(
    discovery: &'a serde_json::Value,
    session_id: &str,
) -> Result<&'a serde_json::Value, String> {
    discovery
        .get("sessions")
        .and_then(serde_json::Value::as_array)
        .and_then(|sessions| {
            sessions.iter().find(|session| {
                session
                    .pointer("/session/sessionId")
                    .and_then(serde_json::Value::as_str)
                    == Some(session_id)
            })
        })
        .ok_or_else(|| "Loom live session is not discoverable".to_owned())
}

#[cfg(test)]
mod live_relay_command_tests {
    use super::*;

    #[test]
    fn snapshot_validation_requires_exact_protocol_identity_and_open_state() {
        let valid = serde_json::json!({
            "session": { "protocolVersion": LIVE_RELAY_PROTOCOL_VERSION, "sessionId": "live:test" },
            "epoch": 1,
            "closed": false,
        });
        assert_eq!(validate_live_session_snapshot(&valid, "live:test"), Ok(1));
        let mut closed = valid;
        closed["closed"] = serde_json::Value::Bool(true);
        assert!(validate_live_session_snapshot(&closed, "live:test").is_err());
    }
}
