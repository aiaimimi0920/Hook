//! Restricted tile control client. Credentials remain native and mutations are never retried.
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::device_session::DeviceSessionAuthorization;
mod image;
mod presentation;
mod response;
mod timing;
use presentation::WallPresentationReport;

#[cfg(test)]
mod tests;

const MAX_REQUEST_BYTES: usize = 512 * 1024;
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
const MAX_IMAGE_RESPONSE_BYTES: usize = 24 * 1024 * 1024;
static IMAGE_READ: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
static INPUT_REQUEST: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
static SURFACE_REQUEST: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WallIdentificationOutcome {
    Applied,
    Dismissed,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum WallOperation {
    State,
    SurfaceOpen {
        request: Value,
    },
    SurfaceState {
        request: Value,
    },
    SurfaceClose {
        request: Value,
    },
    SurfaceImage {
        request: Value,
    },
    SurfaceEvent {
        request: Value,
    },
    SurfaceConfirmation {
        request: Value,
    },
    SurfaceCancel {
        request: Value,
    },
    ControlAcquire {
        request: Value,
    },
    ControlRenew {
        request: Value,
    },
    ControlRelease {
        request: Value,
    },
    Input {
        request: Value,
    },
    ReadImage {
        endpoint_id: String,
        lease_id: String,
        revision: u64,
        resource_id: String,
    },
    Register {
        base_revision: u64,
        endpoint: Value,
    },
    Remove {
        base_revision: u64,
        endpoint_id: String,
    },
    Connect {
        endpoint_id: String,
    },
    Heartbeat {
        endpoint_id: String,
        lease_id: String,
        sequence: u64,
        applied_revision: Option<u64>,
        presentation: Option<WallPresentationReport>,
        scene: Option<timing::WallSceneReport>,
    },
    Disconnect {
        endpoint_id: String,
        lease_id: String,
    },
    IdentifyReport {
        endpoint_id: String,
        lease_id: String,
        request_id: String,
        outcome: WallIdentificationOutcome,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WallClientError {
    code: &'static str,
    status: Option<u16>,
}

impl WallClientError {
    fn new(code: &'static str, status: Option<u16>) -> Self {
        Self { code, status }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WallClientResponse {
    device_id: String,
    body: Value,
}

impl WallOperation {
    fn is_surface(&self) -> bool {
        matches!(
            self,
            Self::SurfaceOpen { .. }
                | Self::SurfaceState { .. }
                | Self::SurfaceClose { .. }
                | Self::SurfaceImage { .. }
                | Self::SurfaceEvent { .. }
                | Self::SurfaceConfirmation { .. }
                | Self::SurfaceCancel { .. }
        )
    }

    fn is_input(&self) -> bool {
        matches!(
            self,
            Self::ControlAcquire { .. }
                | Self::ControlRenew { .. }
                | Self::ControlRelease { .. }
                | Self::Input { .. }
        )
    }

    fn request(self, device_id: &str) -> Result<(&'static str, Option<Value>), WallClientError> {
        Ok(match self {
            Self::State => ("/v1/walls/state", None),
            Self::SurfaceOpen { request } => ("/v1/walls/surfaces/open", Some(request)),
            Self::SurfaceState { request } => ("/v1/walls/surfaces/state", Some(request)),
            Self::SurfaceClose { request } => ("/v1/walls/surfaces/close", Some(request)),
            Self::SurfaceImage { request } => ("/v1/walls/surfaces/image", Some(request)),
            Self::SurfaceEvent { request } => ("/v1/walls/surfaces/event", Some(request)),
            Self::SurfaceConfirmation { request } => {
                ("/v1/walls/surfaces/confirmation", Some(request))
            }
            Self::SurfaceCancel { request } => ("/v1/walls/surfaces/cancel", Some(request)),
            Self::ControlAcquire { request } => ("/v1/walls/control/acquire", Some(request)),
            Self::ControlRenew { request } => ("/v1/walls/control/renew", Some(request)),
            Self::ControlRelease { request } => ("/v1/walls/control/release", Some(request)),
            Self::Input { request } => ("/v1/walls/input", Some(request)),
            Self::ReadImage {
                endpoint_id,
                lease_id,
                revision,
                resource_id,
            } => (
                "/v1/walls/images/read",
                Some(
                    json!({"endpointId": endpoint_id, "leaseId": lease_id, "revision": revision, "resourceId": resource_id}),
                ),
            ),
            Self::Register {
                base_revision,
                mut endpoint,
            } => {
                let object = endpoint
                    .as_object_mut()
                    .ok_or_else(|| WallClientError::new("wall_invalid_request", None))?;
                // The authenticated native identity wins over any untrusted JS field.
                object.insert("deviceId".into(), json!(device_id));
                (
                    "/v1/walls/endpoints/register",
                    Some(json!({"baseRevision":base_revision, "endpoint":endpoint})),
                )
            }
            Self::Remove {
                base_revision,
                endpoint_id,
            } => (
                "/v1/walls/endpoints/remove",
                Some(json!({"baseRevision":base_revision, "endpointId":endpoint_id})),
            ),
            Self::Connect { endpoint_id } => {
                ("/v1/walls/connect", Some(json!({"endpointId":endpoint_id})))
            }
            Self::Heartbeat {
                endpoint_id,
                lease_id,
                sequence,
                applied_revision,
                presentation,
                scene,
            } => {
                let mut body = json!({"endpointId":endpoint_id, "leaseId":lease_id, "sequence":sequence, "appliedRevision":applied_revision});
                if let Some(report) = presentation {
                    body["presentation"] = json!(report);
                }
                if let Some(report) = scene {
                    body["scene"] = json!(report);
                }
                ("/v1/walls/heartbeat", Some(body))
            }
            Self::Disconnect {
                endpoint_id,
                lease_id,
            } => (
                "/v1/walls/disconnect",
                Some(json!({"endpointId":endpoint_id, "leaseId":lease_id})),
            ),
            Self::IdentifyReport {
                endpoint_id,
                lease_id,
                request_id,
                outcome,
            } => (
                "/v1/walls/endpoints/identify/report",
                Some(
                    json!({"endpointId":endpoint_id, "leaseId":lease_id, "requestId":request_id, "outcome":outcome}),
                ),
            ),
        })
    }
}

#[tauri::command]
pub(crate) async fn wall_request(
    app: tauri::AppHandle,
    operation: WallOperation,
) -> Result<WallClientResponse, WallClientError> {
    let _surface_permit = if operation.is_surface() {
        Some(
            SURFACE_REQUEST
                .try_acquire()
                .map_err(|_| WallClientError::new("wall_surface_busy", None))?,
        )
    } else {
        None
    };
    let _input_permit = if operation.is_input() {
        Some(
            INPUT_REQUEST
                .try_acquire()
                .map_err(|_| WallClientError::new("wall_input_busy", None))?,
        )
    } else {
        None
    };
    let image_id = match &operation {
        WallOperation::ReadImage { resource_id, .. } => {
            if !image::validate_id(resource_id) {
                return Err(WallClientError::new("wall_image_invalid", None));
            }
            Some(resource_id.clone())
        }
        WallOperation::SurfaceImage { request } => {
            let id = request
                .get("resourceId")
                .and_then(Value::as_str)
                .filter(|id| image::validate_id(id))
                .ok_or_else(|| WallClientError::new("wall_image_invalid", None))?;
            Some(id.to_owned())
        }
        _ => None,
    };
    // One image download/decode per process; image work never queues behind itself.
    let _permit = if image_id.is_some() {
        Some(
            IMAGE_READ
                .try_acquire()
                .map_err(|_| WallClientError::new("wall_image_busy", None))?,
        )
    } else {
        None
    };
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|_| WallClientError::new("wall_loom_unavailable", None))?;
    let authorization = crate::device_session::authorize_tile_request(&app, &manifest)
        .await
        .map_err(|_| WallClientError::new("wall_pairing_required", None))?;
    let mut body = send(&manifest.transport.base_url, &authorization, operation).await?;
    if let Some(id) = image_id {
        body = tauri::async_runtime::spawn_blocking(move || {
            // Cancellation of the awaiting command must not admit a second decoder.
            let _permit = _permit;
            image::decode(body, &id)
        })
        .await
        .map_err(|_| WallClientError::new("wall_image_decode_failed", None))?
        .map_err(|code| WallClientError::new(code, None))?;
    }
    Ok(WallClientResponse {
        device_id: authorization.device_id,
        body,
    })
}

async fn send(
    base_url: &str,
    authorization: &DeviceSessionAuthorization,
    operation: WallOperation,
) -> Result<Value, WallClientError> {
    let is_image = matches!(
        &operation,
        WallOperation::ReadImage { .. } | WallOperation::SurfaceImage { .. }
    );
    let is_input = operation.is_input();
    let is_surface = operation.is_surface();
    let response_limit = if is_input {
        8192
    } else if is_image {
        MAX_IMAGE_RESPONSE_BYTES
    } else {
        MAX_RESPONSE_BYTES
    };
    crate::loom_connector::classify_loom_base_url(base_url)
        .map_err(|_| WallClientError::new("wall_invalid_origin", None))?;
    let (path, body) = operation.request(&authorization.device_id)?;
    let client = crate::network_proxy::shared_client_with(
        base_url,
        Some(Duration::from_secs(if is_input {
            2
        } else if is_image {
            8
        } else if is_surface {
            4
        } else {
            15
        })),
        "wall-control",
        |builder| builder.redirect(reqwest::redirect::Policy::none()),
    )
    .map_err(|_| WallClientError::new("wall_transport_unavailable", None))?;
    let url = format!("{}{path}", base_url.trim_end_matches('/'));
    let request = if let Some(body) = body {
        let bytes = serde_json::to_vec(&body)
            .map_err(|_| WallClientError::new("wall_invalid_request", None))?;
        if bytes.len() > if is_input { 4096 } else { MAX_REQUEST_BYTES } {
            return Err(WallClientError::new("wall_request_too_large", None));
        }
        client
            .post(url)
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(bytes)
    } else {
        client.get(url)
    };
    let response = authorization
        .apply(request)
        .send()
        .await
        .map_err(|_| WallClientError::new("wall_transport_failed", None))?;
    let status = response.status().as_u16();
    if status == 401 {
        crate::device_session::invalidate_surface_sessions(base_url);
    }
    response::read(response, response_limit).await
}
