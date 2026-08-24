//! Ed25519 device identity validation and crash-safe persistence.

use std::fmt;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use ed25519_dalek::SigningKey;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::identity_protection::{
    decode_from_storage, encode_for_storage, LEGACY_IDENTITY_SCHEMA_VERSION,
};

const DEVICE_IDENTITY_MAX_JSON_BYTES: usize = 64 * 1024;
static DEVICE_IDENTITY_IO_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone)]
pub(super) struct DeviceIdentityDocument {
    pub(super) schema_version: u32,
    pub(super) device_id: Option<String>,
    pub(super) private_key: String,
    pub(super) public_key: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDeviceIdentityDocument {
    schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    device_id: Option<String>,
    private_key: String,
    public_key: String,
}

impl fmt::Debug for DeviceIdentityDocument {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DeviceIdentityDocument")
            .field("schema_version", &self.schema_version)
            .field("device_id", &self.device_id)
            .field("private_key", &"[REDACTED]")
            .field("public_key", &self.public_key)
            .finish()
    }
}

pub(super) fn load_or_create_device_identity(
    app: &AppHandle,
) -> Result<DeviceIdentityDocument, String> {
    let app_data_dir = crate::effective_app_data_dir(app)?;
    load_or_create_device_identity_at(&app_data_dir)
}

pub(super) fn load_or_create_device_identity_at(
    app_data_dir: &Path,
) -> Result<DeviceIdentityDocument, String> {
    let _guard = DEVICE_IDENTITY_IO_LOCK
        .lock()
        .map_err(|_| "Hook device identity lock is unavailable".to_owned())?;
    let path = app_data_dir.join("device-identity.json");
    match fs::metadata(&path) {
        Ok(metadata) => {
            if metadata.len() > DEVICE_IDENTITY_MAX_JSON_BYTES as u64 {
                return Err(format!(
                    "Hook device identity exceeds {} bytes",
                    DEVICE_IDENTITY_MAX_JSON_BYTES
                ));
            }
            let bytes =
                fs::read(&path).map_err(|error| format!("read Hook device identity: {error}"))?;
            let stored = serde_json::from_slice::<StoredDeviceIdentityDocument>(&bytes)
                .map_err(|error| format!("Hook device identity is invalid: {error}"))?;
            let decoded = decode_from_storage(stored.schema_version, &stored.private_key)?;
            let identity = DeviceIdentityDocument {
                schema_version: LEGACY_IDENTITY_SCHEMA_VERSION,
                device_id: stored.device_id,
                private_key: decoded.encoded,
                public_key: stored.public_key,
            };
            validate_device_identity(&identity)?;
            if decoded.needs_migration {
                // A failed migration remains visible instead of silently keeping
                // a plaintext private key at rest.
                persist_device_identity_locked(&path, &identity)?;
            }
            return Ok(identity);
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("inspect Hook device identity: {error}")),
    }

    fs::create_dir_all(app_data_dir)
        .map_err(|error| format!("create Hook app data directory: {error}"))?;
    let signing_key = SigningKey::generate(&mut OsRng);
    let identity = DeviceIdentityDocument {
        schema_version: LEGACY_IDENTITY_SCHEMA_VERSION,
        device_id: None,
        private_key: BASE64.encode(signing_key.to_bytes()),
        public_key: BASE64.encode(signing_key.verifying_key().to_bytes()),
    };
    persist_device_identity_locked(&path, &identity)?;
    Ok(identity)
}

pub(super) fn validate_device_identity(identity: &DeviceIdentityDocument) -> Result<(), String> {
    if identity.schema_version != LEGACY_IDENTITY_SCHEMA_VERSION {
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

pub(super) fn persist_device_identity(
    path: &Path,
    identity: &DeviceIdentityDocument,
) -> Result<(), String> {
    let _guard = DEVICE_IDENTITY_IO_LOCK
        .lock()
        .map_err(|_| "Hook device identity lock is unavailable".to_owned())?;
    persist_device_identity_locked(path, identity)
}

fn persist_device_identity_locked(
    path: &Path,
    identity: &DeviceIdentityDocument,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Hook device identity path has no parent".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create Hook device identity directory: {error}"))?;
    validate_device_identity(identity)?;
    let (schema_version, private_key) = encode_for_storage(&identity.private_key)?;
    let stored = StoredDeviceIdentityDocument {
        schema_version,
        device_id: identity.device_id.clone(),
        private_key,
        public_key: identity.public_key.clone(),
    };
    let bytes = serde_json::to_vec_pretty(&stored)
        .map_err(|error| format!("serialize Hook device identity: {error}"))?;
    if bytes.len() > DEVICE_IDENTITY_MAX_JSON_BYTES {
        return Err(format!(
            "Hook device identity exceeds {} bytes",
            DEVICE_IDENTITY_MAX_JSON_BYTES
        ));
    }

    let (temporary, mut file) = create_identity_temporary(parent)?;
    let result = (|| {
        restrict_identity_file(&file)?;
        file.write_all(&bytes)
            .and_then(|_| file.flush())
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("write Hook device identity: {error}"))?;
        drop(file);
        crate::replace_session_file(&temporary, path)
            .map_err(|error| error.replace("Hook session", "Hook device identity"))?;
        restrict_identity_path(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn create_identity_temporary(parent: &Path) -> Result<(std::path::PathBuf, fs::File), String> {
    for attempt in 0..100_u32 {
        let path = parent.join(format!(
            ".device-identity.json.tmp-{}-{}-{attempt}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("create Hook device identity temporary: {error}")),
        }
    }
    Err("allocate Hook device identity temporary file".to_owned())
}

#[cfg(unix)]
fn restrict_identity_file(file: &fs::File) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("restrict Hook device identity temporary: {error}"))
}

#[cfg(not(unix))]
fn restrict_identity_file(_file: &fs::File) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn restrict_identity_path(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("restrict Hook device identity: {error}"))
}

#[cfg(not(unix))]
fn restrict_identity_path(_path: &Path) -> Result<(), String> {
    Ok(())
}

pub(super) fn decode_signing_key(encoded: &str) -> Result<SigningKey, String> {
    let bytes = BASE64
        .decode(encoded.trim())
        .map_err(|_| "Hook device private key is not valid Base64".to_owned())?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| "Hook device private key must contain 32 Ed25519 bytes".to_owned())?;
    Ok(SigningKey::from_bytes(&bytes))
}
