use super::protocol::{self, ProjectionEnvelope, ProjectionSnapshot};
use serde_json::{json, Value};

pub(super) fn prepared_create_body(
    envelope: ProjectionEnvelope,
    snapshot: ProjectionSnapshot,
    target_device_id: Option<String>,
    actor: &str,
    origin: &str,
) -> Result<Value, String> {
    envelope.validate()?;
    if envelope.source.device_id != actor || envelope.server_origin != origin {
        return Err("projection_source_mismatch".to_owned());
    }
    if protocol::validate_snapshot(&snapshot)? != envelope.content.digest {
        return Err("projection_content_changed".to_owned());
    }
    if target_device_id
        .as_deref()
        .is_some_and(|id| !protocol::identifier(id))
    {
        return Err("projection_invalid_target".to_owned());
    }
    // Loom still verifies signatures and the current device epoch. Never re-sign
    // a saved envelope: retry must retain its original projection ID and nonce.
    Ok(json!({"envelope": envelope, "snapshot": snapshot, "targetDeviceId": target_device_id}))
}
