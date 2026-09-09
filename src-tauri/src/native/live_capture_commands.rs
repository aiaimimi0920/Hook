// Exposes local live-capture lifecycle and raw binary frame delivery to the WebView.

#[tauri::command]
fn start_live_capture(
    window: tauri::WebviewWindow,
    sessions: tauri::State<'_, SharedLiveCaptureSessions>,
    request: LiveCaptureStartRequest,
) -> Result<LiveCaptureStatusSnapshot, String> {
    validate_live_capture_request(&request)?;
    let display_metrics = capture_window_metrics(&window)
        .ok_or_else(|| "live capture display metrics are unavailable".to_string())?;
    let window_region = request
        .window_region
        .map(|region| physical_live_capture_window_region(region, display_metrics.scale_factor))
        .transpose()?;
    let session_id = next_live_capture_session_id();
    #[cfg(target_os = "windows")]
    let source_window = request
        .window_id
        .as_deref()
        .map(|window_id| LiveSourceWindowLifecycle::new_with_region(window_id, window_region))
        .transpose()?
        .map(|source| Arc::new(Mutex::new(source)));
    #[cfg(not(target_os = "windows"))]
    let source_window = None;
    #[cfg(target_os = "windows")]
    let expected_process_id = source_window
        .as_ref()
        .and_then(|source| source.lock().ok().map(|source| source.process_id));
    #[cfg(not(target_os = "windows"))]
    let expected_process_id = None;
    let config = LiveCaptureWorkerConfig {
        session_id: session_id.clone(),
        window_id: request.window_id,
        expected_process_id,
        source_title: request.source_title,
        x: request.x,
        y: request.y,
        width: request.width,
        height: request.height,
        window_region,
        target_fps: request.target_fps,
        display_metrics,
        source_window: source_window.clone(),
    };
    let state = Arc::new(Mutex::new(LiveCaptureSessionState::starting(&config)));
    let frames = Arc::new(Mutex::new(LiveCaptureFrameBuffer::new()));
    let dropped_frames = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let (stop_tx, stop_rx) = mpsc::sync_channel(1);

    #[cfg(target_os = "windows")]
    let join = screenshot::spawn_live_capture_worker(
        config,
        state.clone(),
        frames.clone(),
        dropped_frames.clone(),
        stop_rx,
    )?;
    #[cfg(not(target_os = "windows"))]
    let join = {
        let _ = (config, stop_rx);
        return Err("live capture requires Windows 11 WGC".to_string());
    };

    let session = Arc::new(LiveCaptureSession {
        state: state.clone(),
        frames,
        dropped_frames: dropped_frames.clone(),
        stop_tx: Mutex::new(Some(stop_tx)),
        join: Mutex::new(Some(join)),
        source_window,
    });
    if let Err(error) = sessions.insert(session_id.clone(), session.clone()) {
        let _ = session.stop_and_join();
        return Err(error);
    }
    append_runtime_log_line(&format!("live_capture_started :: session={session_id}"));
    let status = snapshot_live_capture_state(&state, &dropped_frames)?;
    append_runtime_log_line(&format!(
        "live_capture_input_capability :: session={session_id} capability={} enabled={}",
        status.input_capability, status.interaction_enabled
    ));
    Ok(status)
}

#[tauri::command]
fn get_live_capture_status(
    sessions: tauri::State<'_, SharedLiveCaptureSessions>,
    session_id: String,
) -> Result<LiveCaptureStatusSnapshot, String> {
    validate_live_capture_session_id(&session_id)?;
    let session = sessions.get(&session_id)?;
    snapshot_live_capture_state(&session.state, &session.dropped_frames)
}

#[tauri::command]
fn poll_live_capture_frame(
    sessions: tauri::State<'_, SharedLiveCaptureSessions>,
    session_id: String,
    after_frame_id: u64,
) -> Result<LiveCapturePollResponse, String> {
    validate_live_capture_session_id(&session_id)?;
    let session = sessions.get(&session_id)?;
    let frame = session
        .frames
        .lock()
        .map_err(|_| "live capture frame buffer poisoned".to_string())?
        .latest_after(after_frame_id);
    Ok(LiveCapturePollResponse {
        status: snapshot_live_capture_state(&session.state, &session.dropped_frames)?,
        frame,
    })
}

#[tauri::command]
fn read_live_capture_frame(
    sessions: tauri::State<'_, SharedLiveCaptureSessions>,
    session_id: String,
    frame_id: u64,
) -> Result<tauri::ipc::Response, String> {
    validate_live_capture_session_id(&session_id)?;
    if frame_id == 0 {
        return Err("live capture frame id must be positive".to_string());
    }
    let session = sessions.get(&session_id)?;
    let bytes = session
        .frames
        .lock()
        .map_err(|_| "live capture frame buffer poisoned".to_string())?
        .take_bytes_for(frame_id)
        .ok_or_else(|| "live capture frame was evicted".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn set_live_capture_source_hidden(
    sessions: tauri::State<'_, SharedLiveCaptureSessions>,
    session_id: String,
    hidden: bool,
) -> Result<LiveCaptureStatusSnapshot, String> {
    let session = live_capture_session_with_source(&sessions, &session_id)?;
    let mut source = session
        .source_window
        .as_ref()
        .expect("validated live source")
        .lock()
        .map_err(|_| "live source window lock poisoned".to_string())?;
    source.set_logically_hidden(hidden, "user_requested")?;
    update_live_source_status(&session, &source)?;
    snapshot_live_capture_state(&session.state, &session.dropped_frames)
}

#[tauri::command]
fn set_live_capture_interaction_enabled(
    sessions: tauri::State<'_, SharedLiveCaptureSessions>,
    session_id: String,
    enabled: bool,
) -> Result<LiveCaptureStatusSnapshot, String> {
    let session = live_capture_session_with_source(&sessions, &session_id)?;
    let mut source = session
        .source_window
        .as_ref()
        .expect("validated live source")
        .lock()
        .map_err(|_| "live source window lock poisoned".to_string())?;
    let result = source.set_interaction_enabled(enabled);
    update_live_source_status(&session, &source)?;
    append_runtime_log_line(&format!(
        "live_capture_interaction :: session={session_id} enabled={} capability={} ok={}",
        source.interaction_enabled,
        source.input_capability,
        result.is_ok()
    ));
    result?;
    snapshot_live_capture_state(&session.state, &session.dropped_frames)
}

#[tauri::command]
async fn send_live_capture_input(
    sessions: tauri::State<'_, SharedLiveCaptureSessions>,
    session_id: String,
    request: LiveCaptureInputRequest,
) -> Result<(), String> {
    let session = live_capture_session_with_source(&sessions, &session_id)?;
    run_live_input_job(move || deliver_live_capture_input(&session, &session_id, &request)).await
}

#[tauri::command]
fn stop_live_capture(
    sessions: tauri::State<'_, SharedLiveCaptureSessions>,
    session_id: String,
) -> Result<(), String> {
    validate_live_capture_session_id(&session_id)?;
    let session = sessions.remove(&session_id)?;
    let result = session.stop_and_join();
    append_runtime_log_line(&format!(
        "live_capture_stopped :: session={session_id} ok={}",
        result.is_ok()
    ));
    result
}

fn live_capture_session_with_source(
    sessions: &SharedLiveCaptureSessions,
    session_id: &str,
) -> Result<Arc<LiveCaptureSession>, String> {
    validate_live_capture_session_id(session_id)?;
    let session = sessions.get(session_id)?;
    if session.source_window.is_none() {
        return Err("live source window control is unsupported for region capture".to_string());
    }
    Ok(session)
}

fn update_live_source_status(
    session: &LiveCaptureSession,
    source: &LiveSourceWindowLifecycle,
) -> Result<(), String> {
    session
        .state
        .lock()
        .map_err(|_| "live capture state poisoned".to_string())?
        .set_source_window_status(source);
    Ok(())
}

fn shutdown_live_capture_sessions(app: &tauri::AppHandle) {
    if let Some(sessions) = app.try_state::<SharedLiveCaptureSessions>() {
        sessions.shutdown_all();
    }
    crate::live_gpu::shutdown();
}

fn validate_live_capture_request(request: &LiveCaptureStartRequest) -> Result<(), String> {
    if request.width == 0
        || request.height == 0
        || request.width > 16_384
        || request.height > 16_384
    {
        return Err("live capture dimensions are invalid".to_string());
    }
    if request.x.unsigned_abs() > 1_000_000 || request.y.unsigned_abs() > 1_000_000 {
        return Err("live capture origin is invalid".to_string());
    }
    if !(1..=60).contains(&request.target_fps) {
        return Err("live capture target fps must be between 1 and 60".to_string());
    }
    if request
        .source_title
        .as_ref()
        .is_some_and(|title| title.chars().count() > 512)
    {
        return Err("live capture source title is too long".to_string());
    }
    if let Some(window_id) = &request.window_id {
        let trimmed = window_id.trim_start_matches("0x");
        if trimmed.is_empty()
            || trimmed.len() > 16
            || !trimmed.bytes().all(|value| value.is_ascii_hexdigit())
        {
            return Err("live capture window id is invalid".to_string());
        }
    }
    if request.window_region.is_some() && request.window_id.is_none() {
        return Err("live capture window region requires a window id".to_string());
    }
    if let Some(region) = request.window_region {
        validate_live_capture_window_region(region)?;
    }
    Ok(())
}

fn validate_live_capture_session_id(session_id: &str) -> Result<(), String> {
    if session_id.is_empty()
        || session_id.len() > 160
        || !session_id.bytes().all(|value| {
            value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_' | b'.' | b':')
        })
    {
        return Err("live capture session id is invalid".to_string());
    }
    Ok(())
}

fn snapshot_live_capture_state(
    state: &Arc<Mutex<LiveCaptureSessionState>>,
    dropped_frames: &std::sync::atomic::AtomicU64,
) -> Result<LiveCaptureStatusSnapshot, String> {
    let dropped = dropped_frames.load(std::sync::atomic::Ordering::Relaxed);
    state
        .lock()
        .map_err(|_| "live capture state poisoned".to_string())
        .map(|state| state.snapshot(dropped))
}

#[cfg(test)]
mod live_capture_command_tests {
    use super::*;

    #[test]
    fn live_capture_request_bounds_fps_dimensions_and_window_identity() {
        let mut request = LiveCaptureStartRequest {
            window_id: Some("1a2b".to_string()),
            source_title: Some("Fixture".to_string()),
            window_region: Some(LiveCaptureWindowRegion {
                x: 100.0,
                y: 100.0,
                width: 50.0,
                height: 50.0,
            }),
            x: 0,
            y: 0,
            width: 640,
            height: 360,
            target_fps: 12,
        };
        assert!(validate_live_capture_request(&request).is_ok());
        request.target_fps = default_live_capture_fps();
        assert_eq!(request.target_fps, 60);
        assert!(validate_live_capture_request(&request).is_ok());
        request.target_fps = 0;
        assert!(validate_live_capture_request(&request).is_err());
        request.target_fps = 61;
        assert!(validate_live_capture_request(&request).is_err());
        request.target_fps = 12;
        request.window_id = Some("not-a-hwnd".to_string());
        assert!(validate_live_capture_request(&request).is_err());
        request.window_id = None;
        assert!(validate_live_capture_request(&request).is_err());
    }
}
