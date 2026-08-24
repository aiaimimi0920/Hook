// Owns blocking Loom Art websocket requests, cancellation, control, and execution forwarding.
pub(crate) fn release_hook_art_resources(
    node_id: &str,
    execution_request_id: &str,
    generation: u64,
    handles: &[String],
) {
    if handles.is_empty() {
        return;
    }
    use tungstenite::{connect, Message as WsMessage};
    let (release_request_id, request) =
        hook_art_resource_release_request(node_id, execution_request_id, generation, handles);
    let Ok((mut socket, _)) = connect(loom_hook_ws_url().as_str()) else {
        return;
    };
    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
        let _ = tcp.set_read_timeout(Some(Duration::from_secs(5)));
    }
    if socket
        .send(WsMessage::Text(request.to_string().into()))
        .is_err()
    {
        return;
    }
    loop {
        match socket.read() {
            Ok(WsMessage::Text(text)) => {
                if text.len() > MAX_LOOM_CONTROL_WS_MESSAGE_BYTES {
                    break;
                }
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                if hook_art_cancel_response(&json, &release_request_id).is_some() {
                    break;
                }
            }
            Ok(WsMessage::Close(_)) | Err(_) => break,
            _ => {}
        }
    }
    let _ = socket.close(None);
}

fn forward_hook_art_cancel(node_id: &str, request_id: &str, generation: u64) {
    use tungstenite::{connect, Message as WsMessage};
    let request = serde_json::json!({
        "method": "loom.hook.art.cancel",
        "params": {
            "protocolVersion": "loom.hook.v1",
            "requestId": request_id,
            "nodeId": node_id,
            "generation": generation,
            "deviceId": "device:local"
        }
    });
    let ws_url = loom_hook_ws_url();
    let Ok((mut socket, _)) = connect(ws_url.as_str()) else {
        crate::append_runtime_log_line(&format!(
            "hook_art_cancel_connect_failed :: request_id={request_id} node_id={node_id}"
        ));
        return;
    };
    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
        let _ = tcp.set_read_timeout(Some(Duration::from_secs(5)));
    }
    if socket
        .send(WsMessage::Text(request.to_string().into()))
        .is_err()
    {
        crate::append_runtime_log_line(&format!(
            "hook_art_cancel_send_failed :: request_id={request_id} node_id={node_id}"
        ));
        return;
    }
    loop {
        match socket.read() {
            Ok(WsMessage::Text(text)) => {
                if text.len() > MAX_LOOM_CONTROL_WS_MESSAGE_BYTES {
                    crate::append_runtime_log_line(&format!(
                        "hook_art_cancel_response_too_large :: request_id={request_id}"
                    ));
                    break;
                }
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                let Some(response) = hook_art_cancel_response(&json, request_id) else {
                    continue;
                };
                if response["status"].as_str() == Some("failed")
                    && response["error"]["code"].as_str() != Some("request_not_found")
                {
                    let code = sanitize_untrusted_message(
                        response["error"]["code"].as_str().unwrap_or("unknown"),
                        "unknown",
                    );
                    let message = sanitize_untrusted_message(
                        response["error"]["message"].as_str().unwrap_or("unknown"),
                        "unknown",
                    );
                    crate::append_runtime_log_line(&format!(
                        "hook_art_cancel_failed :: request_id={request_id} code={} message={}",
                        code, message
                    ));
                }
                break;
            }
            Ok(WsMessage::Close(_)) => break,
            Err(_) => {
                crate::append_runtime_log_line(&format!(
                    "hook_art_cancel_read_failed :: request_id={request_id}"
                ));
                break;
            }
            _ => {}
        }
    }
    let _ = socket.close(None);
}

fn send_hook_control_request(
    app: &AppHandle,
    message: serde_json::Value,
    timeout: Duration,
    error_event: &str,
) {
    use tungstenite::{connect, Message as WsMessage};
    let ws_url = loom_hook_ws_url();
    match connect(ws_url.as_str()) {
        Ok((mut socket, _)) => {
            if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
                let _ = tcp.set_read_timeout(Some(timeout));
            }
            if socket
                .send(WsMessage::Text(message.to_string().into()))
                .is_err()
            {
                let _ = app.emit(
                    error_event,
                    serde_json::json!({ "error": "Loom control request could not be sent" }),
                );
                return;
            }
            match socket.read() {
                Ok(WsMessage::Text(text)) => {
                    if text.len() > MAX_LOOM_CONTROL_WS_MESSAGE_BYTES {
                        let _ = app.emit(
                            error_event,
                            serde_json::json!({ "error": "Loom control response exceeds the size limit" }),
                        );
                        return;
                    }
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                        if json["status"].as_str() == Some("failed") {
                            let code = sanitize_untrusted_message(
                                json["error"]["code"].as_str().unwrap_or("remote_failure"),
                                "remote_failure",
                            );
                            let message = sanitize_untrusted_message(
                                json["error"]["message"]
                                    .as_str()
                                    .unwrap_or("Loom control request failed"),
                                "Loom control request failed",
                            );
                            let _ = app.emit(
                                error_event,
                                serde_json::json!({ "error": message, "code": code }),
                            );
                        }
                    }
                }
                Err(_) => {
                    crate::append_runtime_log_line("hook_control_request_read_failed");
                }
                _ => {}
            }
            let _ = socket.close(None);
        }
        Err(_) => {
            let _ = app.emit(
                error_event,
                serde_json::json!({ "error": "Loom control connection failed" }),
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn forward_hook_art_execute(
    app_handle: &AppHandle,
    node_id: &str,
    art_id: &str,
    request_id: &str,
    generation: u64,
    input_sources: &HashMap<String, String>,
    params: &HashMap<String, serde_json::Value>,
    disabled_parameters: &[String],
    prefer_shared_memory: bool,
) {
    if let Err(error) = validate_hook_art_input_sources(input_sources) {
        emit_formal_hook_failure(app_handle, node_id, request_id, &error);
        return;
    }
    let mut inputs = serde_json::Map::new();
    let mut input_guards = Vec::new();
    let mut total_rgba_bytes = 0_usize;
    for (name, source) in input_sources {
        let Some(image) = load_input_rgba_image(Some(source)) else {
            emit_formal_hook_failure(
                app_handle,
                node_id,
                request_id,
                &format!("image input `{name}` could not be decoded"),
            );
            return;
        };
        let Ok(rgba_bytes) = checked_hook_rgba_len(image.width(), image.height()) else {
            emit_formal_hook_failure(
                app_handle,
                node_id,
                request_id,
                &format!("image input `{name}` exceeds the Hook image budget"),
            );
            return;
        };
        let Some(next_total) = total_rgba_bytes.checked_add(rgba_bytes) else {
            emit_formal_hook_failure(app_handle, node_id, request_id, "Art input size overflow");
            return;
        };
        if next_total > MAX_HOOK_ART_INPUT_TOTAL_RGBA_BYTES {
            emit_formal_hook_failure(
                app_handle,
                node_id,
                request_id,
                "Art inputs exceed the Hook resident-memory budget",
            );
            return;
        }
        total_rgba_bytes = next_total;
        match formal_hook_input_value(&image, prefer_shared_memory) {
            Ok((value, guard)) => {
                inputs.insert(name.clone(), value);
                if let Some(guard) = guard {
                    input_guards.push(guard);
                }
            }
            Err(error) => {
                emit_formal_hook_failure(app_handle, node_id, request_id, &error);
                return;
            }
        }
    }
    let request = serde_json::json!({
        "method": "loom.hook.art.execute",
        "params": {
            "protocolVersion": "loom.hook.v1",
            "requestId": request_id,
            "nodeId": node_id,
            "artId": art_id,
            "generation": generation,
            "deviceId": "device:local",
            "outputTransports": ["shared_memory", "websocket"],
            "inputs": inputs,
            "parameters": params,
            "disabledParameters": disabled_parameters
        }
    });
    use tungstenite::{connect, Message as WsMessage};
    let ws_url = loom_hook_ws_url();
    let Ok((mut socket, _)) = connect(ws_url.as_str()) else {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            "Loom Hook protocol connection failed",
        );
        return;
    };
    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
        if let Err(error) = tcp.set_read_timeout(Some(Duration::from_secs(150))) {
            emit_formal_hook_failure(app_handle, node_id, request_id, &error.to_string());
            return;
        }
    }
    if socket
        .send(WsMessage::Text(request.to_string().into()))
        .is_err()
    {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            "Loom Hook protocol send failed",
        );
        return;
    }
    let _guards = input_guards;
    loop {
        match socket.read() {
            Ok(WsMessage::Text(text)) => {
                if text.len() > MAX_LOOM_ART_WS_MESSAGE_BYTES {
                    emit_formal_hook_failure(
                        app_handle,
                        node_id,
                        request_id,
                        "Loom Art response exceeds the size limit",
                    );
                    return;
                }
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                if json["protocolVersion"].as_str() != Some("loom.hook.v1") {
                    continue;
                }
                if json["requestId"].as_str() != Some(request_id)
                    && json["params"]["requestId"].as_str() != Some(request_id)
                {
                    continue;
                }
                if let Some(method) = json["method"].as_str() {
                    let params = &json["params"];
                    match method {
                        "loom.hook.art.progress" => {
                            let _ = app_handle.emit(
                                "art/progress",
                                serde_json::json!({
                                    "art_id": node_id,
                                    "request_id": request_id,
                                    "value": params["value"].as_f64().unwrap_or(0.0)
                                }),
                            );
                        }
                        "loom.hook.art.preview" => {
                            let Ok(preview_revision) = formal_hook_commit_revision(
                                params,
                                node_id,
                                request_id,
                                generation,
                                "previewRevision",
                            ) else {
                                continue;
                            };
                            if !emit_formal_hook_port_value(
                                app_handle,
                                node_id,
                                request_id,
                                generation,
                                preview_revision,
                                "preview",
                                &params["value"],
                                None,
                            ) {
                                emit_formal_hook_failure(
                                    app_handle,
                                    node_id,
                                    request_id,
                                    formal_hook_port_delivery(&params["value"])
                                        .err()
                                        .unwrap_or_else(|| {
                                            "unsupported formal preview value".to_owned()
                                        })
                                        .as_str(),
                                );
                            }
                        }
                        "loom.hook.art.result" => {
                            let Ok(result_revision) = formal_hook_commit_revision(
                                params,
                                node_id,
                                request_id,
                                generation,
                                "resultRevision",
                            ) else {
                                emit_formal_hook_failure(
                                    app_handle,
                                    node_id,
                                    request_id,
                                    "Loom Hook returned an invalid Art result commit",
                                );
                                return;
                            };
                            emit_formal_hook_outputs(
                                app_handle,
                                node_id,
                                request_id,
                                generation,
                                result_revision,
                                "final",
                                &params["outputs"],
                                params.get("candidates"),
                            );
                            return;
                        }
                        "loom.hook.art.failure" => {
                            emit_formal_hook_failure(
                                app_handle,
                                node_id,
                                request_id,
                                params["error"]["message"]
                                    .as_str()
                                    .unwrap_or("Art execution failed"),
                            );
                            return;
                        }
                        _ => {}
                    }
                    continue;
                }
                match json["status"].as_str() {
                    Some("failed") | Some("cancelled") => {
                        emit_formal_hook_failure(
                            app_handle,
                            node_id,
                            request_id,
                            json["error"]["message"]
                                .as_str()
                                .unwrap_or("Art execution failed"),
                        );
                        return;
                    }
                    Some("succeeded") => {
                        let Ok(result_revision) = formal_hook_commit_revision(
                            &json["data"],
                            node_id,
                            request_id,
                            generation,
                            "resultRevision",
                        ) else {
                            emit_formal_hook_failure(
                                app_handle,
                                node_id,
                                request_id,
                                "Loom Hook returned an invalid Art result commit",
                            );
                            return;
                        };
                        emit_formal_hook_outputs(
                            app_handle,
                            node_id,
                            request_id,
                            generation,
                            result_revision,
                            "final",
                            &json["data"]["outputs"],
                            json["data"].get("candidates"),
                        );
                        return;
                    }
                    _ => {}
                }
            }
            Ok(WsMessage::Close(_)) | Err(_) => {
                emit_formal_hook_failure(
                    app_handle,
                    node_id,
                    request_id,
                    "Loom Hook protocol closed before final result",
                );
                return;
            }
            _ => {}
        }
    }
}
