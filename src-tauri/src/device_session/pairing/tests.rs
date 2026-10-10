use super::*;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

// One bounded registration response; issuing a challenge/session is not part of this operation.
fn registry(status: &str, body: String) -> (String, thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut socket = loop {
            match listener.accept() {
                Ok((socket, _)) => break socket,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "registration did not connect");
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("accept: {error}"),
            }
        };
        // Windows accepted sockets inherit nonblocking mode; use bounded blocking reads below.
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut request = Vec::new();
        loop {
            let mut bytes = [0; 1024];
            let count = socket.read(&mut bytes).unwrap();
            assert!(count > 0 && request.len() + count <= 16 * 1024);
            request.extend_from_slice(&bytes[..count]);
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
        socket.write_all(response.as_bytes()).unwrap();
        String::from_utf8(request).unwrap()
    });
    (base, worker)
}

fn old_identity() -> (PathBuf, DeviceIdentityDocument) {
    let root = std::env::temp_dir().join(format!("hook-repair-test-{}", uuid::Uuid::new_v4()));
    let mut identity = load_or_create_device_identity_at(&root).unwrap();
    identity.device_id = Some("device-old".to_owned());
    persist_device_identity(&root.join("device-identity.json"), &identity).unwrap();
    (root, identity)
}

#[tokio::test]
async fn explicit_pending_pairing_preserves_keys_replaces_id_and_invalidates_only_its_cache() {
    let (root, original) = old_identity();
    let body = serde_json::json!({ "pending": [{ "id": "device-new", "publicKey": original.public_key }] });
    let (base, worker) = registry("200 OK", body.to_string());
    let old_cache_key = format!("{base}\ndevice-old");
    let other_cache_key = format!("https://{}.test\ndevice-other", uuid::Uuid::new_v4());
    let now = super::super::session_attempt::unix_time_millis();
    super::super::cache::insert(
        old_cache_key.clone(),
        "device-old".into(),
        "old-token".into(),
        u64::MAX,
        now,
    )
    .unwrap();
    super::super::cache::insert(
        other_cache_key.clone(),
        "device-other".into(),
        "other-token".into(),
        u64::MAX,
        now,
    )
    .unwrap();
    let old_authorization = super::super::cache::get(&old_cache_key, now)
        .unwrap()
        .unwrap();

    assert!(request_pairing_at(&base, &root).await.unwrap());
    let request = worker.join().unwrap();
    assert!(request.starts_with("POST /v1/devices/requests "));
    let body: serde_json::Value =
        serde_json::from_str(request.split("\r\n\r\n").nth(1).unwrap()).unwrap();
    assert_eq!(body["publicKey"], original.public_key);
    assert!(body.get("privateKey").is_none());
    let loaded = load_or_create_device_identity_at(&root).unwrap();
    assert_eq!(loaded.device_id.as_deref(), Some("device-new"));
    assert_eq!(loaded.public_key, original.public_key);
    assert_eq!(loaded.private_key, original.private_key);
    assert!(super::super::cache::get(&old_cache_key, now)
        .unwrap()
        .is_none());
    assert!(super::super::cache::get(&other_cache_key, now)
        .unwrap()
        .is_some());
    assert_eq!(old_authorization.device_id, "device-old");
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn approved_existing_pairing_reports_no_identity_change() {
    let (root, original) = old_identity();
    let body = serde_json::json!({ "devices": [{ "id": "device-old", "publicKey": original.public_key }] });
    let (base, worker) = registry("200 OK", body.to_string());
    assert!(!request_pairing_at(&base, &root).await.unwrap());
    assert!(worker
        .join()
        .unwrap()
        .starts_with("POST /v1/devices/requests "));
    assert_eq!(
        load_or_create_device_identity_at(&root)
            .unwrap()
            .private_key,
        original.private_key
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn failed_or_unmatched_registration_does_not_overwrite_identity_or_invalidate_cache() {
    for (status, body) in [
        ("403 Forbidden", r#"{"error":{"code":"pairing_denied"}}"#),
        (
            "200 OK",
            r#"{"pending":[{"id":"wrong","publicKey":"not-ours"}]}"#,
        ),
    ] {
        let (root, _) = old_identity();
        let path = root.join("device-identity.json");
        let before = std::fs::read(&path).unwrap();
        let (base, worker) = registry(status, body.into());
        let cache_key = format!("{base}\ndevice-old");
        let now = super::super::session_attempt::unix_time_millis();
        super::super::cache::insert(
            cache_key.clone(),
            "device-old".into(),
            "old-token".into(),
            u64::MAX,
            now,
        )
        .unwrap();
        assert!(request_pairing_at(&base, &root).await.is_err());
        worker.join().unwrap();
        assert_eq!(std::fs::read(path).unwrap(), before);
        assert!(super::super::cache::get(&cache_key, now).unwrap().is_some());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn invalid_origin_is_rejected_before_creating_or_replacing_identity() {
    let root = std::env::temp_dir().join(format!("hook-repair-rejected-{}", uuid::Uuid::new_v4()));
    assert!(request_pairing_at("http://192.168.15.136:49874", &root)
        .await
        .is_err());
    assert!(!root.exists());
}
