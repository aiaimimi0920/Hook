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

// Responsibility-named fragments share this integration target's fixtures and environment lock.
include!("loom_connector_contract/manifest.rs");
include!("loom_connector_contract/request.rs");
include!("loom_connector_contract/error.rs");
include!("loom_connector_contract/discovery_timeout.rs");
