// Owns formal Art input/output delivery validation and revision identity.
fn formal_hook_input_value(
    image: &RgbaImage,
    prefer_shared_memory: bool,
) -> Result<(serde_json::Value, Option<SafeShmem>), String> {
    let prepared = prepare_hook_input(image, prefer_shared_memory)?;
    Ok((prepared.descriptor, prepared.shmem_guard))
}

fn formal_hook_port_delivery(value: &serde_json::Value) -> Result<serde_json::Value, String> {
    let kind = value["kind"]
        .as_str()
        .ok_or_else(|| "formal value is missing kind".to_owned())?;
    match kind {
        "shared_memory" => {
            let handle = value["handle"]
                .as_str()
                .filter(|handle| handle.starts_with("Loom_Buffer_") && handle.len() > 12)
                .ok_or_else(|| "shared-memory formal value is missing handle".to_owned())?;
            let size = value["size"]
                .as_u64()
                .filter(|size| *size > 0)
                .ok_or_else(|| "shared-memory formal value has invalid size".to_owned())?;
            let width = value["width"]
                .as_u64()
                .filter(|width| *width > 0)
                .ok_or_else(|| "shared-memory formal value has invalid width".to_owned())?;
            let height = value["height"]
                .as_u64()
                .filter(|height| *height > 0)
                .ok_or_else(|| "shared-memory formal value has invalid height".to_owned())?;
            if value["format"].as_str() != Some("rgba8") {
                return Err("shared-memory formal value must use rgba8".to_owned());
            }
            let width_u32 = u32::try_from(width)
                .map_err(|_| "shared-memory formal value width is too large".to_owned())?;
            let height_u32 = u32::try_from(height)
                .map_err(|_| "shared-memory formal value height is too large".to_owned())?;
            let expected_size = checked_hook_rgba_len(width_u32, height_u32)? as u64;
            if size != expected_size {
                return Err(
                    "shared-memory formal value size does not match its dimensions".to_owned(),
                );
            }
            Ok(serde_json::json!({
                "type": "shared_memory",
                "handle": handle,
                "size": size,
                "width": width,
                "height": height,
                "format": "rgba8"
            }))
        }
        "inline_resource" => {
            let mime = value["mime"]
                .as_str()
                .filter(|mime| {
                    matches!(
                        *mime,
                        "image/png"
                            | "image/jpeg"
                            | "image/webp"
                            | "image/gif"
                            | "image/bmp"
                    )
                })
                .ok_or_else(|| "inline formal value has an unsupported image MIME type".to_owned())?;
            let data = value["dataBase64"]
                .as_str()
                .filter(|data| !data.is_empty() && !data.starts_with("data:"))
                .ok_or_else(|| {
                    "inline formal value must contain non-empty bare dataBase64".to_owned()
                })?;
            validate_hook_base64_len(data)?;
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|error| format!("inline formal value has invalid dataBase64: {error}"))?;
            if decoded.len() > MAX_HOOK_ENCODED_IMAGE_BYTES {
                return Err("inline formal value exceeds the Hook transfer budget".to_owned());
            }
            Ok(serde_json::json!({
                "type": "base64",
                "data": format!("data:{mime};base64,{data}"),
                "width": value["width"].clone(),
                "height": value["height"].clone()
            }))
        }
        "value" => {
            let formal_value = value
                .get("value")
                .ok_or_else(|| "value formal value is missing value".to_owned())?;
            Ok(serde_json::json!({
                "type": "value",
                "value": formal_value
            }))
        }
        "resource" => {
            Err("broker resource outputs are not supported on the native Hook Art path".to_owned())
        }
        other => Err(format!("unsupported formal value kind `{other}`")),
    }
}

fn formal_hook_commit_revision(
    value: &serde_json::Value,
    node_id: &str,
    request_id: &str,
    generation: u64,
    revision_field: &str,
) -> Result<u64, String> {
    if value["protocolVersion"].as_str() != Some("loom.hook.v1")
        || value["requestId"].as_str() != Some(request_id)
        || value["nodeId"].as_str() != Some(node_id)
        || value["generation"].as_u64() != Some(generation)
    {
        return Err("Loom Hook Art commit identity does not match the active request".to_owned());
    }
    value[revision_field]
        .as_u64()
        .filter(|revision| *revision > 0)
        .ok_or_else(|| format!("Loom Hook Art commit has invalid {revision_field}"))
}

fn emit_formal_hook_port_value(
    app_handle: &AppHandle,
    node_id: &str,
    request_id: &str,
    generation: u64,
    revision: u64,
    phase: &str,
    value: &serde_json::Value,
    candidates: Option<&serde_json::Value>,
) -> bool {
    let Ok(delivery) = formal_hook_port_delivery(value) else {
        return false;
    };
    let mut payload = serde_json::json!({
        "art_id": node_id,
        "request_id": request_id,
        "generation": generation,
        "phase": phase,
        "status": 200,
        "delivery": delivery
    });
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            if phase == "preview" {
                "preview_revision".to_owned()
            } else {
                "result_revision".to_owned()
            },
            serde_json::json!(revision),
        );
    }
    if let Some(candidates) = candidates {
        if let Some(delivery) = payload
            .get_mut("delivery")
            .and_then(serde_json::Value::as_object_mut)
        {
            delivery.insert("candidates".to_owned(), candidates.clone());
        }
    }
    app_handle.emit("art/ready", payload).is_ok()
}

fn emit_formal_hook_failure(
    app_handle: &AppHandle,
    node_id: &str,
    request_id: &str,
    message: &str,
) {
    emit_art_error(app_handle, node_id, request_id, message);
}

fn hook_art_cancel_response<'a>(
    json: &'a serde_json::Value,
    request_id: &str,
) -> Option<&'a serde_json::Value> {
    (json["protocolVersion"].as_str() == Some("loom.hook.v1")
        && json["requestId"].as_str() == Some(request_id)
        && json["method"].is_null()
        && json["status"].as_str().is_some())
    .then_some(json)
}

fn hook_art_resource_release_request(
    node_id: &str,
    execution_request_id: &str,
    generation: u64,
    handles: &[String],
) -> (String, serde_json::Value) {
    let release_request_id = format!("release:{}", Uuid::new_v4());
    let request = serde_json::json!({
        "method": "loom.hook.art.resources.release",
        "params": {
            "protocolVersion": "loom.hook.v1",
            "requestId": release_request_id,
            "executionRequestId": execution_request_id,
            "nodeId": node_id,
            "generation": generation,
            "deviceId": "device:local",
            "handles": handles,
        }
    });
    (release_request_id, request)
}
