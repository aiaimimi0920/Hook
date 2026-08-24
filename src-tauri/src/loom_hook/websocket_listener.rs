// Owns the local websocket listener connection and reconnect loop.
fn start_listener(app: AppHandle, state: Arc<Mutex<LoomHookState>>) {
    thread::spawn(move || {
        console_line!("[LoomHook] Start Listener Thread...");
        loop {
            // Reconnection Loop
            use tungstenite::{connect, Message};
            let ws_url = loom_hook_ws_url();

            match connect(ws_url.as_str()) {
                Ok((mut socket, _)) => {
                    console_line!("[LoomHook] Listener connected to Loom.");
                    if let Err(error) =
                        socket.send(Message::Text(loom_hook_listener_subscription_message()))
                    {
                        console_error_line!("[LoomHook] Failed to subscribe listener: {error}");
                        emit_backend_connection_state(&app, &state, false);
                        thread::sleep(Duration::from_secs(2));
                        continue;
                    }
                    let settings_request_id = format!("settings:{}", Uuid::new_v4());
                    if let Err(error) = socket.send(Message::Text(
                        serde_json::json!({
                            "method": "loom.hook.settings.get",
                            "params": { "requestId": settings_request_id }
                        })
                        .to_string()
                        .into(),
                    )) {
                        console_error_line!("[LoomHook] Failed to request settings: {error}");
                        emit_backend_connection_state(&app, &state, false);
                        thread::sleep(Duration::from_secs(2));
                        continue;
                    }
                    emit_backend_connection_state(&app, &state, true);

                    // Main Read Loop
                    loop {
                        match socket.read() {
                            Ok(Message::Text(text)) => {
                                if text.len() > MAX_LOOM_JSON_RESPONSE_BYTES {
                                    console_error_line!(
                                        "[LoomHook] Listener message exceeded the size limit"
                                    );
                                    break;
                                }
                                // Parse formal Loom Hook events.
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                                    if let Some(method) = json["method"].as_str() {
                                        if method == "loom.hook.workflow.instantiated" {
                                            console_line!(
                                                "[LoomHook] Received Instantiate Command!"
                                            );
                                            let _ = app.emit("art/instantiate", &json["params"]);
                                        } else if method == "loom.hook.capabilities.updated" {
                                            console_line!(
                                                "[LoomHook] Received Arts Updated Notification!"
                                            );
                                            let _ = app
                                                .emit("art/capabilities_updated", &json["params"]);
                                        } else if method == "loom.hook.cache.control" {
                                            let mut params = json["params"].clone();
                                            let mut emitted = false;
                                            if params["action"].as_str() == Some("settings") {
                                                params["settings"] =
                                                    hook_cache_settings_event(&params["settings"]);
                                            } else if let Some(
                                                action @ ("clearRecycleBin"
                                                | "clearReferenceLibrary"),
                                            ) = params["action"].as_str()
                                            {
                                                let _ =
                                                    app.emit("hook/cache_control", params.clone());
                                                emitted = true;
                                                // Apply the in-memory clear before committing the
                                                // same change to the session file. A concurrent
                                                // workflow sync will then also observe empty data.
                                                thread::sleep(Duration::from_millis(120));
                                                if let Err(error) =
                                                    crate::clear_persisted_session_library(
                                                        &app, action,
                                                    )
                                                {
                                                    crate::append_runtime_log_line(&format!(
                                                        "hook_cache_control_persist_failed :: action={} error={}",
                                                        action, error
                                                    ));
                                                }
                                            }
                                            if !emitted {
                                                let _ = app.emit("hook/cache_control", params);
                                            }
                                        } else if method == "loom.hook.settings.updated" {
                                            if json["params"]["settings"].is_object() {
                                                apply_hook_settings(
                                                    &app,
                                                    &json["params"]["settings"],
                                                );
                                            }
                                        } else if method.starts_with("loom.surface.") {
                                            emit_surface_push(&app, method, &json["params"]);
                                        }
                                    } else if json["protocolVersion"].as_str()
                                        == Some("loom.hook.v1")
                                        && json["requestId"].as_str()
                                            == Some(settings_request_id.as_str())
                                    {
                                        if json["data"].is_object() {
                                            apply_hook_settings(&app, &json["data"]);
                                        }
                                        if json["data"]["hookCache"].is_object() {
                                            let _ = app.emit(
                                                "hook/cache_control",
                                                serde_json::json!({
                                                    "action": "settings",
                                                    "settings": hook_cache_settings_event(&json["data"]["hookCache"]),
                                                }),
                                            );
                                        }
                                    }
                                }
                            }
                            Ok(Message::Close(_)) => {
                                break;
                            }
                            Err(_) => {
                                break;
                            }
                            _ => {}
                        }
                    }
                    emit_backend_connection_state(&app, &state, false);
                    console_line!("[LoomHook] Listener disconnected. Retrying in 5s...");
                }
                Err(_) => {
                    emit_backend_connection_state(&app, &state, false);
                    console_line!("[LoomHook] Connection failed. Retrying...");
                }
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}
