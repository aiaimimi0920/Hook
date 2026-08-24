// Verifies redaction, malformed responses, and bounded timeout behavior.

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
