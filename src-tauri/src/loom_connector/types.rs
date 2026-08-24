//! Public Loom connector DTOs, protocol constants, and errors.

use serde::{Deserialize, Serialize};

pub(super) const LOOM_APP_ID: &str = "loom";
pub(super) const HOOK_CALLER: &str = "hook";
pub(super) const BRAIN_PLAN: &str = "brain.plan";
pub(super) const DEFAULT_LOOM_INVOKE_TIMEOUT_MS: u64 = 120_000;
pub(super) const MAX_LOOM_INVOKE_TIMEOUT_MS: u64 = 10 * 60 * 1_000;
pub(super) const MAX_INVOKE_RESPONSE_BODY_BYTES: usize = 1024 * 1024;
pub(super) const MAX_INVOKE_ERROR_BODY_CHARS: usize = 1_024;
pub(super) const MAX_LOOM_MANIFEST_BYTES: usize = 1024 * 1024;

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
    #[error("Loom invoke response exceeded the {0}-byte limit")]
    InvokeResponseTooLarge(usize),
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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoomManifestTransport {
    #[serde(rename = "type")]
    pub transport_type: String,
    pub base_url: String,
    pub auth: Option<String>,
    pub auth_token: Option<String>,
}

impl std::fmt::Debug for LoomManifestTransport {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LoomManifestTransport")
            .field("transport_type", &self.transport_type)
            .field("base_url", &self.base_url)
            .field("auth", &self.auth)
            .field(
                "auth_token",
                &self.auth_token.as_ref().map(|_| "[redacted]"),
            )
            .finish()
    }
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoomBaseUrlKind {
    LoopbackHttp,
    LoopbackHttps,
    RemoteHttps,
}

#[cfg(test)]
mod tests {
    use super::LoomManifestTransport;

    #[test]
    fn manifest_transport_debug_redacts_bearer_token() {
        let transport = LoomManifestTransport {
            transport_type: "http".to_string(),
            base_url: "http://127.0.0.1:8765".to_string(),
            auth: Some("bearer".to_string()),
            auth_token: Some("secret-token".to_string()),
        };

        let debug = format!("{transport:?}");
        assert!(!debug.contains("secret-token"), "debug={debug}");
        assert!(debug.contains("[redacted]"), "debug={debug}");
    }
}
