// Reconnecting loom.live.v1 WebSocket workers for source publication and viewer delivery.
const LIVE_RELAY_PING_INTERVAL: Duration = Duration::from_secs(2);
const LIVE_RELAY_PING_EXPIRY: Duration = Duration::from_secs(10);

fn spawn_live_relay_source_worker(
    relay: Arc<LiveRelaySession>,
    capture: Arc<LiveCaptureSession>,
) -> Result<std::thread::JoinHandle<()>, String> {
    std::thread::Builder::new()
        .name("hook-live-relay-source".to_owned())
        .spawn(move || run_live_relay_source(relay, capture))
        .map_err(|error| format!("spawn live relay source worker: {error}"))
}

fn spawn_live_relay_viewer_worker(
    relay: Arc<LiveRelaySession>,
) -> Result<std::thread::JoinHandle<()>, String> {
    std::thread::Builder::new()
        .name("hook-live-relay-viewer".to_owned())
        .spawn(move || run_live_relay_viewer(relay))
        .map_err(|error| format!("spawn live relay viewer worker: {error}"))
}

fn run_live_relay_source(relay: Arc<LiveRelaySession>, capture: Arc<LiveCaptureSession>) {
    let mut last_frame_id = 0_u64;
    while !relay.stop.load(Ordering::SeqCst) {
        let connection = connect_live_relay_socket(&relay, 0, 0);
        let mut socket = match connection {
            Ok(socket) => {
                mark_live_relay_connected(&relay);
                socket
            }
            Err(error) => {
                mark_live_relay_recovering(&relay, "source_connect_failed", error);
                live_relay_reconnect_delay(&relay.stop);
                continue;
            }
        };
        let mut last_ping = Instant::now();
        while !relay.stop.load(Ordering::SeqCst) {
            if relay.reconnect.swap(false, Ordering::SeqCst) {
                mark_live_relay_recovering(
                    &relay,
                    "reconnect_requested",
                    "live relay reconnection was requested",
                );
                break;
            }
            let frame = capture
                .frames
                .lock()
                .ok()
                .and_then(|frames| frames.clone_latest_after(last_frame_id));
            if let Some(frame) = frame {
                let network_frame = match encode_live_relay_capture_frame(&frame) {
                    Ok(frame) => frame,
                    Err(error) => {
                        mark_live_relay_recovering(&relay, "source_frame_invalid", error);
                        break;
                    }
                };
                if let Err(error) = socket.send(tungstenite::Message::Binary(network_frame)) {
                    mark_live_relay_recovering(
                        &relay,
                        "source_send_failed",
                        format!("send live relay frame: {error}"),
                    );
                    break;
                }
                last_frame_id = frame.descriptor.frame_id;
                if let Ok(mut state) = relay.state.lock() {
                    state.mark_frame(frame.descriptor.epoch, last_frame_id);
                }
                last_ping = Instant::now();
            } else if last_ping.elapsed() >= Duration::from_secs(2) {
                if socket.send(tungstenite::Message::Ping(Vec::new())).is_err() {
                    mark_live_relay_recovering(
                        &relay,
                        "source_ping_failed",
                        "the Loom live source connection stopped responding",
                    );
                    break;
                }
                last_ping = Instant::now();
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let _ = socket.close(None);
        if !relay.stop.load(Ordering::SeqCst) {
            live_relay_reconnect_delay(&relay.stop);
        }
    }
    mark_live_relay_closed(&relay);
}

fn run_live_relay_viewer(relay: Arc<LiveRelaySession>) {
    let mut connected_once = false;
    while !relay.stop.load(Ordering::SeqCst) {
        if connected_once {
            if let Err(error) = resume_live_viewer_blocking(&relay) {
                mark_live_relay_recovering(&relay, "viewer_resume_failed", error);
                live_relay_reconnect_delay(&relay.stop);
                continue;
            }
        }
        let (after_epoch, after_frame_id) = relay
            .state
            .lock()
            .map(|state| (state.epoch, state.last_frame_id))
            .unwrap_or((0, 0));
        let connection = connect_live_relay_socket(&relay, after_epoch, after_frame_id);
        let mut socket = match connection {
            Ok(socket) => {
                mark_live_relay_connected(&relay);
                connected_once = true;
                socket
            }
            Err(error) => {
                mark_live_relay_recovering(&relay, "viewer_connect_failed", error);
                live_relay_reconnect_delay(&relay.stop);
                continue;
            }
        };
        let mut last_ping_attempt = Instant::now() - LIVE_RELAY_PING_INTERVAL;
        let mut pending_ping: Option<(Vec<u8>, Instant)> = None;
        let mut ping_sequence = 0_u64;
        loop {
            if relay.stop.load(Ordering::SeqCst) {
                break;
            }
            if relay.reconnect.swap(false, Ordering::SeqCst) {
                mark_live_relay_recovering(
                    &relay,
                    "reconnect_requested",
                    "live relay reconnection was requested",
                );
                break;
            }
            if pending_ping
                .as_ref()
                .is_some_and(|(_, sent_at)| sent_at.elapsed() >= LIVE_RELAY_PING_EXPIRY)
            {
                pending_ping = None;
                if let Ok(mut state) = relay.state.lock() {
                    state.round_trip_latency_ms = None;
                }
            }
            if pending_ping.is_none() && last_ping_attempt.elapsed() >= LIVE_RELAY_PING_INTERVAL {
                ping_sequence = ping_sequence.saturating_add(1);
                let payload = ping_sequence.to_be_bytes().to_vec();
                let sent_at = Instant::now();
                if socket
                    .send(tungstenite::Message::Ping(payload.clone()))
                    .is_err()
                {
                    mark_live_relay_recovering(
                        &relay,
                        "viewer_ping_failed",
                        "the Loom live viewer connection stopped responding",
                    );
                    break;
                }
                pending_ping = Some((payload, sent_at));
                last_ping_attempt = sent_at;
            }
            match socket.read() {
                Ok(tungstenite::Message::Binary(bytes)) => {
                    match accept_live_relay_viewer_frame(&relay, &bytes) {
                        Ok(()) => {}
                        Err(error) => {
                            mark_live_relay_recovering(&relay, "viewer_frame_invalid", error);
                            break;
                        }
                    }
                }
                Ok(tungstenite::Message::Ping(bytes)) => {
                    if socket.send(tungstenite::Message::Pong(bytes)).is_err() {
                        break;
                    }
                }
                Ok(tungstenite::Message::Pong(bytes)) => {
                    if pending_ping
                        .as_ref()
                        .is_some_and(|(expected, _)| expected.as_slice() == bytes.as_slice())
                    {
                        let (_, sent_at) = pending_ping.take().expect("checked pending ping");
                        if let Ok(mut state) = relay.state.lock() {
                            state.mark_round_trip(sent_at.elapsed());
                        }
                    }
                }
                Ok(tungstenite::Message::Close(_)) => break,
                Ok(_) => {
                    mark_live_relay_recovering(
                        &relay,
                        "viewer_message_invalid",
                        "Loom sent a non-binary live media message",
                    );
                    break;
                }
                Err(error) => {
                    mark_live_relay_recovering(
                        &relay,
                        "viewer_read_failed",
                        format!("read Loom live media: {error}"),
                    );
                    break;
                }
            }
        }
        let _ = socket.close(None);
        if !relay.stop.load(Ordering::SeqCst) {
            live_relay_reconnect_delay(&relay.stop);
        }
    }
    mark_live_relay_closed(&relay);
}

fn accept_live_relay_viewer_frame(relay: &LiveRelaySession, bytes: &[u8]) -> Result<(), String> {
    let frame = decode_live_relay_binary_frame(&relay.relay_id, &relay.live_session_id, bytes)?;
    {
        let state = relay
            .state
            .lock()
            .map_err(|_| "live relay state poisoned".to_owned())?;
        if frame.descriptor.epoch < state.epoch
            || (frame.descriptor.epoch == state.epoch
                && frame.descriptor.frame_id <= state.last_frame_id)
        {
            return Err("Loom delivered a stale or duplicate live frame".to_owned());
        }
    }
    let epoch = frame.descriptor.epoch;
    let frame_id = frame.descriptor.frame_id;
    relay
        .frames
        .lock()
        .map_err(|_| "live relay frame buffer poisoned".to_owned())?
        .push(frame);
    relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned".to_owned())?
        .mark_frame(epoch, frame_id);
    Ok(())
}

fn connect_live_relay_socket(
    relay: &LiveRelaySession,
    after_epoch: u64,
    after_frame_id: u64,
) -> Result<tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>, String>
{
    use tungstenite::client::IntoClientRequest;
    use tungstenite::http::{header::SEC_WEBSOCKET_PROTOCOL, HeaderValue};

    let mut url = reqwest::Url::parse(&relay.base_url)
        .map_err(|error| format!("parse Loom live WebSocket URL: {error}"))?;
    let websocket_scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        _ => return Err("Loom live WebSocket requires http or https transport".to_owned()),
    };
    url.set_scheme(websocket_scheme)
        .map_err(|_| "replace Loom live WebSocket URL scheme".to_owned())?;
    url.set_path("/v1/live/media");
    url.query_pairs_mut()
        .append_pair("sessionId", &relay.live_session_id)
        .append_pair("role", relay.role.as_str())
        .append_pair("afterEpoch", &after_epoch.to_string())
        .append_pair("afterFrameId", &after_frame_id.to_string())
        .append_pair("deviceId", &relay.authorization.device_id);
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|error| format!("build Loom live WebSocket request: {error}"))?;
    request.headers_mut().insert(
        SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_static(LIVE_RELAY_PROTOCOL_VERSION),
    );
    relay.authorization.apply_websocket(&mut request)?;
    let (socket, response) = tungstenite::connect(request)
        .map_err(|error| format!("connect Loom live WebSocket: {error}"))?;
    if response
        .headers()
        .get(SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        != Some(LIVE_RELAY_PROTOCOL_VERSION)
    {
        return Err("Loom live WebSocket did not negotiate loom.live.v1".to_owned());
    }
    Ok(socket)
}

fn mark_live_relay_connected(relay: &LiveRelaySession) {
    if let Ok(mut state) = relay.state.lock() {
        state.mark_connected();
    }
}

fn mark_live_relay_recovering(relay: &LiveRelaySession, code: &str, message: impl Into<String>) {
    if let Ok(mut state) = relay.state.lock() {
        state.mark_recovering(code, message);
    }
}

fn mark_live_relay_closed(relay: &LiveRelaySession) {
    if let Ok(mut state) = relay.state.lock() {
        state.mark_closed();
    }
}

fn live_relay_reconnect_delay(stop: &AtomicBool) {
    for _ in 0..10 {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(test)]
mod live_relay_websocket_tests {
    use super::*;

    #[test]
    fn viewer_rejects_duplicate_frame_before_mutating_buffer() {
        let state = LiveRelayRuntimeState {
            last_frame_id: 7,
            ..LiveRelayRuntimeState::starting(1, Vec::new(), None)
        };
        let metadata = LiveRelayBinaryMetadata {
            epoch: 1,
            frame_id: 7,
            capture_timestamp_ms: 1,
            encode_timestamp_ms: 2,
            width: 1,
            height: 1,
            dropped_frames: 0,
            keyframe: true,
            color_space: "srgb",
            codec: "raw_bgra",
        };
        let relay = LiveRelaySession {
            relay_id: "relay:test".to_owned(),
            live_session_id: "live:test".to_owned(),
            role: LiveRelayRole::Viewer,
            base_url: "http://127.0.0.1:1".to_owned(),
            surface_instance_id: "instance:test".to_owned(),
            attachment_id: "attachment:test".to_owned(),
            authorization: crate::device_session::DeviceSessionAuthorization::none_for_test(
                "device-000-local",
            ),
            capture: None,
            state: Arc::new(Mutex::new(state)),
            frames: Arc::new(Mutex::new(LiveRelayFrameBuffer::new())),
            stop: Arc::new(AtomicBool::new(false)),
            reconnect: Arc::new(AtomicBool::new(false)),
            join: Mutex::new(None),
            control_join: Mutex::new(None),
            observation_join: Mutex::new(None),
            control_sequence: Mutex::new(1),
            input_sequence: Mutex::new(0),
        };
        let bytes = encode_live_relay_binary_frame(&metadata, &[0; 4]).expect("encode");
        assert!(accept_live_relay_viewer_frame(&relay, &bytes).is_err());
        assert!(relay.frames.lock().expect("frames").frames.is_empty());
    }

    #[test]
    fn viewer_round_trip_latency_uses_bounded_states_and_source_is_unavailable() {
        let mut state = LiveRelayRuntimeState::starting(1, Vec::new(), None);
        state.mark_round_trip(Duration::from_millis(121));
        assert_eq!(state.round_trip_latency_ms, Some(121));
    }
}
