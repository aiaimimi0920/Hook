use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::net::IpAddr;
use std::path::PathBuf;
use std::time::Duration;
use uuid::Uuid;

const LOOM_APP_ID: &str = "loom";
const HOOK_CALLER: &str = "hook";
const BRAIN_PLAN: &str = "brain.plan";
const DEFAULT_LOOM_INVOKE_TIMEOUT_MS: u64 = 120_000;
const MAX_INVOKE_ERROR_BODY_CHARS: usize = 1_024;

#[derive(Debug, thiserror::Error)]
pub enum LoomConnectorError {
    #[error("Loom manifest parse failed: {0}")]
    ManifestParse(String),
    #[error("Loom manifest invalid: {0}")]
    InvalidManifest(String),
    #[error("Loom manifest not found; set LOOM_MANIFEST_PATH or start Loom")]
    ManifestNotFound,
    #[error("Loom manifest read failed: {0}")]
    ManifestRead(String),
    #[error("Loom invoke response parse failed: {0}")]
    InvokeResponseParse(String),
    #[error("Loom invoke failed: {0}")]
    InvokeHttp(#[from] reqwest::Error),
    #[error("Loom invoke timed out after {0} ms")]
    InvokeTimeout(u64),
    #[error("Loom invoke returned HTTP {status}: {body}")]
    InvokeStatus { status: u16, body: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomManifest {
    pub schema_version: u32,
    pub app_id: String,
    pub display_name: String,
    pub version: String,
    pub pid: Option<u32>,
    pub transport: LoomManifestTransport,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub started_at: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomManifestTransport {
    #[serde(rename = "type")]
    pub transport_type: String,
    pub base_url: String,
    pub auth: Option<String>,
    pub auth_token: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomBrainPlanRequest {
    pub request_id: Option<String>,
    pub goal: String,
    #[serde(default)]
    pub constraints: Vec<String>,
    pub context: Option<serde_json::Value>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomInvokeEnvelope {
    pub request_id: String,
    pub caller: String,
    pub capability: String,
    pub input: LoomBrainPlanInput,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomBrainPlanInput {
    pub goal: String,
    pub constraints: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomBrainPlanResult {
    pub request_id: String,
    pub status: String,
    pub run_id: Option<String>,
    pub summary: Option<String>,
    #[serde(default)]
    pub steps: Vec<String>,
    pub run: Option<serde_json::Value>,
    pub error: Option<LoomInvokeErrorPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomInvokeResponseEnvelope {
    pub request_id: String,
    pub status: String,
    pub output: Option<LoomInvokeOutput>,
    pub error: Option<LoomInvokeErrorPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomInvokeOutput {
    pub run_id: Option<String>,
    pub summary: Option<String>,
    #[serde(default)]
    pub steps: Vec<String>,
    pub run: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomInvokeErrorPayload {
    pub code: String,
    pub message: String,
}

pub fn validate_loom_manifest(raw: &str) -> Result<LoomManifest, LoomConnectorError> {
    let manifest: LoomManifest = serde_json::from_str(raw)
        .map_err(|error| LoomConnectorError::ManifestParse(error.to_string()))?;
    validate_loom_manifest_value(manifest)
}

pub fn validate_loom_manifest_value(
    manifest: LoomManifest,
) -> Result<LoomManifest, LoomConnectorError> {
    if manifest.schema_version != 1 {
        return Err(LoomConnectorError::InvalidManifest(format!(
            "schemaVersion must be 1, got {}",
            manifest.schema_version
        )));
    }

    if manifest.app_id != LOOM_APP_ID {
        return Err(LoomConnectorError::InvalidManifest(format!(
            "appId must be {LOOM_APP_ID}, got {}",
            manifest.app_id
        )));
    }

    if manifest.display_name.trim().is_empty() {
        return Err(LoomConnectorError::InvalidManifest(
            "displayName must be non-empty".to_string(),
        ));
    }

    if manifest.version.trim().is_empty() {
        return Err(LoomConnectorError::InvalidManifest(
            "version must be non-empty".to_string(),
        ));
    }

    if manifest.pid.is_none() {
        return Err(LoomConnectorError::InvalidManifest(
            "pid is required".to_string(),
        ));
    }

    if manifest.started_at.is_none() {
        return Err(LoomConnectorError::InvalidManifest(
            "startedAt is required".to_string(),
        ));
    }

    if !manifest
        .transport
        .transport_type
        .eq_ignore_ascii_case("http")
    {
        return Err(LoomConnectorError::InvalidManifest(format!(
            "transport.type must be http, got {}",
            manifest.transport.transport_type
        )));
    }

    if !is_loopback_base_url(&manifest.transport.base_url) {
        return Err(LoomConnectorError::InvalidManifest(format!(
            "transport.baseUrl must be an origin-only http loopback URL, got {}",
            manifest.transport.base_url
        )));
    }

    let auth_mode = manifest.transport.auth.as_deref().unwrap_or("none");
    if !auth_mode.eq_ignore_ascii_case("none") && !auth_mode.eq_ignore_ascii_case("bearer") {
        return Err(LoomConnectorError::InvalidManifest(format!(
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
        return Err(LoomConnectorError::InvalidManifest(
            "transport.authToken is required when transport.auth is bearer".to_string(),
        ));
    }

    let mut capability_names = HashSet::new();
    for capability in &manifest.capabilities {
        if capability.trim().is_empty() {
            return Err(LoomConnectorError::InvalidManifest(
                "capabilities must contain only non-empty strings".to_string(),
            ));
        }
        if !capability_names.insert(capability.as_str()) {
            return Err(LoomConnectorError::InvalidManifest(format!(
                "capabilities must be unique, duplicate {capability}"
            )));
        }
    }

    if !capability_names.contains(BRAIN_PLAN) {
        return Err(LoomConnectorError::InvalidManifest(format!(
            "capabilities must include {BRAIN_PLAN}"
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

pub fn build_brain_plan_envelope(request: LoomBrainPlanRequest) -> LoomInvokeEnvelope {
    LoomInvokeEnvelope {
        request_id: request
            .request_id
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        caller: HOOK_CALLER.to_string(),
        capability: BRAIN_PLAN.to_string(),
        input: LoomBrainPlanInput {
            goal: request.goal,
            constraints: request.constraints,
            context: request.context,
        },
    }
}

pub async fn invoke_brain_plan(
    request: LoomBrainPlanRequest,
) -> Result<LoomBrainPlanResult, LoomConnectorError> {
    let manifest = read_default_loom_manifest()?;
    invoke_brain_plan_with_manifest(manifest, request).await
}

pub async fn invoke_brain_plan_with_manifest(
    manifest: LoomManifest,
    request: LoomBrainPlanRequest,
) -> Result<LoomBrainPlanResult, LoomConnectorError> {
    let manifest = validate_loom_manifest_value(manifest)?;
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_LOOM_INVOKE_TIMEOUT_MS)
        .max(1);
    let envelope = build_brain_plan_envelope(request);
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
            LoomConnectorError::InvokeTimeout(timeout_ms)
        } else {
            LoomConnectorError::InvokeHttp(error)
        }
    })?;
    let status = response.status();
    let body = response.text().await.map_err(|error| {
        if error.is_timeout() {
            LoomConnectorError::InvokeTimeout(timeout_ms)
        } else {
            LoomConnectorError::InvokeHttp(error)
        }
    })?;
    let parsed_envelope = parse_invoke_response_envelope(&body);
    if !status.is_success() {
        if let Ok(envelope) = parsed_envelope {
            if envelope.status == "failed" {
                return Ok(result_from_invoke_response(envelope));
            }
        }
        return Err(LoomConnectorError::InvokeStatus {
            status: status.as_u16(),
            body: sanitize_invoke_response_body(&body),
        });
    }

    let envelope = parsed_envelope?;
    Ok(result_from_invoke_response(envelope))
}

fn parse_invoke_response_envelope(
    body: &str,
) -> Result<LoomInvokeResponseEnvelope, LoomConnectorError> {
    serde_json::from_str(body).map_err(|error| {
        LoomConnectorError::InvokeResponseParse(format!(
            "{error}; body={}",
            sanitize_invoke_response_body(body)
        ))
    })
}

fn result_from_invoke_response(envelope: LoomInvokeResponseEnvelope) -> LoomBrainPlanResult {
    LoomBrainPlanResult {
        request_id: envelope.request_id,
        status: envelope.status,
        run_id: envelope
            .output
            .as_ref()
            .and_then(|output| output.run_id.clone()),
        summary: envelope
            .output
            .as_ref()
            .and_then(|output| output.summary.clone()),
        steps: envelope
            .output
            .as_ref()
            .map(|output| output.steps.clone())
            .unwrap_or_default(),
        run: envelope
            .output
            .as_ref()
            .and_then(|output| output.run.clone()),
        error: envelope.error,
    }
}

fn sanitize_invoke_response_body(body: &str) -> String {
    let mut sanitized = if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(body) {
        sanitize_json_value(&mut value);
        serde_json::to_string(&value).unwrap_or_else(|_| "[redacted]".to_string())
    } else {
        sanitize_sensitive_text(body)
    };

    if sanitized.chars().count() > MAX_INVOKE_ERROR_BODY_CHARS {
        sanitized = sanitized
            .chars()
            .take(MAX_INVOKE_ERROR_BODY_CHARS)
            .collect::<String>();
        sanitized.push_str("...[truncated]");
    }
    sanitized
}

fn sanitize_json_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                if is_sensitive_json_key(key) {
                    *child = serde_json::Value::String("[redacted]".to_string());
                } else {
                    sanitize_json_value(child);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                sanitize_json_value(item);
            }
        }
        serde_json::Value::String(text) => {
            *text = sanitize_sensitive_text(text);
        }
        _ => {}
    }
}

fn is_sensitive_json_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    lower == "authorization"
        || lower.contains("token")
        || lower.contains("secret")
        || lower.contains("password")
}

fn sanitize_sensitive_text(text: &str) -> String {
    text.lines()
        .map(|line| {
            let lower = line.to_ascii_lowercase();
            if lower.contains("authorization") {
                "[redacted]".to_string()
            } else {
                redact_bearer_tokens(line)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn redact_bearer_tokens(text: &str) -> String {
    let mut output = String::new();
    let mut remaining = text;
    while let Some(index) = ascii_case_insensitive_find(remaining, "bearer ") {
        output.push_str(&remaining[..index]);
        output.push_str("Bearer [redacted]");
        let token_start = index + "bearer ".len();
        let token_len = remaining[token_start..]
            .find(|character: char| {
                character.is_whitespace()
                    || matches!(character, '"' | '\'' | ',' | ';' | ')' | ']' | '}')
            })
            .unwrap_or_else(|| remaining[token_start..].len());
        remaining = &remaining[(token_start + token_len)..];
    }
    output.push_str(remaining);
    output
}

fn ascii_case_insensitive_find(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
}

fn read_default_loom_manifest() -> Result<LoomManifest, LoomConnectorError> {
    let path = default_loom_manifest_paths()
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or(LoomConnectorError::ManifestNotFound)?;
    let raw = std::fs::read_to_string(&path).map_err(|error| {
        LoomConnectorError::ManifestRead(format!("{}: {}", path.display(), error))
    })?;
    validate_loom_manifest(&raw)
}

fn default_loom_manifest_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(path) = std::env::var_os("LOOM_MANIFEST_PATH")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        paths.push(path);
    }

    for key in [
        "LOOM_MANIFEST_DIR",
        "LOOM_CAPABILITY_MANIFEST_DIR",
        "NEURO_CAPABILITIES_DIR",
    ] {
        if let Some(dir) = std::env::var_os(key)
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())
        {
            paths.push(dir.join("loom.json"));
        }
    }

    if let Some(appdata) = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        paths.push(appdata.join("Neuro").join("capabilities").join("loom.json"));
    }

    paths.push(
        PathBuf::from(".runtime")
            .join("neuro")
            .join("capabilities")
            .join("loom.json"),
    );

    paths
}
