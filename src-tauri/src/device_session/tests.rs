use super::*;

#[cfg(feature = "remote-surface")]
use super::identity::{
    load_or_create_device_identity_at, persist_device_identity, validate_device_identity,
};
#[cfg(feature = "remote-surface")]
use super::identity_protection::LEGACY_IDENTITY_SCHEMA_VERSION;
#[cfg(all(feature = "remote-surface", windows))]
use super::identity_protection::PROTECTED_IDENTITY_SCHEMA_VERSION;
#[cfg(feature = "remote-surface")]
use super::session_attempt::{device_session_signature_message, is_pending_device_approval};

fn loom_manifest(
    base_url: &str,
    auth: Option<&str>,
    auth_token: Option<&str>,
) -> crate::loom_connector::LoomManifest {
    crate::loom_connector::LoomManifest {
        schema_version: 1,
        app_id: "loom".to_owned(),
        display_name: "Loom".to_owned(),
        version: "0.1.0".to_owned(),
        pid: Some(1),
        transport: crate::loom_connector::LoomManifestTransport {
            transport_type: "http".to_owned(),
            base_url: base_url.to_owned(),
            auth: auth.map(str::to_owned),
            auth_token: auth_token.map(str::to_owned),
        },
        capabilities: vec!["brain.plan".to_owned()],
        started_at: Some(serde_json::json!(1)),
    }
}

#[cfg(feature = "remote-surface")]
#[test]
fn identity_round_trip_preserves_one_ed25519_key_pair() {
    let root = std::env::temp_dir().join(format!(
        "hook-device-identity-test-{}",
        uuid::Uuid::new_v4()
    ));
    let first = load_or_create_device_identity_at(&root).expect("create identity");
    let second = load_or_create_device_identity_at(&root).expect("reload identity");
    assert_eq!(first.public_key, second.public_key);
    assert_eq!(first.private_key, second.private_key);
    validate_device_identity(&second).expect("valid reloaded identity");
    let stored: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.join("device-identity.json")).expect("read stored identity"),
    )
    .expect("parse stored identity");
    #[cfg(windows)]
    {
        assert_eq!(stored["schemaVersion"], PROTECTED_IDENTITY_SCHEMA_VERSION);
        assert!(stored["privateKey"]
            .as_str()
            .is_some_and(|value| value.starts_with("DPAPI1:")));
        assert_ne!(stored["privateKey"], first.private_key);
    }
    #[cfg(not(windows))]
    assert_eq!(stored["schemaVersion"], LEGACY_IDENTITY_SCHEMA_VERSION);
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(all(feature = "remote-surface", windows))]
#[test]
fn plaintext_identity_is_migrated_to_dpapi_without_changing_the_key_pair() {
    let root = std::env::temp_dir().join(format!(
        "hook-device-identity-migration-test-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root).expect("create identity root");
    let signing_key = ed25519_dalek::SigningKey::generate(&mut rand_core::OsRng);
    let private_key = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        signing_key.to_bytes(),
    );
    let public_key = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        signing_key.verifying_key().to_bytes(),
    );
    let legacy = serde_json::json!({
        "schemaVersion": LEGACY_IDENTITY_SCHEMA_VERSION,
        "deviceId": "legacy-device",
        "privateKey": private_key,
        "publicKey": public_key,
    });
    std::fs::write(
        root.join("device-identity.json"),
        serde_json::to_vec_pretty(&legacy).expect("serialize legacy identity"),
    )
    .expect("write legacy identity");

    let loaded = load_or_create_device_identity_at(&root).expect("migrate identity");
    assert_eq!(loaded.private_key, private_key);
    assert_eq!(loaded.public_key, public_key);
    let migrated: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.join("device-identity.json")).expect("read migrated identity"),
    )
    .expect("parse migrated identity");
    assert_eq!(migrated["schemaVersion"], PROTECTED_IDENTITY_SCHEMA_VERSION);
    assert!(migrated["privateKey"]
        .as_str()
        .is_some_and(|value| value.starts_with("DPAPI1:")));
    assert!(!serde_json::to_string(&migrated)
        .expect("serialize migrated identity")
        .contains(&private_key));
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(feature = "remote-surface")]
#[test]
fn persisted_identity_replacement_is_valid_and_debug_redacts_private_key() {
    let root = std::env::temp_dir().join(format!(
        "hook-device-identity-replace-test-{}",
        uuid::Uuid::new_v4()
    ));
    let mut identity = load_or_create_device_identity_at(&root).expect("create identity");
    identity.device_id = Some("device-replaced".to_owned());
    persist_device_identity(&root.join("device-identity.json"), &identity)
        .expect("replace identity");
    let loaded = load_or_create_device_identity_at(&root).expect("reload identity");
    assert_eq!(loaded.device_id.as_deref(), Some("device-replaced"));
    let debug = format!("{loaded:?}");
    assert!(!debug.contains(&loaded.private_key));
    assert!(debug.contains("[REDACTED]"));
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn authorization_debug_redacts_transport_credentials() {
    let bearer = DeviceSessionAuthorization {
        device_id: "device".to_owned(),
        credential: SurfaceRequestCredential::Bearer("bearer-secret".to_owned()),
    };
    let debug = format!("{bearer:?}");
    assert!(!debug.contains("bearer-secret"));
    assert!(debug.contains("[REDACTED]"));
}

#[cfg(feature = "remote-surface")]
#[test]
fn signature_message_is_stable_and_context_bound() {
    assert_eq!(
        device_session_signature_message("device:1", "challenge:1", "abc", "nonce_0000000000"),
        "loom.device-session.v1\ndevice:1\nchallenge:1\nabc\nnonce_0000000000"
    );
}

#[cfg(feature = "remote-surface")]
#[test]
fn remote_device_sessions_reject_plaintext_http() {
    assert!(validate_secure_loom_base_url("http://192.168.1.20:8765").is_err());
    validate_secure_loom_base_url("https://loom.example.test").expect("remote HTTPS");
    validate_secure_loom_base_url("https://127.0.0.1.evil.example/")
        .expect("lookalike host is a remote HTTPS origin, not loopback");
    validate_secure_loom_base_url("http://127.0.0.1:8765").expect("loopback HTTP");
    for hostile in [
        "http://localhost:8080@evil.example/",
        "http://127.0.0.1.evil.example/",
        "https://loom.example.test/path",
        "https://loom.example.test/?query=1",
    ] {
        assert!(
            validate_secure_loom_base_url(hostile).is_err(),
            "hostile origin was accepted: {hostile}"
        );
    }
}

#[test]
fn loopback_surface_auth_uses_manifest_none_without_device_pairing() {
    let authorization =
        loopback_surface_authorization(&loom_manifest("http://127.0.0.1:8765", Some("none"), None))
            .expect("valid loopback auth")
            .expect("loopback authorization");
    assert_eq!(authorization.device_id, "device-000-local");
    assert!(matches!(
        authorization.credential,
        SurfaceRequestCredential::None
    ));
}

#[test]
fn loopback_surface_auth_uses_manifest_bearer_token() {
    let authorization = loopback_surface_authorization(&loom_manifest(
        "http://localhost:8765",
        Some("bearer"),
        Some("test-token"),
    ))
    .expect("valid loopback auth")
    .expect("loopback authorization");
    assert_eq!(authorization.device_id, "device-000-local");
    assert!(matches!(
        authorization.credential,
        SurfaceRequestCredential::Bearer(token) if token == "test-token"
    ));
}

#[test]
fn remote_surface_auth_still_requires_device_session_pairing() {
    assert!(loopback_surface_authorization(&loom_manifest(
        "https://loom.example.test",
        None,
        None,
    ))
    .expect("remote auth routing")
    .is_none());
}

#[test]
fn loopback_bearer_surface_auth_rejects_missing_token() {
    assert!(loopback_surface_authorization(&loom_manifest(
        "http://127.0.0.1:8765",
        Some("bearer"),
        None,
    ))
    .is_err());
}

#[cfg(feature = "remote-surface")]
#[test]
fn only_pending_device_approval_is_retryable() {
    assert!(is_pending_device_approval(
        403,
        r#"{"error":{"code":"device_not_authorized","message":"pending"}}"#
    ));
    assert!(!is_pending_device_approval(
        403,
        r#"{"error":{"code":"device_revoked","message":"revoked"}}"#
    ));
    assert!(!is_pending_device_approval(
        500,
        r#"{"error":{"code":"device_not_authorized","message":"pending"}}"#
    ));
    assert!(!is_pending_device_approval(403, "not-json"));
}

#[cfg(not(feature = "remote-surface"))]
#[test]
fn loopback_only_surface_error_names_the_feature() {
    let message = disabled_remote_surface_error("https://loom.example.test");
    assert!(message.contains("https://loom.example.test"));
    assert!(message.contains("remote-surface"));
}
