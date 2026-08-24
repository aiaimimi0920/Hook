// Owns remote Surface polling, stream-envelope validation, and local Surface event emission.
/// Poll loop for a paired remote Loom Surface.
#[cfg(feature = "remote-surface")]
fn start_remote_surface_poll_listener(app: AppHandle, state: Arc<Mutex<LoomHookState>>) {
    thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                crate::append_runtime_log_line(&format!(
                    "surface_remote_poll_runtime_failed :: error={error}"
                ));
                return;
            }
        };
        runtime.block_on(async move {
            let mut cursor = 0_u64;
            loop {
                let result = poll_remote_surface_once(&app, cursor).await;
                match result {
                    Ok((next, reset, messages)) => {
                        let poll_delay = remote_surface_poll_delay(cursor, next);
                        emit_backend_connection_state(&app, &state, true);
                        if reset {
                            let _ =
                                app.emit("surface/reset", serde_json::json!({ "cursor": next }));
                        }
                        for message in messages {
                            if let Some(method) =
                                message.get("method").and_then(serde_json::Value::as_str)
                            {
                                emit_surface_push(&app, method, &message["params"]);
                            }
                        }
                        cursor = next;
                        if let Some(delay) = poll_delay {
                            tokio::time::sleep(delay).await;
                        }
                    }
                    Err(error) => {
                        emit_backend_connection_state(&app, &state, false);
                        crate::append_runtime_log_line(&format!(
                            "surface_remote_poll_failed :: error={}",
                            sanitize_untrusted_message(&error, "Surface poll failed")
                        ));
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                }
            }
        });
    });
}

#[cfg(feature = "remote-surface")]
async fn poll_remote_surface_once(
    app: &AppHandle,
    cursor: u64,
) -> Result<(u64, bool, Vec<serde_json::Value>), String> {
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface stream: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let authorization = crate::device_session::authorize_surface_request(app, &manifest).await?;
    let client = crate::network_proxy::shared_client(base, Some(Duration::from_secs(30)))
        .map_err(|error| format!("build Surface stream client: {error}"))?;
    let response = authorization
        .apply(client.get(format!(
            "{base}/v1/surfaces/stream?after={cursor}&timeoutMs=20000"
        )))
        .send()
        .await
        .map_err(|error| format!("poll Loom Surface stream: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        if status.as_u16() == 401 {
            crate::device_session::invalidate_surface_sessions(base);
        }
        return Err(format!("Loom Surface stream returned {status}"));
    }
    let body = read_bounded_loom_json_body(response, "Loom Surface stream response").await?;
    let response: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|error| format!("parse Loom Surface stream: {error}"))?;
    surface_stream_envelope(&response, cursor)
}

// 协议标识不符时按错误返回，而不是照旧消费 messages：拿到的可能是另一个版本的流语义，
// 也可能压根不是 Loom——base_url 指错时对方同样会回 200 加一段 JSON。缺字段一律算不符，
// 与 Hook 校验 `loom.hook.v1` 的写法一致；唯一的产出方无条件带上这个字段。
//
// 这一段在 `remote-surface` 关闭时只被测试调用：留着编译是有意的，协议判定的用例要在两种
// feature 组合下都跑，见 `docs/REMOTE_SURFACE_STAGED.md`。
#[cfg_attr(not(feature = "remote-surface"), allow(dead_code))]
fn surface_stream_envelope(
    response: &serde_json::Value,
    cursor: u64,
) -> Result<(u64, bool, Vec<serde_json::Value>), String> {
    let protocol_version = response["protocolVersion"].as_str();
    if protocol_version != Some(SURFACE_STREAM_PROTOCOL_VERSION) {
        return Err(format!(
            "Loom Surface stream protocol is {}, expected \"{SURFACE_STREAM_PROTOCOL_VERSION}\"",
            describe_stream_protocol_version(protocol_version)
        ));
    }
    let next = response
        .get("next")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(cursor);
    if next < cursor {
        return Err(format!(
            "Loom Surface stream cursor rewound from {cursor} to {next}"
        ));
    }
    let reset = response
        .get("reset")
        .and_then(serde_json::Value::as_bool)
        .ok_or_else(|| "Loom Surface stream reset flag is absent or invalid".to_owned())?;
    let messages = response
        .get("messages")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    if messages.len() > MAX_SURFACE_STREAM_MESSAGES {
        return Err("Loom Surface stream contains too many messages".to_owned());
    }
    for message in &messages {
        validate_json_payload_size(message, "Loom Surface stream message", 1024 * 1024)?;
    }
    Ok((next, reset, messages))
}

#[cfg_attr(not(feature = "remote-surface"), allow(dead_code))]
fn remote_surface_poll_delay(cursor: u64, next: u64) -> Option<Duration> {
    (next == cursor).then_some(REMOTE_SURFACE_IDLE_POLL_DELAY)
}

// 不匹配的一方可以往这个字段里塞任意长度的串，而错误串会进运行日志，所以按字符截断
// （不是字节，免得切开一个多字节字符），只留够定位的长度。
fn describe_stream_protocol_version(value: Option<&str>) -> String {
    let Some(version) = value else {
        return "absent".to_owned();
    };
    let mut clipped: String = version.chars().take(64).collect();
    if version.chars().nth(64).is_some() {
        clipped.push('…');
    }
    format!("\"{clipped}\"")
}

fn emit_surface_push(app: &AppHandle, method: &str, params: &serde_json::Value) {
    let local_event = match method {
        "loom.surface.snapshot" => "surface/snapshot",
        "loom.surface.patch" => "surface/patch",
        "loom.surface.generation" => "surface/generation",
        "loom.surface.action.ack" => "surface/action_ack",
        "loom.surface.confirmation.request" => "surface/confirmation",
        "loom.surface.action.progress" => "surface/progress",
        "loom.surface.preview" => "surface/preview",
        "loom.surface.result" => "surface/result",
        "loom.surface.failure" => "surface/failure",
        "loom.surface.lifecycle" => "surface/lifecycle",
        "loom.surface.dispose" => "surface/dispose",
        _ => return,
    };
    let _ = app.emit(local_event, params);
}
