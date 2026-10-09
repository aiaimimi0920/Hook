// 只监听随机 loopback 端口；所有请求、等待及析构 join 均有界。
struct ViewerHttpFixture {
    url: String,
    stop: Arc<AtomicBool>,
    worker: Option<std::thread::JoinHandle<()>>,
    paths: Arc<Mutex<Vec<String>>>,
    bodies: Arc<Mutex<Vec<serde_json::Value>>>,
}

impl ViewerHttpFixture {
    fn new(events: Option<serde_json::Value>, snapshot: serde_json::Value) -> Self {
        Self::with_snapshot_status(events, snapshot, 200)
    }

    fn with_snapshot_status(
        events: Option<serde_json::Value>,
        snapshot: serde_json::Value,
        snapshot_status: u16,
    ) -> Self {
        Self::with_statuses(events, snapshot, 200, snapshot_status)
    }

    fn with_statuses(
        events: Option<serde_json::Value>,
        snapshot: serde_json::Value,
        events_status: u16,
        snapshot_status: u16,
    ) -> Self {
        Self::with_response_override(events, snapshot, events_status, snapshot_status, None)
    }

    fn with_response_override(
        events: Option<serde_json::Value>,
        snapshot: serde_json::Value,
        events_status: u16,
        snapshot_status: u16,
        response_override: Option<String>,
    ) -> Self {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let done = Arc::clone(&stop);
        let paths = Arc::new(Mutex::new(Vec::new()));
        let requests = Arc::clone(&paths);
        let bodies = Arc::new(Mutex::new(Vec::new()));
        let request_bodies = Arc::clone(&bodies);
        let worker = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            while !done.load(Ordering::SeqCst) && Instant::now() < deadline {
                let (mut stream, _) = match listener.accept() {
                    Ok(pair) => pair,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("accept: {error}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_millis(250)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_millis(250)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut chunk = [0; 1024];
                let request_deadline = Instant::now() + Duration::from_secs(1);
                while !bytes.windows(4).any(|value| value == b"\r\n\r\n")
                    && bytes.len() < 8192
                    && Instant::now() < request_deadline
                {
                    match stream.read(&mut chunk) {
                        Ok(0) | Err(_) => break,
                        Ok(count) => bytes.extend_from_slice(&chunk[..count]),
                    }
                }
                let request = String::from_utf8_lossy(&bytes);
                let path = request.lines().next().unwrap_or("").to_owned();
                requests.lock().unwrap().push(path.clone());
                if let Some(start) = bytes.windows(4).position(|value| value == b"\r\n\r\n") {
                    let content_length = request
                        .lines()
                        .filter_map(|line| line.split_once(':'))
                        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                        .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    let end = start + 4 + content_length.min(8192);
                    while bytes.len() < end && Instant::now() < request_deadline {
                        match stream.read(&mut chunk) {
                            Ok(0) | Err(_) => break,
                            Ok(count) => bytes.extend_from_slice(&chunk[..count]),
                        }
                    }
                    if content_length > 0 && bytes.len() >= end {
                        request_bodies.lock().unwrap().push(
                            serde_json::from_slice(&bytes[start + 4..end])
                                .unwrap_or(serde_json::Value::Null),
                        );
                    }
                }
                if let Some(response) = &response_override {
                    let _ = stream.write_all(response.as_bytes());
                    continue;
                }
                let is_events = path.contains("/events?");
                let (status, value) = if is_events {
                    events.as_ref().map_or(
                        (
                            404,
                            serde_json::json!({"error":{"code":"live_session_not_found"}}),
                        ),
                        |value| (events_status, value.clone()),
                    )
                } else {
                    (snapshot_status, snapshot.clone())
                };
                let body = serde_json::to_vec(&value).unwrap();
                let headers = format!("HTTP/1.1 {status} Result\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream
                    .write_all(headers.as_bytes())
                    .and_then(|()| stream.write_all(&body));
            }
        });
        Self {
            url,
            stop,
            worker: Some(worker),
            paths,
            bodies,
        }
    }
}

impl Drop for ViewerHttpFixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.worker.take().unwrap().join().unwrap();
    }
}

fn viewer_snapshot(closed: bool) -> serde_json::Value {
    serde_json::json!({"epoch":1,"closed":closed,"session":{
        "protocolVersion":LIVE_RELAY_PROTOCOL_VERSION,"sessionId":"live:test",
        "revision":2,"viewerDevices":["viewer:test"]
    }})
}

fn joined_events() -> serde_json::Value {
    let event = |sequence, revision, reason, controller| {
        serde_json::json!({
            "protocolVersion":LIVE_RELAY_PROTOCOL_VERSION,"sessionId":"live:test","epoch":1,
            "sequence":sequence,"messageType":"session_state","payload":{
                "revision":revision,"visibility":"visible","viewers":["viewer:test"],
                "controllerDeviceId":controller,"reason":reason
            }
        })
    };
    serde_json::json!({"protocolVersion":LIVE_RELAY_PROTOCOL_VERSION,"next":302,"reset":true,
        "events":[event(300,1,"controller_acquired",Some("viewer:test")),
            event(301,2,"viewer_joined",None),event(302,3,"controller_revoked",None)]})
}
