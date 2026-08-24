use hook_lib::talk_connector::{
    build_voice_capture_once_envelope, capture_voice_once_with_manifest, validate_talk_manifest,
    TalkVoiceCaptureRequest,
};
use serde_json::json;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::Duration;

fn manifest_with(base_url: &str, app_id: &str) -> String {
    json!({
        "schemaVersion": 1,
        "appId": app_id,
        "displayName": "Talk",
        "version": "0.1.0",
        "pid": 12345,
        "transport": {
            "type": "http",
            "baseUrl": base_url,
            "auth": "bearer",
            "authToken": "local-token"
        },
        "capabilities": [
            "voice.capture.once",
            "voice.dictate"
        ],
        "startedAt": "2026-06-07T00:00:00Z"
    })
    .to_string()
}

fn manifest_with_auth(auth: &str, auth_token: Option<&str>) -> String {
    let mut transport = json!({
        "type": "http",
        "baseUrl": "http://127.0.0.1:49210",
        "auth": auth
    });
    if let Some(token) = auth_token {
        transport["authToken"] = json!(token);
    }

    json!({
        "schemaVersion": 1,
        "appId": "talk",
        "displayName": "Talk",
        "version": "0.1.0",
        "pid": 12345,
        "transport": transport,
        "capabilities": [
            "voice.capture.once",
            "voice.dictate"
        ],
        "startedAt": "2026-06-07T00:00:00Z"
    })
    .to_string()
}

fn manifest_with_auth_base_url_and_token(
    base_url: &str,
    auth: &str,
    auth_token: Option<&str>,
) -> String {
    let mut transport = json!({
        "type": "http",
        "baseUrl": base_url,
        "auth": auth
    });
    if let Some(token) = auth_token {
        transport["authToken"] = json!(token);
    }

    json!({
        "schemaVersion": 1,
        "appId": "talk",
        "displayName": "Talk",
        "version": "0.1.0",
        "pid": 12345,
        "transport": transport,
        "capabilities": [
            "voice.capture.once",
            "voice.dictate"
        ],
        "startedAt": "2026-06-07T00:00:00Z"
    })
    .to_string()
}

fn manifest_with_numeric_started_at() -> String {
    json!({
        "schemaVersion": 1,
        "appId": "talk",
        "displayName": "Talk",
        "version": "0.1.0",
        "pid": 12345,
        "transport": {
            "type": "http",
            "baseUrl": "http://127.0.0.1:49210",
            "auth": "bearer",
            "authToken": "local-token"
        },
        "capabilities": [
            "voice.capture.once",
            "voice.dictate"
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

    String::from_utf8_lossy(&buffer).to_string()
}

// Responsibility-named fragments share this integration target's transport fixtures.
include!("talk_connector_contract/manifest.rs");
include!("talk_connector_contract/request.rs");
include!("talk_connector_contract/error_timeout.rs");
