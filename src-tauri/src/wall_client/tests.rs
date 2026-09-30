#![cfg(feature = "remote-surface")]
use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread::{self, JoinHandle};
use std::time::Instant;

fn server(response: Vec<u8>) -> (String, JoinHandle<(String, Value)>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let handle = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error)
                    if error.kind() == std::io::ErrorKind::WouldBlock
                        && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("wall client fixture accept failed: {error}"),
            }
        };
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut request = Vec::new();
        let (head_end, body_size) = loop {
            let mut block = [0; 2048];
            let count = stream.read(&mut block).unwrap();
            assert!(count > 0 && request.len() + count <= MAX_REQUEST_BYTES + 4096);
            request.extend_from_slice(&block[..count]);
            if let Some(index) = request.windows(4).position(|value| value == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..index]);
                let size = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if request.len() >= index + 4 + size {
                    break (index + 4, size);
                }
            }
        };
        let headers = String::from_utf8(request[..head_end].to_vec()).unwrap();
        let body = if body_size == 0 {
            Value::Null
        } else {
            serde_json::from_slice(&request[head_end..head_end + body_size]).unwrap()
        };
        // Size rejection may close the socket before the synthetic body is consumed.
        let _ = stream.write_all(&response);
        (headers, body)
    });
    (url, handle)
}

fn json_response(status: u16, body: &str) -> Vec<u8> {
    format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).into_bytes()
}

#[test]
fn paired_identity_and_nonce_are_native_and_registration_cannot_impersonate() {
    let auth = DeviceSessionAuthorization::device_for_test("paired-device", "wall-fixture-token");
    let (url, handle) = server(json_response(200, r#"{"revision":1}"#));
    let value = tauri::async_runtime::block_on(send(
        &url,
        &auth,
        WallOperation::Register {
            base_revision: 0,
            endpoint: json!({"deviceId":"forged", "endpointId":"tile-1"}),
        },
    ))
    .unwrap();
    assert_eq!(value["revision"], 1);
    let (headers, body) = handle.join().unwrap();
    assert!(headers.starts_with("POST /v1/walls/endpoints/register HTTP/1.1"));
    assert!(headers
        .to_ascii_lowercase()
        .contains("authorization: device wall-fixture-token"));
    assert!(headers
        .to_ascii_lowercase()
        .contains("x-loom-device-nonce:"));
    assert_eq!(body["endpoint"]["deviceId"], "paired-device");
    assert!(!body.to_string().contains("wall-fixture-token"));
}

#[test]
fn identification_report_uses_a_fixed_device_route_and_strict_outcomes() {
    let request = json!({"kind":"identify_report","endpointId":"tile","leaseId":"lease",
        "requestId":"id","outcome":"applied"});
    let operation: WallOperation = serde_json::from_value(request.clone()).unwrap();
    let (path, body) = operation.request("device").unwrap();
    assert_eq!(path, "/v1/walls/endpoints/identify/report");
    assert_eq!(
        body.unwrap(),
        json!({"endpointId":"tile","leaseId":"lease","requestId":"id","outcome":"applied"})
    );
    for (key, value) in [
        ("outcome", json!("running")),
        ("url", json!("https://evil.example")),
    ] {
        let mut invalid = request.clone();
        invalid[key] = value;
        assert!(serde_json::from_value::<WallOperation>(invalid).is_err());
    }
    assert!(serde_json::from_value::<WallOperation>(
        json!({"kind":"identify","endpointId":"tile"})
    )
    .is_err());
}

#[test]
fn presentation_reports_preserve_ordinary_heartbeat_shape_and_reject_unknown_fields() {
    let ordinary = json!({"kind": "heartbeat", "endpointId": "tile-1", "leaseId": "lease",
        "sequence": 1, "appliedRevision": 3});
    let operation: WallOperation = serde_json::from_value(ordinary.clone()).unwrap();
    let (_, body) = operation.request("device").unwrap();
    assert!(body.unwrap().get("presentation").is_none());
    let mut frozen = ordinary.clone();
    frozen["presentation"] = json!({"revision": 4, "outcome": "applied"});
    let operation: WallOperation = serde_json::from_value(frozen.clone()).unwrap();
    let (path, body) = operation.request("device").unwrap();
    assert_eq!(path, "/v1/walls/heartbeat");
    assert_eq!(body.unwrap()["presentation"], frozen["presentation"]);
    for invalid in [
        json!({"revision": 4, "outcome": "hidden"}),
        json!({"revision": 4, "outcome": "applied", "extra": true}),
    ] {
        let mut request = ordinary.clone();
        request["presentation"] = invalid;
        assert!(serde_json::from_value::<WallOperation>(request).is_err());
    }
}

#[test]
fn rejects_status_redirect_and_invalid_json_without_echoing_server_secrets() {
    let auth = DeviceSessionAuthorization::device_for_test("paired-device", "wall-fixture-token");
    for (status, body, expected) in [
        (
            409,
            r#"{"error":{"message":"secret-server-value"}}"#,
            "wall_request_rejected",
        ),
        (
            503,
            r#"{"error":{"code":"daemon_busy"}}"#,
            "wall_request_rejected",
        ),
        (401, "unauthorized", "wall_request_rejected"),
        (302, "redirect", "wall_request_rejected"),
        (200, "{invalid", "wall_response_invalid"),
    ] {
        let (url, handle) = server(json_response(status, body));
        let error = tauri::async_runtime::block_on(send(
            &url,
            &auth,
            WallOperation::Connect {
                endpoint_id: "tile-1".into(),
            },
        ))
        .unwrap_err();
        handle.join().unwrap();
        assert_eq!(error.code, expected);
        assert_eq!(error.status, Some(status));
        let public = serde_json::to_string(&error).unwrap();
        assert!(!public.contains("secret-server-value") && !public.contains("wall-fixture-token"));
    }
}

#[test]
fn rejects_size_claims_chunked_overflow_and_truncated_json() {
    let auth = DeviceSessionAuthorization::device_for_test("paired-device", "wall-fixture-token");
    let oversized_head = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        MAX_RESPONSE_BYTES + 1
    )
    .into_bytes();
    let truncated =
        b"HTTP/1.1 200 OK\r\nContent-Length: 200\r\nConnection: close\r\n\r\n{}".to_vec();
    let mut chunked =
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".to_vec();
    let block = vec![b' '; 64 * 1024];
    for _ in 0..=(MAX_RESPONSE_BYTES / block.len()) {
        chunked.extend_from_slice(format!("{:x}\r\n", block.len()).as_bytes());
        chunked.extend_from_slice(&block);
        chunked.extend_from_slice(b"\r\n");
    }
    chunked.extend_from_slice(b"0\r\n\r\n");
    for (response, expected) in [
        (oversized_head, "wall_response_too_large"),
        (chunked, "wall_response_too_large"),
        (truncated, "wall_response_incomplete"),
    ] {
        let (url, handle) = server(response);
        let error =
            tauri::async_runtime::block_on(send(&url, &auth, WallOperation::State)).unwrap_err();
        handle.join().unwrap();
        assert_eq!(error.code, expected);
    }
}

#[test]
fn rejects_untrusted_origins_unknown_operations_and_oversized_requests_before_connecting() {
    let auth = DeviceSessionAuthorization::device_for_test("paired-device", "wall-fixture-token");
    for url in [
        "http://192.168.1.10",
        "https://example.com/path",
        "https://user:password@example.com",
        "file:///private",
    ] {
        let error =
            tauri::async_runtime::block_on(send(url, &auth, WallOperation::State)).unwrap_err();
        assert_eq!(error.code, "wall_invalid_origin");
    }
    assert!(serde_json::from_value::<WallOperation>(json!({"kind":"put_layout"})).is_err());
    assert!(serde_json::from_value::<WallOperation>(
        json!({"kind":"connect", "endpointId":"x", "url":"https://evil.example"})
    )
    .is_err());
    let error = tauri::async_runtime::block_on(send(
        "http://127.0.0.1:1",
        &auth,
        WallOperation::Register {
            base_revision: 0,
            endpoint: json!({"extra":"x".repeat(MAX_REQUEST_BYTES)}),
        },
    ))
    .unwrap_err();
    assert_eq!(error.code, "wall_request_too_large");
}

#[test]
fn surface_operations_keep_fixed_routes_and_allow_only_sanitized_failure_codes() {
    let auth = DeviceSessionAuthorization::device_for_test("paired-device", "wall-fixture-token");
    for operation in [
        "open",
        "state",
        "close",
        "image",
        "event",
        "confirmation",
        "cancel",
    ] {
        let request = json!({"view":{"attachmentId":"wall-view"},"payload":"x".repeat(5000)});
        let parsed: WallOperation = serde_json::from_value(
            json!({"kind":format!("surface_{operation}"),"request":request}),
        )
        .unwrap();
        assert!(parsed.is_surface());
        assert!(!parsed.is_input());
        let (url, handle) = server(json_response(
            409,
            r#"{"error":{"code":"wall_surface_forbidden","message":"private-source-path"}}"#,
        ));
        let error = tauri::async_runtime::block_on(send(&url, &auth, parsed)).unwrap_err();
        let (headers, body) = handle.join().unwrap();
        assert!(headers.starts_with(&format!("POST /v1/walls/surfaces/{operation} HTTP/1.1")));
        assert_eq!(body, request);
        assert_eq!(error.code, "wall_surface_forbidden");
        assert!(!serde_json::to_string(&error)
            .unwrap()
            .contains("private-source-path"));
    }
    let error = tauri::async_runtime::block_on(send(
        "http://127.0.0.1:1",
        &auth,
        WallOperation::Input {
            request: json!({"payload":"x".repeat(5000)}),
        },
    ))
    .unwrap_err();
    assert_eq!(error.code, "wall_request_too_large");
}
