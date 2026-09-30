// Bounded, dependency-light redaction before runtime diagnostics reach disk or stderr.
const RUNTIME_LOG_MESSAGE_LIMIT: usize = 512;
const RUNTIME_LOG_SCAN_LIMIT: usize = 2048;
const REDACTED_LOG_VALUE: &str = "[REDACTED]";

fn sanitize_runtime_log_message(message: &str) -> String {
    let bounded = message
        .chars()
        .take(RUNTIME_LOG_SCAN_LIMIT)
        .collect::<String>();
    let mut redacted_words = Vec::new();
    let mut redact_following = 0_u8;
    for word in bounded.split_whitespace() {
        if redact_following > 0 {
            redacted_words.push(REDACTED_LOG_VALUE.to_owned());
            redact_following -= 1;
            continue;
        }
        let normalized = word
            .trim_matches(|character: char| {
                matches!(
                    character,
                    '"' | '\'' | '(' | ')' | '[' | ']' | '{' | '}' | ','
                )
            })
            .to_ascii_lowercase();
        if let Some((replacement, following)) = authorization_redaction(&normalized) {
            redacted_words.push(replacement.to_owned());
            redact_following = following;
            continue;
        }
        if is_sensitive_assignment(&normalized) {
            redacted_words.push(REDACTED_LOG_VALUE.to_owned());
            continue;
        }
        if normalized.contains("://")
            || normalized.starts_with("//")
            || normalized.starts_with("mailto:")
        {
            redacted_words.push(sanitize_runtime_log_url(word));
            continue;
        }
        if looks_like_compact_token(&normalized) {
            redacted_words.push(REDACTED_LOG_VALUE.to_owned());
            continue;
        }
        redacted_words.push(
            word.chars()
                .map(|character| {
                    if character.is_control() {
                        ' '
                    } else {
                        character
                    }
                })
                .collect(),
        );
    }
    truncate_runtime_log_message(redacted_words.join(" "))
}

fn authorization_redaction(value: &str) -> Option<(&'static str, u8)> {
    for prefix in ["authorization:", "authorization="] {
        if let Some(rest) = value.strip_prefix(prefix) {
            let following = if rest.is_empty() {
                2
            } else if matches!(rest.trim_end_matches([':', '=']), "bearer" | "basic") {
                1
            } else {
                0
            };
            return Some(("authorization:[REDACTED]", following));
        }
    }
    if value == "bearer" {
        return Some(("Bearer", 1));
    }
    if let Some(rest) = value
        .strip_prefix("bearer:")
        .or_else(|| value.strip_prefix("bearer="))
    {
        return Some(("Bearer:[REDACTED]", u8::from(rest.is_empty())));
    }
    None
}

fn is_sensitive_assignment(value: &str) -> bool {
    const NAMES: [&str; 9] = [
        "authorization",
        "auth_token",
        "authtoken",
        "token",
        "password",
        "passwd",
        "secret",
        "api_key",
        "apikey",
    ];
    NAMES.iter().any(|name| {
        value.find(name).is_some_and(|index| {
            value[index + name.len()..]
                .chars()
                .next()
                .is_some_and(|separator| matches!(separator, ':' | '='))
        })
    })
}

fn looks_like_compact_token(value: &str) -> bool {
    let token_alphabet = value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    let jwt_shaped = value.split('.').count() == 3;
    let opaque_alphanumeric = value.bytes().all(|byte| byte.is_ascii_alphanumeric())
        && value.bytes().any(|byte| byte.is_ascii_alphabetic())
        && value.bytes().any(|byte| byte.is_ascii_digit());
    value.len() >= 40 && token_alphabet && (jwt_shaped || opaque_alphanumeric)
}

fn sanitize_runtime_log_url(value: &str) -> String {
    let Ok(mut url) = reqwest::Url::parse(value) else {
        return if value.contains('?') || value.contains('@') || value.contains('#') {
            "[REDACTED_URL]".to_owned()
        } else {
            value.to_owned()
        };
    };
    let carried_credentials = !url.username().is_empty() || url.password().is_some();
    let carried_query = url.query().is_some() || url.fragment().is_some();
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.set_query(None);
    url.set_fragment(None);
    let mut sanitized = url.to_string();
    if carried_credentials || carried_query {
        sanitized.push_str("[REDACTED]");
    }
    sanitized
}

fn truncate_runtime_log_message(message: String) -> String {
    let mut characters = message.chars();
    let mut bounded = characters
        .by_ref()
        .take(RUNTIME_LOG_MESSAGE_LIMIT)
        .collect::<String>();
    if characters.next().is_some() {
        bounded.push_str("...[truncated]");
    }
    bounded
}

#[cfg(test)]
mod runtime_log_sanitize_tests {
    use super::*;

    #[test]
    fn runtime_logs_redact_credentials_queries_and_compact_tokens() {
        let jwt = format!("{}.{}.{}", "a".repeat(20), "b".repeat(20), "c".repeat(20));
        let message = format!(
            "Authorization: Bearer secret-value token=abc https://user:pass@example.test/path?q=secret {jwt}"
        );
        let sanitized = sanitize_runtime_log_message(&message);
        for secret in [
            "secret-value",
            "token=abc",
            "user",
            "pass",
            "q=secret",
            jwt.as_str(),
        ] {
            assert!(!sanitized.contains(secret), "secret survived: {sanitized}");
        }
        assert!(sanitized.contains(REDACTED_LOG_VALUE));
        assert!(sanitized.contains("https://example.test/path"));
    }

    #[test]
    fn runtime_logs_redact_compact_authorization_and_opaque_credentials() {
        let opaque = format!("api{}", "7".repeat(48));
        for message in [
            "Authorization:Bearer secret-value".to_owned(),
            "Authorization:Bearer:secret-value".to_owned(),
            "Bearer:secret-value".to_owned(),
            format!("credential {opaque}"),
            "//user:pass@example.test/path?token=secret".to_owned(),
        ] {
            let sanitized = sanitize_runtime_log_message(&message);
            for secret in [
                "secret-value",
                "user",
                "pass",
                "token=secret",
                opaque.as_str(),
            ] {
                assert!(!sanitized.contains(secret), "secret survived: {sanitized}");
            }
        }
    }

    #[test]
    fn runtime_logs_are_single_line_and_bounded() {
        let sanitized = sanitize_runtime_log_message(&format!("first\r\n{}", "x".repeat(800)));
        assert!(!sanitized.contains('\n'));
        assert!(!sanitized.contains('\r'));
        assert!(sanitized.chars().count() <= RUNTIME_LOG_MESSAGE_LIMIT + 14);
        assert!(sanitized.ends_with("...[truncated]"));
    }

    #[test]
    fn runtime_logs_preserve_structured_acceptance_markers() {
        let marker = "first-launch-20260905-1234567890abcdef";
        assert!(sanitize_runtime_log_message(marker).contains(marker));
    }
}
