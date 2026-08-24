// Owns listener subscription payloads, formal output selection, and Hook settings application.
fn loom_hook_listener_subscription_message() -> String {
    serde_json::json!({
        "method": "loom.hook.subscribe",
        "params": {
            "requestId": format!("subscribe:{}", Uuid::new_v4()),
            "events": [
                "loom.hook.workflow.instantiated",
                "loom.hook.capabilities.updated",
                "loom.hook.cache.control",
                "loom.hook.settings.updated",
                "loom.surface.snapshot",
                "loom.surface.patch",
                "loom.surface.generation",
                "loom.surface.action.ack",
                "loom.surface.confirmation.request",
                "loom.surface.action.progress",
                "loom.surface.preview",
                "loom.surface.result",
                "loom.surface.failure",
                "loom.surface.lifecycle",
                "loom.surface.dispose"
            ]
        }
    })
    .to_string()
}

fn preferred_formal_output<'a>(
    outputs: &'a serde_json::Map<String, serde_json::Value>,
) -> Option<(&'a str, &'a serde_json::Value)> {
    for name in ["output_image", "output", "image"] {
        if let Some(value) = outputs.get(name) {
            return Some((name, value));
        }
    }
    outputs
        .iter()
        .next()
        .map(|(name, value)| (name.as_str(), value))
}

fn formal_output_map_value(value: &serde_json::Value) -> Result<serde_json::Value, String> {
    match value["kind"].as_str() {
        Some("value") => value
            .get("value")
            .cloned()
            .ok_or_else(|| "value formal value is missing value".to_owned()),
        Some("inline_resource") => {
            let mime = value["mime"]
                .as_str()
                .filter(|mime| !mime.is_empty())
                .ok_or_else(|| "inline formal value is missing mime".to_owned())?;
            let data = value["dataBase64"]
                .as_str()
                .filter(|data| !data.is_empty() && !data.starts_with("data:"))
                .ok_or_else(|| {
                    "inline formal value must contain non-empty bare dataBase64".to_owned()
                })?;
            base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|error| format!("inline formal value has invalid dataBase64: {error}"))?;
            Ok(serde_json::Value::String(format!(
                "data:{mime};base64,{data}"
            )))
        }
        Some("shared_memory") => formal_hook_port_delivery(value),
        Some("resource") => {
            Err("broker resource outputs are not supported on the native Hook Art path".to_owned())
        }
        Some(other) => Err(format!("unsupported formal value kind `{other}`")),
        None => Err("formal value is missing kind".to_owned()),
    }
}

fn emit_formal_hook_outputs(
    app_handle: &AppHandle,
    node_id: &str,
    request_id: &str,
    generation: u64,
    result_revision: u64,
    phase: &str,
    outputs: &serde_json::Value,
    candidates: Option<&serde_json::Value>,
) {
    let Some(map) = outputs.as_object() else {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            "Art execution returned no output",
        );
        return;
    };
    if map.is_empty() {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            "Art execution returned no output",
        );
        return;
    }
    let mut decoded = serde_json::Map::new();
    for (name, value) in map {
        match formal_output_map_value(value) {
            Ok(decoded_value) => {
                decoded.insert(name.clone(), decoded_value);
            }
            Err(error) => {
                emit_formal_hook_failure(app_handle, node_id, request_id, &error);
                return;
            }
        }
    }
    let Some((_, primary_value)) = preferred_formal_output(map) else {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            "Art execution returned no output",
        );
        return;
    };
    let Ok(mut delivery) = formal_hook_port_delivery(primary_value) else {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            formal_hook_port_delivery(primary_value)
                .err()
                .unwrap_or_else(|| "unsupported formal value kind".to_owned())
                .as_str(),
        );
        return;
    };
    if let Some(object) = delivery.as_object_mut() {
        object.insert("outputs".to_owned(), serde_json::Value::Object(decoded));
        if let Some(candidates) = candidates {
            object.insert("candidates".to_owned(), candidates.clone());
        }
    }
    let _ = app_handle.emit(
        "art/ready",
        serde_json::json!({
            "art_id": node_id,
            "request_id": request_id,
            "generation": generation,
            "result_revision": result_revision,
            "phase": phase,
            "status": 200,
            "delivery": delivery
        }),
    );
}

fn hook_cache_settings_event(settings: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "recycleBinMaxEntries": settings.get("recycleBinMaxEntries").cloned().unwrap_or(serde_json::Value::Null),
        "recycleBinRetentionDays": settings.get("recycleBinRetentionDays").cloned().unwrap_or(serde_json::Value::Null),
        "tempCacheMaxBytes": settings.get("tempCacheMaxBytes").cloned().unwrap_or(serde_json::Value::Null),
        "tempCacheRetentionDays": settings.get("tempCacheRetentionDays").cloned().unwrap_or(serde_json::Value::Null),
    })
}

fn apply_hook_settings(app: &AppHandle, settings: &serde_json::Value) {
    if let Err(error) = crate::network_proxy::apply_loom_settings(settings) {
        crate::append_runtime_log_line(&format!("hook_proxy_settings_apply_failed :: {error}"));
    }
    crate::configure_runtime_log_level_from_loom(settings);
    match crate::apply_loom_shortcut_settings(app, settings) {
        Ok(()) => {
            let _ = app.emit(
                "hook/settings_updated",
                serde_json::json!({ "settings": settings }),
            );
        }
        Err(error) => {
            crate::append_runtime_log_line(&format!("hook_settings_apply_failed :: {error}"))
        }
    }
}

// Background Listener Function

