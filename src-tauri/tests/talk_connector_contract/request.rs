// Verifies envelopes, proxy policy, authorization, and successful responses.

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
    let connector_source = include_str!("../../src/talk_connector.rs");
    let proxy_source = include_str!("../../src/network_proxy.rs");

    assert!(
        connector_source.contains("network_proxy::shared_client"),
        "Talk capability calls must use the shared Hook proxy policy"
    );
    assert!(
        proxy_source.contains("apply_to_url(Client::builder(), endpoint)"),
        "the shared client must still run the endpoint through the proxy policy"
    );
    assert!(
        proxy_source.contains("endpoint_is_loopback(endpoint)")
            && proxy_source.contains("return Ok(builder.no_proxy())"),
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
