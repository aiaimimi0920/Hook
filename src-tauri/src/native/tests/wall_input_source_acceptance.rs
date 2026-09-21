// Native WGC/relay source for the wall probe. No app instance, global hooks, or mutex bypass.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WallInputSourceReady {
    base_url: String,
    source_device_id: String,
    source_token: String,
    surface_instance_id: String,
    source_attachment_id: String,
    hwnd: String,
    duration_seconds: u64,
}

struct WallInputSourceGuard {
    capture: Arc<LiveCaptureSession>,
    relay: Option<Arc<LiveRelaySession>>,
    finished: bool,
}

impl WallInputSourceGuard {
    fn finish(&mut self) -> bool {
        if self.finished {
            return true;
        }
        self.finished = true;
        let mut joined = true;
        if let Some(relay) = &self.relay {
            joined &= relay.stop_and_join().is_ok();
            joined &= release_live_relay_source_inputs(relay).is_ok();
            let _ = close_live_session_blocking(relay);
        }
        joined & self.capture.stop_and_join().is_ok()
    }
}

impl Drop for WallInputSourceGuard {
    fn drop(&mut self) {
        self.finish();
    }
}

fn wall_source_probe_status(guard: &WallInputSourceGuard) -> serde_json::Value {
    let relay = guard.relay.as_ref().expect("probe relay");
    let snapshot = relay.snapshot().expect("probe relay status");
    let state = relay.state.lock().expect("probe authority");
    let source = guard.capture.source_window.as_ref().expect("probe source");
    let source = source.lock().expect("probe source state");
    serde_json::json!({
        "frames": snapshot.received_frames, "lastFrameId": snapshot.last_frame_id,
        "controllerDeviceId": state.controller_device_id,
        "remoteControlActive": state.remote_control_active,
        "errorCode": state.error_code, "errorMessage": state.error_message,
        "pressedMouseButtons": source.pressed_mouse_buttons,
        "pressedKeyCount": source.pressed_virtual_keys.len(),
        "interactionEnabled": source.interaction_enabled,
    })
}

fn wall_probe_capture_config(hwnd: HWND) -> LiveCaptureWorkerConfig {
    use windows::Win32::Foundation::{POINT, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::HiDpi::LogicalToPhysicalPointForPerMonitorDPI;
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;
    let _dpi = enter_live_source_dpi_context(hwnd).expect("fixture DPI context");
    let mut frame = RECT::default();
    let mut client = RECT::default();
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&raw mut frame).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
        .expect("fixture frame bounds");
        GetClientRect(hwnd, &mut client).expect("fixture client bounds");
    }
    let mut origin = POINT { x: 0, y: 0 };
    let mut end = POINT {
        x: client.right,
        y: client.bottom,
    };
    unsafe {
        assert!(ClientToScreen(hwnd, &mut origin).as_bool());
        assert!(ClientToScreen(hwnd, &mut end).as_bool());
        assert!(LogicalToPhysicalPointForPerMonitorDPI(Some(hwnd), &mut origin).as_bool());
        assert!(LogicalToPhysicalPointForPerMonitorDPI(Some(hwnd), &mut end).as_bool());
    }
    // The fixture publishes client-normalized targets. Capture that exact visible region
    // so the tested wall coordinates also point at the displayed controls, excluding chrome.
    let region = LiveCapturePhysicalRegion {
        left: u32::try_from(origin.x - frame.left).expect("client left inset"),
        top: u32::try_from(origin.y - frame.top).expect("client top inset"),
        width: u32::try_from(end.x - origin.x).expect("client width"),
        height: u32::try_from(end.y - origin.y).expect("client height"),
    };
    let mut config = phase_four_capture_config(hwnd, false);
    config.width = region.width;
    config.height = region.height;
    config.window_region = Some(region);
    config.source_window = Some(Arc::new(Mutex::new(
        LiveSourceWindowLifecycle::new_with_region(&format!("{:x}", hwnd.0 as usize), Some(region))
            .expect("client-region input owner"),
    )));
    config
}

#[test]
#[ignore = "started by the isolated tile wall native input probe"]
fn wall_input_native_source_endpoint() {
    let root = PathBuf::from(std::env::var_os("HOOK_WALL_INPUT_PROBE_ROOT").expect("probe root"));
    let ready: WallInputSourceReady = read_phase_four_json(&root.join("source-private.json"));
    assert!((30..=900).contains(&ready.duration_seconds));
    assert!(ready.base_url.starts_with("http://127.0.0.1:"));
    let hwnd = HWND(ready.hwnd.parse::<isize>().expect("fixture HWND") as *mut std::ffi::c_void);
    let config = wall_probe_capture_config(hwnd);
    let source_window = config.source_window.clone();
    let state = Arc::new(Mutex::new(LiveCaptureSessionState::starting(&config)));
    let frames = Arc::new(Mutex::new(LiveCaptureFrameBuffer::new()));
    let dropped = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let (stop_tx, stop_rx) = mpsc::sync_channel(1);
    let worker = crate::screenshot::spawn_live_capture_worker(
        config,
        Arc::clone(&state),
        Arc::clone(&frames),
        Arc::clone(&dropped),
        stop_rx,
    )
    .expect("start native WGC fixture source");
    let capture = Arc::new(LiveCaptureSession {
        state: Arc::clone(&state),
        frames,
        dropped_frames: Arc::clone(&dropped),
        stop_tx: Mutex::new(Some(stop_tx)),
        join: Mutex::new(Some(worker)),
        source_window,
    });
    let mut guard = WallInputSourceGuard {
        capture: Arc::clone(&capture),
        relay: None,
        finished: false,
    };
    assert!(wait_for_capture_streaming(&state, Duration::from_secs(15)));
    {
        let mut source = capture.source_window.as_ref().unwrap().lock().unwrap();
        source
            .set_logically_hidden(true, "wall_native_probe")
            .expect("hide fixture logically");
        update_live_source_status(&capture, &source).expect("update fixture capture status");
    }
    let authorization = crate::device_session::DeviceSessionAuthorization::device_for_test(
        &ready.source_device_id,
        &ready.source_token,
    );
    let capture_status = snapshot_live_capture_state(&state, &dropped).expect("capture status");
    let session_id = format!("live:wall-probe:{}", uuid::Uuid::new_v4());
    let request = LiveRelayPublishRequest {
        capture_session_id: capture_status.session_id.clone(),
        surface_instance_id: Some(ready.surface_instance_id.clone()),
        source_attachment_id: Some(ready.source_attachment_id.clone()),
        source_hook_id: "hook-node:wall-input-source".into(),
        live_session_id: Some(session_id.clone()),
    };
    let body = build_live_session_create_body(
        &request,
        &capture_status,
        &authorization.device_id,
        &session_id,
        &[],
    );
    let runtime = tokio::runtime::Runtime::new().expect("native probe runtime");
    let response = runtime
        .block_on(create_live_session_http(
            &ready.base_url,
            &authorization,
            &body,
        ))
        .expect("publish fixture through real paired-device API");
    let epoch = validate_live_session_snapshot(&response, &session_id).expect("source epoch");
    let relay = phase_four_relay(
        LiveRelayRole::Source,
        &ready.base_url,
        &session_id,
        epoch,
        &ready.surface_instance_id,
        &ready.source_attachment_id,
        authorization,
        Some(Arc::clone(&capture)),
        Vec::new(),
        None,
    );
    guard.relay = Some(Arc::clone(&relay));
    *relay.join.lock().unwrap() = Some(
        spawn_live_relay_source_worker(Arc::clone(&relay), Arc::clone(&capture))
            .expect("start native source media"),
    );
    *relay.control_join.lock().unwrap() = Some(
        spawn_live_relay_control_worker(Arc::clone(&relay)).expect("start native source input"),
    );
    write_phase_four_json(
        &root.join("input-source-ready.json"),
        &serde_json::json!({
            "sessionId": session_id, "captureSessionId": capture_status.session_id,
            "sourceDeviceId": ready.source_device_id,
        "sourceKind": "native WGC client region and production input relay in Rust test harness",
            "executable": std::env::current_exe().unwrap(), "pid": std::process::id(),
        }),
    );
    let start = Instant::now();
    while !root.join("stop-source").exists() && start.elapsed().as_secs() < ready.duration_seconds {
        write_phase_four_json(
            &root.join("source-status.json"),
            &wall_source_probe_status(&guard),
        );
        std::thread::sleep(Duration::from_millis(100));
    }
    let timed_out = !root.join("stop-source").exists();
    let status = wall_source_probe_status(&guard);
    let reasons = phase_four_event_reasons(guard.relay.as_ref().unwrap()).unwrap_or_default();
    let joined = guard.finish();
    let cleaned = wall_source_probe_status(&guard);
    write_phase_four_json(
        &root.join("source-summary.json"),
        &serde_json::json!({
            "timedOut": timed_out, "elapsedMs": start.elapsed().as_millis(),
        "beforeCleanup": status, "afterCleanup": cleaned, "workersJoined": joined,
        "eventReasons": reasons,
        }),
    );
    assert!(
        !timed_out,
        "wall probe did not request bounded source shutdown"
    );
    assert!(joined, "native source workers or input cleanup failed");
    assert!(status["frames"].as_u64().unwrap_or(0) >= 3);
}
