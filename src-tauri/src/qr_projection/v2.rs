//! Native client for Loom-owned account projection operations.
use super::{client, protocol, v2_protocol};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum ProjectionV2Operation {
    Context {},
    Create {
        unit_id: String,
        content_kind: String,
        snapshot: protocol::ProjectionSnapshot,
    },
    Inspect {
        envelope: v2_protocol::Envelope,
    },
    Accept {
        envelope: v2_protocol::Envelope,
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
        snapshot: protocol::ProjectionSnapshot,
    },
    Read {
        projection_id: String,
        known_revision: u64,
    },
    Unlink {
        projection_id: String,
    },
    Code {
        envelope: v2_protocol::Envelope,
    },
}

#[tauri::command]
pub(crate) async fn projection_v2_request(
    app: tauri::AppHandle,
    operation: ProjectionV2Operation,
) -> Result<Value, String> {
    validate_operation(&operation)?;
    let body = serde_json::to_value(&operation).map_err(|_| "projection_invalid_request")?;
    if let ProjectionV2Operation::Code { envelope } = &operation {
        return Ok(
            serde_json::json!({"qrDataUrl":qr_data_url(&serde_json::to_value(envelope).map_err(|_| "projection_invalid_invitation")?)?}),
        );
    }
    // A QR origin is never a network destination for Hook v2. Only the local Loom is contacted.
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|_| "projection_loom_unavailable")?;
    let origin = protocol::normalize_origin(&manifest.transport.base_url)?;
    let url = reqwest::Url::parse(&origin).map_err(|_| "projection_invalid_origin")?;
    if !url.host_str().is_some_and(|host| {
        host == "localhost"
            || host == "[::1]"
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|ip| ip.is_loopback())
    }) {
        return Err("projection_local_loom_required".to_owned());
    }
    let authorization = crate::device_session::authorize_projection_request(&app, &origin)
        .await
        .map_err(|_| "projection_pairing_required")?;
    let path = format!(
        "/v1/projections/v2/{}",
        body["kind"].as_str().ok_or("projection_invalid_request")?
    );
    let mut response = client::send(&origin, &authorization, &path, body.clone()).await?;
    if matches!(operation, ProjectionV2Operation::Context {}) {
        validate_context(&response)?;
    } else if matches!(operation, ProjectionV2Operation::Unlink { .. }) {
        if response["unlinked"] != true {
            return Err("projection_invalid_response".to_owned());
        }
    } else {
        v2_protocol::validate_response(&response, &body)?;
        if matches!(operation, ProjectionV2Operation::Create { .. }) {
            response["qrDataUrl"] = Value::String(qr_data_url(&response["envelope"])?);
        }
    }
    Ok(response)
}

fn validate_operation(operation: &ProjectionV2Operation) -> Result<(), String> {
    let valid_revision = |revision| (1..=protocol::MAX_REVISION).contains(&revision);
    let valid = match operation {
        ProjectionV2Operation::Context {} => true,
        ProjectionV2Operation::Create {
            unit_id,
            content_kind,
            snapshot,
        } => {
            protocol::validate_snapshot(snapshot)?;
            protocol::identifier(unit_id) && matches!(content_kind.as_str(), "sticker" | "art")
        }
        ProjectionV2Operation::Code { envelope } | ProjectionV2Operation::Inspect { envelope } => {
            envelope.validate()?;
            true
        }
        ProjectionV2Operation::Accept {
            envelope,
            expected_revision,
            expected_digest,
            receiver_unit_id,
            confirmed,
        } => {
            envelope.validate()?;
            *confirmed
                && protocol::identifier(receiver_unit_id)
                && valid_revision(*expected_revision)
                && expected_digest.len() == 64
                && expected_digest.bytes().all(|b| b.is_ascii_hexdigit())
        }
        ProjectionV2Operation::Update {
            projection_id,
            source_session_id,
            prior_revision,
            revision,
            snapshot,
        } => {
            protocol::validate_snapshot(snapshot)?;
            protocol::projection_id(projection_id)
                && protocol::identifier(source_session_id)
                && valid_revision(*prior_revision)
                && valid_revision(*revision)
                && *revision == prior_revision + 1
        }
        ProjectionV2Operation::Read {
            projection_id,
            known_revision,
        } => protocol::projection_id(projection_id) && valid_revision(*known_revision),
        ProjectionV2Operation::Unlink { projection_id } => protocol::projection_id(projection_id),
    };
    if valid {
        Ok(())
    } else {
        Err("projection_invalid_request".to_owned())
    }
}

fn validate_context(value: &Value) -> Result<(), String> {
    if value.get("status").and_then(Value::as_str) != Some("signed_in")
        || value.get("protocol").and_then(Value::as_str) != Some("neuro.loom-account.v1")
        || value.get("deviceId").and_then(Value::as_str).is_none()
        || value.get("accountId").and_then(Value::as_str).is_none()
        || value.get("policy").and_then(Value::as_object).is_none()
        || value["projectionProtocol"] != "neuro.qr-projection.v2"
        || !value["origin"]
            .as_str()
            .is_some_and(|origin| protocol::normalize_origin(origin).as_deref() == Ok(origin))
    {
        return Err("projection_invalid_response".to_owned());
    }
    Ok(())
}

fn qr_data_url(envelope: &Value) -> Result<String, String> {
    let bytes = serde_json::to_vec(envelope).map_err(|_| "projection_invalid_response")?;
    if bytes.len() > 4096 {
        return Err("projection_qr_capacity".to_owned());
    }
    let code = qrcode::QrCode::with_error_correction_level(bytes, qrcode::EcLevel::M)
        .map_err(|_| "projection_qr_capacity")?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(320, 320)
        .build();
    Ok(format!(
        "data:image/svg+xml;base64,{}",
        STANDARD.encode(svg)
    ))
}
