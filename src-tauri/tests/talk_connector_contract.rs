use hook_lib::talk_connector::{
    build_voice_capture_once_envelope, capture_voice_once_with_manifest, validate_talk_manifest,
    TalkVoiceCaptureRequest,
};
use serde_json::json;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

fn manifest_with(base_url: &str, app_id: &str) -> String {
    json!({
        "schemaVersion": 1,
        "appId": app_id,
        "displayName": "Talk",
        "version": "0.1.0",
        "pid": 12345,
        "transport": {
            "type": "http",
            "baseUrl": base_url,
            "auth": "bearer",
            "authToken": "local-token"
        },
        "capabilities": [
            "voice.capture.once",
            "voice.dictate"
        ],
        "startedAt": "2026-06-07T00:00:00Z"
    })
    .to_string()
}

fn manifest_with_auth(auth: &str, auth_token: Option<&str>) -> String {
    let mut transport = json!({
        "type": "http",
        "baseUrl": "http://127.0.0.1:49210",
        "auth": auth
    });
    if let Some(token) = auth_token {
        transport["authToken"] = json!(token);
    }

    json!({
        "schemaVersion": 1,
        "appId": "talk",
        "displayName": "Talk",
        "version": "0.1.0",
        "pid": 12345,
        "transport": transport,
        "capabilities": [
            "voice.capture.once",
            "voice.dictate"
        ],
        "startedAt": "2026-06-07T00:00:00Z"
    })
    .to_string()
}

fn manifest_with_auth_base_url_and_token(
    base_url: &str,
    auth: &str,
    auth_token: Option<&str>,
) -> String {
    let mut transport = json!({
        "type": "http",
        "baseUrl": base_url,
        "auth": auth
    });
    if let Some(token) = auth_token {
        transport["authToken"] = json!(token);
    }

    json!({
        "schemaVersion": 1,
        "appId": "talk",
        "displayName": "Talk",
        "version": "0.1.0",
        "pid": 12345,
        "transport": transport,
        "capabilities": [
            "voice.capture.once",
            "voice.dictate"
        ],
        "startedAt": "2026-06-07T00:00:00Z"
    })
    .to_string()
}

fn manifest_with_numeric_started_at() -> String {
    json!({
        "schemaVersion": 1,
        "appId": "talk",
        "displayName": "Talk",
        "version": "0.1.0",
        "pid": 12345,
        "transport": {
            "type": "http",
            "baseUrl": "http://127.0.0.1:49210",
            "auth": "bearer",
            "authToken": "local-token"
        },
        "capabilities": [
            "voice.capture.once",
            "voice.dictate"
        ],
        "startedAt": 1780861361_u64
    })
    .to_string()
}

fn read_http_request(stream: &mut TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .expect("set read timeout");

    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 1024];
    loop {
        let read = stream.read(&mut chunk).expect("read request");
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            let request = String::from_utf8_lossy(&buffer);
            let content_length = request
                .lines()
                .find_map(|line| {
                    line.strip_prefix("content-length:")
                        .or_else(|| line.strip_prefix("Content-Length:"))
                        .and_then(|value| value.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            let header_end = buffer
                .windows(4)
                .position(|window| window == b"\r\n\r\n")
                .map(|index| index + 4)
                .expect("header end");
            while buffer.len() < header_end + content_length {
                let read = stream.read(&mut chunk).expect("read request body");
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
            }
            break;
        }
    }

    String::from_utf8_lossy(&buffer).to_string()
}

#[test]
fn validates_talk_manifest_and_rejects_wrong_app_id_or_non_loopback_transport() {
    let manifest = validate_talk_manifest(&manifest_with("http://127.0.0.1:49210", "talk"))
        .expect("valid loopback Talk manifest");

    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.app_id, "talk");
    assert_eq!(manifest.transport.transport_type, "http");
    assert_eq!(manifest.transport.base_url, "http://127.0.0.1:49210");
    assert!(manifest
        .capabilities
        .iter()
        .any(|capability| capability == "voice.capture.once"));

    let wrong_app_error = validate_talk_manifest(&manifest_with("http://127.0.0.1:49210", "loom"))
        .expect_err("wrong appId is rejected");
    assert!(
        wrong_app_error.to_string().contains("appId"),
        "wrong_app_error={wrong_app_error}"
    );

    let non_loopback_error =
        validate_talk_manifest(&manifest_with("http://192.168.1.10:49210", "talk"))
            .expect_err("LAN baseUrl is rejected");
    assert!(
        non_loopback_error.to_string().contains("loopback"),
        "non_loopback_error={non_loopback_error}"
    );

    for base_url in [
        "http://127.0.0.1:49210/v1",
        "http://127.0.0.1:49210?token=leak",
        "http://127.0.0.1:49210#fragment",
        "http://user:pass@127.0.0.1:49210",
    ] {
        let error = validate_talk_manifest(&manifest_with(base_url, "talk"))
            .expect_err("baseUrl with path, query, fragment, or userinfo is rejected");
        assert!(
            error.to_string().contains("loopback"),
            "base_url={base_url} error={error}"
        );
    }
}

#[test]
fn validates_talk_manifest_auth_modes_before_invoke() {
    let no_auth_manifest = validate_talk_manifest(&manifest_with_auth("none", None))
        .expect("local no-auth Talk manifest is accepted");
    assert_eq!(no_auth_manifest.transport.auth.as_deref(), Some("none"));
    assert!(no_auth_manifest.transport.auth_token.is_none());

    let missing_token_error = validate_talk_manifest(&manifest_with_auth("bearer", None))
        .expect_err("bearer auth requires a manifest token before invoking Talk");
    assert!(
        missing_token_error.to_string().contains("authToken"),
        "missing_token_error={missing_token_error}"
    );
}

#[test]
fn validates_talk_manifest_rejects_incomplete_metadata_and_duplicate_capabilities() {
    let mut missing_display_name: serde_json::Value =
        serde_json::from_str(&manifest_with("http://127.0.0.1:49210", "talk"))
            .expect("manifest json");
    missing_display_name["displayName"] = json!(" ");
    let error = validate_talk_manifest(&missing_display_name.to_string())
        .expect_err("blank displayName is rejected");
    assert!(
        error.to_string().contains("displayName"),
        "displayName error={error}"
    );

    let mut missing_version: serde_json::Value =
        serde_json::from_str(&manifest_with("http://127.0.0.1:49210", "talk"))
            .expect("manifest json");
    missing_version["version"] = json!("");
    let error = validate_talk_manifest(&missing_version.to_string())
        .expect_err("blank version is rejected");
    assert!(
        error.to_string().contains("version"),
        "version error={error}"
    );

    let mut missing_pid: serde_json::Value =
        serde_json::from_str(&manifest_with("http://127.0.0.1:49210", "talk"))
            .expect("manifest json");
    missing_pid
        .as_object_mut()
        .expect("manifest object")
        .remove("pid");
    let error =
        validate_talk_manifest(&missing_pid.to_string()).expect_err("missing pid is rejected");
    assert!(error.to_string().contains("pid"), "pid error={error}");

    let mut missing_started_at: serde_json::Value =
        serde_json::from_str(&manifest_with("http://127.0.0.1:49210", "talk"))
            .expect("manifest json");
    missing_started_at
        .as_object_mut()
        .expect("manifest object")
        .remove("startedAt");
    let error = validate_talk_manifest(&missing_started_at.to_string())
        .expect_err("missing startedAt is rejected");
    assert!(
        error.to_string().contains("startedAt"),
        "startedAt error={error}"
    );

    let mut duplicate_capabilities: serde_json::Value =
        serde_json::from_str(&manifest_with("http://127.0.0.1:49210", "talk"))
            .expect("manifest json");
    duplicate_capabilities["capabilities"] = json!(["voice.capture.once", "voice.capture.once"]);
    let error = validate_talk_manifest(&duplicate_capabilities.to_string())
        .expect_err("duplicate capabilities are rejected");
    assert!(
        error.to_string().contains("duplicate"),
        "duplicate capabilities error={error}"
    );
}

#[test]
fn validates_manifest_shape_written_by_talk_serve() {
    let manifest = validate_talk_manifest(&manifest_with_numeric_started_at())
        .expect("Hook accepts Talk serve's numeric startedAt manifest");

    assert_eq!(manifest.app_id, "talk");
    assert_eq!(manifest.started_at, Some(json!(1780861361_u64)));
}

#[test]
fn talk_connector_builds_voice_capture_once_invoke_envelope_for_hook_caller() {
    let envelope = build_voice_capture_once_envelope(TalkVoiceCaptureRequest {
        request_id: Some("hook-request-1".to_string()),
        mode: Some("dictation".to_string()),
        context: Some(json!({
            "source": "hook-panel",
            "windowTitle": "Paint"
        })),
        timeout_ms: None,
    });
    let value = serde_json::to_value(&envelope).expect("serialize envelope");

    assert_eq!(value["requestId"], "hook-request-1");
    assert_eq!(value["caller"], "hook");
    assert_eq!(value["capability"], "voice.capture.once");
    assert_eq!(value["input"]["mode"], "dictation");
    assert_eq!(value["input"]["context"]["source"], "hook-panel");
    assert_eq!(value["input"]["context"]["windowTitle"], "Paint");
}

#[test]
fn talk_connector_disables_system_http_proxy_for_loopback_capability_calls() {
    let source = include_str!("../src/talk_connector.rs");

    assert!(
        source.contains(".no_proxy()"),
        "Talk local capability calls must not send loopback bearer tokens through system HTTP proxies"
    );
}

#[tokio::test]
async fn talk_connector_posts_invoke_request_with_bearer_and_maps_debug_output() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Talk server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Talk invoke");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("set read timeout");

        let mut buffer = Vec::new();
        let mut chunk = [0_u8; 1024];
        loop {
            let read = stream.read(&mut chunk).expect("read request");
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
            if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                let request = String::from_utf8_lossy(&buffer);
                let content_length = request
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("content-length:")
                            .or_else(|| line.strip_prefix("Content-Length:"))
                            .and_then(|value| value.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                let header_end = buffer
                    .windows(4)
                    .position(|window| window == b"\r\n\r\n")
                    .map(|index| index + 4)
                    .expect("header end");
                while buffer.len() < header_end + content_length {
                    let read = stream.read(&mut chunk).expect("read request body");
                    if read == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                }
                break;
            }
        }

        let raw_request = String::from_utf8_lossy(&buffer);
        assert!(raw_request.starts_with("POST /v1/invoke "));
        assert!(raw_request.contains("authorization: Bearer local-token"));
        assert!(raw_request.contains("\"requestId\":\"hook-request-live\""));
        assert!(raw_request.contains("\"caller\":\"hook\""));
        assert!(raw_request.contains("\"capability\":\"voice.capture.once\""));

        let body = json!({
            "requestId": "hook-request-live",
            "status": "succeeded",
            "output": {
                "text": "hello from fake Talk",
                "transcript": "hello from fake Talk",
                "sessionId": "session-live",
                "evidencePath": ".runtime/talk/logs/session-live.json",
                "triggerEvents": ["trigger_start", "trigger_stop"]
            }
        })
        .to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write fake Talk response");
    });

    let manifest =
        validate_talk_manifest(&manifest_with(&format!("http://127.0.0.1:{port}"), "talk"))
            .expect("valid fake Talk manifest");
    let result = capture_voice_once_with_manifest(
        manifest,
        TalkVoiceCaptureRequest {
            request_id: Some("hook-request-live".to_string()),
            mode: Some("dictation".to_string()),
            context: Some(json!({ "source": "hook-panel" })),
            timeout_ms: None,
        },
    )
    .await
    .expect("capture via fake Talk");

    assert_eq!(result.request_id, "hook-request-live");
    assert_eq!(result.status, "succeeded");
    assert_eq!(result.text.as_deref(), Some("hello from fake Talk"));
    assert_eq!(result.session_id.as_deref(), Some("session-live"));
    assert_eq!(result.trigger_events, vec!["trigger_start", "trigger_stop"]);

    server.join().expect("fake server thread joins");
}

#[tokio::test]
async fn talk_connector_does_not_send_stale_auth_token_when_manifest_auth_is_none() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Talk server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Talk invoke");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("set read timeout");

        let mut buffer = Vec::new();
        let mut chunk = [0_u8; 1024];
        loop {
            let read = stream.read(&mut chunk).expect("read request");
            if read == 0 {
                break;
            }
            buffer.extend_from_slice(&chunk[..read]);
            if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
                let request = String::from_utf8_lossy(&buffer);
                let content_length = request
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("content-length:")
                            .or_else(|| line.strip_prefix("Content-Length:"))
                            .and_then(|value| value.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                let header_end = buffer
                    .windows(4)
                    .position(|window| window == b"\r\n\r\n")
                    .map(|index| index + 4)
                    .expect("header end");
                while buffer.len() < header_end + content_length {
                    let read = stream.read(&mut chunk).expect("read request body");
                    if read == 0 {
                        break;
                    }
                    buffer.extend_from_slice(&chunk[..read]);
                }
                break;
            }
        }

        let raw_request = String::from_utf8_lossy(&buffer);
        assert!(raw_request.starts_with("POST /v1/invoke "));
        assert!(
            !raw_request.to_ascii_lowercase().contains("authorization:"),
            "auth=none manifests must not leak stale authToken via Authorization header: {raw_request}"
        );

        let body = json!({
            "requestId": "hook-request-no-auth",
            "status": "succeeded",
            "output": {
                "text": "hello from no-auth Talk",
                "transcript": "hello from no-auth Talk",
                "triggerEvents": []
            }
        })
        .to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write fake Talk response");
    });

    let manifest = validate_talk_manifest(&manifest_with_auth_base_url_and_token(
        &format!("http://127.0.0.1:{port}"),
        "none",
        Some("stale-token-that-must-not-be-sent"),
    ))
    .expect("valid fake no-auth Talk manifest with stale token field");
    let result = capture_voice_once_with_manifest(
        manifest,
        TalkVoiceCaptureRequest {
            request_id: Some("hook-request-no-auth".to_string()),
            mode: Some("dictation".to_string()),
            context: Some(json!({ "source": "hook-panel" })),
            timeout_ms: None,
        },
    )
    .await
    .expect("capture via fake no-auth Talk");

    assert_eq!(result.status, "succeeded");
    assert_eq!(result.text.as_deref(), Some("hello from no-auth Talk"));

    server.join().expect("fake server thread joins");
}

#[tokio::test]
async fn talk_connector_redacts_sensitive_values_from_http_error_bodies() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Talk server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Talk invoke");
        let raw_request = read_http_request(&mut stream);
        assert!(raw_request.contains("authorization: Bearer local-token"));

        let body = json!({
            "authToken": "local-token",
            "Authorization": "Bearer local-token",
            "password": "super-secret",
            "message": "upstream saw Bearer local-token"
        })
        .to_string();
        let response = format!(
            "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write fake Talk response");
    });

    let manifest =
        validate_talk_manifest(&manifest_with(&format!("http://127.0.0.1:{port}"), "talk"))
            .expect("valid fake Talk manifest");
    let error = capture_voice_once_with_manifest(
        manifest,
        TalkVoiceCaptureRequest {
            request_id: Some("hook-request-redaction".to_string()),
            mode: Some("dictation".to_string()),
            context: Some(json!({ "source": "hook-panel" })),
            timeout_ms: None,
        },
    )
    .await
    .expect_err("HTTP errors are surfaced");

    let message = error.to_string();
    assert!(message.contains("HTTP 500"), "error={message}");
    assert!(!message.contains("local-token"), "error={message}");
    assert!(!message.contains("super-secret"), "error={message}");
    assert!(!message.contains("Bearer local-token"), "error={message}");

    server.join().expect("fake server thread joins");
}

#[tokio::test]
async fn talk_connector_labels_malformed_success_response_as_invoke_response_parse() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Talk server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Talk invoke");
        let _ = read_http_request(&mut stream);

        let body = "{ not valid json";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write fake Talk response");
    });

    let manifest =
        validate_talk_manifest(&manifest_with(&format!("http://127.0.0.1:{port}"), "talk"))
            .expect("valid fake Talk manifest");
    let error = capture_voice_once_with_manifest(
        manifest,
        TalkVoiceCaptureRequest {
            request_id: Some("hook-request-parse".to_string()),
            mode: Some("dictation".to_string()),
            context: Some(json!({ "source": "hook-panel" })),
            timeout_ms: None,
        },
    )
    .await
    .expect_err("malformed success response is rejected");

    let message = error.to_string();
    assert!(
        message.contains("Talk invoke response parse failed"),
        "error={message}"
    );

    server.join().expect("fake server thread joins");
}

#[tokio::test]
async fn talk_connector_times_out_wedged_local_talk_server() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind wedged Talk server");
    let port = listener.local_addr().expect("wedged server address").port();
    let server = thread::spawn(move || {
        let (_stream, _) = listener.accept().expect("accept wedged Talk invoke");
        thread::sleep(Duration::from_millis(300));
    });

    let manifest =
        validate_talk_manifest(&manifest_with(&format!("http://127.0.0.1:{port}"), "talk"))
            .expect("valid wedged Talk manifest");
    let error = capture_voice_once_with_manifest(
        manifest,
        TalkVoiceCaptureRequest {
            request_id: Some("hook-request-timeout".to_string()),
            mode: Some("dictation".to_string()),
            context: None,
            timeout_ms: Some(50),
        },
    )
    .await
    .expect_err("wedged Talk server times out");

    assert!(
        error.to_string().contains("timed out") || error.to_string().contains("timeout"),
        "error={error}"
    );

    server.join().expect("wedged server thread joins");
}
