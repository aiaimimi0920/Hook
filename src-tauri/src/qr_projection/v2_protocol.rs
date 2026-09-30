//! Wire validation is local; only Loom decides account trust and peer authorization.
use super::protocol::{self, ProjectionContent, ProjectionSignature, ProjectionSnapshot};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Source {
    pub device_id: String,
    pub account_id: String,
    pub public_key: String,
    pub session_id: String,
    pub unit_id: String,
    pub revision: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Envelope {
    pub protocol: String,
    pub projection_id: String,
    pub server_origin: String,
    pub source: Source,
    pub content: ProjectionContent,
    pub expires_at_ms: u64,
    pub nonce: String,
    pub signature: ProjectionSignature,
}

impl Envelope {
    pub(super) fn validate(&self) -> Result<(), String> {
        let invalid = || "projection_invalid_invitation".to_owned();
        let legacy_shape = protocol::ProjectionEnvelope {
            protocol: protocol::PROTOCOL.to_owned(),
            projection_id: self.projection_id.clone(),
            server_origin: self.server_origin.clone(),
            source: protocol::ProjectionSource {
                device_id: self.source.device_id.clone(),
                session_id: self.source.session_id.clone(),
                unit_id: self.source.unit_id.clone(),
                revision: self.source.revision,
            },
            content: self.content.clone(),
            expires_at_ms: self.expires_at_ms,
            nonce: self.nonce.clone(),
            signature: self.signature.clone(),
        };
        legacy_shape.validate()?;
        if self.protocol != "neuro.qr-projection.v2"
            || self.source.revision != 1
            || !protocol::identifier(&self.source.account_id)
            || uuid::Uuid::parse_str(&self.source.device_id).is_err()
            || protocol::normalize_origin(&self.server_origin)? != self.server_origin
        {
            return Err(invalid());
        }
        let key = STANDARD
            .decode(&self.source.public_key)
            .map_err(|_| invalid())?;
        if STANDARD.encode(&key) != self.source.public_key {
            return Err(invalid());
        }
        let key: [u8; 32] = key.try_into().map_err(|_| invalid())?;
        let key = VerifyingKey::from_bytes(&key).map_err(|_| invalid())?;
        let signature = URL_SAFE_NO_PAD
            .decode(&self.signature.value)
            .map_err(|_| invalid())?;
        let signature = Signature::from_slice(&signature).map_err(|_| invalid())?;
        let message = [
            self.protocol.clone(),
            self.projection_id.clone(),
            self.server_origin.clone(),
            self.source.device_id.clone(),
            self.source.account_id.clone(),
            self.source.public_key.clone(),
            self.source.session_id.clone(),
            self.source.unit_id.clone(),
            self.source.revision.to_string(),
            self.content.kind.clone(),
            self.content.digest.clone(),
            self.expires_at_ms.to_string(),
            self.nonce.clone(),
            self.signature.algorithm.clone(),
            self.signature.key_id.clone(),
        ]
        .join("\n");
        key.verify_strict(message.as_bytes(), &signature)
            .map_err(|_| invalid())
    }
}

pub(super) fn validate_response(value: &Value, body: &Value) -> Result<Envelope, String> {
    let invalid = || "projection_invalid_response".to_owned();
    let envelope: Envelope =
        serde_json::from_value(value["envelope"].clone()).map_err(|_| invalid())?;
    envelope.validate()?;
    if body
        .get("projectionId")
        .is_some_and(|id| id != &value["envelope"]["projectionId"])
        || body
            .get("envelope")
            .is_some_and(|e| e != &value["envelope"])
        || body
            .get("receiverUnitId")
            .is_some_and(|id| id != &value["receiverUnitId"])
        || body
            .get("unitId")
            .is_some_and(|id| id != &value["envelope"]["source"]["unitId"])
        || body
            .get("contentKind")
            .is_some_and(|kind| kind != &value["envelope"]["content"]["kind"])
        || body
            .get("sourceSessionId")
            .is_some_and(|id| id != &value["envelope"]["source"]["sessionId"])
        || !value["linked"].is_boolean()
    {
        return Err(invalid());
    }
    let revision = value["revision"].as_u64().ok_or_else(invalid)?;
    let known = body["knownRevision"]
        .as_u64()
        .or(body["expectedRevision"].as_u64())
        .unwrap_or(1);
    if revision < known || revision > protocol::MAX_REVISION || revision < envelope.source.revision
    {
        return Err(invalid());
    }
    let digest = value["digest"].as_str().ok_or_else(invalid)?;
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid());
    }
    if body["kind"] == "update" {
        let snapshot: ProjectionSnapshot =
            serde_json::from_value(body["snapshot"].clone()).map_err(|_| invalid())?;
        if (Some(revision) != body["revision"].as_u64()
            && Some(revision) != body["priorRevision"].as_u64())
            || protocol::validate_snapshot(&snapshot)? != digest
        {
            return Err(invalid());
        }
    }
    if body["expectedRevision"].as_u64() == Some(revision)
        && body["expectedDigest"]
            .as_str()
            .is_some_and(|expected| expected != digest)
    {
        return Err(invalid());
    }
    if !value["snapshot"].is_null() {
        let snapshot: ProjectionSnapshot =
            serde_json::from_value(value["snapshot"].clone()).map_err(|_| invalid())?;
        if protocol::validate_snapshot(&snapshot)? != digest {
            return Err(invalid());
        }
    } else if matches!(body["kind"].as_str(), Some("inspect" | "accept")) {
        return Err(invalid());
    }
    Ok(envelope)
}
