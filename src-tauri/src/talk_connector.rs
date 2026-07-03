use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::net::IpAddr;
use std::path::PathBuf;
use std::time::Duration;
use uuid::Uuid;

const TALK_APP_ID: &str = "talk";
const HOOK_CALLER: &str = "hook";
const VOICE_CAPTURE_ONCE: &str = "voice.capture.once";
const DEFAULT_TALK_INVOKE_TIMEOUT_MS: u64 = 120_000;

#[derive(Debug, thiserror::Error)]
pub enum TalkConnectorError {
    #[error("Talk manifest parse failed: {0}")]
    ManifestParse(String),
    #[error("Talk manifest invalid: {0}")]
    InvalidManifest(String),
    #[error("Talk manifest not found; set TALK_MANIFEST_PATH or start Talk")]
    ManifestNotFound,
    #[error("Talk manifest read failed: {0}")]
    ManifestRead(String),
    #[error("Talk invoke failed: {0}")]
    InvokeHttp(#[from] reqwest::Error),
    #[error("Talk invoke timed out after {0} ms")]
    InvokeTimeout(u64),
    #[error("Talk invoke returned HTTP {status}: {body}")]
    InvokeStatus { status: u16, body: String },
    #[error("Talk invoke response parse failed: {0}")]
    InvokeResponseParse(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkManifest {
    pub schema_version: u32,
    pub app_id: String,
    pub display_name: String,
    pub version: String,
    pub pid: Option<u32>,
    pub transport: TalkManifestTransport,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub started_at: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkManifestTransport {
    #[serde(rename = "type")]
    pub transport_type: String,
    pub base_url: String,
    pub auth: Option<String>,
    pub auth_token: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkVoiceCaptureRequest {
    pub request_id: Option<String>,
    pub mode: Option<String>,
    pub context: Option<serde_json::Value>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkInvokeEnvelope {
    pub request_id: String,
    pub caller: String,
    pub capability: String,
    pub input: TalkVoiceCaptureInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkVoiceCaptureInput {
    pub mode: String,
    pub context: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkVoiceCaptureResult {
    pub request_id: String,
    pub status: String,
    pub text: Option<String>,
    pub transcript: Option<String>,
    pub session_id: Option<String>,
    pub evidence_path: Option<String>,
    pub trigger_events: Vec<String>,
    pub error: Option<TalkInvokeErrorPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkInvokeResponseEnvelope {
    pub request_id: String,
    pub status: String,
    pub output: Option<TalkInvokeOutput>,
    pub error: Option<TalkInvokeErrorPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkInvokeOutput {
    pub text: Option<String>,
    pub transcript: Option<String>,
    pub session_id: Option<String>,
    pub evidence_path: Option<String>,
    #[serde(default)]
    pub trigger_events: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TalkInvokeErrorPayload {
    pub code: String,
    pub message: String,
}

pub fn validate_talk_manifest(raw: &str) -> Result<TalkManifest, TalkConnectorError> {
    let manifest: TalkManifest = serde_json::from_str(raw)
        .map_err(|error| TalkConnectorError::ManifestParse(error.to_string()))?;
    validate_talk_manifest_value(manifest)
}

pub fn validate_talk_manifest_value(
    manifest: TalkManifest,
) -> Result<TalkManifest, TalkConnectorError> {
    if manifest.schema_version != 1 {
        return Err(TalkConnectorError::InvalidManifest(format!(
            "schemaVersion must be 1, got {}",
            manifest.schema_version
        )));
    }

    if manifest.app_id != TALK_APP_ID {
        return Err(TalkConnectorError::InvalidManifest(format!(
            "appId must be {TALK_APP_ID}, got {}",
            manifest.app_id
        )));
    }

    if manifest.display_name.trim().is_empty() {
        return Err(TalkConnectorError::InvalidManifest(
            "displayName must not be empty".to_string(),
        ));
    }

    if manifest.version.trim().is_empty() {
        return Err(TalkConnectorError::InvalidManifest(
            "version must not be empty".to_string(),
        ));
    }

    if manifest.pid.is_none() {
        return Err(TalkConnectorError::InvalidManifest(
            "pid is required".to_string(),
        ));
    }

    if manifest.started_at.is_none() {
        return Err(TalkConnectorError::InvalidManifest(
            "startedAt is required".to_string(),
        ));
    }

    if !manifest
        .transport
        .transport_type
        .eq_ignore_ascii_case("http")
    {
        return Err(TalkConnectorError::InvalidManifest(format!(
            "transport.type must be http, got {}",
            manifest.transport.transport_type
        )));
    }

    if !is_loopback_base_url(&manifest.transport.base_url) {
        return Err(TalkConnectorError::InvalidManifest(format!(
            "transport.baseUrl must be an origin-only http loopback URL, got {}",
            manifest.transport.base_url
        )));
    }

    let auth_mode = manifest.transport.auth.as_deref().unwrap_or("none");
    if !auth_mode.eq_ignore_ascii_case("none") && !auth_mode.eq_ignore_ascii_case("bearer") {
        return Err(TalkConnectorError::InvalidManifest(format!(
            "transport.auth must be none or bearer when present, got {:?}",
            manifest.transport.auth
        )));
    }

    if auth_mode.eq_ignore_ascii_case("bearer")
        && manifest
            .transport
            .auth_token
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .is_empty()
    {
        return Err(TalkConnectorError::InvalidManifest(
            "transport.authToken is required when transport.auth is bearer".to_string(),
        ));
    }

    let mut seen_capabilities = HashSet::new();
    for capability in &manifest.capabilities {
        let capability = capability.trim();
        if capability.is_empty() {
            return Err(TalkConnectorError::InvalidManifest(
                "capabilities must not contain empty values".to_string(),
            ));
        }
        if !seen_capabilities.insert(capability.to_string()) {
            return Err(TalkConnectorError::InvalidManifest(format!(
                "capabilities must not contain duplicate value {capability}"
            )));
        }
    }

    if !manifest
        .capabilities
        .iter()
        .any(|capability| capability == VOICE_CAPTURE_ONCE)
    {
        return Err(TalkConnectorError::InvalidManifest(format!(
            "capabilities must include {VOICE_CAPTURE_ONCE}"
        )));
    }

    Ok(manifest)
}

pub fn is_loopback_base_url(base_url: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(base_url) else {
        return false;
    };
    if url.scheme() != "http" {
        return false;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return false;
    }

    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    host.parse::<IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

fn sanitize_error_body(body: &str) -> String {
    const MAX_ERROR_BODY_CHARS: usize = 2_048;

    let redacted = match serde_json::from_str::<Value>(body) {
        Ok(mut value) => {
            redact_json_value(&mut value);
            serde_json::to_string(&value).unwrap_or_else(|_| body.to_string())
        }
        Err(_) => body.to_string(),
    };
    let redacted = redact_bearer_tokens(&redacted);

    if redacted.chars().count() <= MAX_ERROR_BODY_CHARS {
        return redacted;
    }

    let mut truncated = redacted
        .chars()
        .take(MAX_ERROR_BODY_CHARS)
        .collect::<String>();
    truncated.push_str("...[truncated]");
    truncated
}

fn redact_json_value(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, child) in map.iter_mut() {
                if is_sensitive_key(key) {
                    *child = Value::String("[redacted]".to_string());
                } else {
                    redact_json_value(child);
                }
            }
        }
        Value::Array(items) => {
            for item in items {
                redact_json_value(item);
            }
        }
        _ => {}
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    ["authorization", "token", "secret", "password", "credential"]
        .iter()
        .any(|needle| key.contains(needle))
}

fn redact_bearer_tokens(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut rest = input;

    loop {
        let lower = rest.to_ascii_lowercase();
        let Some(index) = lower.find("bearer ") else {
            output.push_str(rest);
            break;
        };

        output.push_str(&rest[..index]);
        output.push_str("Bearer [redacted]");

        let after_prefix = &rest[index + "bearer ".len()..];
        let token_len = after_prefix
            .find(|character: char| {
                character.is_whitespace()
                    || matches!(character, '"' | '\'' | ',' | '}' | ']' | '\\')
            })
            .unwrap_or(after_prefix.len());
        rest = &after_prefix[token_len..];
    }

    output
}

pub fn build_voice_capture_once_envelope(request: TalkVoiceCaptureRequest) -> TalkInvokeEnvelope {
    TalkInvokeEnvelope {
        request_id: request
            .request_id
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        caller: HOOK_CALLER.to_string(),
        capability: VOICE_CAPTURE_ONCE.to_string(),
        input: TalkVoiceCaptureInput {
            mode: request.mode.unwrap_or_else(|| "dictation".to_string()),
            context: request.context.unwrap_or_else(|| {
                json!({
                    "source": "hook-panel"
                })
            }),
        },
    }
}

pub async fn capture_voice_once(
    request: TalkVoiceCaptureRequest,
) -> Result<TalkVoiceCaptureResult, TalkConnectorError> {
    let manifest = read_default_talk_manifest()?;
    capture_voice_once_with_manifest(manifest, request).await
}

pub async fn capture_voice_once_with_manifest(
    manifest: TalkManifest,
    request: TalkVoiceCaptureRequest,
) -> Result<TalkVoiceCaptureResult, TalkConnectorError> {
    let manifest = validate_talk_manifest_value(manifest)?;
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_TALK_INVOKE_TIMEOUT_MS)
        .max(1);
    let envelope = build_voice_capture_once_envelope(request);
    let endpoint = format!(
        "{}/v1/invoke",
        manifest.transport.base_url.trim_end_matches('/')
    );

    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(timeout_ms))
        .build()?
        .post(endpoint)
        .json(&envelope);
    if manifest
        .transport
        .auth
        .as_deref()
        .unwrap_or("none")
        .eq_ignore_ascii_case("bearer")
    {
        if let Some(token) = manifest
            .transport
            .auth_token
            .as_deref()
            .map(str::trim)
            .filter(|token| !token.is_empty())
        {
            builder = builder.bearer_auth(token);
        }
    }

    let response = builder.send().await.map_err(|error| {
        if error.is_timeout() {
            TalkConnectorError::InvokeTimeout(timeout_ms)
        } else {
            TalkConnectorError::InvokeHttp(error)
        }
    })?;
    let status = response.status();
    let body = response.text().await.map_err(|error| {
        if error.is_timeout() {
            TalkConnectorError::InvokeTimeout(timeout_ms)
        } else {
            TalkConnectorError::InvokeHttp(error)
        }
    })?;
    if !status.is_success() {
        return Err(TalkConnectorError::InvokeStatus {
            status: status.as_u16(),
            body: sanitize_error_body(&body),
        });
    }

    let envelope: TalkInvokeResponseEnvelope = serde_json::from_str(&body)
        .map_err(|error| TalkConnectorError::InvokeResponseParse(error.to_string()))?;
    Ok(TalkVoiceCaptureResult {
        request_id: envelope.request_id,
        status: envelope.status,
        text: envelope
            .output
            .as_ref()
            .and_then(|output| output.text.clone()),
        transcript: envelope
            .output
            .as_ref()
            .and_then(|output| output.transcript.clone()),
        session_id: envelope
            .output
            .as_ref()
            .and_then(|output| output.session_id.clone()),
        evidence_path: envelope
            .output
            .as_ref()
            .and_then(|output| output.evidence_path.clone()),
        trigger_events: envelope
            .output
            .as_ref()
            .map(|output| output.trigger_events.clone())
            .unwrap_or_default(),
        error: envelope.error,
    })
}

fn read_default_talk_manifest() -> Result<TalkManifest, TalkConnectorError> {
    let path = default_talk_manifest_paths()
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or(TalkConnectorError::ManifestNotFound)?;
    let raw = std::fs::read_to_string(&path).map_err(|error| {
        TalkConnectorError::ManifestRead(format!("{}: {}", path.display(), error))
    })?;
    validate_talk_manifest(&raw)
}

fn default_talk_manifest_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(path) = std::env::var_os("TALK_MANIFEST_PATH")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        paths.push(path);
    }

    for key in ["TALK_MANIFEST_DIR", "NEURO_CAPABILITIES_DIR"] {
        if let Some(dir) = std::env::var_os(key)
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())
        {
            paths.push(dir.join("talk.json"));
        }
    }

    if let Some(appdata) = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        paths.push(appdata.join("Neuro").join("capabilities").join("talk.json"));
    }

    paths.push(
        PathBuf::from(".runtime")
            .join("neuro")
            .join("capabilities")
            .join("talk.json"),
    );

    paths
}
