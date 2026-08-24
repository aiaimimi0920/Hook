//! Device registration and identity association with a Loom endpoint.

use serde::Deserialize;
use tauri::AppHandle;

use super::identity::{persist_device_identity, DeviceIdentityDocument};
use super::session_attempt::{read_surface_response_body, surface_client};

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

pub(super) async fn register_device_pairing_request(
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
    let body = read_surface_response_body(response).await?;
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
    persist_device_identity(&app_data_dir.join("device-identity.json"), identity)
}
