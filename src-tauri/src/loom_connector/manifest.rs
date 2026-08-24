//! Loom manifest parsing, identity checks, and URL trust classification.

use super::types::*;
use std::collections::HashSet;
use std::net::IpAddr;

pub fn validate_loom_manifest(raw: &str) -> Result<LoomManifest, LoomConnectorError> {
    if raw.len() > MAX_LOOM_MANIFEST_BYTES {
        return Err(LoomConnectorError::InvalidManifest(format!(
            "manifest exceeds the {MAX_LOOM_MANIFEST_BYTES}-byte limit"
        )));
    }
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

    let base_url_kind = classify_loom_base_url(&manifest.transport.base_url).map_err(|error| {
        LoomConnectorError::InvalidManifest(format!("transport.baseUrl {error}"))
    })?;
    #[cfg(not(feature = "remote-surface"))]
    if base_url_kind != LoomBaseUrlKind::LoopbackHttp {
        return Err(LoomConnectorError::InvalidManifest(format!(
            "transport.baseUrl must be an origin-only http loopback URL, got {}",
            manifest.transport.base_url
        )));
    }
    #[cfg(feature = "remote-surface")]
    let _ = base_url_kind;

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
    classify_loom_base_url(base_url) == Ok(LoomBaseUrlKind::LoopbackHttp)
}

pub fn classify_loom_base_url(base_url: &str) -> Result<LoomBaseUrlKind, &'static str> {
    let url = reqwest::Url::parse(base_url).map_err(|_| "must be a valid URL origin")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("must use http or https");
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("must not contain userinfo");
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err("must contain only an origin (no path, query, or fragment)");
    }

    let host = url.host_str().ok_or("must contain a host")?;
    let ip_host = host
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host);
    let loopback = host.eq_ignore_ascii_case("localhost")
        || ip_host
            .parse::<IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false);

    match (url.scheme(), loopback) {
        ("http", true) => Ok(LoomBaseUrlKind::LoopbackHttp),
        ("https", true) => Ok(LoomBaseUrlKind::LoopbackHttps),
        ("https", false) => Ok(LoomBaseUrlKind::RemoteHttps),
        _ => Err("must use https unless the host is loopback"),
    }
}

#[cfg(test)]
mod base_url_tests {
    use super::*;

    fn manifest(base_url: &str) -> LoomManifest {
        LoomManifest {
            schema_version: 1,
            app_id: LOOM_APP_ID.to_owned(),
            display_name: "Loom".to_owned(),
            version: "1.0.0".to_owned(),
            pid: Some(1),
            transport: LoomManifestTransport {
                transport_type: "http".to_owned(),
                base_url: base_url.to_owned(),
                auth: Some("none".to_owned()),
                auth_token: None,
            },
            capabilities: vec![BRAIN_PLAN.to_owned()],
            started_at: Some(serde_json::json!(1)),
        }
    }

    #[test]
    fn classifies_only_origin_shaped_loopback_and_https_urls() {
        assert_eq!(
            classify_loom_base_url("http://127.0.0.1:8765"),
            Ok(LoomBaseUrlKind::LoopbackHttp)
        );
        assert_eq!(
            classify_loom_base_url("https://[::1]:8765"),
            Ok(LoomBaseUrlKind::LoopbackHttps)
        );
        assert_eq!(
            classify_loom_base_url("https://loom.example.test"),
            Ok(LoomBaseUrlKind::RemoteHttps)
        );
        assert_eq!(
            classify_loom_base_url("https://127.0.0.1.evil.example/"),
            Ok(LoomBaseUrlKind::RemoteHttps),
            "a lookalike host must be treated as remote, never loopback"
        );

        for hostile in [
            "http://localhost:8080@evil.example/",
            "https://loom.example.test/path",
            "https://loom.example.test/?query=1",
            "https://loom.example.test/#fragment",
            "http://loom.example.test",
            "http://127.0.0.1.evil.example/",
        ] {
            assert!(
                classify_loom_base_url(hostile).is_err(),
                "hostile or non-origin URL was accepted: {hostile}"
            );
        }
    }

    #[cfg(feature = "remote-surface")]
    #[test]
    fn remote_surface_build_accepts_only_strict_https_remote_manifests() {
        validate_loom_manifest_value(manifest("https://loom.example.test"))
            .expect("remote HTTPS origin");
        for rejected in [
            "http://loom.example.test",
            "https://loom.example.test/path",
            "http://localhost:8080@evil.example/",
            "http://127.0.0.1.evil.example/",
        ] {
            assert!(validate_loom_manifest_value(manifest(rejected)).is_err());
        }
    }

    #[cfg(not(feature = "remote-surface"))]
    #[test]
    fn loopback_only_build_rejects_remote_manifests() {
        assert!(validate_loom_manifest_value(manifest("https://loom.example.test")).is_err());
        validate_loom_manifest_value(manifest("http://127.0.0.1:8765"))
            .expect("loopback HTTP origin");
    }

    #[test]
    fn rejects_oversized_manifest_before_json_parsing() {
        let raw = " ".repeat(MAX_LOOM_MANIFEST_BYTES + 1);
        let error = validate_loom_manifest(&raw).expect_err("oversized manifest must fail");
        assert!(error.to_string().contains("byte limit"), "error={error}");
    }
}
