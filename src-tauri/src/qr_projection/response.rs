//! Correlate network replies before pixels or link metadata reach the workspace.
use super::protocol::{self, ProjectionEnvelope, ProjectionSnapshot};
use serde_json::Value;

pub(super) struct ResponseContext {
    path: &'static str,
    origin: String,
    projection_id: Value,
    envelope: Value,
    receiver_unit_id: Value,
    known_revision: u64,
    expected_revision: Option<u64>,
    expected_digest: Option<String>,
}

impl ResponseContext {
    pub(super) fn new(path: &'static str, origin: &str, body: &Value) -> Self {
        Self {
            path,
            origin: origin.to_owned(),
            projection_id: body
                .get("projectionId")
                .unwrap_or(&body["envelope"]["projectionId"])
                .clone(),
            envelope: body["envelope"].clone(),
            receiver_unit_id: body["receiverUnitId"].clone(),
            known_revision: body["knownRevision"]
                .as_u64()
                .or(body["expectedRevision"].as_u64())
                .unwrap_or(0),
            expected_revision: body["revision"].as_u64().or_else(|| {
                (path == "/v1/projections/create")
                    .then(|| body["envelope"]["source"]["revision"].as_u64())
                    .flatten()
            }),
            expected_digest: body["digest"]
                .as_str()
                .or_else(|| {
                    (path == "/v1/projections/create")
                        .then(|| body["envelope"]["content"]["digest"].as_str())
                        .flatten()
                })
                .map(str::to_owned),
        }
    }
}

pub(super) fn validate(value: Value, context: &ResponseContext) -> Result<Value, String> {
    if context.path == "/v1/projections/unlink" {
        return if value.get("unlinked") == Some(&Value::Bool(true)) {
            Ok(value)
        } else {
            Err("projection_invalid_response".to_owned())
        };
    }
    let envelope: ProjectionEnvelope = serde_json::from_value(value["envelope"].clone())
        .map_err(|_| "projection_invalid_response")?;
    envelope.validate()?;
    if envelope.server_origin != context.origin
        || value["envelope"]["projectionId"] != context.projection_id
        || (!context.envelope.is_null() && value["envelope"] != context.envelope)
        || (!context.receiver_unit_id.is_null()
            && value["receiverUnitId"] != context.receiver_unit_id)
    {
        return Err("projection_response_mismatch".to_owned());
    }
    if !value["digest"].as_str().is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    }) || !value["linked"].is_boolean()
    {
        return Err("projection_invalid_response".to_owned());
    }
    if !value["revision"].as_u64().is_some_and(|revision| {
        revision >= envelope.source.revision
            && revision >= context.known_revision
            && revision <= protocol::MAX_REVISION
    }) {
        return Err("projection_invalid_revision".to_owned());
    }
    if context
        .expected_revision
        .is_some_and(|revision| value["revision"].as_u64() != Some(revision))
        || context
            .expected_digest
            .as_deref()
            .is_some_and(|digest| value["digest"].as_str() != Some(digest))
    {
        return Err("projection_response_mismatch".to_owned());
    }
    if context.path == "/v1/projections/accept" && value["snapshot"].is_null() {
        return Err("projection_invalid_response".to_owned());
    }
    if !value["snapshot"].is_null() {
        let snapshot: ProjectionSnapshot = serde_json::from_value(value["snapshot"].clone())
            .map_err(|_| "projection_invalid_response")?;
        let digest = protocol::validate_snapshot(&snapshot)?;
        if value["digest"].as_str() != Some(&digest) {
            return Err("projection_digest_mismatch".to_owned());
        }
    }
    Ok(value)
}
