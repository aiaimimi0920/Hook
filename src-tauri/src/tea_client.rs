use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HookIntakeRequest {
    pub source: String,
    pub text: String,
    pub context: HookContext,
    #[serde(default)]
    pub attachments: Vec<HookAttachment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HookContext {
    pub active_window: Option<String>,
    pub selection_text: Option<String>,
    pub ocr_text: Option<String>,
    pub screenshot_ref: Option<String>,
    pub cwd: Option<String>,
    pub app: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HookAttachment {
    pub kind: String,
    pub reference: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeaIntakeConfig {
    pub base_url: String,
    pub auth_token: String,
    pub source: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeaTicketSummary {
    pub id: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub approval_policy: Option<String>,
    #[serde(default)]
    pub labels: Vec<String>,
}

#[derive(Debug, Error)]
pub enum TeaIntakeError {
    #[error("Tea intake is disabled by HOOK_TEA_INTAKE_ENABLED")]
    Disabled,
    #[error("Tea intake is not configured; set HOOK_TEA_BASE_URL and HOOK_TEA_AUTH_TOKEN")]
    MissingConfig,
    #[error("invalid Tea intake URL: {0}")]
    InvalidUrl(String),
    #[error("Tea intake request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("Tea intake returned HTTP {status}: {body}")]
    HttpStatus { status: u16, body: String },
}

#[derive(Debug, Clone)]
pub struct TeaIntakeClient {
    config: TeaIntakeConfig,
    http: reqwest::Client,
}

impl TeaIntakeConfig {
    pub fn from_env() -> Result<Self, TeaIntakeError> {
        if env_bool("HOOK_TEA_INTAKE_ENABLED", true) == Some(false) {
            return Err(TeaIntakeError::Disabled);
        }

        let Some(base_url) = env_first_non_empty(&["HOOK_TEA_BASE_URL", "TEA_SERVER_URL"]) else {
            return Err(TeaIntakeError::MissingConfig);
        };
        let Some(auth_token) = env_first_non_empty(&["HOOK_TEA_AUTH_TOKEN", "TEA_AUTH_TOKEN"])
        else {
            return Err(TeaIntakeError::MissingConfig);
        };

        Ok(Self {
            base_url,
            auth_token,
            source: env_first_non_empty(&["HOOK_TEA_SOURCE"])
                .unwrap_or_else(|| "hook-desktop".to_string()),
            enabled: true,
        })
    }
}

impl TeaIntakeClient {
    pub fn new(config: TeaIntakeConfig) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .build()
            .expect("reqwest client builder with timeout should not fail");
        Self { config, http }
    }

    pub async fn create_ticket(
        &self,
        request: HookIntakeRequest,
    ) -> Result<TeaTicketSummary, TeaIntakeError> {
        if !self.config.enabled {
            return Err(TeaIntakeError::Disabled);
        }

        let response = self
            .http
            .post(self.intake_url()?)
            .bearer_auth(&self.config.auth_token)
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let raw_body = response.text().await.unwrap_or_default();
            return Err(TeaIntakeError::HttpStatus {
                status: status.as_u16(),
                // Redact secrets before the untrusted body reaches error text / logs.
                body: redact_sensitive_body(&raw_body, &self.config.auth_token),
            });
        }

        Ok(response.json::<TeaTicketSummary>().await?)
    }

    fn intake_url(&self) -> Result<reqwest::Url, TeaIntakeError> {
        let base = self.config.base_url.trim_end_matches('/');
        let url = format!("{base}/v1/intake/hook");
        reqwest::Url::parse(&url).map_err(|_| TeaIntakeError::InvalidUrl(url))
    }
}

#[tauri::command]
pub async fn create_tea_ticket(mut request: HookIntakeRequest) -> Result<TeaTicketSummary, String> {
    let config = TeaIntakeConfig::from_env().map_err(|error| error.to_string())?;
    apply_default_request_context(&mut request, &config);
    let client = TeaIntakeClient::new(config);
    let ticket = client
        .create_ticket(request)
        .await
        .map_err(|error| error.to_string())?;
    crate::append_runtime_log_line(&format!("tea_ticket_created :: id={}", ticket.id));
    Ok(ticket)
}

fn apply_default_request_context(request: &mut HookIntakeRequest, config: &TeaIntakeConfig) {
    if request.source.trim().is_empty() {
        request.source = config.source.clone();
    }
    if request
        .context
        .app
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        request.context.app = Some("hook".to_string());
    }
    if request.context.cwd.is_none() {
        request.context.cwd = std::env::current_dir()
            .ok()
            .map(|path| path.to_string_lossy().to_string());
    }
}

fn env_first_non_empty(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        std::env::var(key)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn env_bool(key: &str, default: bool) -> Option<bool> {
    let value = std::env::var(key).ok()?;
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Some(default);
    }
    Some(matches!(
        normalized.as_str(),
        "1" | "true" | "yes" | "on" | "enabled"
    ))
}

/// Redacts secrets from an untrusted server response body before it is surfaced
/// in an error message or written to a log. Strips `Bearer <token>` sequences
/// and, defensively, the client's own auth token if the server echoed it back.
/// Kept local so the Tea client stays self-contained (the loom/talk connectors
/// carry their own, intentionally distinct, redaction).
fn redact_sensitive_body(body: &str, auth_token: &str) -> String {
    let redacted = redact_bearer_tokens(body);
    if auth_token.is_empty() {
        redacted
    } else {
        redacted.replace(auth_token, "[redacted]")
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bearer_tokens_case_insensitively() {
        assert_eq!(
            redact_sensitive_body("auth failed: Bearer abc123.def", ""),
            "auth failed: Bearer [redacted]"
        );
        assert_eq!(
            redact_sensitive_body("x bearer TOKEN\"y", ""),
            "x Bearer [redacted]\"y"
        );
    }

    #[test]
    fn redacts_the_clients_own_auth_token_when_echoed_back() {
        let body = "{\"error\":\"invalid\",\"echo\":\"secret-token-xyz\"}";
        let out = redact_sensitive_body(body, "secret-token-xyz");
        assert!(!out.contains("secret-token-xyz"));
        assert!(out.contains("[redacted]"));
    }

    #[test]
    fn leaves_non_sensitive_bodies_unchanged() {
        let body = "{\"error\":\"not found\"}";
        assert_eq!(redact_sensitive_body(body, "some-token"), body);
    }

    #[test]
    fn empty_auth_token_only_redacts_bearer() {
        assert_eq!(redact_sensitive_body("plain text", ""), "plain text");
    }
}
