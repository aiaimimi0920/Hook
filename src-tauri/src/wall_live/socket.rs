use super::*;
use std::net::{TcpStream, ToSocketAddrs};
use tungstenite::{
    client::IntoClientRequest,
    http::{header::SEC_WEBSOCKET_PROTOCOL, HeaderValue},
    Message,
};
type Socket = tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<TcpStream>>;

fn connect(
    base_url: &str,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    binding: &WallLiveRequest,
) -> Result<Socket, &'static str> {
    let mut url = reqwest::Url::parse(base_url).map_err(|_| "wall_invalid_origin")?;
    let scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        _ => return Err("wall_invalid_origin"),
    };
    url.set_scheme(scheme).map_err(|_| "wall_invalid_origin")?;
    url.set_path("/v1/walls/live/media");
    url.set_query(None);
    url.set_fragment(None);
    url.query_pairs_mut()
        .append_pair("endpointId", &binding.endpoint_id)
        .append_pair("leaseId", &binding.lease_id)
        .append_pair("revision", &binding.revision.to_string())
        .append_pair("sessionId", &binding.session_id)
        .append_pair("format", binding.format.as_str());
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| "wall_live_invalid_request")?;
    request.headers_mut().insert(
        SEC_WEBSOCKET_PROTOCOL,
        HeaderValue::from_static("loom.wall.media.v1"),
    );
    authorization
        .apply_websocket(&mut request)
        .map_err(|_| "wall_pairing_required")?;
    let connector =
        crate::loom_tls::websocket_connector(&url).map_err(|_| "wall_tls_configuration_invalid")?;
    let addresses = (
        url.host_str().ok_or("wall_invalid_origin")?,
        url.port_or_known_default().ok_or("wall_invalid_origin")?,
    )
        .to_socket_addrs()
        .map_err(|_| "wall_live_resolve_failed")?;
    let tcp = addresses
        .take(4)
        .find_map(|address| TcpStream::connect_timeout(&address, Duration::from_secs(2)).ok())
        .ok_or("wall_live_connect_failed")?;
    tcp.set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| "wall_live_socket_failed")?;
    tcp.set_write_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| "wall_live_socket_failed")?;
    let config = tungstenite::protocol::WebSocketConfig {
        max_message_size: Some(MAX_FRAME_BYTES + packet::HEADER_LEN),
        max_frame_size: Some(MAX_FRAME_BYTES + packet::HEADER_LEN),
        ..Default::default()
    };
    let (socket, response) =
        tungstenite::client_tls_with_config(request, tcp, Some(config), connector).map_err(
            |error| match error {
                tungstenite::HandshakeError::Failure(error) => connect_error(error),
                tungstenite::HandshakeError::Interrupted(_) => "wall_live_connect_failed",
            },
        )?;
    if response
        .headers()
        .get(SEC_WEBSOCKET_PROTOCOL)
        .and_then(|v| v.to_str().ok())
        != Some("loom.wall.media.v1")
    {
        return Err("wall_live_protocol_invalid");
    }
    let tcp = match socket.get_ref() {
        tungstenite::stream::MaybeTlsStream::Plain(tcp) => tcp,
        tungstenite::stream::MaybeTlsStream::Rustls(tls) => &tls.sock,
        _ => return Err("wall_live_transport_unsupported"),
    };
    tcp.set_read_timeout(Some(Duration::from_millis(250)))
        .map_err(|_| "wall_live_socket_failed")?;
    tcp.set_write_timeout(Some(Duration::from_millis(250)))
        .map_err(|_| "wall_live_socket_failed")?;
    Ok(socket)
}

pub(super) fn run(
    stream: &Stream,
    base_url: &str,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    binding: &WallLiveRequest,
) -> Result<(), &'static str> {
    let mut socket = connect(base_url, authorization, binding)?;
    let (mut epoch, mut frame_id) = (0, 0);
    let mut received_at = 0;
    let outcome = (|| {
        while !stream.stop.load(Ordering::SeqCst) {
            {
                let state = stream.state.lock().map_err(|_| "wall_live_unavailable")?;
                if state.last_read.elapsed() > Duration::from_secs(5)
                    || state.last_frame.elapsed() > Duration::from_secs(5)
                {
                    return Err("wall_live_consumer_timeout");
                }
            }
            match socket.read() {
                Ok(Message::Binary(bytes)) => {
                    let identity =
                        packet::validate(&bytes, binding.format, (epoch, frame_id), received_at)?;
                    epoch = identity.0;
                    frame_id = identity.1;
                    received_at = identity.2;
                    let mut state = stream.state.lock().map_err(|_| "wall_live_unavailable")?;
                    stats::received(bytes.len(), state.frame.is_some());
                    state.frame = Some(bytes);
                    state.last_frame = Instant::now();
                }
                Ok(Message::Ping(bytes)) => {
                    socket
                        .send(Message::Pong(bytes))
                        .map_err(|_| "wall_live_disconnected")?;
                }
                Ok(Message::Pong(_)) => {}
                Ok(Message::Close(close)) => {
                    return Err(public_error(
                        close
                            .as_ref()
                            .map(|frame| frame.reason.as_ref())
                            .unwrap_or(""),
                    ))
                }
                Ok(_) => return Err("wall_live_protocol_invalid"),
                Err(tungstenite::Error::Io(error))
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) => {}
                Err(_) => return Err("wall_live_disconnected"),
            }
        }
        Ok(())
    })();
    let _ = socket.close(None);
    outcome
}

fn connect_error(error: tungstenite::Error) -> &'static str {
    if let tungstenite::Error::Http(response) = error {
        if let Some(bytes) = response.body().as_ref().filter(|bytes| bytes.len() <= 8192) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) {
                return public_error(
                    value
                        .pointer("/error/code")
                        .and_then(|code| code.as_str())
                        .unwrap_or(""),
                );
            }
        }
    }
    "wall_live_connect_failed"
}

fn public_error(code: &str) -> &'static str {
    match code {
        "wall_live_source_missing" => "wall_live_source_missing",
        "wall_live_source_closed" => "wall_live_source_closed",
        "wall_live_source_unavailable" => "wall_live_source_unavailable",
        "wall_live_codec_unavailable" => "wall_live_codec_unavailable",
        "wall_source_codec_unsupported" => "wall_source_codec_unsupported",
        "wall_media_profile_invalid" => "wall_media_profile_invalid",
        "wall_media_format_invalid" => "wall_media_format_invalid",
        "wall_live_pairing_required" => "wall_live_pairing_required",
        "wall_live_denied" | "wall_live_forbidden" => "wall_live_denied",
        "live_media_busy" => "live_media_busy",
        "wall_media_frame_limit" | "wall_source_dimensions_invalid" => "wall_media_frame_limit",
        "wall_clock_unavailable" => "wall_clock_unavailable",
        "wall_png_encode_failed" => "wall_png_encode_failed",
        _ => "wall_live_disconnected",
    }
}
