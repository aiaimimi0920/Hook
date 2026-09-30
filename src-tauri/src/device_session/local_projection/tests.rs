use super::*;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

fn manifest(origin: &str) -> LoomManifest {
    crate::device_session::tests::loom_manifest(origin, Some("bearer"), Some("local-test-token"))
}

fn registry(approval: &str, enabled: bool) -> Value {
    let device = json!({"id": "device-hook", "publicKey": "own-key", "approval": approval, "enabled": enabled});
    if approval == "pending" {
        json!({"devices": [], "pending": [device]})
    } else {
        json!({"devices": [device], "pending": []})
    }
}

// A finite loopback server checks every request, including credentials and mutation scope.
fn server(steps: Vec<(&'static str, Value)>) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let thread = std::thread::spawn(move || {
        for (expected, response) in steps {
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            std::time::Instant::now() < deadline,
                            "missing request: {expected}"
                        );
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("{error}"),
                }
            };
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 1024];
            loop {
                let read = socket.read(&mut buffer).unwrap();
                assert!(read > 0 && bytes.len() + read <= 16_384);
                bytes.extend_from_slice(&buffer[..read]);
                let request = String::from_utf8_lossy(&bytes);
                if let Some(end) = request.find("\r\n\r\n") {
                    let length = request[..end]
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|value| value.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let request = String::from_utf8(bytes).unwrap();
            assert_eq!(
                request.lines().next().unwrap(),
                format!("{expected} HTTP/1.1")
            );
            assert!(request
                .to_ascii_lowercase()
                .contains("authorization: bearer local-test-token\r\n"));
            if expected == "POST /v1/devices" {
                let body: Value =
                    serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
                assert_eq!(body["publicKey"], "own-key");
            }
            let body = response.to_string();
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        }
    });
    (origin, thread)
}

#[test]
fn local_credential_is_bound_to_exact_manifest_origin() {
    let local = manifest("http://127.0.0.1:8765");
    assert_eq!(
        local_token("http://127.0.0.1:8765/", &local),
        Some("local-test-token")
    );
    for origin in [
        "http://127.0.0.1:8766",
        "http://localhost:8765",
        "https://remote.test",
        "http://127.0.0.1:8765/path",
        "http://127.0.0.1:8765/?x=1",
        "http://127.0.0.1:8765@remote.test",
    ] {
        assert!(local_token(origin, &local).is_none(), "{origin}");
    }
    assert!(local_token("https://remote.test", &manifest("https://remote.test")).is_none());
    let secure = manifest("https://[::1]:8765");
    assert!(local_token("https://[::1]:8765", &secure).is_some());
    let mut no_token = local.clone();
    no_token.transport.auth_token = None;
    assert!(local_token("http://127.0.0.1:8765", &no_token).is_none());
}

#[tokio::test]
async fn first_local_registration_needs_no_remote_device_or_manual_approval() {
    let (origin, server) = server(vec![
        ("GET /v1/devices", json!({"devices": [], "pending": []})),
        ("POST /v1/devices", registry("approved", true)),
    ]);
    let result = register(&origin, "own-key", Some(&manifest(&origin))).await;
    server.join().unwrap();
    assert_eq!(result.unwrap().as_deref(), Some("device-hook"));
}

#[tokio::test]
async fn pending_local_registration_is_approved_only_once_under_concurrent_use() {
    let (origin, server) = server(vec![
        ("GET /v1/devices", registry("pending", true)),
        (
            "POST /v1/devices/device-hook/approve",
            registry("approved", true),
        ),
        ("GET /v1/devices", registry("approved", true)),
    ]);
    let manifest = manifest(&origin);
    let (first, second) = tokio::join!(
        register(&origin, "own-key", Some(&manifest)),
        register(&origin, "own-key", Some(&manifest)),
    );
    server.join().unwrap();
    assert_eq!(first.unwrap(), second.unwrap());
}

#[tokio::test]
async fn disabled_or_rejected_local_identity_is_not_reapproved() {
    for (approval, enabled) in [("approved", false), ("rejected", true), ("pending", false)] {
        let (origin, server) = server(vec![("GET /v1/devices", registry(approval, enabled))]);
        let result = register(&origin, "own-key", Some(&manifest(&origin))).await;
        server.join().unwrap();
        assert_eq!(result.unwrap_err(), "projection_pairing_required");
    }
}

#[tokio::test]
async fn untrusted_origin_does_not_receive_local_credentials_or_registration() {
    let local = manifest("http://127.0.0.1:8765");
    assert!(
        register("https://unreachable.invalid", "own-key", Some(&local))
            .await
            .unwrap()
            .is_none()
    );
    assert!(register("http://127.0.0.1:8766", "own-key", Some(&local))
        .await
        .unwrap()
        .is_none());
}

#[test]
fn registration_response_cannot_substitute_another_identity_or_path() {
    assert!(own_device(
        serde_json::from_value(registry("approved", true)).unwrap(),
        "other-key"
    )
    .unwrap()
    .is_none());
    let mut invalid = registry("pending", true);
    invalid["pending"][0]["id"] = json!("../other/approve");
    assert!(own_device(serde_json::from_value(invalid).unwrap(), "own-key").is_err());
    let mut duplicate = registry("approved", true);
    duplicate["pending"] = registry("pending", true)["pending"].clone();
    assert!(own_device(serde_json::from_value(duplicate).unwrap(), "own-key").is_err());
}
