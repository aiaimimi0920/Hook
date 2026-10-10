// Local manifest authority is read per connection, so reconnects do not retain stale tokens.
fn hook_websocket_credential(endpoint: &str) -> Result<HookBridgeCredential, String> {
    validate_hook_websocket_endpoint(endpoint)?;
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|_| "Loom local authentication manifest is unavailable".to_owned())?;
    let base_url = manifest.transport.base_url.clone();
    let admin_token = local_hook_transport_token(manifest.transport)?;
    request_scoped_hook_credential(endpoint, &base_url, &admin_token)
}

#[derive(Deserialize)]
struct HookBridgeCredential {
    url: String,
    token: String,
}

fn request_scoped_hook_credential(
    endpoint: &str,
    base_url: &str,
    admin_token: &str,
) -> Result<HookBridgeCredential, String> {
    use std::io::Read;
    validate_hook_websocket_endpoint(endpoint)?;
    let client = crate::network_proxy::loom_blocking_client(base_url, Some(Duration::from_secs(3)))
        .map_err(|_| "Loom credential broker is unavailable".to_owned())?;
    let response = client
        .post(format!(
            "{}/v1/hook-bridge/credentials",
            base_url.trim_end_matches('/')
        ))
        .bearer_auth(admin_token)
        .json(&serde_json::json!({}))
        .send()
        .map_err(|_| "Loom credential broker is unavailable".to_owned())?;
    if !response.status().is_success() || response.content_length().is_some_and(|size| size > 8192)
    {
        return Err("Loom Hook bridge is not available".to_owned());
    }
    let mut bytes = Vec::new();
    response
        .take(8193)
        .read_to_end(&mut bytes)
        .map_err(|_| "Invalid Hook credential response".to_owned())?;
    if bytes.len() > 8192 {
        return Err("Invalid Hook credential response".to_owned());
    }
    let credential: HookBridgeCredential = serde_json::from_slice(&bytes)
        .map_err(|_| "Invalid Hook credential response".to_owned())?;
    validate_hook_websocket_endpoint(&credential.url)?;
    let bound = reqwest::Url::parse(&credential.url).map_err(|_| "Invalid Hook endpoint")?;
    let requested = reqwest::Url::parse(endpoint).map_err(|_| "Invalid Hook endpoint")?;
    if bound.host_str() != Some("127.0.0.1")
        || bound.port_or_known_default() != requested.port_or_known_default()
        || !credential.token.starts_with("hook-v1.")
        || credential.token.len() > 4096
    {
        return Err("Hook endpoint does not match the daemon-owned listener".to_owned());
    }
    Ok(credential)
}

fn local_hook_transport_token(
    transport: crate::loom_connector::LoomManifestTransport,
) -> Result<String, String> {
    if !crate::loom_connector::is_loopback_base_url(&transport.base_url)
        || !transport
            .auth
            .as_deref()
            .is_some_and(|mode| mode.eq_ignore_ascii_case("bearer"))
    {
        return Err("Hook WebSocket requires a local authenticated Loom manifest".to_owned());
    }
    transport
        .auth_token
        .filter(|token| !token.is_empty() && token.len() <= 4096)
        .ok_or_else(|| "Loom local authentication token is unavailable".to_owned())
}

fn validate_hook_websocket_endpoint(endpoint: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(endpoint)
        .map_err(|_| "Invalid local Hook WebSocket endpoint".to_owned())?;
    let loopback = url.host_str().is_some_and(|host| {
        host == "localhost"
            || host
                .trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    });
    if url.scheme() != "ws"
        || !loopback
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("Hook WebSocket endpoint must be a credential-free loopback origin".to_owned());
    }
    Ok(())
}

type HookSocketConnection = (
    tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
    tungstenite::handshake::client::Response,
);

fn connect_authenticated_hook_socket(endpoint: &str) -> Result<HookSocketConnection, String> {
    let credential = hook_websocket_credential(endpoint)?;
    connect_hook_socket_with_token(&credential.url, &credential.token)
}

fn connect_hook_socket_with_token(
    endpoint: &str,
    token: &str,
) -> Result<HookSocketConnection, String> {
    use tungstenite::client::IntoClientRequest;
    validate_hook_websocket_endpoint(endpoint)?;
    let mut request = endpoint
        .into_client_request()
        .map_err(|_| "Invalid local Hook WebSocket request".to_owned())?;
    request.headers_mut().insert(
        "authorization",
        format!("Bearer {token}")
            .parse()
            .map_err(|_| "Invalid Loom authentication credential".to_owned())?,
    );
    // Never include tungstenite's request/response Debug in errors: it may contain credentials.
    // A redirect must never forward the scoped bridge credential to another endpoint.
    tungstenite::client::connect_with_config(request, None, 0)
        .map_err(|_| "Authenticated Loom WebSocket connection failed".to_owned())
}

#[tauri::command]
pub async fn loom_hook_websocket_protocols(endpoint: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let credential = hook_websocket_credential(&endpoint)?;
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(credential.token.as_bytes());
        Ok(serde_json::json!({"url": credential.url, "protocols": ["loom.hook.v1", format!("loom.auth.{encoded}")]}))
    }).await.map_err(|_| "Loom credential broker task failed".to_owned())?
}

#[cfg(test)]
mod websocket_auth_tests {
    use super::*;
    #[test]
    fn scoped_broker_authenticates_http_but_returns_only_bound_bridge_authority() {
        use std::io::{Read, Write};
        for (status, url, token, accepted) in [
            (200, "ws://127.0.0.1:19820", "hook-v1.fixture", true),
            (200, "ws://127.0.0.1:19821", "hook-v1.fixture", false),
            (200, "ws://[::1]:19820", "hook-v1.fixture", false),
            (200, "ws://127.0.0.1:19820", "administrator", false),
            (503, "ws://127.0.0.1:19820", "hook-v1.fixture", false),
            (302, "ws://127.0.0.1:19820", "hook-v1.fixture", false),
        ] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let server = thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut received = Vec::new();
                while !received.ends_with(b"\r\n\r\n") {
                    assert!(received.len() < 8192);
                    let mut byte = [0];
                    stream.read_exact(&mut byte).unwrap();
                    received.push(byte[0]);
                }
                let headers = String::from_utf8(received).unwrap().to_ascii_lowercase();
                assert!(headers.starts_with("post /v1/hook-bridge/credentials "));
                assert!(headers.contains("authorization: bearer administrator\r\n"));
                let mut body = [0; 2];
                stream.read_exact(&mut body).unwrap();
                let response = serde_json::json!({"url":url,"token":token}).to_string();
                write!(stream, "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", response.len()).unwrap();
            });
            let result = request_scoped_hook_credential("ws://[::1]:19820", &base, "administrator");
            server.join().unwrap();
            assert_eq!(result.is_ok(), accepted);
            if let Ok(credential) = result {
                assert_eq!(credential.url, "ws://127.0.0.1:19820");
                assert_ne!(credential.token, "administrator");
            }
        }
    }
    #[test]
    fn validated_manifest_bearer_modes_remain_case_insensitive() {
        for mode in ["bearer", "Bearer", "BEARER"] {
            let transport = crate::loom_connector::LoomManifestTransport {
                transport_type: "http".to_owned(),
                base_url: "http://127.0.0.1:19819".to_owned(),
                auth: Some(mode.to_owned()),
                auth_token: Some("fixture".to_owned()),
            };
            assert_eq!(local_hook_transport_token(transport).unwrap(), "fixture");
        }
    }
    #[test]
    fn local_credential_is_not_forwarded_across_a_websocket_redirect() {
        use std::io::{Read, Write};
        let target = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        target.set_nonblocking(true).unwrap();
        let target_addr = target.local_addr().unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("ws://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut received = Vec::new();
            while !received.ends_with(b"\r\n\r\n") {
                assert!(received.len() < 8192);
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                received.push(byte[0]);
            }
            assert!(String::from_utf8(received)
                .unwrap()
                .to_ascii_lowercase()
                .contains("authorization: bearer test-secret"));
            write!(stream, "HTTP/1.1 302 Found\r\nLocation: ws://{target_addr}/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        });
        let error = connect_hook_socket_with_token(&endpoint, "test-secret")
            .err()
            .unwrap();
        server.join().unwrap();
        assert!(!error.contains("test-secret"));
        assert!(
            matches!(target.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock)
        );
    }
    #[test]
    fn authentication_rejects_remote_or_credential_bearing_endpoints() {
        for url in [
            "ws://example.com:19820",
            "wss://example.com",
            "ws://user@127.0.0.1",
            "ws://127.0.0.1/?token=secret",
            "ws://127.0.0.1/#secret",
            "ws://127.0.0.1/path",
            "ws://localhost.evil.example",
        ] {
            assert!(validate_hook_websocket_endpoint(url).is_err(), "{url}");
        }
        for url in [
            "ws://127.0.0.1:19820",
            "ws://localhost:19820",
            "ws://[::1]:19820",
        ] {
            assert!(validate_hook_websocket_endpoint(url).is_ok(), "{url}");
        }
    }
}
