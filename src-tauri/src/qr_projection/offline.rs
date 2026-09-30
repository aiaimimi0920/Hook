//! Route through the caller's paired Loom while leaving the source-signed envelope untouched.
use super::*;
use sha2::{Digest, Sha256};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OfflineRoute {
    peer_id: Option<String>,
    remote_device_id: Option<String>,
}
pub(super) fn prepare(
    path: &'static str,
    body: &mut Value,
    route: OfflineRoute,
) -> Result<&'static str, String> {
    if path == "/v1/projections/create" {
        let peer = route.peer_id.ok_or("projection_invalid_target")?;
        let remote = route.remote_device_id.ok_or("projection_invalid_target")?;
        let target = format!(
            "peer-target:{:x}",
            Sha256::digest(format!("{peer}\n{remote}"))
        );
        if peer.len() != 69
            || !peer.starts_with("loom-")
            || !peer[5..].bytes().all(|b| b.is_ascii_hexdigit())
            || !protocol::identifier(&remote)
            || body["targetDeviceId"] != target
        {
            return Err("projection_invalid_target".into());
        }
        body["peerId"] = json!(peer);
        body["remoteDeviceId"] = json!(remote);
    } else if route.peer_id.is_some() || route.remote_device_id.is_some() {
        return Err("projection_invalid_request".into());
    }
    match path {
        "/v1/projections/edit" => Ok("/v1/offline-projections/edit"),
        "/v1/projections/create" => Ok("/v1/offline-projections/create"),
        "/v1/projections/inbox" => Ok("/v1/offline-projections/inbox"),
        "/v1/projections/inspect" => Ok("/v1/offline-projections/inspect"),
        "/v1/projections/accept" => Ok("/v1/offline-projections/accept"),
        "/v1/projections/read" => Ok("/v1/offline-projections/read"),
        "/v1/projections/update" => Ok("/v1/offline-projections/update"),
        "/v1/projections/receipt" => Ok("/v1/offline-projections/receipt"),
        "/v1/projections/unlink" => Ok("/v1/offline-projections/unlink"),
        _ => Err("projection_invalid_request".into()),
    }
}
