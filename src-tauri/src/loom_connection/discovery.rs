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
}
static SCANNING: AtomicBool = AtomicBool::new(false);
struct ScanGuard;
impl Drop for ScanGuard {
    fn drop(&mut self) {
        SCANNING.store(false, Ordering::Release);
    }
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
        let mut packet = [0; 1025];
        while Instant::now() < deadline {
            let Ok((size, _)) = socket.recv_from(&mut packet) else {
                continue;
            };
            if size > 1024 || targets.len() >= 64 {
                continue;
            }
            let Ok(info) = serde_json::from_slice::<LoomInfo>(&packet[..size]) else {
                continue;
            };
            if protocol::validate_info(&info).is_err() || !info.discoverable {
                continue;
            }
            let Some(endpoint) = info.endpoint.as_deref() else {
                continue;
            };
            let Ok(origin) = protocol::origin(endpoint) else {
                continue;
            };
            if !origin.starts_with("https://")
                || targets.iter().any(|item: &Candidate| item.origin == origin)
            {
                continue;
            }
            targets.push(Candidate {
                origin,
                name: info.name,
                loom_id: info.loom_id,
            });
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
