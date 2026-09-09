//! Surface request authorization.
//!
//! Loopback authorization is always available. Remote pairing support is split into focused
//! owners for identity persistence, pairing, session challenges, and the bounded token cache.

#[cfg(feature = "remote-surface")]
mod cache;
#[cfg(feature = "remote-surface")]
mod identity;
#[cfg(feature = "remote-surface")]
mod identity_protection;
#[cfg(feature = "remote-surface")]
mod pairing;
#[cfg(feature = "remote-surface")]
mod session_attempt;

use reqwest::RequestBuilder;
use std::fmt;
use tauri::AppHandle;

#[cfg(feature = "remote-surface")]
use identity::load_or_create_device_identity;
#[cfg(feature = "remote-surface")]
use pairing::register_device_pairing_request;
#[cfg(feature = "remote-surface")]
use session_attempt::{random_url_safe, unix_time_millis, wait_for_approved_device_session};

#[derive(Clone)]
pub(crate) struct DeviceSessionAuthorization {
    pub(crate) device_id: String,
    credential: SurfaceRequestCredential,
}

#[derive(Clone)]
enum SurfaceRequestCredential {
    None,
    Bearer(String),
    #[cfg(feature = "remote-surface")]
    Device(String),
}

impl fmt::Debug for DeviceSessionAuthorization {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let credential = match &self.credential {
            SurfaceRequestCredential::None => "none",
            SurfaceRequestCredential::Bearer(_) => "bearer:[REDACTED]",
            #[cfg(feature = "remote-surface")]
            SurfaceRequestCredential::Device(_) => "device:[REDACTED]",
        };
        formatter
            .debug_struct("DeviceSessionAuthorization")
            .field("device_id", &self.device_id)
            .field("credential", &credential)
            .finish()
    }
}

impl DeviceSessionAuthorization {
    #[cfg(test)]
    pub(crate) fn none_for_test(device_id: &str) -> Self {
        Self {
            device_id: device_id.to_owned(),
            credential: SurfaceRequestCredential::None,
        }
    }

    #[cfg(all(test, feature = "remote-surface"))]
    pub(crate) fn device_for_test(device_id: &str, token: &str) -> Self {
        Self {
            device_id: device_id.to_owned(),
            credential: SurfaceRequestCredential::Device(token.to_owned()),
        }
    }

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

    pub(crate) fn apply_blocking(
        &self,
        request: reqwest::blocking::RequestBuilder,
    ) -> reqwest::blocking::RequestBuilder {
        match &self.credential {
            SurfaceRequestCredential::None => request,
            SurfaceRequestCredential::Bearer(token) => request.bearer_auth(token),
            #[cfg(feature = "remote-surface")]
            SurfaceRequestCredential::Device(token) => request
                .header("Authorization", format!("Device {token}"))
                .header("X-Loom-Device-Nonce", random_url_safe(24)),
        }
    }

    pub(crate) fn apply_websocket(
        &self,
        request: &mut tungstenite::http::Request<()>,
    ) -> Result<(), String> {
        use tungstenite::http::{header::AUTHORIZATION, HeaderName, HeaderValue};

        let authorization = match &self.credential {
            SurfaceRequestCredential::None => None,
            SurfaceRequestCredential::Bearer(token) => Some(format!("Bearer {token}")),
            #[cfg(feature = "remote-surface")]
            SurfaceRequestCredential::Device(token) => Some(format!("Device {token}")),
        };
        if let Some(value) = authorization {
            request.headers_mut().insert(
                AUTHORIZATION,
                HeaderValue::from_str(&value)
                    .map_err(|_| "Loom authorization header is invalid".to_owned())?,
            );
        }
        #[cfg(feature = "remote-surface")]
        if matches!(&self.credential, SurfaceRequestCredential::Device(_)) {
            request.headers_mut().insert(
                HeaderName::from_static("x-loom-device-nonce"),
                HeaderValue::from_str(&random_url_safe(24))
                    .map_err(|_| "Loom device nonce header is invalid".to_owned())?,
            );
        }
        Ok(())
    }
}

/// Authorize one Surface request. A loopback-only build refuses remote origins instead of
/// pretending to pair.
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
    if let Some(authorization) = cache::get(&cache_key, now)? {
        return Ok(authorization);
    }

    let session = wait_for_approved_device_session(base_url, &identity).await?;
    let authorization = DeviceSessionAuthorization {
        device_id: session.device_id.clone(),
        credential: SurfaceRequestCredential::Device(session.token.clone()),
    };
    cache::insert(
        cache_key,
        session.device_id,
        session.token,
        session.expires_at_ms,
        unix_time_millis(),
    )?;
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

#[cfg(feature = "remote-surface")]
fn validate_secure_loom_base_url(base_url: &str) -> Result<(), String> {
    crate::loom_connector::classify_loom_base_url(base_url)
        .map(|_| ())
        .map_err(|error| format!("invalid Loom Surface origin: {error}"))
}

/// Drop every cached device session for one Loom endpoint. Loopback-only builds have no cache.
pub(crate) fn invalidate_surface_sessions(base_url: &str) {
    #[cfg(not(feature = "remote-surface"))]
    let _ = base_url;

    #[cfg(feature = "remote-surface")]
    cache::invalidate(base_url);
}

#[cfg(test)]
mod tests;
