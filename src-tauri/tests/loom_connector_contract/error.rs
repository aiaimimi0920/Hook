// Verifies failed, malformed, and redacted Loom response handling.

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

