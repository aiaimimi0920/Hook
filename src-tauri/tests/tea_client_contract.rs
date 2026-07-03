use hook_lib::tea_client::{
    HookAttachment, HookContext, HookIntakeRequest, TeaIntakeClient, TeaIntakeConfig,
};
use serde_json::Value;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

fn content_length_from_headers(request: &str) -> usize {
    request
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0)
}

fn read_http_request(mut stream: TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .expect("set read timeout");

    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 1024];
    loop {
        let size = stream.read(&mut buffer).expect("read request");
        assert!(size > 0, "mock Tea server received an empty request");
        bytes.extend_from_slice(&buffer[..size]);

        let request = String::from_utf8_lossy(&bytes).to_string();
        if let Some(header_end) = request.find("\r\n\r\n") {
            let body_len = request.len() - header_end - 4;
            let expected_body_len = content_length_from_headers(&request);
            if body_len >= expected_body_len {
                let response_body = r#"{"id":"11111111-1111-4111-8111-111111111111","title":"Please fix failing smoke","description":"created by mock","source":"hook","status":"open","approval_policy":"plan_only","labels":["source:hook"]}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );
                stream
                    .write_all(response.as_bytes())
                    .expect("write response");
                return request;
            }
        }
    }
}

#[tokio::test]
async fn posts_hook_intake_to_tea_with_bearer_auth() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock tea");
    let base_url = format!("http://{}", listener.local_addr().expect("local addr"));
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept request");
        sender
            .send(read_http_request(stream))
            .expect("send request");
    });

    let client = TeaIntakeClient::new(TeaIntakeConfig {
        base_url,
        auth_token: "secret-token".to_string(),
        source: "hook-test".to_string(),
        enabled: true,
    });
    let ticket = client
        .create_ticket(HookIntakeRequest {
            source: "hook-test".to_string(),
            text: "Please fix failing smoke".to_string(),
            context: HookContext {
                active_window: Some("PowerShell".to_string()),
                selection_text: Some("cargo test failed".to_string()),
                ocr_text: None,
                screenshot_ref: Some("file://capture.png".to_string()),
                cwd: Some("C:\\repo".to_string()),
                app: Some("hook".to_string()),
            },
            attachments: vec![HookAttachment {
                kind: "screenshot".to_string(),
                reference: "file://capture.png".to_string(),
            }],
        })
        .await
        .expect("ticket created");

    assert_eq!(ticket.id, "11111111-1111-4111-8111-111111111111");
    assert_eq!(ticket.status, "open");

    let raw_request = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("mock captured request");
    assert!(raw_request.starts_with("POST /v1/intake/hook HTTP/1.1"));
    assert!(raw_request.contains("authorization: Bearer secret-token"));

    let body: Value = serde_json::from_str(raw_request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(body["source"], "hook-test");
    assert_eq!(body["text"], "Please fix failing smoke");
    assert_eq!(body["context"]["active_window"], "PowerShell");
    assert_eq!(body["context"]["selection_text"], "cargo test failed");
    assert_eq!(body["context"]["cwd"], "C:\\repo");
    assert_eq!(body["context"]["app"], "hook");
    assert_eq!(body["attachments"][0]["kind"], "screenshot");
    assert_eq!(body["attachments"][0]["reference"], "file://capture.png");
}
