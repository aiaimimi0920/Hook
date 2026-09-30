//! Enroll this Hook with its own Loom using the already trusted local manifest.
//! Remote invitations must never receive the local administrator credential.
use super::session_attempt::{read_surface_response_body, surface_client};
use crate::loom_connector::{classify_loom_base_url, LoomBaseUrlKind, LoomManifest};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Device {
    id: String,
    public_key: Option<String>,
    approval: String,
    enabled: bool,
}

#[derive(Deserialize)]
struct Registry {
    devices: Vec<Device>,
    pending: Vec<Device>,
}

fn local_token<'a>(base_url: &str, manifest: &'a LoomManifest) -> Option<&'a str> {
    if !matches!(
        classify_loom_base_url(base_url),
        Ok(LoomBaseUrlKind::LoopbackHttp | LoomBaseUrlKind::LoopbackHttps)
    ) || !matches!(
        classify_loom_base_url(&manifest.transport.base_url),
        Ok(LoomBaseUrlKind::LoopbackHttp | LoomBaseUrlKind::LoopbackHttps)
    ) || reqwest::Url::parse(base_url).ok()?
        != reqwest::Url::parse(&manifest.transport.base_url).ok()?
        || !manifest
            .transport
            .auth
            .as_deref()?
            .eq_ignore_ascii_case("bearer")
    {
        return None;
    }
    manifest
        .transport
        .auth_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
}

async fn registry_response(response: reqwest::Response) -> Result<Registry, String> {
    let success = response.status().is_success();
    let body = read_surface_response_body(response).await?;
    if !success {
        return Err("projection_pairing_required".to_owned());
    }
    serde_json::from_str(&body).map_err(|_| "projection_invalid_response".to_owned())
}

fn own_device(registry: Registry, public_key: &str) -> Result<Option<Device>, String> {
    let mut matches = registry
        .devices
        .into_iter()
        .chain(registry.pending)
        .filter(|device| device.public_key.as_deref() == Some(public_key));
    let Some(device) = matches.next() else {
        return Ok(None);
    };
    // Never revive a revoked identity, approve another key, or interpolate an unchecked ID.
    if matches.next().is_some()
        || !device.enabled
        || !matches!(device.approval.as_str(), "pending" | "approved")
        || device.id.is_empty()
        || device.id.len() > 160
        || !device
            .id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    {
        return Err("projection_pairing_required".to_owned());
    }
    Ok(Some(device))
}

pub(super) async fn register(
    base_url: &str,
    public_key: &str,
    manifest: Option<&LoomManifest>,
) -> Result<Option<String>, String> {
    let Some(token) = manifest.and_then(|manifest| local_token(base_url, manifest)) else {
        return Ok(None);
    };
    // Approval changes the device epoch. Serialize enrollment so concurrent inbox/create
    // requests cannot approve twice and revoke the session they just established.
    static ENROLL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = ENROLL.lock().await;
    let base = base_url.trim_end_matches('/');
    let client = surface_client(base)?;
    let registry = registry_response(
        client
            .get(format!("{base}/v1/devices"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|_| "projection_transport_failed")?,
    )
    .await?;
    let response = match own_device(registry, public_key)? {
        Some(device) if device.approval == "approved" => return Ok(Some(device.id)),
        Some(device) => {
            client
                .post(format!("{base}/v1/devices/{}/approve", device.id))
                .bearer_auth(token)
                .json(&serde_json::json!({}))
                .send()
                .await
        }
        None => {
            client
                .post(format!("{base}/v1/devices"))
                .bearer_auth(token)
                .json(&serde_json::json!({
                    "name": "Hook", "kind": "computer", "address": "hook://local",
                    "publicKey": public_key,
                }))
                .send()
                .await
        }
    }
    .map_err(|_| "projection_transport_failed")?;
    let device = own_device(registry_response(response).await?, public_key)?
        .filter(|device| device.approval == "approved")
        .ok_or("projection_pairing_required")?;
    Ok(Some(device.id))
}

#[cfg(test)]
mod tests;
