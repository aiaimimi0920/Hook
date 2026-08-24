// Validates Loom manifest identity, metadata, capabilities, and authentication.

#[test]
fn validates_loom_manifest_and_rejects_wrong_app_id_or_non_loopback_transport() {
    let manifest = validate_loom_manifest(&manifest_with("http://127.0.0.1:8765", "loom"))
        .expect("valid loopback Loom manifest");

    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.app_id, "loom");
    assert_eq!(manifest.transport.transport_type, "http");
    assert_eq!(manifest.transport.base_url, "http://127.0.0.1:8765");
    assert!(manifest
        .capabilities
        .iter()
        .any(|capability| capability == "brain.plan"));

    let wrong_app_error = validate_loom_manifest(&manifest_with("http://127.0.0.1:8765", "talk"))
        .expect_err("wrong appId is rejected");
    assert!(
        wrong_app_error.to_string().contains("appId"),
        "wrong_app_error={wrong_app_error}"
    );

    let non_loopback_error =
        validate_loom_manifest(&manifest_with("http://192.168.1.10:8765", "loom"))
            .expect_err("LAN baseUrl is rejected");
    assert!(
        non_loopback_error.to_string().contains("loopback"),
        "non_loopback_error={non_loopback_error}"
    );

    for base_url in [
        "http://127.0.0.1:8765/api",
        "http://127.0.0.1:8765?proxy=1",
        "http://127.0.0.1:8765/#fragment",
        "http://user:secret@127.0.0.1:8765",
    ] {
        let base_url_error = validate_loom_manifest(&manifest_with(base_url, "loom"))
            .expect_err("baseUrl must be an origin-only loopback URL");
        assert!(
            base_url_error.to_string().contains("baseUrl"),
            "base_url_error={base_url_error}"
        );
    }
}

#[test]
fn validates_loom_manifest_required_metadata_and_capability_shape() {
    for (field, manifest) in [
        (
            "displayName",
            json!({
                "schemaVersion": 1,
                "appId": "loom",
                "displayName": "",
                "version": "0.1.0",
                "pid": 12345,
                "transport": {
                    "type": "http",
                    "baseUrl": "http://127.0.0.1:8765",
                    "auth": "none"
                },
                "capabilities": ["brain.plan"],
                "startedAt": 1780861361_u64
            }),
        ),
        (
            "version",
            json!({
                "schemaVersion": 1,
                "appId": "loom",
                "displayName": "Loom",
                "version": "",
                "pid": 12345,
                "transport": {
                    "type": "http",
                    "baseUrl": "http://127.0.0.1:8765",
                    "auth": "none"
                },
                "capabilities": ["brain.plan"],
                "startedAt": 1780861361_u64
            }),
        ),
        (
            "pid",
            json!({
                "schemaVersion": 1,
                "appId": "loom",
                "displayName": "Loom",
                "version": "0.1.0",
                "transport": {
                    "type": "http",
                    "baseUrl": "http://127.0.0.1:8765",
                    "auth": "none"
                },
                "capabilities": ["brain.plan"],
                "startedAt": 1780861361_u64
            }),
        ),
        (
            "startedAt",
            json!({
                "schemaVersion": 1,
                "appId": "loom",
                "displayName": "Loom",
                "version": "0.1.0",
                "pid": 12345,
                "transport": {
                    "type": "http",
                    "baseUrl": "http://127.0.0.1:8765",
                    "auth": "none"
                },
                "capabilities": ["brain.plan"]
            }),
        ),
        (
            "capabilities",
            json!({
                "schemaVersion": 1,
                "appId": "loom",
                "displayName": "Loom",
                "version": "0.1.0",
                "pid": 12345,
                "transport": {
                    "type": "http",
                    "baseUrl": "http://127.0.0.1:8765",
                    "auth": "none"
                },
                "capabilities": ["brain.plan", "brain.plan"],
                "startedAt": 1780861361_u64
            }),
        ),
    ] {
        let error = validate_loom_manifest(&manifest.to_string())
            .expect_err("invalid metadata/capability manifest is rejected");
        assert!(
            error.to_string().contains(field),
            "field={field} error={error}"
        );
    }
}

#[test]
fn validates_loom_manifest_auth_modes_before_invoke() {
    let no_auth_manifest = validate_loom_manifest(&manifest_with_auth("none", None))
        .expect("local no-auth Loom manifest is accepted");
    assert_eq!(no_auth_manifest.transport.auth.as_deref(), Some("none"));
    assert!(no_auth_manifest.transport.auth_token.is_none());

    let missing_token_error = validate_loom_manifest(&manifest_with_auth("bearer", None))
        .expect_err("bearer auth requires a manifest token before invoking Loom");
    assert!(
        missing_token_error.to_string().contains("authToken"),
        "missing_token_error={missing_token_error}"
    );
}
