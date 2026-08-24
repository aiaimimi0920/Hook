//! Redacts untrusted Loom response bodies before they enter displayed errors.

use super::types::MAX_INVOKE_ERROR_BODY_CHARS;

pub(super) fn sanitize_invoke_response_body(body: &str) -> String {
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
