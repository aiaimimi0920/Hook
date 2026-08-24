// Validates Talk manifest identity, metadata, capabilities, and authentication.

#[test]
fn validates_talk_manifest_and_rejects_wrong_app_id_or_non_loopback_transport() {
    let manifest = validate_talk_manifest(&manifest_with("http://127.0.0.1:49210", "talk"))
        .expect("valid loopback Talk manifest");

    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.app_id, "talk");
    assert_eq!(manifest.transport.transport_type, "http");
    assert_eq!(manifest.transport.base_url, "http://127.0.0.1:49210");
    assert!(manifest
        .capabilities
        .iter()
        .any(|capability| capability == "voice.capture.once"));

    let wrong_app_error = validate_talk_manifest(&manifest_with("http://127.0.0.1:49210", "loom"))
        .expect_err("wrong appId is rejected");
    assert!(
        wrong_app_error.to_string().contains("appId"),
        "wrong_app_error={wrong_app_error}"
    );

    let non_loopback_error =
        validate_talk_manifest(&manifest_with("http://192.168.1.10:49210", "talk"))
            .expect_err("LAN baseUrl is rejected");
    assert!(
        non_loopback_error.to_string().contains("loopback"),
        "non_loopback_error={non_loopback_error}"
    );

    for base_url in [
        "http://127.0.0.1:49210/v1",
        "http://127.0.0.1:49210?token=leak",
        "http://127.0.0.1:49210#fragment",
        "http://user:pass@127.0.0.1:49210",
    ] {
        let error = validate_talk_manifest(&manifest_with(base_url, "talk"))
            .expect_err("baseUrl with path, query, fragment, or userinfo is rejected");
        assert!(
            error.to_string().contains("loopback"),
            "base_url={base_url} error={error}"
        );
    }
}

#[test]
fn validates_talk_manifest_auth_modes_before_invoke() {
    let no_auth_manifest = validate_talk_manifest(&manifest_with_auth("none", None))
        .expect("local no-auth Talk manifest is accepted");
    assert_eq!(no_auth_manifest.transport.auth.as_deref(), Some("none"));
    assert!(no_auth_manifest.transport.auth_token.is_none());

    let missing_token_error = validate_talk_manifest(&manifest_with_auth("bearer", None))
        .expect_err("bearer auth requires a manifest token before invoking Talk");
    assert!(
        missing_token_error.to_string().contains("authToken"),
        "missing_token_error={missing_token_error}"
    );
}

#[test]
fn validates_talk_manifest_rejects_incomplete_metadata_and_duplicate_capabilities() {
    let mut missing_display_name: serde_json::Value =
        serde_json::from_str(&manifest_with("http://127.0.0.1:49210", "talk"))
            .expect("manifest json");
    missing_display_name["displayName"] = json!(" ");
    let error = validate_talk_manifest(&missing_display_name.to_string())
        .expect_err("blank displayName is rejected");
    assert!(
        error.to_string().contains("displayName"),
        "displayName error={error}"
    );

    let mut missing_version: serde_json::Value =
        serde_json::from_str(&manifest_with("http://127.0.0.1:49210", "talk"))
            .expect("manifest json");
    missing_version["version"] = json!("");
    let error = validate_talk_manifest(&missing_version.to_string())
        .expect_err("blank version is rejected");
    assert!(
        error.to_string().contains("version"),
        "version error={error}"
    );

    let mut missing_pid: serde_json::Value =
        serde_json::from_str(&manifest_with("http://127.0.0.1:49210", "talk"))
            .expect("manifest json");
    missing_pid
        .as_object_mut()
        .expect("manifest object")
        .remove("pid");
    let error =
        validate_talk_manifest(&missing_pid.to_string()).expect_err("missing pid is rejected");
    assert!(error.to_string().contains("pid"), "pid error={error}");

    let mut missing_started_at: serde_json::Value =
        serde_json::from_str(&manifest_with("http://127.0.0.1:49210", "talk"))
            .expect("manifest json");
    missing_started_at
        .as_object_mut()
        .expect("manifest object")
        .remove("startedAt");
    let error = validate_talk_manifest(&missing_started_at.to_string())
        .expect_err("missing startedAt is rejected");
    assert!(
        error.to_string().contains("startedAt"),
        "startedAt error={error}"
    );

    let mut duplicate_capabilities: serde_json::Value =
        serde_json::from_str(&manifest_with("http://127.0.0.1:49210", "talk"))
            .expect("manifest json");
    duplicate_capabilities["capabilities"] = json!(["voice.capture.once", "voice.capture.once"]);
    let error = validate_talk_manifest(&duplicate_capabilities.to_string())
        .expect_err("duplicate capabilities are rejected");
    assert!(
        error.to_string().contains("duplicate"),
        "duplicate capabilities error={error}"
    );
}

#[test]
fn validates_manifest_shape_written_by_talk_serve() {
    let manifest = validate_talk_manifest(&manifest_with_numeric_started_at())
        .expect("Hook accepts Talk serve's numeric startedAt manifest");

    assert_eq!(manifest.app_id, "talk");
    assert_eq!(manifest.started_at, Some(json!(1780861361_u64)));
}
