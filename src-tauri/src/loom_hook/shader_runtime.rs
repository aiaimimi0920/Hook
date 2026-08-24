// Owns Loom shader Art execution, formal result decoding, and Tauri prefetch commands.
fn try_prefetch_shader_via_loom(
    art_id: &str,
    input_path: Option<&str>,
    reference_path: Option<&str>,
) -> Result<serde_json::Value, String> {
    use tungstenite::{connect, Message as WsMessage};

    let request_id = format!("shader-prefetch:{}", Uuid::new_v4());
    let node_id = format!("shader-prefetch:{art_id}");
    let body = serde_json::json!({
        "method": "loom.hook.art.execute",
        "params": {
            "protocolVersion": "loom.hook.v1",
            "requestId": request_id,
            "nodeId": node_id,
            "artId": art_id,
            "generation": 1,
            "deviceId": "device:local",
            "outputTransports": ["websocket"],
            "inputs": {},
            "parameters": {
            "output_mode": "shader",
            "mode": "shader",
            "input_path": input_path.unwrap_or(""),
            "reference_path": reference_path.unwrap_or(""),
            },
            "disabledParameters": []
        }
    });
    let ws_url = loom_hook_ws_url();
    let (mut socket, _) = connect(ws_url.as_str())
        .map_err(|_| "Loom Hook protocol is unavailable".to_owned())?;
    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
        let _ = tcp.set_read_timeout(Some(Duration::from_secs(20)));
    }
    socket
        .send(WsMessage::Text(body.to_string().into()))
        .map_err(|error| format!("Failed to send shader execution request: {error}"))?;

    loop {
        let message = socket
            .read()
            .map_err(|error| format!("Failed to read shader execution result: {error}"))?;
        let WsMessage::Text(text) = message else {
            continue;
        };
        if text.len() > MAX_LOOM_SHADER_WS_MESSAGE_BYTES {
            return Err("Loom shader response exceeds the size limit".to_owned());
        }
        let response: serde_json::Value = serde_json::from_str(&text)
            .map_err(|error| format!("Failed to parse shader execution result: {error}"))?;
        if response["protocolVersion"].as_str() != Some("loom.hook.v1") {
            continue;
        }
        let response_request_id = response["requestId"]
            .as_str()
            .or_else(|| response["params"]["requestId"].as_str());
        if response_request_id != Some(request_id.as_str()) {
            continue;
        }
        if response["method"].as_str() == Some("loom.hook.art.failure")
            || matches!(response["status"].as_str(), Some("failed" | "cancelled"))
        {
            let message = response["params"]["error"]["message"]
                .as_str()
                .or_else(|| response["error"]["message"].as_str())
                .unwrap_or("Loom shader execution failed");
            return Err(sanitize_untrusted_message(
                message,
                "Loom shader execution failed",
            ));
        }
        let outputs = if response["method"].as_str() == Some("loom.hook.art.result") {
            &response["params"]["outputs"]
        } else if response["status"].as_str() == Some("succeeded") {
            &response["data"]["outputs"]
        } else {
            continue;
        };
        let Some(map) = outputs.as_object() else {
            return Err("Loom shader execution returned no output".to_owned());
        };
        let value = preferred_formal_output(map)
            .map(|(_, value)| value)
            .ok_or_else(|| "Loom shader execution returned no output".to_owned())?;
        if value["kind"].as_str() != Some("value") {
            return Err("Loom shader execution returned a non-value output".to_owned());
        }
        return unwrap_formal_shader_output(value["value"].clone());
    }
}

fn unwrap_formal_shader_output(value: serde_json::Value) -> Result<serde_json::Value, String> {
    if value.get("type").and_then(serde_json::Value::as_str) == Some("shader") {
        return Ok(value);
    }
    let text = value
        .get("content")
        .and_then(serde_json::Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("text"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Loom Art did not return a shader payload".to_owned())?;
    let parsed = serde_json::from_str::<serde_json::Value>(text)
        .map_err(|error| format!("Loom Art returned invalid shader JSON: {error}"))?;
    if parsed.get("type").and_then(serde_json::Value::as_str) != Some("shader") {
        return Err("Loom Art returned JSON that is not a shader payload".to_owned());
    }
    Ok(parsed)
}

/// Prefetch shader code from the installed Loom Art package.
#[tauri::command]
pub async fn prefetch_shader(
    art_id: String,
    input_path: Option<String>,
    reference_path: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        prefetch_shader_blocking(art_id, input_path, reference_path)
    })
    .await
    .map_err(|e| format!("Shader prefetch task failed: {}", e))?
}

fn prefetch_shader_blocking(
    art_id: String,
    input_path: Option<String>,
    reference_path: Option<String>,
) -> Result<serde_json::Value, String> {
    console_line!("[LoomHook] Prefetching shader for Art: {}", art_id);

    let resolved_input_path = materialize_shader_image_input(input_path.as_ref(), "input");
    let resolved_reference_path =
        materialize_shader_image_input(reference_path.as_ref(), "reference");

    console_line!(
        "[LoomHook] Resolved shader inputs: input={}, reference={}",
        if resolved_input_path.is_some() { "present" } else { "none" },
        if resolved_reference_path.is_some() { "present" } else { "none" }
    );

    let result = try_prefetch_shader_via_loom(
        &art_id,
        resolved_input_path.as_deref(),
        resolved_reference_path.as_deref(),
    )?;
    console_line!("[LoomHook] Loom shader prefetch succeeded.");
    Ok(result)
}
