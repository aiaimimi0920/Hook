// Verifies manifest discovery and bounded timeout behavior.

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
