//! Discovery is a bounded hint collection, never a trust or connected-state assertion.
use super::protocol::{self, LoomInfo};
use serde::Serialize;
use std::{
    net::UdpSocket,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Candidate {
    origin: String,
    name: String,
    loom_id: String,
    certificate: Option<String>,
}
static SCANNING: AtomicBool = AtomicBool::new(false);
struct ScanGuard;
impl Drop for ScanGuard {
    fn drop(&mut self) {
        SCANNING.store(false, Ordering::Release);
    }
}

fn decode_candidate(packet: &[u8], peer: std::net::IpAddr) -> Option<Candidate> {
    if packet.len() > 8192 {
        return None;
    }
    let info: LoomInfo = serde_json::from_slice(packet).ok()?;
    if protocol::validate_info(&info).is_err() || !info.discoverable {
        return None;
    }
    let origin = protocol::origin(info.endpoint.as_deref()?).ok()?;
    let url = reqwest::Url::parse(&origin).ok()?;
    // A discovery hint cannot redirect a selection to another machine or to plaintext.
    if url.scheme() != "https" || url.host_str()?.parse::<std::net::IpAddr>().ok()? != peer {
        return None;
    }
    let std::net::IpAddr::V4(ip) = peer else {
        return None;
    };
    if !ip.is_private() && !ip.is_loopback() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(packet).ok()?;
    let certificate = value["certificate"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 8192)
        .map(str::to_owned);
    Some(Candidate {
        origin,
        name: info.name,
        loom_id: info.loom_id,
        certificate,
    })
}

pub(super) async fn discover() -> Result<Vec<Candidate>, String> {
    if SCANNING.swap(true, Ordering::AcqRel) {
        return Err("正在搜索 Loom".into());
    }
    let guard = ScanGuard;
    let mut targets = tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let mut targets = Vec::new();
        let socket = UdpSocket::bind("0.0.0.0:49779")
            .map_err(|_| "无法监听局域网发现端口 49779".to_string())?;
        socket
            .set_read_timeout(Some(Duration::from_millis(150)))
            .map_err(|_| "无法启动 Loom 发现".to_string())?;
        let deadline = Instant::now() + Duration::from_millis(2300);
        let mut packet = [0; 8193];
        while Instant::now() < deadline {
            let Ok((size, peer)) = socket.recv_from(&mut packet) else {
                continue;
            };
            if size > 8192 || targets.len() >= 64 {
                continue;
            }
            let Some(candidate) = decode_candidate(&packet[..size], peer.ip()) else {
                continue;
            };
            if targets
                .iter()
                .any(|item: &Candidate| item.origin == candidate.origin)
            {
                continue;
            }
            targets.push(candidate);
        }
        Ok::<_, String>(targets)
    })
    .await
    .map_err(|_| "Loom 发现任务失败".to_string())??;
    if let Ok(manifest) = crate::loom_connector::read_default_loom_manifest() {
        if let Ok(origin) = protocol::origin(&manifest.transport.base_url) {
            if !targets.iter().any(|item| item.origin == origin) {
                if let Ok(info) = protocol::probe(&origin).await {
                    targets.insert(
                        0,
                        Candidate {
                            certificate: None,
                            origin,
                            name: info.name,
                            loom_id: info.loom_id,
                        },
                    );
                }
            }
        }
    }
    Ok(targets)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_is_password_independent_and_cannot_redirect_to_another_peer() {
        let mut value = serde_json::json!({"protocolVersion":"loom.connection.v1", "loomId":"loom-test", "name":"Loom",
            "endpoint":"https://192.168.1.20:8766", "discoverable":true, "approval":"lan", "passwordRequired":true, "certificate":"public"});
        let peer = "192.168.1.20".parse().unwrap();
        for required in [true, false] {
            value["passwordRequired"] = required.into();
            assert!(decode_candidate(&serde_json::to_vec(&value).unwrap(), peer).is_some());
        }
        assert!(decode_candidate(
            &serde_json::to_vec(&value).unwrap(),
            "192.168.1.21".parse().unwrap()
        )
        .is_none());
        value["endpoint"] = "http://192.168.1.20:8766".into();
        assert!(decode_candidate(&serde_json::to_vec(&value).unwrap(), peer).is_none());
        value["endpoint"] = "https://192.168.1.20:8766".into();
        value["discoverable"] = false.into();
        assert!(decode_candidate(&serde_json::to_vec(&value).unwrap(), peer).is_none());
        assert!(decode_candidate(&vec![0; 8193], peer).is_none());
    }
}
