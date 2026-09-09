// Authenticated loom.live.v1 HTTP control-plane requests and bounded JSON parsing.
const LIVE_RELAY_MAX_JSON_BYTES: usize = 1024 * 1024;
const LIVE_RELAY_BUSY_RETRIES: usize = 3;
const LIVE_RELAY_BUSY_RETRY_MS: u64 = 50;

async fn live_relay_context(
    app: &tauri::AppHandle,
) -> Result<(String, crate::device_session::DeviceSessionAuthorization), String> {
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for live relay: {error}"))?;
    let base_url = manifest.transport.base_url.trim_end_matches('/').to_owned();
    let authorization = crate::device_session::authorize_surface_request(app, &manifest).await?;
    Ok((base_url, authorization))
}

fn build_live_session_create_body(
    request: &LiveRelayPublishRequest,
    status: &LiveCaptureStatusSnapshot,
    device_id: &str,
    live_session_id: &str,
    observation_capabilities: &[String],
) -> serde_json::Value {
    let source_kind = if status.source_kind == "window" {
        "window"
    } else {
        "region"
    };
    let capture_strategy = if source_kind == "window" {
        "persistent_window_wgc"
    } else {
        "persistent_display_wgc"
    };
    let preservation = if source_kind == "window" {
        "visible_offscreen"
    } else {
        "visible"
    };
    let window_id = status
        .source_window_id
        .clone()
        .unwrap_or_else(|| status.session_id.clone());
    let now = live_capture_now_ms();
    let interaction_capabilities: &[&str] = if status.input_capability == "window_message" {
        &[
            "pointer_move",
            "pointer_button",
            "double_click",
            "drag",
            "wheel",
            "keyboard",
            "cancel",
        ]
    } else {
        &[]
    };
    serde_json::json!({
        "surfaceInstanceId": request.surface_instance_id,
        "sourceAttachmentId": request.source_attachment_id,
        "envelope": {
            "protocolVersion": LIVE_RELAY_PROTOCOL_VERSION,
            "sessionId": live_session_id,
            "epoch": 1,
            "sequence": 1,
            "messageType": "session_start",
            "payload": {
                "session": {
                    "protocolVersion": LIVE_RELAY_PROTOCOL_VERSION,
                    "sessionId": live_session_id,
                    "sourceDeviceId": device_id,
                    "sourceHookId": request.source_hook_id,
                    "sourceKind": source_kind,
                    "sourceWindowIdentity": {
                        "windowId": window_id,
                        "processId": status.source_process_id.unwrap_or_else(std::process::id),
                        "title": status.source_title,
                    },
                    "sourceRegion": {
                        "x": 0,
                        "y": 0,
                        "width": status.width,
                        "height": status.height,
                    },
                    "regionAnchor": if source_kind == "window" { "window" } else { "screen" },
                    "frameStream": {
                        "streamId": format!("stream:{live_session_id}"),
                        "transport": "websocket_binary",
                        "endpoint": "/v1/live/media",
                        "codec": "raw_bgra",
                        "colorSpace": "srgb",
                        "width": status.width,
                        "height": status.height,
                        "targetFps": status.target_fps,
                        "maxBufferedFrames": LIVE_RELAY_FRAME_BUFFER,
                        "keyframeInterval": 1,
                    },
                    "interactionCapabilities": interaction_capabilities,
                    "observationCapabilities": observation_capabilities,
                    "triggerBindings": [],
                    "viewerDevices": [],
                    "visibilityState": "visible",
                    "captureStrategy": capture_strategy,
                    "renderPreservationStrategy": preservation,
                    "revision": 1,
                    "createdAtMs": now,
                    "lastSeenAtMs": now,
                },
                "requestedByDeviceId": device_id,
                "requestNonce": format!("request:{}", uuid::Uuid::new_v4()),
            }
        }
    })
}

async fn create_live_session_http(
    base_url: &str,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    body: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let client = crate::network_proxy::shared_client(base_url, Some(Duration::from_secs(15)))
        .map_err(|error| format!("build Loom live-session client: {error}"))?;
    send_live_relay_json(
        authorization
            .apply(client.post(format!("{base_url}/v1/live/sessions")))
            .json(body),
        "create Loom live session",
    )
    .await
}

async fn discover_live_sessions_http(
    base_url: &str,
    authorization: &crate::device_session::DeviceSessionAuthorization,
) -> Result<serde_json::Value, String> {
    let client = crate::network_proxy::shared_client(base_url, Some(Duration::from_secs(10)))
        .map_err(|error| format!("build Loom live discovery client: {error}"))?;
    let value = send_live_relay_json(
        authorization.apply(client.get(format!("{base_url}/v1/live/sessions"))),
        "discover Loom live sessions",
    )
    .await?;
    if value
        .get("protocolVersion")
        .and_then(serde_json::Value::as_str)
        != Some(LIVE_RELAY_PROTOCOL_VERSION)
        || !value
            .get("sessions")
            .is_some_and(serde_json::Value::is_array)
    {
        return Err("Loom live discovery response has an invalid protocol envelope".to_owned());
    }
    Ok(value)
}

async fn attach_live_viewer_http(
    base_url: &str,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    request: &LiveRelayJoinRequest,
    epoch: u64,
) -> Result<serde_json::Value, String> {
    let client = crate::network_proxy::shared_client(base_url, Some(Duration::from_secs(15)))
        .map_err(|error| format!("build Loom live viewer client: {error}"))?;
    let url = live_relay_session_url(base_url, &request.live_session_id, Some("viewers"))?;
    let body = serde_json::json!({
        "surfaceInstanceId": request.surface_instance_id,
        "attachmentId": request.attachment_id,
        "envelope": {
            "protocolVersion": LIVE_RELAY_PROTOCOL_VERSION,
            "sessionId": request.live_session_id,
            "epoch": epoch,
            "sequence": 1,
            "messageType": "session_ack",
            "payload": {
                "accepted": true,
                "responderDeviceId": authorization.device_id,
            }
        }
    });
    send_live_relay_json(
        authorization.apply(client.post(url)).json(&body),
        "attach Loom live viewer",
    )
    .await
}

fn resume_live_viewer_blocking(session: &LiveRelaySession) -> Result<(), String> {
    let (epoch, last_frame_id) = session
        .state
        .lock()
        .map(|state| (state.epoch, state.last_frame_id))
        .map_err(|_| "live relay state poisoned".to_owned())?;
    let mut sequence = session
        .control_sequence
        .lock()
        .map_err(|_| "live relay control sequence poisoned".to_owned())?;
    let input_sequence = *session
        .input_sequence
        .lock()
        .map_err(|_| "live relay input sequence poisoned".to_owned())?;
    let next = sequence.saturating_add(1);
    let body = serde_json::json!({
        "envelope": {
            "protocolVersion": LIVE_RELAY_PROTOCOL_VERSION,
            "sessionId": session.live_session_id,
            "epoch": epoch,
            "sequence": next,
            "messageType": "resume_request",
            "payload": {
                "lastControlSequence": *sequence,
                "lastFrameId": last_frame_id,
                "lastInputSequence": input_sequence,
                "requesterDeviceId": session.authorization.device_id,
            }
        }
    });
    let client =
        crate::network_proxy::blocking_client(&session.base_url, Some(Duration::from_secs(10)))
            .map_err(|error| format!("build Loom live resume client: {error}"))?;
    let url = live_relay_session_url(&session.base_url, &session.live_session_id, Some("resume"))?;
    send_live_relay_json_blocking(
        session
            .authorization
            .apply_blocking(client.post(url))
            .json(&body),
        "resume Loom live viewer",
    )?;
    *sequence = next;
    Ok(())
}

fn change_live_controller_blocking(
    session: &LiveRelaySession,
    action: LiveRelayControlAction,
    lease_duration_ms: Option<u64>,
) -> Result<serde_json::Value, String> {
    if matches!(
        action,
        LiveRelayControlAction::Acquire | LiveRelayControlAction::Release
    ) && session.role != LiveRelayRole::Viewer
    {
        return Err(
            "only a live relay viewer can request or release controller authority".to_owned(),
        );
    }
    if matches!(action, LiveRelayControlAction::Revoke) && session.role != LiveRelayRole::Source {
        return Err("only a live relay source can revoke controller authority".to_owned());
    }
    let epoch = session
        .state
        .lock()
        .map(|state| state.epoch)
        .map_err(|_| "live relay state poisoned".to_owned())?;
    let mut sequence = session
        .control_sequence
        .lock()
        .map_err(|_| "live relay control sequence poisoned".to_owned())?;
    let next = sequence.saturating_add(1);
    let action_name = match action {
        LiveRelayControlAction::Acquire => "acquire",
        LiveRelayControlAction::Release => "release",
        LiveRelayControlAction::Revoke => "revoke",
    };
    let body = serde_json::json!({
        "protocolVersion": LIVE_RELAY_PROTOCOL_VERSION,
        "surfaceInstanceId": session.surface_instance_id,
        "attachmentId": session.attachment_id,
        "action": action_name,
        "sequence": next,
        "epoch": epoch,
        "leaseDurationMs": lease_duration_ms,
    });
    let client =
        crate::network_proxy::blocking_client(&session.base_url, Some(Duration::from_secs(10)))
            .map_err(|error| format!("build Loom live controller client: {error}"))?;
    let url = live_relay_session_url(&session.base_url, &session.live_session_id, Some("control"))?;
    let response = send_live_relay_json_blocking(
        session
            .authorization
            .apply_blocking(client.post(url))
            .json(&body),
        "change Loom live controller",
    )?;
    let response_epoch = validate_live_session_snapshot(&response, &session.live_session_id)?;
    let expected_controller = match action {
        LiveRelayControlAction::Acquire => Some(session.authorization.device_id.as_str()),
        LiveRelayControlAction::Release | LiveRelayControlAction::Revoke => None,
    };
    let actual_controller = response
        .pointer("/session/controllerDevice")
        .and_then(serde_json::Value::as_str);
    if response_epoch != epoch || actual_controller != expected_controller {
        return Err(
            "Loom live controller response does not match the requested authority".to_owned(),
        );
    }
    *sequence = next;
    Ok(response)
}

fn close_live_session_blocking(session: &LiveRelaySession) -> Result<(), String> {
    if session.role != LiveRelayRole::Source {
        return Ok(());
    }
    let epoch = session
        .state
        .lock()
        .map(|state| state.epoch)
        .map_err(|_| "live relay state poisoned".to_owned())?;
    let mut sequence = session
        .control_sequence
        .lock()
        .map_err(|_| "live relay control sequence poisoned".to_owned())?;
    let next = sequence.saturating_add(1);
    let body = serde_json::json!({
        "envelope": {
            "protocolVersion": LIVE_RELAY_PROTOCOL_VERSION,
            "sessionId": session.live_session_id,
            "epoch": epoch,
            "sequence": next,
            "messageType": "session_end",
            "payload": {
                "reason": "closed",
                "endedByDeviceId": session.authorization.device_id,
                "detail": "Hook publisher stopped",
            }
        }
    });
    let client =
        crate::network_proxy::blocking_client(&session.base_url, Some(Duration::from_secs(10)))
            .map_err(|error| format!("build Loom live close client: {error}"))?;
    let url = live_relay_session_url(&session.base_url, &session.live_session_id, Some("close"))?;
    send_live_relay_json_blocking(
        session
            .authorization
            .apply_blocking(client.post(url))
            .json(&body),
        "close Loom live session",
    )?;
    *sequence = next;
    Ok(())
}

async fn send_live_relay_json(
    request: reqwest::RequestBuilder,
    context: &str,
) -> Result<serde_json::Value, String> {
    for attempt in 0..=LIVE_RELAY_BUSY_RETRIES {
        let mut response = request
            .try_clone()
            .ok_or_else(|| format!("{context}: request body cannot be retried safely"))?
            .send()
            .await
            .map_err(|error| format!("{context}: {error}"))?;
        let status = response.status().as_u16();
        if response
            .content_length()
            .is_some_and(|length| length > LIVE_RELAY_MAX_JSON_BYTES as u64)
        {
            return Err(format!("{context}: response exceeds the JSON size limit"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("{context}: read response: {error}"))?
        {
            if bytes.len().saturating_add(chunk.len()) > LIVE_RELAY_MAX_JSON_BYTES {
                return Err(format!("{context}: response exceeds the JSON size limit"));
            }
            bytes.extend_from_slice(&chunk);
        }
        if !is_retryable_daemon_busy(status, &bytes) || attempt == LIVE_RELAY_BUSY_RETRIES {
            return parse_live_relay_response(status, &bytes, context);
        }
        tokio::time::sleep(Duration::from_millis(
            LIVE_RELAY_BUSY_RETRY_MS * (attempt as u64 + 1),
        ))
        .await;
    }
    unreachable!("bounded live relay retry loop always returns")
}

fn send_live_relay_json_blocking(
    request: reqwest::blocking::RequestBuilder,
    context: &str,
) -> Result<serde_json::Value, String> {
    for attempt in 0..=LIVE_RELAY_BUSY_RETRIES {
        let mut response = request
            .try_clone()
            .ok_or_else(|| format!("{context}: request body cannot be retried safely"))?
            .send()
            .map_err(|error| format!("{context}: {error}"))?;
        let status = response.status().as_u16();
        if response
            .content_length()
            .is_some_and(|length| length > LIVE_RELAY_MAX_JSON_BYTES as u64)
        {
            return Err(format!("{context}: response exceeds the JSON size limit"));
        }
        let mut bytes = Vec::new();
        let mut limited =
            std::io::Read::take(&mut response, (LIVE_RELAY_MAX_JSON_BYTES + 1) as u64);
        std::io::Read::read_to_end(&mut limited, &mut bytes)
            .map_err(|error| format!("{context}: read response: {error}"))?;
        if bytes.len() > LIVE_RELAY_MAX_JSON_BYTES {
            return Err(format!("{context}: response exceeds the JSON size limit"));
        }
        if !is_retryable_daemon_busy(status, &bytes) || attempt == LIVE_RELAY_BUSY_RETRIES {
            return parse_live_relay_response(status, &bytes, context);
        }
        std::thread::sleep(Duration::from_millis(
            LIVE_RELAY_BUSY_RETRY_MS * (attempt as u64 + 1),
        ));
    }
    unreachable!("bounded live relay retry loop always returns")
}

fn parse_live_relay_response(
    status: u16,
    bytes: &[u8],
    context: &str,
) -> Result<serde_json::Value, String> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("{context}: parse JSON response: {error}"))?;
    if !(200..300).contains(&status) {
        let detail = value
            .pointer("/error/message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Loom rejected the live relay request");
        return Err(format!(
            "{context}: HTTP {status}: {}",
            sanitize_live_relay_error(detail.to_owned())
        ));
    }
    Ok(value)
}

fn is_retryable_daemon_busy(status: u16, bytes: &[u8]) -> bool {
    if status != 503 {
        return false;
    }
    serde_json::from_slice::<serde_json::Value>(bytes)
        .ok()
        .is_some_and(|value| {
            value
                .pointer("/error/code")
                .and_then(serde_json::Value::as_str)
                == Some("daemon_busy")
                && value
                    .pointer("/error/retryable")
                    .and_then(serde_json::Value::as_bool)
                    == Some(true)
        })
}

fn live_relay_session_url(
    base_url: &str,
    session_id: &str,
    suffix: Option<&str>,
) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(base_url)
        .map_err(|error| format!("parse Loom live base URL: {error}"))?;
    let mut segments = url
        .path_segments_mut()
        .map_err(|_| "Loom live base URL cannot carry path segments".to_owned())?;
    segments.extend(["v1", "live", "sessions", session_id]);
    if let Some(suffix) = suffix {
        segments.push(suffix);
    }
    drop(segments);
    Ok(url)
}

#[cfg(test)]
mod live_relay_http_tests {
    use super::*;

    #[test]
    fn retries_only_explicit_pre_dispatch_daemon_busy_responses() {
        let busy = br#"{"error":{"code":"daemon_busy","message":"busy","retryable":true}}"#;
        assert!(is_retryable_daemon_busy(503, busy));
        assert!(!is_retryable_daemon_busy(
            503,
            br#"{"error":{"retryable":true}}"#
        ));
        assert!(!is_retryable_daemon_busy(502, busy));
    }
}
