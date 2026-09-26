//! Fixed-route projection bridge. Pairing credentials and source signing keys stay native.
mod client;
mod delivery;
mod offline;
pub(crate) mod protocol;
pub(crate) mod v2;
mod v2_protocol;
mod v2_work;

use protocol::{
    ProjectionContent, ProjectionEnvelope, ProjectionSignature, ProjectionSnapshot,
    ProjectionSource,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum ProjectionOperation {
    Context,
    Targets,
    Inbox {
        policy: delivery::ReceivePolicy,
    },
    Receipt {
        projection_id: String,
        status: delivery::ReceiptStatus,
    },
    Create {
        unit_id: String,
        content_kind: String,
        snapshot: ProjectionSnapshot,
        target_device_id: Option<String>,
    },
    Inspect {
        envelope: ProjectionEnvelope,
    },
    Accept {
        envelope: ProjectionEnvelope,
        expected_revision: u64,
        expected_digest: String,
        receiver_unit_id: String,
        confirmed: bool,
    },
    Update {
        projection_id: String,
        source_session_id: String,
        prior_revision: u64,
        revision: u64,
        snapshot: ProjectionSnapshot,
    },
    Read {
        projection_id: String,
        known_revision: u64,
    },
    Unlink {
        projection_id: String,
    },
    Code {
        envelope: ProjectionEnvelope,
    },
}

#[tauri::command]
pub(crate) async fn projection_request(
    app: tauri::AppHandle,
    operation: ProjectionOperation,
    server_origin: Option<String>,
    offline_route: Option<offline::OfflineRoute>,
) -> Result<Value, String> {
    static REQUEST: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    let permit = REQUEST.try_acquire().map_err(|_| "projection_busy")?;
    if let ProjectionOperation::Code { envelope } = &operation {
        return Ok(json!({ "qrDataUrl": protocol::qr_data_url(envelope)? }));
    }
    let offline = offline_route.is_some();
    let origin = if offline {
        protocol::normalize_origin(
            server_origin
                .as_deref()
                .ok_or("projection_invalid_origin")?,
        )?
    } else {
        match &operation {
            ProjectionOperation::Inspect { envelope }
            | ProjectionOperation::Accept { envelope, .. } => {
                envelope.validate()?;
                envelope.server_origin.clone()
            }
            ProjectionOperation::Context | ProjectionOperation::Create { .. } => {
                let configured = server_origin.or_else(|| {
                    crate::loom_connector::read_default_loom_manifest()
                        .ok()
                        .map(|manifest| manifest.transport.base_url)
                });
                protocol::normalize_origin(
                    configured.as_deref().ok_or("projection_loom_unavailable")?,
                )?
            }
            _ => protocol::normalize_origin(
                server_origin
                    .as_deref()
                    .ok_or("projection_invalid_origin")?,
            )?,
        }
    };
    if matches!(operation, ProjectionOperation::Context) {
        return Ok(json!({ "serverOrigin": origin }));
    }
    let authorization = crate::device_session::authorize_projection_request(&app, &origin)
        .await
        .map_err(|_| "projection_pairing_required")?;
    let actor = authorization.device_id.clone();
    let request_origin = origin.clone();
    // Decoding is blocking work; its permit survives cancellation of the IPC future.
    let ((path, body, qr), permit) = tauri::async_runtime::spawn_blocking(move || {
        prepare(operation, &app, &actor, &request_origin).map(|request| (request, permit))
    })
    .await
    .map_err(|_| "projection_prepare_failed")??;
    let context = response::ResponseContext::new(path, &origin, &body).offline(offline);
    let mut body = body;
    let network_path = if let Some(route) = offline_route {
        offline::prepare(path, &mut body, route)?
    } else {
        path
    };
    let mut response = client::send(&origin, &authorization, network_path, body).await?;
    response = tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        response::validate(response, &context)
    })
    .await
    .map_err(|_| "projection_decode_failed")??;
    if let Some(qr) = qr.filter(|_| !offline) {
        response["qrDataUrl"] = json!(qr);
    }
    Ok(response)
}

fn prepare(
    operation: ProjectionOperation,
    app: &tauri::AppHandle,
    actor: &str,
    origin: &str,
) -> Result<(&'static str, Value, Option<String>), String> {
    Ok(match operation {
        ProjectionOperation::Create {
            unit_id,
            content_kind,
            snapshot,
            target_device_id,
        } => {
            if !protocol::identifier(&unit_id)
                || !matches!(content_kind.as_str(), "sticker" | "art")
            {
                return Err("projection_invalid_source".to_owned());
            }
            let digest = protocol::validate_snapshot(&snapshot)?;
            if target_device_id
                .as_deref()
                .is_some_and(|id| !protocol::identifier(id))
            {
                return Err("projection_invalid_target".to_owned());
            }
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "projection_clock_invalid")?
                .as_millis() as u64;
            let mut envelope = ProjectionEnvelope {
                protocol: protocol::PROTOCOL.to_owned(),
                projection_id: format!("projection:{}", uuid::Uuid::new_v4().simple()),
                server_origin: origin.to_owned(),
                source: ProjectionSource {
                    device_id: actor.to_owned(),
                    session_id: format!("session:{}", uuid::Uuid::new_v4().simple()),
                    unit_id,
                    revision: 1,
                },
                content: ProjectionContent {
                    kind: content_kind,
                    digest,
                },
                // Leave 30 seconds for a sender clock ahead of the shared Loom.
                expires_at_ms: now + 270_000,
                nonce: uuid::Uuid::new_v4().simple().to_string(),
                signature: ProjectionSignature {
                    algorithm: "ed25519".to_owned(),
                    key_id: actor.to_owned(),
                    value: "_".repeat(86),
                },
            };
            envelope.signature.value =
                crate::device_session::sign_projection_invitation(app, &envelope)?;
            let qr = protocol::qr_data_url(&envelope)?;
            let mut body = json!({ "envelope": envelope, "snapshot": snapshot });
            if let Some(target) = target_device_id {
                body["targetDeviceId"] = json!(target);
            }
            ("/v1/projections/create", body, Some(qr))
        }
        ProjectionOperation::Inspect { envelope } => {
            envelope.validate()?;
            (
                "/v1/projections/inspect",
                json!({ "envelope": envelope }),
                None,
            )
        }
        ProjectionOperation::Accept {
            envelope,
            expected_revision,
            expected_digest,
            receiver_unit_id,
            confirmed,
        } => {
            envelope.validate()?;
            if !confirmed || !protocol::identifier(&receiver_unit_id) {
                return Err("projection_confirmation_required".to_owned());
            }
            (
                "/v1/projections/accept",
                json!({ "envelope": envelope, "expectedRevision": expected_revision,
                "expectedDigest": expected_digest, "receiverUnitId": receiver_unit_id, "confirmed": true }),
                None,
            )
        }
        ProjectionOperation::Update {
            projection_id,
            source_session_id,
            prior_revision,
            revision,
            snapshot,
        } => {
            if !protocol::projection_id(&projection_id)
                || !protocol::identifier(&source_session_id)
                || revision != prior_revision.saturating_add(1)
                || revision > protocol::MAX_REVISION
            {
                return Err("projection_invalid_revision".to_owned());
            }
            let digest = protocol::validate_snapshot(&snapshot)?;
            (
                "/v1/projections/update",
                json!({ "projectionId": projection_id, "sourceSessionId": source_session_id,
                "priorRevision": prior_revision, "revision": revision, "digest": digest, "snapshot": snapshot }),
                None,
            )
        }
        ProjectionOperation::Read {
            projection_id,
            known_revision,
        } => {
            if !protocol::projection_id(&projection_id) || known_revision > protocol::MAX_REVISION {
                return Err("projection_invalid_request".to_owned());
            }
            (
                "/v1/projections/read",
                json!({ "projectionId": projection_id, "knownRevision": known_revision }),
                None,
            )
        }
        ProjectionOperation::Unlink { projection_id } => {
            if !protocol::projection_id(&projection_id) {
                return Err("projection_invalid_request".to_owned());
            }
            (
                "/v1/projections/unlink",
                json!({ "projectionId": projection_id }),
                None,
            )
        }
        ProjectionOperation::Targets => ("/v1/projections/targets", json!({}), None),
        ProjectionOperation::Inbox { policy } => {
            ("/v1/projections/inbox", json!({ "policy": policy }), None)
        }
        ProjectionOperation::Receipt {
            projection_id,
            status,
        } => {
            if !protocol::projection_id(&projection_id) {
                return Err("projection_invalid_request".to_owned());
            }
            (
                "/v1/projections/receipt",
                json!({ "projectionId": projection_id, "status": status }),
                None,
            )
        }
        ProjectionOperation::Code { .. } | ProjectionOperation::Context => {
            return Err("projection_invalid_request".to_owned())
        }
    })
}

mod response;
#[cfg(test)]
mod tests;
