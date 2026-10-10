// Finite connect/handshake/read/write deadlines keep source recovery and shutdown joinable.
fn connect_live_relay_transport(
    request: tungstenite::http::Request<()>,
    url: &reqwest::Url,
    role: LiveRelayRole,
) -> Result<LiveRelayMediaConnection, String> {
    use std::net::{TcpStream, ToSocketAddrs};
    let connector = crate::loom_tls::websocket_connector(url).map_err(|error| error.to_string())?;
    let addresses = (
        url.host_str().ok_or("live relay host is missing")?,
        url.port_or_known_default()
            .ok_or("live relay port is missing")?,
    )
        .to_socket_addrs()
        .map_err(|_| "live relay host resolution failed")?;
    let tcp = addresses
        .take(4)
        .find_map(|address| TcpStream::connect_timeout(&address, Duration::from_secs(2)).ok())
        .ok_or("live relay connect deadline exceeded")?;
    tcp.set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| "live relay read deadline failed")?;
    tcp.set_write_timeout(Some(Duration::from_secs(3)))
        .map_err(|_| "live relay write deadline failed")?;
    let limit = if role == LiveRelayRole::Source {
        64 * 1024
    } else {
        LIVE_RELAY_MAX_FRAME_BYTES + 64
    };
    let config = tungstenite::protocol::WebSocketConfig {
        max_message_size: Some(limit),
        max_frame_size: Some(limit),
        ..Default::default()
    };
    let (socket, response) =
        tungstenite::client_tls_with_config(request, tcp, Some(config), connector)
            .map_err(|_| "live relay WebSocket handshake failed")?;
    let profile = LiveRelayMediaProfile::negotiated(
        response
            .headers()
            .get(tungstenite::http::header::SEC_WEBSOCKET_PROTOCOL)
            .and_then(|value| value.to_str().ok()),
    )?;
    let tcp = match socket.get_ref() {
        tungstenite::stream::MaybeTlsStream::Plain(tcp) => tcp,
        tungstenite::stream::MaybeTlsStream::Rustls(tls) => &tls.sock,
        _ => return Err("live relay transport is unsupported".to_owned()),
    };
    tcp.set_read_timeout(Some(Duration::from_millis(
        if role == LiveRelayRole::Source {
            1
        } else {
            250
        },
    )))
    .map_err(|_| "live relay read deadline failed")?;
    tcp.set_write_timeout(Some(Duration::from_millis(250)))
        .map_err(|_| "live relay write deadline failed")?;
    Ok(LiveRelayMediaConnection { socket, profile })
}

fn live_relay_read_timeout(error: &tungstenite::Error) -> bool {
    matches!(error, tungstenite::Error::Io(error) if matches!(error.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut))
}

fn service_live_relay_source_socket(
    relay: &LiveRelaySession,
    socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
) -> Result<(), &'static str> {
    service_live_relay_source_video_socket(relay, socket, None)
}

fn service_live_relay_source_video_socket(
    relay: &LiveRelaySession,
    socket: &mut tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
    video: Option<&mut LiveRelayVideoSource>,
) -> Result<(), &'static str> {
    match socket.read() {
        Ok(tungstenite::Message::Text(text)) => video
            .ok_or("video policy without negotiation")?
            .policy(&text),
        Ok(tungstenite::Message::Ping(bytes)) => socket
            .send(tungstenite::Message::Pong(bytes))
            .map_err(|_| "source liveness response failed"),
        Ok(tungstenite::Message::Pong(_)) => Ok(()),
        Ok(tungstenite::Message::Close(close)) => {
            close_live_relay_if_device_revoked(relay, close.as_ref());
            Err("source connection closed")
        }
        Err(error) if live_relay_read_timeout(&error) => Ok(()),
        _ => Err("source connection closed or sent invalid control data"),
    }
}
