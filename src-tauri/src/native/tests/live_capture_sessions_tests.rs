use super::*;

fn session(id: &str, source: &str) -> Arc<LiveCaptureSession> {
    let config = LiveCaptureWorkerConfig {
        session_id: id.into(), window_id: Some(source.into()), expected_process_id: None,
        source_title: None, x: 0, y: 0, width: 100, height: 100, window_region: None,
        target_fps: 12,
        display_metrics: CaptureWindowMetrics {
            physical_origin_x: 0.0, physical_origin_y: 0.0, scale_factor: 1.5,
            logical_width: 800.0, logical_height: 600.0,
        },
        source_window: None,
    };
    Arc::new(LiveCaptureSession {
        state: Arc::new(Mutex::new(LiveCaptureSessionState::starting(&config))),
        frames: Arc::new(Mutex::new(LiveCaptureFrameBuffer::new())),
        dropped_frames: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        stop_tx: Mutex::new(None), join: Mutex::new(None), source_window: None,
    })
}

#[test]
fn live_sessions_allow_same_window_and_stop_only_the_requested_region() {
    let sessions = SharedLiveCaptureSessions::new();
    let first = session("first", "123");
    let second = session("second", "123");
    let third = session("third", "456");
    sessions.insert("first".into(), first.clone()).unwrap();
    sessions.insert("second".into(), second.clone()).unwrap();
    sessions.insert("third".into(), third.clone()).unwrap();
    sessions.remove("second").unwrap().stop_and_join().unwrap();
    assert!(sessions.get("second").is_err());
    assert_eq!(second.state.lock().unwrap().capture_state, "closed");
    assert!(Arc::ptr_eq(&sessions.get("first").unwrap(), &first));
    assert!(Arc::ptr_eq(&sessions.get("third").unwrap(), &third));
    assert_ne!(first.state.lock().unwrap().capture_state, "closed");
    sessions.shutdown_all();
    assert_eq!(first.state.lock().unwrap().capture_state, "closed");
    assert_eq!(third.state.lock().unwrap().capture_state, "closed");
}

#[test]
fn live_sessions_remain_bounded_and_reuse_a_released_slot() {
    let sessions = SharedLiveCaptureSessions::new();
    for index in 0..LIVE_CAPTURE_MAX_SESSIONS {
        let id = index.to_string();
        sessions.insert(id.clone(), session(&id, "123")).unwrap();
    }
    assert_eq!(sessions.insert("extra".into(), session("extra", "123")).unwrap_err(),
        "live capture session limit reached");
    sessions.remove("0").unwrap().stop_and_join().unwrap();
    sessions.insert("extra".into(), session("extra", "123")).unwrap();
    sessions.shutdown_all();
}

#[test]
fn live_session_id_collision_does_not_replace_the_existing_worker() {
    let sessions = SharedLiveCaptureSessions::new();
    let original = session("same-id", "123");
    sessions.insert("same-id".into(), original.clone()).unwrap();
    assert_eq!(sessions.insert("same-id".into(), session("same-id", "456")).unwrap_err(),
        "live capture session id collision");
    assert!(Arc::ptr_eq(&sessions.get("same-id").unwrap(), &original));
    sessions.shutdown_all();
}
