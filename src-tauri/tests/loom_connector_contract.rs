use hook_lib::loom_connector::{
    build_brain_plan_envelope, invoke_brain_plan, invoke_brain_plan_with_manifest,
    validate_loom_manifest, LoomBrainPlanRequest,
};
use serde_json::json;
use std::ffi::OsString;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

static ENV_LOCK: Mutex<()> = Mutex::new(());

struct EnvSnapshot {
    saved: Vec<(&'static str, Option<OsString>)>,
}

impl EnvSnapshot {
    fn capture(keys: &[&'static str]) -> Self {
        Self {
            saved: keys
                .iter()
                .map(|key| (*key, std::env::var_os(key)))
                .collect(),
        }
    }
}

impl Drop for EnvSnapshot {
    fn drop(&mut self) {
        for (key, value) in &self.saved {
            if let Some(value) = value {
                std::env::set_var(key, value);
            } else {
                std::env::remove_var(key);
            }
        }
    }
}

fn manifest_with(base_url: &str, app_id: &str) -> String {
    json!({
        "schemaVersion": 1,
        "appId": app_id,
        "displayName": "Loom",
        "version": "0.1.0",
        "pid": 12345,
        "transport": {
            "type": "http",
            "baseUrl": base_url,
            "auth": "none"
        },
        "capabilities": [
            "brain.plan"
        ],
        "startedAt": 1780861361_u64
    })
    .to_string()
}

fn manifest_with_auth(auth: &str, auth_token: Option<&str>) -> String {
    let mut transport = json!({
        "type": "http",
        "baseUrl": "http://127.0.0.1:8765",
        "auth": auth
    });
    if let Some(token) = auth_token {
        transport["authToken"] = json!(token);
    }

    json!({
        "schemaVersion": 1,
        "appId": "loom",
        "displayName": "Loom",
        "version": "0.1.0",
        "pid": 12345,
        "transport": transport,
        "capabilities": [
            "brain.plan"
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

    String::from_utf8_lossy(&buffer).into_owned()
}

#[test]
fn validates_loom_manifest_and_rejects_wrong_app_id_or_non_loopback_transport() {
    let manifest = validate_loom_manifest(&manifest_with("http://127.0.0.1:8765", "loom"))
        .expect("valid loopback Loom manifest");

    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.app_id, "loom");
    assert_eq!(manifest.transport.transport_type, "http");
    assert_eq!(manifest.transport.base_url, "http://127.0.0.1:8765");
    assert!(manifest
        .capabilities
        .iter()
        .any(|capability| capability == "brain.plan"));

    let wrong_app_error = validate_loom_manifest(&manifest_with("http://127.0.0.1:8765", "talk"))
        .expect_err("wrong appId is rejected");
    assert!(
        wrong_app_error.to_string().contains("appId"),
        "wrong_app_error={wrong_app_error}"
    );

    let non_loopback_error =
        validate_loom_manifest(&manifest_with("http://192.168.1.10:8765", "loom"))
            .expect_err("LAN baseUrl is rejected");
    assert!(
        non_loopback_error.to_string().contains("loopback"),
        "non_loopback_error={non_loopback_error}"
    );

    for base_url in [
        "http://127.0.0.1:8765/api",
        "http://127.0.0.1:8765?proxy=1",
        "http://127.0.0.1:8765/#fragment",
        "http://user:secret@127.0.0.1:8765",
    ] {
        let base_url_error = validate_loom_manifest(&manifest_with(base_url, "loom"))
            .expect_err("baseUrl must be an origin-only loopback URL");
        assert!(
            base_url_error.to_string().contains("baseUrl"),
            "base_url_error={base_url_error}"
        );
    }
}

#[test]
fn validates_loom_manifest_required_metadata_and_capability_shape() {
    for (field, manifest) in [
        (
            "displayName",
            json!({
                "schemaVersion": 1,
                "appId": "loom",
                "displayName": "",
                "version": "0.1.0",
                "pid": 12345,
                "transport": {
                    "type": "http",
                    "baseUrl": "http://127.0.0.1:8765",
                    "auth": "none"
                },
                "capabilities": ["brain.plan"],
                "startedAt": 1780861361_u64
            }),
        ),
        (
            "version",
            json!({
                "schemaVersion": 1,
                "appId": "loom",
                "displayName": "Loom",
                "version": "",
                "pid": 12345,
                "transport": {
                    "type": "http",
                    "baseUrl": "http://127.0.0.1:8765",
                    "auth": "none"
                },
                "capabilities": ["brain.plan"],
                "startedAt": 1780861361_u64
            }),
        ),
        (
            "pid",
            json!({
                "schemaVersion": 1,
                "appId": "loom",
                "displayName": "Loom",
                "version": "0.1.0",
                "transport": {
                    "type": "http",
                    "baseUrl": "http://127.0.0.1:8765",
                    "auth": "none"
                },
                "capabilities": ["brain.plan"],
                "startedAt": 1780861361_u64
            }),
        ),
        (
            "startedAt",
            json!({
                "schemaVersion": 1,
                "appId": "loom",
                "displayName": "Loom",
                "version": "0.1.0",
                "pid": 12345,
                "transport": {
                    "type": "http",
                    "baseUrl": "http://127.0.0.1:8765",
                    "auth": "none"
                },
                "capabilities": ["brain.plan"]
            }),
        ),
        (
            "capabilities",
            json!({
                "schemaVersion": 1,
                "appId": "loom",
                "displayName": "Loom",
                "version": "0.1.0",
                "pid": 12345,
                "transport": {
                    "type": "http",
                    "baseUrl": "http://127.0.0.1:8765",
                    "auth": "none"
                },
                "capabilities": ["brain.plan", "brain.plan"],
                "startedAt": 1780861361_u64
            }),
        ),
    ] {
        let error = validate_loom_manifest(&manifest.to_string())
            .expect_err("invalid metadata/capability manifest is rejected");
        assert!(
            error.to_string().contains(field),
            "field={field} error={error}"
        );
    }
}

#[test]
fn validates_loom_manifest_auth_modes_before_invoke() {
    let no_auth_manifest = validate_loom_manifest(&manifest_with_auth("none", None))
        .expect("local no-auth Loom manifest is accepted");
    assert_eq!(no_auth_manifest.transport.auth.as_deref(), Some("none"));
    assert!(no_auth_manifest.transport.auth_token.is_none());

    let missing_token_error = validate_loom_manifest(&manifest_with_auth("bearer", None))
        .expect_err("bearer auth requires a manifest token before invoking Loom");
    assert!(
        missing_token_error.to_string().contains("authToken"),
        "missing_token_error={missing_token_error}"
    );
}

#[test]
fn loom_connector_builds_brain_plan_invoke_envelope_for_hook_caller() {
    let envelope = build_brain_plan_envelope(LoomBrainPlanRequest {
        request_id: Some("hook-loom-request-1".to_string()),
        goal: "Plan a stable Hook Talk Loom flow".to_string(),
        constraints: vec!["keep apps independent".to_string()],
        context: Some(json!({
            "source": "hook-panel",
            "selectedText": "voice command"
        })),
        timeout_ms: None,
    });
    let value = serde_json::to_value(&envelope).expect("serialize envelope");

    assert_eq!(value["requestId"], "hook-loom-request-1");
    assert_eq!(value["caller"], "hook");
    assert_eq!(value["capability"], "brain.plan");
    assert_eq!(value["input"]["goal"], "Plan a stable Hook Talk Loom flow");
    assert_eq!(value["input"]["constraints"][0], "keep apps independent");
    assert_eq!(value["input"]["context"]["source"], "hook-panel");
    assert_eq!(value["input"]["context"]["selectedText"], "voice command");
}

#[test]
fn loom_connector_disables_system_http_proxy_for_loopback_capability_calls() {
    let source = include_str!("../src/loom_connector.rs");

    assert!(
        source.contains(".no_proxy()"),
        "Loom local capability calls must not send loopback bearer tokens through system HTTP proxies"
    );
}

#[tokio::test]
async fn loom_connector_posts_invoke_request_with_bearer_and_maps_plan_output() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Loom server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Loom invoke");
        let raw_request = read_http_request(&mut stream);
        assert!(raw_request.starts_with("POST /v1/invoke "));
        assert!(raw_request.contains("authorization: Bearer local-token"));
        assert!(raw_request.contains("\"requestId\":\"hook-loom-live\""));
        assert!(raw_request.contains("\"caller\":\"hook\""));
        assert!(raw_request.contains("\"capability\":\"brain.plan\""));
        assert!(raw_request.contains("\"goal\":\"Plan from Hook\""));

        let body = json!({
            "requestId": "hook-loom-live",
            "status": "succeeded",
            "output": {
                "runId": "run-live",
                "summary": "Plan prepared for Hook",
                "steps": ["clarify objective", "identify constraints"],
                "run": {
                    "id": "run-live",
                    "capability": "brain.plan",
                    "status": "succeeded"
                }
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
            .expect("write fake Loom response");
    });

    let manifest = validate_loom_manifest(
        &manifest_with_auth("bearer", Some("local-token"))
            .replace("http://127.0.0.1:8765", &format!("http://127.0.0.1:{port}")),
    )
    .expect("valid fake Loom manifest");
    let result = invoke_brain_plan_with_manifest(
        manifest,
        LoomBrainPlanRequest {
            request_id: Some("hook-loom-live".to_string()),
            goal: "Plan from Hook".to_string(),
            constraints: vec!["local only".to_string()],
            context: None,
            timeout_ms: None,
        },
    )
    .await
    .expect("invoke fake Loom");

    assert_eq!(result.request_id, "hook-loom-live");
    assert_eq!(result.status, "succeeded");
    assert_eq!(result.run_id.as_deref(), Some("run-live"));
    assert_eq!(result.summary.as_deref(), Some("Plan prepared for Hook"));
    assert_eq!(
        result.steps,
        vec!["clarify objective", "identify constraints"]
    );

    server.join().expect("fake server thread joins");
}

#[tokio::test]
async fn loom_connector_does_not_send_stale_token_when_manifest_auth_is_none() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Loom server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Loom invoke");
        let raw_request = read_http_request(&mut stream);
        assert!(
            !raw_request.to_ascii_lowercase().contains("authorization:"),
            "auth=none manifest must not send stale bearer token: {raw_request}"
        );

        let body = json!({
            "requestId": "hook-loom-no-auth",
            "status": "succeeded",
            "output": {
                "runId": "run-no-auth",
                "summary": "Plan prepared",
                "steps": [],
                "run": {
                    "id": "run-no-auth",
                    "capability": "brain.plan",
                    "status": "succeeded"
                }
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
            .expect("write fake Loom response");
    });

    let manifest = validate_loom_manifest(
        &manifest_with_auth("none", Some("stale-token"))
            .replace("http://127.0.0.1:8765", &format!("http://127.0.0.1:{port}")),
    )
    .expect("auth=none manifest may contain stale token but must not use it");
    let result = invoke_brain_plan_with_manifest(
        manifest,
        LoomBrainPlanRequest {
            request_id: Some("hook-loom-no-auth".to_string()),
            goal: "Plan without auth".to_string(),
            constraints: Vec::new(),
            context: None,
            timeout_ms: None,
        },
    )
    .await
    .expect("invoke fake Loom");

    assert_eq!(result.request_id, "hook-loom-no-auth");
    assert_eq!(result.status, "succeeded");
    server.join().expect("fake server thread joins");
}

#[tokio::test]
async fn loom_connector_maps_failed_invoke_response_body() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Loom server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Loom invoke");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("set read timeout");

        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer).expect("read request");
        let body = json!({
            "requestId": "hook-loom-failed",
            "status": "failed",
            "error": {
                "code": "invalid_input",
                "message": "brain.plan input.goal is required"
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
            .expect("write fake Loom response");
    });

    let manifest =
        validate_loom_manifest(&manifest_with(&format!("http://127.0.0.1:{port}"), "loom"))
            .expect("valid fake Loom manifest");
    let result = invoke_brain_plan_with_manifest(
        manifest,
        LoomBrainPlanRequest {
            request_id: Some("hook-loom-failed".to_string()),
            goal: " ".to_string(),
            constraints: Vec::new(),
            context: None,
            timeout_ms: None,
        },
    )
    .await
    .expect("HTTP 200 failed local capability response maps to result");

    assert_eq!(result.request_id, "hook-loom-failed");
    assert_eq!(result.status, "failed");
    let error = result.error.expect("failed response error");
    assert_eq!(error.code, "invalid_input");
    assert_eq!(error.message, "brain.plan input.goal is required");

    server.join().expect("fake server thread joins");
}

#[tokio::test]
async fn loom_connector_maps_failed_invoke_response_body_even_when_http_status_is_bad_request() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Loom server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Loom invoke");
        let _ = read_http_request(&mut stream);
        let body = json!({
            "requestId": "hook-loom-failed-400",
            "status": "failed",
            "error": {
                "code": "invalid_input",
                "message": "brain.plan input.goal is required"
            }
        })
        .to_string();
        let response = format!(
            "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write fake Loom response");
    });

    let manifest =
        validate_loom_manifest(&manifest_with(&format!("http://127.0.0.1:{port}"), "loom"))
            .expect("valid fake Loom manifest");
    let result = invoke_brain_plan_with_manifest(
        manifest,
        LoomBrainPlanRequest {
            request_id: Some("hook-loom-failed-400".to_string()),
            goal: " ".to_string(),
            constraints: Vec::new(),
            context: None,
            timeout_ms: None,
        },
    )
    .await
    .expect("structured failed local capability response maps to result");

    assert_eq!(result.request_id, "hook-loom-failed-400");
    assert_eq!(result.status, "failed");
    assert_eq!(
        result.error.expect("failed response error").code,
        "invalid_input"
    );

    server.join().expect("fake server thread joins");
}

#[tokio::test]
async fn loom_connector_labels_malformed_invoke_response_as_invoke_parse_error() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Loom server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Loom invoke");
        let _ = read_http_request(&mut stream);
        let body = "not-json";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write fake Loom response");
    });

    let manifest =
        validate_loom_manifest(&manifest_with(&format!("http://127.0.0.1:{port}"), "loom"))
            .expect("valid fake Loom manifest");
    let error = invoke_brain_plan_with_manifest(
        manifest,
        LoomBrainPlanRequest {
            request_id: Some("hook-loom-bad-json".to_string()),
            goal: "Bad JSON test".to_string(),
            constraints: Vec::new(),
            context: None,
            timeout_ms: None,
        },
    )
    .await
    .expect_err("malformed invoke response is rejected");

    assert!(
        error.to_string().contains("invoke response parse failed"),
        "error={error}"
    );
    assert!(
        !error.to_string().contains("manifest parse failed"),
        "error={error}"
    );

    server.join().expect("fake server thread joins");
}

#[tokio::test]
async fn loom_connector_redacts_sensitive_response_body_from_displayed_errors() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Loom server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Loom invoke");
        let _ = read_http_request(&mut stream);
        let body = r#"{"authToken":"secret-token","message":"Authorization: Bearer secret-token"}"#;
        let response = format!(
            "HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write fake Loom response");
    });

    let manifest = validate_loom_manifest(
        &manifest_with_auth("bearer", Some("secret-token"))
            .replace("http://127.0.0.1:8765", &format!("http://127.0.0.1:{port}")),
    )
    .expect("valid fake Loom manifest");
    let error = invoke_brain_plan_with_manifest(
        manifest,
        LoomBrainPlanRequest {
            request_id: Some("hook-loom-redact".to_string()),
            goal: "Redaction test".to_string(),
            constraints: Vec::new(),
            context: None,
            timeout_ms: None,
        },
    )
    .await
    .expect_err("HTTP 500 response is rejected");

    let displayed = error.to_string();
    assert!(
        !displayed.contains("secret-token"),
        "displayed error leaked token: {displayed}"
    );
    assert!(
        !displayed.contains("Authorization"),
        "displayed error leaked authorization header: {displayed}"
    );
    assert!(
        displayed.contains("[redacted]"),
        "displayed error should preserve sanitized diagnostics: {displayed}"
    );

    server.join().expect("fake server thread joins");
}

#[tokio::test]
async fn loom_connector_redacts_sensitive_malformed_success_response_errors() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Loom server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Loom invoke");
        let _ = read_http_request(&mut stream);
        let body = "not-json Authorization: Bearer secret-token";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write fake Loom response");
    });

    let manifest = validate_loom_manifest(
        &manifest_with_auth("bearer", Some("secret-token"))
            .replace("http://127.0.0.1:8765", &format!("http://127.0.0.1:{port}")),
    )
    .expect("valid fake Loom manifest");
    let error = invoke_brain_plan_with_manifest(
        manifest,
        LoomBrainPlanRequest {
            request_id: Some("hook-loom-redact-parse".to_string()),
            goal: "Redaction parse test".to_string(),
            constraints: Vec::new(),
            context: None,
            timeout_ms: None,
        },
    )
    .await
    .expect_err("malformed success response is rejected");

    let displayed = error.to_string();
    assert!(
        !displayed.contains("secret-token"),
        "displayed error leaked token: {displayed}"
    );
    assert!(
        !displayed.contains("Authorization"),
        "displayed error leaked authorization header: {displayed}"
    );
    assert!(
        displayed.contains("[redacted]"),
        "displayed error should preserve sanitized diagnostics: {displayed}"
    );

    server.join().expect("fake server thread joins");
}

#[tokio::test(flavor = "current_thread")]
async fn loom_connector_discovers_loom_capability_manifest_dir() {
    let _guard = ENV_LOCK.lock().expect("env lock");
    let _env = EnvSnapshot::capture(&[
        "LOOM_MANIFEST_PATH",
        "LOOM_MANIFEST_DIR",
        "LOOM_CAPABILITY_MANIFEST_DIR",
        "NEURO_CAPABILITIES_DIR",
        "APPDATA",
    ]);

    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind fake Loom server");
    let port = listener.local_addr().expect("fake server address").port();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept Loom invoke");
        let raw_request = read_http_request(&mut stream);
        assert!(raw_request.contains("\"requestId\":\"hook-loom-discovery\""));

        let body = json!({
            "requestId": "hook-loom-discovery",
            "status": "succeeded",
            "output": {
                "runId": "run-discovery",
                "summary": "Plan prepared through discovery",
                "steps": [],
                "run": {
                    "id": "run-discovery",
                    "capability": "brain.plan",
                    "status": "succeeded"
                }
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
            .expect("write fake Loom response");
    });

    let root =
        std::env::temp_dir().join(format!("neuro-loom-manifest-test-{}", uuid::Uuid::new_v4()));
    let capability_dir = root.join("capabilities");
    let empty_appdata = root.join("appdata");
    std::fs::create_dir_all(&capability_dir).expect("create capability dir");
    std::fs::create_dir_all(&empty_appdata).expect("create empty appdata dir");
    std::fs::write(
        capability_dir.join("loom.json"),
        manifest_with(&format!("http://127.0.0.1:{port}"), "loom"),
    )
    .expect("write loom manifest");

    std::env::remove_var("LOOM_MANIFEST_PATH");
    std::env::remove_var("LOOM_MANIFEST_DIR");
    std::env::remove_var("NEURO_CAPABILITIES_DIR");
    std::env::set_var("LOOM_CAPABILITY_MANIFEST_DIR", &capability_dir);
    std::env::set_var("APPDATA", &empty_appdata);

    let result = invoke_brain_plan(LoomBrainPlanRequest {
        request_id: Some("hook-loom-discovery".to_string()),
        goal: "Plan through LOOM_CAPABILITY_MANIFEST_DIR".to_string(),
        constraints: Vec::new(),
        context: None,
        timeout_ms: None,
    })
    .await
    .expect("invoke fake Loom through manifest discovery");

    assert_eq!(result.request_id, "hook-loom-discovery");
    assert_eq!(result.status, "succeeded");
    server.join().expect("fake server thread joins");
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn loom_connector_times_out_wedged_local_loom_server() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind wedged Loom server");
    let port = listener.local_addr().expect("wedged server address").port();
    let server = thread::spawn(move || {
        let (_stream, _) = listener.accept().expect("accept wedged Loom invoke");
        thread::sleep(Duration::from_millis(300));
    });

    let manifest =
        validate_loom_manifest(&manifest_with(&format!("http://127.0.0.1:{port}"), "loom"))
            .expect("valid wedged Loom manifest");
    let error = invoke_brain_plan_with_manifest(
        manifest,
        LoomBrainPlanRequest {
            request_id: Some("hook-loom-timeout".to_string()),
            goal: "Timeout test".to_string(),
            constraints: Vec::new(),
            context: None,
            timeout_ms: Some(50),
        },
    )
    .await
    .expect_err("wedged Loom server times out");

    assert!(
        error.to_string().contains("timed out") || error.to_string().contains("timeout"),
        "error={error}"
    );

    server.join().expect("wedged server thread joins");
}
