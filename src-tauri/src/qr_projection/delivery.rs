use super::protocol::{self, ProjectionEnvelope};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

fn target_route_valid(entry: &Value) -> bool {
    if entry["route"] == "shared_loom" {
        return entry.get("peerId").is_none()
            && entry["deviceId"]
                .as_str()
                .is_some_and(|id| !id.starts_with("peer-target:"));
    }
    let (Some(peer), Some(remote), Some(name)) = (
        entry["peerId"].as_str(),
        entry["remoteDeviceId"].as_str(),
        entry["peerName"].as_str(),
    ) else {
        return false;
    };
    if entry["route"] != "offline_peer"
        || !((entry["deliveryAvailable"] == true
            && entry["transferProtocol"] == "loom.offline-transfer.v1")
            || (entry["deliveryAvailable"] == false
                && entry["unavailableReason"] == "offline_peer_delivery_not_implemented"))
        || !peer.strip_prefix("loom-").is_some_and(|id| {
            id.len() == 64
                && id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        || !protocol::identifier(remote)
        || name.is_empty()
        || name.len() > 128
        || name.chars().any(char::is_control)
    {
        return false;
    }
    entry["deviceId"]
        == format!(
            "peer-target:{:x}",
            Sha256::digest(format!("{peer}\n{remote}"))
        )
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ReceivePolicy {
    Confirm,
    Auto,
    Disabled,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ReceiptStatus {
    Displayed,
    Rejected,
}

pub(super) fn validate(value: Value, path: &str, origin: &str) -> Result<Value, String> {
    validate_mode(value, path, origin, false)
}
pub(super) fn validate_mode(
    value: Value,
    path: &str,
    origin: &str,
    offline: bool,
) -> Result<Value, String> {
    let invalid = || "projection_invalid_response".to_owned();
    if path == "/v1/projections/receipt" {
        return if value["recorded"] == true {
            Ok(value)
        } else {
            Err(invalid())
        };
    }
    let key = if path == "/v1/projections/targets" {
        "targets"
    } else {
        "invitations"
    };
    let entries = value[key]
        .as_array()
        .filter(|items| items.len() <= 64)
        .ok_or_else(invalid)?;
    for entry in entries {
        if key == "targets" {
            if !entry["deviceId"].as_str().is_some_and(protocol::identifier)
                || !entry["name"]
                    .as_str()
                    .is_some_and(|name| name.len() <= 1024)
                || !matches!(entry["policy"].as_str(), Some("auto" | "confirm"))
                || !target_route_valid(entry)
            {
                return Err(invalid());
            }
        } else {
            let envelope: ProjectionEnvelope =
                serde_json::from_value(entry["envelope"].clone()).map_err(|_| invalid())?;
            envelope.validate()?;
            if (!offline && envelope.server_origin != origin)
                || (offline && entry["route"] != "offline_peer")
                || !entry["revision"].as_u64().is_some_and(|rev| {
                    rev >= envelope.source.revision && rev <= protocol::MAX_REVISION
                })
                || !entry["digest"].as_str().is_some_and(|digest| {
                    digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit())
                })
                || !matches!(
                    entry["delivery"]["status"].as_str(),
                    Some("awaiting_confirmation" | "accepted")
                )
            {
                return Err(invalid());
            }
        }
    }
    Ok(value)
}
