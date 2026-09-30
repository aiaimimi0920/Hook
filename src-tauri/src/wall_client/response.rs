//! Bound error bodies and expose only fixed protocol codes, never server messages or secrets.
use super::WallClientError;
use serde_json::Value;

fn public_code(bytes: &[u8]) -> &'static str {
    let value = serde_json::from_slice::<Value>(bytes).unwrap_or(Value::Null);
    match value.pointer("/error/code").and_then(Value::as_str) {
        Some("surface_runtime_incompatible") => "surface_runtime_incompatible",
        Some("surface_host_capability_missing") => "surface_host_capability_missing",
        Some("surface_art_package_unavailable") => "surface_art_package_unavailable",
        Some("surface_manifest_missing") => "surface_manifest_missing",
        Some("surface_conflict") => "surface_conflict",
        Some("surface_not_found") => "surface_not_found",
        Some("wall_surface_runtime_unsupported") => "wall_surface_runtime_unsupported",
        Some("wall_surface_input_unavailable") => "wall_surface_input_unavailable",
        Some("wall_surface_unavailable") => "wall_surface_unavailable",
        Some("wall_surface_capacity") => "wall_surface_capacity",
        Some("wall_surface_size_limit") => "wall_surface_size_limit",
        Some("wall_surface_forbidden") => "wall_surface_forbidden",
        Some("wall_surface_detached") => "wall_surface_detached",
        Some("wall_surface_closing") => "wall_surface_closing",
        Some("wall_surface_event_stale") => "wall_surface_event_stale",
        Some("wall_surface_resource_forbidden") => "wall_surface_resource_forbidden",
        Some("wall_control_conflict") => "wall_control_conflict",
        Some("wall_control_invalid") => "wall_control_invalid",
        Some("wall_input_sequence_invalid") => "wall_input_sequence_invalid",
        Some("wall_live_source_unavailable") => "wall_live_source_unavailable",
        Some("wall_scene_not_active") => "wall_scene_not_active",
        Some("wall_scene_unsupported") => "wall_scene_unsupported",
        Some("wall_presentation_paused") => "wall_presentation_paused",
        Some("wall_endpoint_identifying") => "wall_endpoint_identifying",
        _ => "wall_request_rejected",
    }
}

pub(super) async fn read(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Value, WallClientError> {
    let status = response.status().as_u16();
    let success = (200..300).contains(&status);
    let limit = if success { limit } else { 8192 };
    let too_large = || {
        WallClientError::new(
            if success {
                "wall_response_too_large"
            } else {
                "wall_request_rejected"
            },
            Some(status),
        )
    };
    if response
        .content_length()
        .is_some_and(|size| size > limit as u64)
    {
        return Err(too_large());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        WallClientError::new(
            if success {
                "wall_response_incomplete"
            } else {
                "wall_request_rejected"
            },
            Some(status),
        )
    })? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(too_large());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !success {
        return Err(WallClientError::new(public_code(&bytes), Some(status)));
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| WallClientError::new("wall_response_invalid", Some(status)))
}
