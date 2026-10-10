use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// 本地有界 HTTP 服务验证真实重试路径，而不只验证错误码分类函数。
async fn server(
    responses: Vec<(u16, serde_json::Value)>,
) -> (String, tokio::task::JoinHandle<usize>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = tokio::spawn(async move {
        let mut count = 0;
        for (status, body) in responses {
            let (mut socket, _) = tokio::time::timeout(Duration::from_secs(3), listener.accept())
                .await
                .unwrap()
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut chunk = [0; 1024];
                let len = tokio::time::timeout(Duration::from_secs(2), socket.read(&mut chunk))
                    .await
                    .unwrap()
                    .unwrap();
                assert!(len > 0 && request.len() + len <= 16 * 1024);
                request.extend_from_slice(&chunk[..len]);
                if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
                    let length: usize = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .unwrap()
                        .trim()
                        .parse()
                        .unwrap();
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let body = body.to_string();
            let response = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            tokio::time::timeout(
                Duration::from_secs(2),
                socket.write_all(response.as_bytes()),
            )
            .await
            .unwrap()
            .unwrap();
            count += 1;
        }
        count
    });
    (base, worker)
}

fn identity() -> DeviceIdentityDocument {
    let key = ed25519_dalek::SigningKey::generate(&mut OsRng);
    DeviceIdentityDocument {
        schema_version: 1,
        device_id: Some("device-test".to_owned()),
        private_key: BASE64.encode(key.to_bytes()),
        public_key: BASE64.encode(key.verifying_key().to_bytes()),
    }
}

#[tokio::test]
async fn disabled_device_does_not_enter_approval_polling() {
    let (base, worker) = server(vec![(
        403,
        serde_json::json!({"error":{"code":"device_disabled"}}),
    )])
    .await;
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        wait_for_approved_device_session(&base, &identity()),
    )
    .await;
    let requests = worker.await.unwrap();
    assert_eq!(requests, 1);
    // 错误若被误判为 pending，下一次连接会失败，无法保留此终态错误。
    assert!(result.unwrap().err().unwrap().contains("device_disabled"));
}

#[tokio::test]
async fn pending_device_can_still_wait_then_sign_an_approved_session() {
    let (base, worker) = server(vec![
        (403, serde_json::json!({"error":{"code":"device_not_authorized"}})),
        (201, serde_json::json!({"deviceId":"device-test","challengeId":"challenge-test","challenge":"challenge"})),
        (201, serde_json::json!({"deviceId":"device-test","token":"test-token","expiresAtMs":unix_time_millis()+900_000})),
    ]).await;
    let result = tokio::time::timeout(
        Duration::from_secs(3),
        wait_for_approved_device_session(&base, &identity()),
    )
    .await;
    assert_eq!(worker.await.unwrap(), 3);
    assert_eq!(result.unwrap().unwrap().device_id, "device-test");
}
