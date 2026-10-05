// 有界真实 WebSocket；额外请求计数用于证明 terminal 后没有 resume/reconnect。
struct MediaCloseFixture {
    url: String,
    requests: Arc<std::sync::atomic::AtomicUsize>,
    published: Arc<std::sync::atomic::AtomicUsize>,
    close: std::sync::mpsc::Sender<()>,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
}

impl MediaCloseFixture {
    // Tungstenite requires an unboxed HTTP error response in this handshake callback.
    #[allow(clippy::result_large_err)]
    fn new(
        code: tungstenite::protocol::frame::coding::CloseCode,
        reason: &'static str,
        send_frame: bool,
    ) -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let published = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let (close, rx) = std::sync::mpsc::channel();
        let seen = Arc::clone(&requests);
        let frames = Arc::clone(&published);
        let stopped = Arc::clone(&stop);
        let worker = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(6);
            while !stopped.load(Ordering::SeqCst) && Instant::now() < deadline {
                let Ok((tcp, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                };
                tcp.set_read_timeout(Some(Duration::from_millis(250)))
                    .unwrap();
                tcp.set_write_timeout(Some(Duration::from_millis(250)))
                    .unwrap();
                let first = seen.fetch_add(1, Ordering::SeqCst) == 0;
                let socket = tungstenite::accept_hdr(
                    tcp,
                    |_: &tungstenite::handshake::server::Request,
                     mut response: tungstenite::handshake::server::Response| {
                        response.headers_mut().insert(
                            "sec-websocket-protocol",
                            tungstenite::http::HeaderValue::from_static(if send_frame {
                                "loom.live.v1"
                            } else {
                                "loom.live.jpeg.v1"
                            }),
                        );
                        Ok(response)
                    },
                );
                if let Ok(mut socket) = socket {
                    if first {
                        if send_frame {
                            socket
                                .send(tungstenite::Message::Binary(frame_bytes()))
                                .unwrap();
                        }
                        if send_frame {
                            let _ = rx.recv_timeout(Duration::from_secs(3));
                        } else {
                            socket
                                .get_mut()
                                .set_read_timeout(Some(Duration::from_millis(10)))
                                .unwrap();
                            let deadline = Instant::now() + Duration::from_secs(3);
                            while matches!(rx.try_recv(), Err(std::sync::mpsc::TryRecvError::Empty))
                                && Instant::now() < deadline
                            {
                                match socket.read() {
                                    Ok(tungstenite::Message::Binary(_)) => {
                                        frames.fetch_add(1, Ordering::SeqCst);
                                    }
                                    Ok(tungstenite::Message::Ping(bytes)) => {
                                        let _ = socket.send(tungstenite::Message::Pong(bytes));
                                    }
                                    Ok(tungstenite::Message::Pong(_)) => {}
                                    Err(error) if live_relay_read_timeout(&error) => {}
                                    _ => break,
                                }
                            }
                        }
                        let _ = socket.close(Some(tungstenite::protocol::CloseFrame {
                            code,
                            reason: reason.into(),
                        }));
                    }
                }
            }
        });
        Self {
            url,
            requests,
            published,
            close,
            stop,
            worker: Some(worker),
        }
    }
}

impl Drop for MediaCloseFixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.close.send(());
        self.worker.take().unwrap().join().unwrap();
    }
}

fn wait_media(accept: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(2);
    while !accept() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    accept()
}

fn device_viewer(url: String) -> Arc<LiveRelaySession> {
    let mut relay = viewer_relay(url);
    Arc::get_mut(&mut relay).unwrap().authorization =
        crate::device_session::DeviceSessionAuthorization::device_for_test(
            "viewer:test",
            "fixture-token",
        );
    relay
}
