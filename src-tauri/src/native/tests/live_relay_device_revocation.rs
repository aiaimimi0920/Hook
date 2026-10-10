// 专用 Policy/reason 来自原已认证媒体连接，不把普通 Close 或 HTTP 失败解释为撤销。
#[test]
fn device_terminal_close_clears_frames_and_stops_real_viewer_worker() {
    use tungstenite::protocol::frame::coding::CloseCode;
    let fixture = MediaCloseFixture::new(CloseCode::Policy, "live_media_device_revoked", true);
    let relay = device_viewer(fixture.url.clone());
    *relay.join.lock().unwrap() = Some(spawn_live_relay_viewer_worker(Arc::clone(&relay)).unwrap());
    let received = wait_media(|| relay.snapshot().unwrap().received_frames == 1);
    fixture.close.send(()).unwrap();
    let terminal = wait_media(|| relay.stop.load(Ordering::SeqCst));
    std::thread::sleep(Duration::from_millis(650));
    let status = relay.snapshot().unwrap();
    let empty = relay.frames.lock().unwrap().frames.is_empty();
    let requests = fixture.requests.load(Ordering::SeqCst);
    relay.stop_and_join().unwrap();
    assert!(
        received,
        "fixture frame was not accepted: status={status:?}, requests={requests}"
    );
    assert!(
        terminal,
        "authoritative Device revocation did not stop viewer"
    );
    assert_eq!(status.connection_state, "closed");
    assert_eq!(
        status.error_code.as_deref(),
        Some("live_media_device_revoked")
    );
    assert!(empty, "revoked viewer retained old pixels");
    assert_eq!(requests, 1, "revoked viewer attempted resume/reconnect");
    assert!(accept_live_relay_viewer_frame(&relay, &frame_bytes()).is_err());
}

#[test]
fn ordinary_policy_close_keeps_recovery_and_previous_pixels() {
    use tungstenite::protocol::frame::coding::CloseCode;
    let fixture = MediaCloseFixture::new(CloseCode::Policy, "device_session_expired", true);
    let relay = device_viewer(fixture.url.clone());
    *relay.join.lock().unwrap() = Some(spawn_live_relay_viewer_worker(Arc::clone(&relay)).unwrap());
    let received = wait_media(|| relay.snapshot().unwrap().received_frames == 1);
    fixture.close.send(()).unwrap();
    let retried = wait_media(|| fixture.requests.load(Ordering::SeqCst) > 1);
    let stopped = relay.stop.load(Ordering::SeqCst);
    let has_frame = !relay.frames.lock().unwrap().frames.is_empty();
    relay.stop_and_join().unwrap();
    assert!(
        received && retried,
        "ordinary closure did not enter recovery"
    );
    assert!(!stopped);
    assert!(has_frame, "recoverable failure discarded previous pixels");
}

#[test]
fn terminal_signal_requires_exact_device_close_identity_and_is_sticky_for_recovery() {
    use tungstenite::protocol::{frame::coding::CloseCode, CloseFrame};
    let relay = device_viewer("http://127.0.0.1:1".to_owned());
    accept_live_relay_viewer_frame(&relay, &frame_bytes()).unwrap();
    for (code, reason) in [
        (CloseCode::Normal, "live_media_device_revoked"),
        (CloseCode::Policy, "device_session_expired"),
        (CloseCode::Policy, "live_media_device_revoked extra"),
    ] {
        assert!(!close_live_relay_if_device_revoked(
            &relay,
            Some(&CloseFrame {
                code,
                reason: reason.into()
            })
        ));
        assert!(!relay.stop.load(Ordering::SeqCst));
        assert!(ensure_live_relay_not_revoked(&relay).is_ok());
    }
    let terminal = CloseFrame {
        code: CloseCode::Policy,
        reason: "live_media_device_revoked".into(),
    };
    let admin = viewer_relay("http://127.0.0.1:1".to_owned());
    assert!(!close_live_relay_if_device_revoked(&admin, Some(&terminal)));
    assert!(!close_live_relay_if_device_revoked(&relay, None));
    assert!(close_live_relay_if_device_revoked(&relay, Some(&terminal)));
    relay.stop_and_join().unwrap();
    mark_live_relay_connected(&relay);
    fail_live_relay_control(&relay, "late_failure", "late");
    assert!(ensure_live_relay_not_revoked(&relay).is_err());
    assert_eq!(
        relay.snapshot().unwrap().error_code.as_deref(),
        Some("live_media_device_revoked")
    );
    let relays = SharedLiveRelaySessions::new();
    relays.insert(Arc::clone(&relay)).unwrap();
    // replace_source must reject before attempting to start a worker, even after shutdown join.
    assert!(relays
        .replace_source(&relay, viewer_relay(relay.base_url.clone()))
        .unwrap_err()
        .starts_with("source_recovery_unavailable:"));
    assert!(Arc::ptr_eq(&relays.get(&relay.relay_id).unwrap(), &relay));
}

#[test]
fn source_socket_service_preserves_authoritative_terminal_close() {
    use tungstenite::protocol::frame::coding::CloseCode;
    let fixture = MediaCloseFixture::new(CloseCode::Policy, "live_media_device_revoked", false);
    let mut relay = device_viewer(fixture.url.clone());
    Arc::get_mut(&mut relay).unwrap().role = LiveRelayRole::Source;
    let mut socket = connect_live_relay_socket(&relay, 0, 0).unwrap().socket;
    fixture.close.send(()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline && service_live_relay_source_socket(&relay, &mut socket).is_ok()
    {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(relay.stop.load(Ordering::SeqCst));
    assert_eq!(relay.snapshot().unwrap().connection_state, "closed");
    assert!(ensure_live_relay_not_revoked(&relay).is_err());
}

#[test]
fn publishing_source_worker_consumes_terminal_close_before_more_frames() {
    use tungstenite::protocol::frame::coding::CloseCode;
    let fixture = MediaCloseFixture::new(CloseCode::Policy, "live_media_device_revoked", false);
    let config = LiveCaptureWorkerConfig {
        session_id: "synthetic-capture".to_owned(),
        window_id: None,
        expected_process_id: None,
        source_title: None,
        x: 0,
        y: 0,
        width: 64,
        height: 32,
        window_region: None,
        target_fps: 60,
        display_metrics: CaptureWindowMetrics {
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            scale_factor: 1.0,
            logical_width: 800.0,
            logical_height: 600.0,
        },
        source_window: None,
    };
    let _budget = crate::live_gpu::work_budget::CaptureBudget::register(
        &config.session_id,
        config.target_fps,
    );
    let capture = Arc::new(LiveCaptureSession {
        state: Arc::new(Mutex::new(LiveCaptureSessionState::starting(&config))),
        frames: Arc::new(Mutex::new(LiveCaptureFrameBuffer::new())),
        dropped_frames: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        stop_tx: Mutex::new(None),
        join: Mutex::new(None),
        source_window: None,
    });
    let mut relay = device_viewer(fixture.url.clone());
    Arc::get_mut(&mut relay).unwrap().role = LiveRelayRole::Source;
    Arc::get_mut(&mut relay).unwrap().capture = Some(Arc::clone(&capture));
    let worker_relay = Arc::clone(&relay);
    let worker_capture = Arc::clone(&capture);
    *relay.join.lock().unwrap() = Some(std::thread::spawn(move || {
        run_live_relay_source(worker_relay, worker_capture)
    }));
    let jpeg =
        Arc::new(include_bytes!("../../../../protocol/fixtures/live-jpeg-v1.nllv")[64..].to_vec());
    let producing = Arc::clone(&capture);
    let producer_stop = Arc::clone(&relay.stop);
    let producer = std::thread::spawn(move || {
        for frame_id in 1..=100 {
            if producer_stop.load(Ordering::SeqCst) {
                break;
            }
            producing.frames.lock().unwrap().push(
                LiveCaptureFrame {
                    descriptor: LiveCaptureFrameDescriptor {
                        session_id: config.session_id.clone(),
                        epoch: 1,
                        frame_id,
                        capture_timestamp_ms: frame_id,
                        encode_timestamp_ms: frame_id,
                        width: 64,
                        height: 32,
                        mime: "image/jpeg".to_owned(),
                        byte_length: jpeg.len(),
                        dropped_frames: 0,
                    },
                    bytes: Arc::clone(&jpeg),
                },
                &producing.dropped_frames,
            );
            std::thread::sleep(Duration::from_millis(15));
        }
    });
    let published = wait_media(|| fixture.published.load(Ordering::SeqCst) >= 2);
    fixture.close.send(()).unwrap();
    let stopped = wait_media(|| relay.stop.load(Ordering::SeqCst));
    relay.stop_and_join().unwrap();
    producer.join().unwrap();
    assert!(
        published,
        "real source worker did not continuously publish the synthetic frames"
    );
    assert!(
        stopped,
        "publishing source failed to consume terminal Close"
    );
    let snapshot = relay.snapshot().unwrap();
    let timing = snapshot.source_timing.as_ref().unwrap();
    assert_eq!(timing.socket_send.succeeded, snapshot.received_frames);
    assert!(timing.socket_send.succeeded >= 2);
    assert!(timing.adaptation.succeeded >= timing.socket_send.succeeded);
    assert!(timing.socket_service.attempts >= timing.socket_send.succeeded);
    assert_eq!(timing.socket_send.empty, 0);
    assert_eq!(
        snapshot.error_code.as_deref(),
        Some("live_media_device_revoked")
    );
    assert_eq!(fixture.requests.load(Ordering::SeqCst), 1);
}
