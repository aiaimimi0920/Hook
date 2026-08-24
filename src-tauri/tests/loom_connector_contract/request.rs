// Verifies request envelopes, proxy policy, authorization, and successful responses.

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
    let invoke_source = include_str!("../../src/loom_connector/invoke.rs");
    let proxy_source = include_str!("../../src/network_proxy.rs");

    assert!(
        invoke_source.contains("network_proxy::shared_client"),
        "Loom capability calls must use the shared Hook proxy policy"
    );
    assert!(
        proxy_source.contains("apply_to_url(Client::builder(), endpoint)"),
        "the shared client must still run the endpoint through the proxy policy"
    );
    assert!(
        proxy_source.contains("endpoint_is_loopback(endpoint)")
            && proxy_source.contains("return Ok(builder.no_proxy())"),
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
