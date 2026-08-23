//! Surface request authorization.
//!
//! The loopback half runs in every build. The remote / device-session half — device pairing, the
//! Ed25519 device identity, session tokens, and the HTTPS-origin rule — is enabled by Hook's default
//! feature set. `--no-default-features` retains a loopback-only compatibility build.

#[cfg(feature = "remote-surface")]
use std::collections::HashMap;
#[cfg(feature = "remote-surface")]
use std::fs;
#[cfg(feature = "remote-surface")]
use std::path::{Path, PathBuf};
#[cfg(feature = "remote-surface")]
use std::sync::{Mutex, OnceLock};
#[cfg(feature = "remote-surface")]
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(feature = "remote-surface")]
use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD as BASE64_URL};
#[cfg(feature = "remote-surface")]
use base64::Engine as _;
#[cfg(feature = "remote-surface")]
use ed25519_dalek::{Signer as _, SigningKey};
#[cfg(feature = "remote-surface")]
use rand_core::{OsRng, RngCore};
use reqwest::RequestBuilder;
#[cfg(feature = "remote-surface")]
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[cfg(feature = "remote-surface")]
const DEVICE_IDENTITY_SCHEMA_VERSION: u32 = 1;
#[cfg(feature = "remote-surface")]
const DEVICE_SESSION_RENEWAL_MARGIN_MILLIS: u64 = 30_000;
#[cfg(feature = "remote-surface")]
const DEVICE_PAIRING_APPROVAL_TIMEOUT: Duration = Duration::from_secs(90);
#[cfg(feature = "remote-surface")]
const DEVICE_PAIRING_APPROVAL_POLL_INTERVAL: Duration = Duration::from_millis(250);

#[cfg(feature = "remote-surface")]
static DEVICE_IDENTITY_IO_LOCK: Mutex<()> = Mutex::new(());
#[cfg(feature = "remote-surface")]
static DEVICE_SESSION_CACHE: OnceLock<Mutex<HashMap<String, CachedDeviceSession>>> =
    OnceLock::new();

#[cfg(feature = "remote-surface")]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIdentityDocument {
    schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    private_key: String,
    public_key: String,
}

#[cfg(feature = "remote-surface")]
#[derive(Clone, Debug)]
struct CachedDeviceSession {
    device_id: String,
    token: String,
    expires_at_ms: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct DeviceSessionAuthorization {
    pub(crate) device_id: String,
    credential: SurfaceRequestCredential,
}

#[derive(Clone, Debug)]
enum SurfaceRequestCredential {
    None,
    Bearer(String),
    #[cfg(feature = "remote-surface")]
    Device(String),
}

impl DeviceSessionAuthorization {
    pub(crate) fn apply(&self, request: RequestBuilder) -> RequestBuilder {
        match &self.credential {
            SurfaceRequestCredential::None => request,
            SurfaceRequestCredential::Bearer(token) => request.bearer_auth(token),
            #[cfg(feature = "remote-surface")]
            SurfaceRequestCredential::Device(token) => request
                .header("Authorization", format!("Device {token}"))
                .header("X-Loom-Device-Nonce", random_url_safe(24)),
        }
    }
}

#[cfg(feature = "remote-surface")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceSummary {
    id: String,
    #[serde(default)]
    public_key: Option<String>,
}

#[cfg(feature = "remote-surface")]
#[derive(Debug, Deserialize)]
struct DeviceRegistryResponse {
    #[serde(default)]
    devices: Vec<DeviceSummary>,
    #[serde(default)]
    pending: Vec<DeviceSummary>,
}

#[cfg(feature = "remote-surface")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceSessionChallenge {
    challenge_id: String,
    device_id: String,
    challenge: String,
}

#[cfg(feature = "remote-surface")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceSessionResponse {
    device_id: String,
    token: String,
    expires_at_ms: u64,
}

/// Authorize one Surface request. A loopback-only build refuses remote origins instead of
/// pretending to pair.
// With `remote-surface` off there is nothing to await; the signature stays `async` so both feature
// combinations share one call site in `loom_hook.rs`.
#[cfg_attr(not(feature = "remote-surface"), allow(clippy::unused_async))]
pub(crate) async fn authorize_surface_request(
    app: &AppHandle,
    manifest: &crate::loom_connector::LoomManifest,
) -> Result<DeviceSessionAuthorization, String> {
    if let Some(authorization) = loopback_surface_authorization(manifest)? {
        return Ok(authorization);
    }

    #[cfg(not(feature = "remote-surface"))]
    {
        let _ = app;
        Err(disabled_remote_surface_error(&manifest.transport.base_url))
    }

    #[cfg(feature = "remote-surface")]
    {
        remote_surface_authorization(app, manifest).await
    }
}

/// The refusal a deliberately loopback-only build returns for a remote Surface endpoint.
#[cfg(not(feature = "remote-surface"))]
fn disabled_remote_surface_error(base_url: &str) -> String {
    format!(
        "cross-device Loom Surface support is disabled in this build: `{base_url}` is not a \
         loopback transport (rebuild with Hook's default features or `--features remote-surface`)"
    )
}

#[cfg(feature = "remote-surface")]
async fn remote_surface_authorization(
    app: &AppHandle,
    manifest: &crate::loom_connector::LoomManifest,
) -> Result<DeviceSessionAuthorization, String> {
    let base_url = manifest.transport.base_url.as_str();

    validate_secure_loom_base_url(base_url)?;
    let mut identity = load_or_create_device_identity(app)?;
    if identity.device_id.is_none() {
        register_device_pairing_request(base_url, &mut identity, app).await?;
    }
    let device_id = identity
        .device_id
        .as_deref()
        .ok_or_else(|| "Hook device pairing did not return a device id".to_owned())?;
    let cache_key = format!("{}\n{}", base_url.trim_end_matches('/'), device_id);
    let now = unix_time_millis();
    if let Some(cached) = device_session_cache()
        .lock()
        .map_err(|_| "Hook device session cache is unavailable".to_owned())?
        .get(&cache_key)
        .filter(|session| {
            session.expires_at_ms > now.saturating_add(DEVICE_SESSION_RENEWAL_MARGIN_MILLIS)
        })
        .cloned()
    {
        return Ok(DeviceSessionAuthorization {
            device_id: cached.device_id,
            credential: SurfaceRequestCredential::Device(cached.token),
        });
    }

    let session = wait_for_approved_device_session(base_url, &identity).await?;
    let authorization = DeviceSessionAuthorization {
        device_id: session.device_id.clone(),
        credential: SurfaceRequestCredential::Device(session.token.clone()),
    };
    device_session_cache()
        .lock()
        .map_err(|_| "Hook device session cache is unavailable".to_owned())?
        .insert(
            cache_key,
            CachedDeviceSession {
                device_id: session.device_id,
                token: session.token,
                expires_at_ms: session.expires_at_ms,
            },
        );
    Ok(authorization)
}

fn loopback_surface_authorization(
    manifest: &crate::loom_connector::LoomManifest,
) -> Result<Option<DeviceSessionAuthorization>, String> {
    if !crate::loom_connector::is_loopback_base_url(&manifest.transport.base_url) {
        return Ok(None);
    }

    let auth_mode = manifest.transport.auth.as_deref().unwrap_or("none");
    let credential = if auth_mode.eq_ignore_ascii_case("none") {
        SurfaceRequestCredential::None
    } else if auth_mode.eq_ignore_ascii_case("bearer") {
        let token = manifest
            .transport
            .auth_token
            .as_deref()
            .map(str::trim)
            .filter(|token| !token.is_empty())
            .ok_or_else(|| "Loom manifest requires bearer auth but has no auth token".to_owned())?;
        SurfaceRequestCredential::Bearer(token.to_owned())
    } else {
        return Err(format!(
            "unsupported Loom Surface auth mode `{auth_mode}` for loopback transport"
        ));
    };

    Ok(Some(DeviceSessionAuthorization {
        device_id: "device-000-local".to_owned(),
        credential,
    }))
}

/// Accept only an origin-shaped loopback URL or an HTTPS remote origin.
#[cfg(feature = "remote-surface")]
fn validate_secure_loom_base_url(base_url: &str) -> Result<(), String> {
    crate::loom_connector::classify_loom_base_url(base_url)
        .map(|_| ())
        .map_err(|error| format!("invalid Loom Surface origin: {error}"))
}

/// Drop every cached device session for one Loom endpoint.
///
/// Compiled in both feature combinations because `loom_hook` calls it from a live loopback path.
/// With `remote-surface` off there is no session cache to clear, so this is a no-op.
pub(crate) fn invalidate_surface_sessions(base_url: &str) {
    #[cfg(not(feature = "remote-surface"))]
    let _ = base_url;

    #[cfg(feature = "remote-surface")]
    {
        let prefix = format!("{}\n", base_url.trim_end_matches('/'));
        if let Ok(mut cache) = device_session_cache().lock() {
            cache.retain(|key, _| !key.starts_with(&prefix));
        }
    }
}

#[cfg(feature = "remote-surface")]
fn device_session_cache() -> &'static Mutex<HashMap<String, CachedDeviceSession>> {
    DEVICE_SESSION_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(feature = "remote-surface")]
fn load_or_create_device_identity(app: &AppHandle) -> Result<DeviceIdentityDocument, String> {
    let app_data_dir = crate::effective_app_data_dir(app)?;
    load_or_create_device_identity_at(&app_data_dir)
}

#[cfg(feature = "remote-surface")]
fn load_or_create_device_identity_at(
    app_data_dir: &Path,
) -> Result<DeviceIdentityDocument, String> {
    let _guard = DEVICE_IDENTITY_IO_LOCK
        .lock()
        .map_err(|_| "Hook device identity lock is unavailable".to_owned())?;
    let path = app_data_dir.join("device-identity.json");
    if let Ok(bytes) = fs::read(&path) {
        let identity = serde_json::from_slice::<DeviceIdentityDocument>(&bytes)
            .map_err(|error| format!("Hook device identity is invalid: {error}"))?;
        validate_device_identity(&identity)?;
        return Ok(identity);
    }

    fs::create_dir_all(app_data_dir)
        .map_err(|error| format!("create Hook app data directory: {error}"))?;
    let signing_key = SigningKey::generate(&mut OsRng);
    let identity = DeviceIdentityDocument {
        schema_version: DEVICE_IDENTITY_SCHEMA_VERSION,
        device_id: None,
        private_key: BASE64.encode(signing_key.to_bytes()),
        public_key: BASE64.encode(signing_key.verifying_key().to_bytes()),
    };
    persist_device_identity(&path, &identity)?;
    Ok(identity)
}

#[cfg(feature = "remote-surface")]
fn validate_device_identity(identity: &DeviceIdentityDocument) -> Result<(), String> {
    if identity.schema_version != DEVICE_IDENTITY_SCHEMA_VERSION {
        return Err(format!(
            "unsupported Hook device identity schema {}",
            identity.schema_version
        ));
    }
    let private_key = decode_signing_key(&identity.private_key)?;
    if BASE64.encode(private_key.verifying_key().to_bytes()) != identity.public_key {
        return Err("Hook device identity public/private key pair does not match".to_owned());
    }
    Ok(())
}

#[cfg(feature = "remote-surface")]
fn persist_device_identity(path: &Path, identity: &DeviceIdentityDocument) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Hook device identity path has no parent".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create Hook device identity directory: {error}"))?;
    let temporary = temporary_identity_path(path);
    let bytes = serde_json::to_vec_pretty(identity)
        .map_err(|error| format!("serialize Hook device identity: {error}"))?;
    fs::write(&temporary, bytes).map_err(|error| format!("write Hook device identity: {error}"))?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| format!("replace Hook device identity: {error}"))?;
    }
    fs::rename(&temporary, path).map_err(|error| format!("activate Hook device identity: {error}"))
}

#[cfg(feature = "remote-surface")]
fn temporary_identity_path(path: &Path) -> PathBuf {
    path.with_extension(format!("json.{}.tmp", std::process::id()))
}

#[cfg(feature = "remote-surface")]
async fn register_device_pairing_request(
    base_url: &str,
    identity: &mut DeviceIdentityDocument,
    app: &AppHandle,
) -> Result<(), String> {
    let base = base_url.trim_end_matches('/');
    let client = surface_client(base)?;
    let computer_name = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Hook 设备".to_owned());
    let response = client
        .post(format!("{base}/v1/devices/requests"))
        .json(&serde_json::json!({
            "name": computer_name,
            "kind": "computer",
            "address": format!("hook://{}", computer_name),
            "publicKey": identity.public_key,
        }))
        .send()
        .await
        .map_err(|error| format!("submit Hook device pairing request: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("read Hook device pairing response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Hook device pairing request returned {status}: {body}"
        ));
    }
    let registry = serde_json::from_str::<DeviceRegistryResponse>(&body)
        .map_err(|error| format!("parse Hook device pairing response: {error}"))?;
    let device = registry
        .pending
        .into_iter()
        .chain(registry.devices)
        .find(|device| device.public_key.as_deref() == Some(identity.public_key.as_str()))
        .ok_or_else(|| "Loom did not return the paired Hook device".to_owned())?;
    identity.device_id = Some(device.id);
    let app_data_dir = crate::effective_app_data_dir(app)?;
    let _guard = DEVICE_IDENTITY_IO_LOCK
        .lock()
        .map_err(|_| "Hook device identity lock is unavailable".to_owned())?;
    persist_device_identity(&app_data_dir.join("device-identity.json"), identity)
}

#[cfg(feature = "remote-surface")]
#[derive(Debug)]
enum DeviceSessionAttemptError {
    PendingApproval(String),
    Fatal(String),
}

#[cfg(feature = "remote-surface")]
async fn wait_for_approved_device_session(
    base_url: &str,
    identity: &DeviceIdentityDocument,
) -> Result<DeviceSessionResponse, String> {
    let deadline = tokio::time::Instant::now() + DEVICE_PAIRING_APPROVAL_TIMEOUT;
    loop {
        match create_device_session_attempt(base_url, identity).await {
            Ok(session) => return Ok(session),
            Err(DeviceSessionAttemptError::PendingApproval(error)) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(format!(
                        "Loom did not approve this Hook device within {} seconds: {error}",
                        DEVICE_PAIRING_APPROVAL_TIMEOUT.as_secs()
                    ));
                }
                tokio::time::sleep(DEVICE_PAIRING_APPROVAL_POLL_INTERVAL).await;
            }
            Err(DeviceSessionAttemptError::Fatal(error)) => return Err(error),
        }
    }
}

#[cfg(feature = "remote-surface")]
async fn create_device_session_attempt(
    base_url: &str,
    identity: &DeviceIdentityDocument,
) -> Result<DeviceSessionResponse, DeviceSessionAttemptError> {
    let base = base_url.trim_end_matches('/');
    let device_id = identity.device_id.as_deref().ok_or_else(|| {
        DeviceSessionAttemptError::Fatal("Hook device identity is not paired".to_owned())
    })?;
    let client = surface_client(base).map_err(DeviceSessionAttemptError::Fatal)?;
    let challenge_response = client
        .post(format!("{base}/v1/device-sessions/challenges"))
        .json(&serde_json::json!({"deviceId": device_id}))
        .send()
        .await
        .map_err(|error| {
            DeviceSessionAttemptError::Fatal(format!("request Loom device challenge: {error}"))
        })?;
    let challenge_status = challenge_response.status();
    let challenge_body = challenge_response.text().await.map_err(|error| {
        DeviceSessionAttemptError::Fatal(format!("read Loom device challenge: {error}"))
    })?;
    if !challenge_status.is_success() {
        let error = format!(
            "Loom has not approved this Hook device or cannot issue a session ({challenge_status}): {challenge_body}"
        );
        return if is_pending_device_approval(challenge_status.as_u16(), &challenge_body) {
            Err(DeviceSessionAttemptError::PendingApproval(error))
        } else {
            Err(DeviceSessionAttemptError::Fatal(error))
        };
    }
    let challenge =
        serde_json::from_str::<DeviceSessionChallenge>(&challenge_body).map_err(|error| {
            DeviceSessionAttemptError::Fatal(format!("parse Loom device challenge: {error}"))
        })?;
    if challenge.device_id != device_id {
        return Err(DeviceSessionAttemptError::Fatal(
            "Loom device challenge identity mismatch".to_owned(),
        ));
    }
    let client_nonce = random_url_safe(24);
    let message = device_session_signature_message(
        device_id,
        &challenge.challenge_id,
        &challenge.challenge,
        &client_nonce,
    );
    let signature = decode_signing_key(&identity.private_key)
        .map_err(DeviceSessionAttemptError::Fatal)?
        .sign(message.as_bytes());
    let session_response = client
        .post(format!("{base}/v1/device-sessions"))
        .json(&serde_json::json!({
            "deviceId": device_id,
            "challengeId": challenge.challenge_id,
            "clientNonce": client_nonce,
            "signature": BASE64.encode(signature.to_bytes()),
        }))
        .send()
        .await
        .map_err(|error| {
            DeviceSessionAttemptError::Fatal(format!("create Loom device session: {error}"))
        })?;
    let session_status = session_response.status();
    let session_body = session_response.text().await.map_err(|error| {
        DeviceSessionAttemptError::Fatal(format!("read Loom device session: {error}"))
    })?;
    if !session_status.is_success() {
        return Err(DeviceSessionAttemptError::Fatal(format!(
            "Loom device session request returned {session_status}: {session_body}"
        )));
    }
    serde_json::from_str::<DeviceSessionResponse>(&session_body).map_err(|error| {
        DeviceSessionAttemptError::Fatal(format!("parse Loom device session: {error}"))
    })
}

#[cfg(feature = "remote-surface")]
fn is_pending_device_approval(status: u16, body: &str) -> bool {
    status == 403
        && serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|value| {
                value
                    .pointer("/error/code")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)
            })
            .as_deref()
            == Some("device_not_authorized")
}

#[cfg(feature = "remote-surface")]
fn surface_client(base_url: &str) -> Result<reqwest::Client, String> {
    crate::network_proxy::shared_client(base_url, Some(Duration::from_secs(10)))
        .map_err(|error| format!("build Hook device session client: {error}"))
}

#[cfg(feature = "remote-surface")]
fn decode_signing_key(encoded: &str) -> Result<SigningKey, String> {
    let bytes = BASE64
        .decode(encoded.trim())
        .map_err(|_| "Hook device private key is not valid Base64".to_owned())?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Hook device private key must contain 32 Ed25519 bytes".to_owned())?;
    Ok(SigningKey::from_bytes(&bytes))
}

#[cfg(feature = "remote-surface")]
fn device_session_signature_message(
    device_id: &str,
    challenge_id: &str,
    challenge: &str,
    client_nonce: &str,
) -> String {
    format!("loom.device-session.v1\n{device_id}\n{challenge_id}\n{challenge}\n{client_nonce}")
}

#[cfg(feature = "remote-surface")]
fn random_url_safe(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    BASE64_URL.encode(bytes)
}

#[cfg(feature = "remote-surface")]
fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let _ = fs::remove_dir_all(root);
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
        let authorization = loopback_surface_authorization(&loom_manifest(
            "http://127.0.0.1:8765",
            Some("none"),
            None,
        ))
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
}
