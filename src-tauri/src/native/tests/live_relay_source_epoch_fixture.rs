// Synthetic local capture generations feed the production source worker over a real bounded socket.
struct SourceEpochFixture {
    capture: Arc<LiveCaptureSession>,
    relay: Arc<LiveRelaySession>,
    received: std::sync::mpsc::Receiver<Vec<u8>>,
    server: Option<std::thread::JoinHandle<()>>,
    _budget: crate::live_gpu::work_budget::CaptureBudget,
}

impl SourceEpochFixture {
    fn new(profile: LiveRelayMediaProfile) -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let config = LiveCaptureWorkerConfig {
            session_id: "capture:epoch-regression".to_owned(),
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
        let budget = crate::live_gpu::work_budget::CaptureBudget::register(
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
        let mut relay = viewer_relay(format!("http://{}", listener.local_addr().unwrap()));
        Arc::get_mut(&mut relay).unwrap().role = LiveRelayRole::Source;
        Arc::get_mut(&mut relay).unwrap().capture = Some(Arc::clone(&capture));
        relay.state.lock().unwrap().epoch = 3;
        let stopped = Arc::clone(&relay.stop);
        let (tx, received) = std::sync::mpsc::sync_channel(2);
        let server = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let tcp = loop {
                if stopped.load(Ordering::SeqCst) || Instant::now() >= deadline {
                    return;
                }
                if let Ok((tcp, _)) = listener.accept() {
                    break tcp;
                }
                std::thread::sleep(Duration::from_millis(5));
            };
            tcp.set_read_timeout(Some(Duration::from_millis(100)))
                .unwrap();
            tcp.set_write_timeout(Some(Duration::from_millis(100)))
                .unwrap();
            let mut socket = tungstenite::accept_hdr(
                tcp,
                |_: &tungstenite::handshake::server::Request,
                 mut response: tungstenite::handshake::server::Response| {
                    response.headers_mut().insert(
                        "sec-websocket-protocol",
                        tungstenite::http::HeaderValue::from_static(
                            if profile == LiveRelayMediaProfile::H264 {
                                LIVE_RELAY_H264_PROTOCOL
                            } else if profile == LiveRelayMediaProfile::Jpeg {
                                LIVE_RELAY_JPEG_PROTOCOL
                            } else {
                                LIVE_RELAY_PROTOCOL_VERSION
                            },
                        ),
                    );
                    Ok(response)
                },
            )
            .unwrap();
            while !stopped.load(Ordering::SeqCst) && Instant::now() < deadline {
                match socket.read() {
                    Ok(tungstenite::Message::Binary(bytes)) => {
                        if tx.try_send(bytes).is_err() {
                            break;
                        }
                    }
                    Ok(tungstenite::Message::Ping(bytes)) => {
                        let _ = socket.send(tungstenite::Message::Pong(bytes));
                    }
                    Ok(tungstenite::Message::Pong(_)) => {}
                    Err(error) if live_relay_read_timeout(&error) => {}
                    _ => break,
                }
            }
        });
        let worker_relay = Arc::clone(&relay);
        let worker_capture = Arc::clone(&capture);
        *relay.join.lock().unwrap() = Some(std::thread::spawn(move || {
            run_live_relay_source(worker_relay, worker_capture);
        }));
        Self {
            capture,
            relay,
            received,
            server: Some(server),
            _budget: budget,
        }
    }

    fn publish(&self, epoch: u64, frame_id: u64) -> LiveRelayFrame {
        let jpeg = Arc::new(
            include_bytes!("../../../../protocol/fixtures/live-jpeg-v1.nllv")[64..].to_vec(),
        );
        self.capture.frames.lock().unwrap().push(
            LiveCaptureFrame {
                descriptor: LiveCaptureFrameDescriptor {
                    session_id: "capture:epoch-regression".to_owned(),
                    epoch,
                    frame_id,
                    capture_timestamp_ms: frame_id,
                    encode_timestamp_ms: frame_id,
                    width: 64,
                    height: 32,
                    mime: "image/jpeg".to_owned(),
                    byte_length: jpeg.len(),
                    dropped_frames: 0,
                },
                bytes: jpeg,
            },
            &self.capture.dropped_frames,
        );
        let bytes = self.received.recv_timeout(Duration::from_secs(2)).unwrap();
        decode_live_relay_binary_frame("relay:test", "live:test", &bytes).unwrap()
    }
}

impl Drop for SourceEpochFixture {
    fn drop(&mut self) {
        self.relay.stop_and_join().unwrap();
        self.server.take().unwrap().join().unwrap();
    }
}
