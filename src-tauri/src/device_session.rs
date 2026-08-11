use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD as BASE64_URL};
use base64::Engine as _;
use ed25519_dalek::{Signer as _, SigningKey};
use rand_core::{OsRng, RngCore};
use reqwest::RequestBuilder;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const DEVICE_IDENTITY_SCHEMA_VERSION: u32 = 1;
const DEVICE_SESSION_RENEWAL_MARGIN_MILLIS: u64 = 30_000;
const DEVICE_PAIRING_APPROVAL_TIMEOUT: Duration = Duration::from_secs(90);
const DEVICE_PAIRING_APPROVAL_POLL_INTERVAL: Duration = Duration::from_millis(250);

static DEVICE_IDENTITY_IO_LOCK: Mutex<()> = Mutex::new(());
static DEVICE_SESSION_CACHE: OnceLock<Mutex<HashMap<String, CachedDeviceSession>>> =
    OnceLock::new();

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceIdentityDocument {
    schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    private_key: String,
    public_key: String,
}

#[derive(Clone, Debug)]
struct CachedDeviceSession {
    device_id: String,
    token: String,
    expires_at_ms: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct DeviceSessionAuthorization {
    pub(crate) device_id: String,
    token: String,
}

impl DeviceSessionAuthorization {
    pub(crate) fn apply(&self, request: RequestBuilder) -> RequestBuilder {
        request
            .header("Authorization", format!("Device {}", self.token))
            .header("X-Loom-Device-Nonce", random_url_safe(24))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceSummary {
    id: String,
    #[serde(default)]
    public_key: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DeviceRegistryResponse {
    #[serde(default)]
    devices: Vec<DeviceSummary>,
    #[serde(default)]
    pending: Vec<DeviceSummary>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceSessionChallenge {
    challenge_id: String,
    device_id: String,
    challenge: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceSessionResponse {
    device_id: String,
    token: String,
    expires_at_ms: u64,
}

pub(crate) async fn authorize_surface_request(
    app: &AppHandle,
    base_url: &str,
) -> Result<DeviceSessionAuthorization, String> {
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
            token: cached.token,
        });
    }

    let session = wait_for_approved_device_session(base_url, &identity).await?;
    let authorization = DeviceSessionAuthorization {
        device_id: session.device_id.clone(),
        token: session.token.clone(),
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

fn validate_secure_loom_base_url(base_url: &str) -> Result<(), String> {
    let lower = base_url.trim().to_ascii_lowercase();
    let loopback = lower.starts_with("http://127.0.0.1:")
        || lower.starts_with("https://127.0.0.1:")
        || lower.starts_with("http://localhost:")
        || lower.starts_with("https://localhost:")
        || matches!(
            lower.as_str(),
            "http://127.0.0.1" | "https://127.0.0.1" | "http://localhost" | "https://localhost"
        );
    if !loopback && !lower.starts_with("https://") {
        return Err(
            "remote Loom Surface connections require an authenticated HTTPS endpoint".to_owned(),
        );
    }
    Ok(())
}

pub(crate) fn invalidate_surface_sessions(base_url: &str) {
    let prefix = format!("{}\n", base_url.trim_end_matches('/'));
    if let Ok(mut cache) = device_session_cache().lock() {
        cache.retain(|key, _| !key.starts_with(&prefix));
    }
}

fn device_session_cache() -> &'static Mutex<HashMap<String, CachedDeviceSession>> {
    DEVICE_SESSION_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn load_or_create_device_identity(app: &AppHandle) -> Result<DeviceIdentityDocument, String> {
    let app_data_dir = crate::effective_app_data_dir(app)?;
    load_or_create_device_identity_at(&app_data_dir)
}

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

fn temporary_identity_path(path: &Path) -> PathBuf {
    path.with_extension(format!("json.{}.tmp", std::process::id()))
}

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

#[derive(Debug)]
enum DeviceSessionAttemptError {
    PendingApproval(String),
    Fatal(String),
}

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

fn surface_client(base_url: &str) -> Result<reqwest::Client, String> {
    crate::network_proxy::apply_to_url(reqwest::Client::builder(), base_url)
        .map_err(|error| format!("configure Hook device session client: {error}"))?
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("build Hook device session client: {error}"))
}

fn decode_signing_key(encoded: &str) -> Result<SigningKey, String> {
    let bytes = BASE64
        .decode(encoded.trim())
        .map_err(|_| "Hook device private key is not valid Base64".to_owned())?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Hook device private key must contain 32 Ed25519 bytes".to_owned())?;
    Ok(SigningKey::from_bytes(&bytes))
}

fn device_session_signature_message(
    device_id: &str,
    challenge_id: &str,
    challenge: &str,
    client_nonce: &str,
) -> String {
    format!("loom.device-session.v1\n{device_id}\n{challenge_id}\n{challenge}\n{client_nonce}")
}

fn random_url_safe(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    BASE64_URL.encode(bytes)
}

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn signature_message_is_stable_and_context_bound() {
        assert_eq!(
            device_session_signature_message("device:1", "challenge:1", "abc", "nonce_0000000000"),
            "loom.device-session.v1\ndevice:1\nchallenge:1\nabc\nnonce_0000000000"
        );
    }

    #[test]
    fn remote_device_sessions_reject_plaintext_http() {
        assert!(validate_secure_loom_base_url("http://192.168.1.20:8765").is_err());
        validate_secure_loom_base_url("https://loom.example.test").expect("remote HTTPS");
        validate_secure_loom_base_url("http://127.0.0.1:8765").expect("loopback HTTP");
    }

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
}
