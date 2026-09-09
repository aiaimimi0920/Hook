// Shared source/relay construction for the Phase 4-6 end-to-end probes.
fn phase_four_relay(
    role: LiveRelayRole,
    base_url: &str,
    live_session_id: &str,
    epoch: u64,
    surface_instance_id: &str,
    attachment_id: &str,
    authorization: crate::device_session::DeviceSessionAuthorization,
    capture: Option<Arc<LiveCaptureSession>>,
    observation_capabilities: Vec<String>,
    observation_reason: Option<String>,
) -> Arc<LiveRelaySession> {
    Arc::new(LiveRelaySession {
        relay_id: next_live_relay_id(role),
        live_session_id: live_session_id.to_owned(),
        role,
        base_url: base_url.to_owned(),
        surface_instance_id: surface_instance_id.to_owned(),
        attachment_id: attachment_id.to_owned(),
        authorization,
        capture,
        state: Arc::new(Mutex::new(LiveRelayRuntimeState::starting(
            epoch,
            observation_capabilities,
            observation_reason,
        ))),
        frames: Arc::new(Mutex::new(LiveRelayFrameBuffer::new())),
        stop: Arc::new(AtomicBool::new(false)),
        reconnect: Arc::new(AtomicBool::new(false)),
        join: Mutex::new(None),
        control_join: Mutex::new(None),
        observation_join: Mutex::new(None),
        control_sequence: Mutex::new(1),
        input_sequence: Mutex::new(0),
    })
}

fn phase_four_capture_config(hwnd: HWND, interactive: bool) -> LiveCaptureWorkerConfig {
    let source_window = interactive.then(|| {
        Arc::new(Mutex::new(
            LiveSourceWindowLifecycle::new_with_region(&format!("{:x}", hwnd.0 as usize), None)
                .expect("create live source lifecycle"),
        ))
    });
    let expected_process_id = source_window
        .as_ref()
        .and_then(|source| source.lock().ok().map(|source| source.process_id));
    LiveCaptureWorkerConfig {
        session_id: format!("phase4-source-{}", std::process::id()),
        window_id: Some(format!("{:x}", hwnd.0 as usize)),
        expected_process_id,
        source_title: Some("Hook live Phase 4 source".to_owned()),
        x: 0,
        y: 0,
        width: 640,
        height: 420,
        window_region: None,
        target_fps: 12,
        display_metrics: CaptureWindowMetrics {
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            scale_factor: 1.0,
            logical_width: 1920.0,
            logical_height: 1080.0,
        },
        source_window,
    }
}

fn wait_for_capture_streaming(
    state: &Arc<Mutex<LiveCaptureSessionState>>,
    timeout: Duration,
) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if state
            .lock()
            .map(|state| state.capture_state == "streaming")
            .unwrap_or(false)
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}
