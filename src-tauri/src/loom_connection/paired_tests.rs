//! Opt-in paired check uses Otter's real signer/client against an isolated, explicitly supplied daemon.
use super::protocol;
use crate::device_session::connection_identity::ConnectionIdentity;
use serde_json::{json, Value};
use std::{
    process::{Child, Command, Stdio},
    time::Duration,
};

struct Daemon(Child);
impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[tokio::test]
#[ignore = "requires OTTER_LOOM_CONNECTION_SMOKE_EXE pointing to the newly built Loom daemon"]
async fn loom_connection_paired_signed_approval_and_lease() {
    let executable =
        std::env::var("OTTER_LOOM_CONNECTION_SMOKE_EXE").expect("explicit Loom daemon executable");
    let root = std::env::temp_dir().join(format!("otter-loom-paired-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let origin = format!("http://127.0.0.1:{port}");
    let token = uuid::Uuid::new_v4().to_string();
    let log = std::fs::File::create(root.join("daemon.log")).unwrap();
    let _daemon = Daemon(
        Command::new(executable)
            .env("LOOM_DAEMON_HOST", "127.0.0.1")
            .env("LOOM_DAEMON_PORT", port.to_string())
            .env("LOOM_DAEMON_TOKEN", &token)
            .env("LOOM_CONTROL_PLANE_ROOT", root.join("control"))
            .env("LOOM_CONFIGURATION_ROOT", root.join("configuration"))
            .env("LOOM_RUN_STORE_PATH", root.join("runs.sqlite3"))
            .env("LOOM_CAPABILITY_MANIFEST_DIR", root.join("manifests"))
            .env_remove("LOOM_GATEWAY_MODEL")
            .env_remove("LOOM_TLS_TERMINATED")
            .stdin(Stdio::null())
            .stdout(log.try_clone().unwrap())
            .stderr(log)
            .spawn()
            .unwrap(),
    );
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        if client.get(format!("{origin}/health")).send().await.is_ok() {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "daemon startup: {}",
            root.display()
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let info = protocol::probe(&origin).await.unwrap();
    let mut identity = ConnectionIdentity::load_at(&root.join("otter-identity")).unwrap();
    let created = protocol::request(
        &origin,
        "/v1/otter/connections/request",
        Some(json!({
            "name":"Paired Otter", "publicKey":identity.public_key()
        })),
        None,
    )
    .await
    .unwrap();
    assert_eq!(created["connection"]["phase"], "pending");
    let receipt = json!({"requestId":created["connection"]["id"], "receipt":created["receipt"]});
    identity.bind(created["connection"]["deviceId"].as_str().unwrap().into());
    assert!(identity.session(&origin).await.is_err());
    let approve = client
        .post(format!("{origin}/v1/otter/connections/decision"))
        .bearer_auth(&token)
        .json(&json!({"requestId":created["connection"]["id"],"approve":true}))
        .send()
        .await
        .unwrap();
    assert!(approve.status().is_success());
    let (session, _) = identity.session(&origin).await.unwrap();
    for _ in 0..2 {
        let active = protocol::request(
            &origin,
            "/v1/otter/connections/activate",
            Some(receipt.clone()),
            Some(&session),
        )
        .await
        .unwrap();
        assert_eq!(active["loom"]["loomId"], info.loom_id);
        assert_eq!(active["connection"]["phase"], "connected");
    }
    protocol::request(
        &origin,
        "/v1/otter/connections/cancel",
        Some(receipt.clone()),
        None,
    )
    .await
    .unwrap();
    assert!(protocol::request(
        &origin,
        "/v1/otter/connections/activate",
        Some(receipt),
        Some(&session)
    )
    .await
    .is_err());
    let policy = json!({"name":"Paired Loom","discoverable":false,"endpoint":null,"approval":"authenticated"});
    assert!(client
        .put(format!("{origin}/v1/otter/connections/policy"))
        .bearer_auth(&token)
        .json(&policy)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    let automatic: Value = protocol::request(
        &origin,
        "/v1/otter/connections/request",
        Some(json!({
            "name":"Paired Otter", "publicKey":identity.public_key()
        })),
        Some(&session),
    )
    .await
    .unwrap();
    assert_eq!(automatic["connection"]["phase"], "approved");
    println!("paired connection evidence: {}", root.display());
}
