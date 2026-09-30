use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub(crate) const PROTOCOL: &str = "neuro.qr-projection.v1";
pub(super) const MAX_BODY: usize = 6 * 1024 * 1024;
pub(super) const MAX_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectionSource {
    pub device_id: String,
    pub session_id: String,
    pub unit_id: String,
    pub revision: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectionContent {
    pub kind: String,
    pub digest: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectionSignature {
    pub algorithm: String,
    pub key_id: String,
    pub value: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectionEnvelope {
    pub protocol: String,
    pub projection_id: String,
    pub server_origin: String,
    pub source: ProjectionSource,
    pub content: ProjectionContent,
    pub expires_at_ms: u64,
    pub nonce: String,
    pub signature: ProjectionSignature,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectionSnapshot {
    pub image_base64: String,
    pub width: u32,
    pub height: u32,
}

pub(super) fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:/-".contains(&byte))
}

pub(super) fn projection_id(value: &str) -> bool {
    value
        .strip_prefix("projection:")
        .is_some_and(|id| id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

impl ProjectionEnvelope {
    pub(crate) fn signature_message(&self) -> String {
        format!(
            "{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
            self.protocol,
            self.projection_id,
            self.server_origin,
            self.source.device_id,
            self.source.session_id,
            self.source.unit_id,
            self.source.revision,
            self.content.kind,
            self.content.digest,
            self.expires_at_ms,
            self.nonce
        )
    }

    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.protocol != PROTOCOL
            || !projection_id(&self.projection_id)
            || normalize_origin(&self.server_origin).as_deref() != Ok(self.server_origin.as_str())
            || !identifier(&self.source.device_id)
            || !identifier(&self.source.session_id)
            || !identifier(&self.source.unit_id)
            || self.source.revision == 0
            || self.source.revision > MAX_REVISION
            || !matches!(self.content.kind.as_str(), "sticker" | "art")
            || self.content.digest.len() != 64
            || !self
                .content
                .digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || self.nonce.len() != 32
            || !self.nonce.bytes().all(|byte| byte.is_ascii_hexdigit())
            || self.expires_at_ms == 0
            || self.expires_at_ms > MAX_REVISION
            || self.signature.algorithm != "ed25519"
            || self.signature.key_id != self.source.device_id
            || self.signature.value.len() != 86
            || !self
                .signature
                .value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
        {
            return Err("projection_invalid_invitation".to_owned());
        }
        Ok(())
    }
}

pub(super) fn normalize_origin(origin: &str) -> Result<String, String> {
    if origin.len() > 256
        || !origin.is_ascii()
        || origin
            .chars()
            .any(|ch| ch.is_control() || ch.is_whitespace() || ch == '\\')
    {
        return Err("projection_invalid_origin".to_owned());
    }
    crate::loom_connector::classify_loom_base_url(origin)
        .map_err(|_| "projection_invalid_origin".to_owned())?;
    let url = reqwest::Url::parse(origin).map_err(|_| "projection_invalid_origin")?;
    Ok(url.origin().ascii_serialization())
}

pub(super) fn validate_snapshot(snapshot: &ProjectionSnapshot) -> Result<String, String> {
    let invalid = || "projection_invalid_image".to_owned();
    if snapshot.image_base64.len() > (4 * 1024 * 1024usize).div_ceil(3) * 4
        || snapshot.width == 0
        || snapshot.height == 0
        || snapshot.width > 8192
        || snapshot.height > 8192
        || u64::from(snapshot.width) * u64::from(snapshot.height) > 16_777_216
    {
        return Err(invalid());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&snapshot.image_base64)
        .map_err(|_| invalid())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err(invalid());
    }
    let mut reader =
        image::ImageReader::with_format(std::io::Cursor::new(&bytes), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(80 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| invalid())?;
    if image.width() != snapshot.width || image.height() != snapshot.height {
        return Err(invalid());
    }
    Ok(format!("{:x}", Sha256::digest(&bytes)))
}

pub(super) fn qr_data_url(envelope: &ProjectionEnvelope) -> Result<String, String> {
    envelope.validate()?;
    let bytes = serde_json::to_vec(envelope).map_err(|_| "projection_invalid_invitation")?;
    let code = qrcode::QrCode::with_error_correction_level(bytes, qrcode::EcLevel::M)
        .map_err(|_| "projection_qr_capacity")?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(320, 320)
        .build();
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg)
    ))
}
