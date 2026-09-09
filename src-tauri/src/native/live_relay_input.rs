// Polls reliable Loom control events and bridges authorized input to Hook's source window.
const LIVE_RELAY_CONTROL_POLL_MS: u64 = 750;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayEventsResponse {
    protocol_version: String,
    next: u64,
    reset: bool,
    events: Vec<LiveRelayControlEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayControlEvent {
    protocol_version: String,
    session_id: String,
    epoch: u64,
    sequence: u64,
    message_type: String,
    payload: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelaySessionStateEvent {
    revision: u64,
    visibility: String,
    viewers: Vec<String>,
    controller_device_id: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayInputEvent {
    input_sequence: u64,
    issued_at_ms: u64,
    source_device_id: String,
    kind: LiveRelayInputKind,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
enum LiveRelayInputKind {
    MouseMove(LiveRelayPointer),
    MouseButton(LiveRelayMouseButton),
    Wheel(LiveRelayWheel),
    Key(LiveRelayKey),
    Cancel,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayPointer {
    x: f64,
    y: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayMouseButton {
    button: String,
    state: String,
    x: f64,
    y: f64,
    click_count: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayWheel {
    delta_x: i32,
    delta_y: i32,
    x: f64,
    y: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayKey {
    code: String,
    state: String,
    modifiers: u8,
}

fn spawn_live_relay_control_worker(
    relay: Arc<LiveRelaySession>,
) -> Result<std::thread::JoinHandle<()>, String> {
    std::thread::Builder::new()
        .name(format!("hook-live-control-{}", relay.role.as_str()))
        .spawn(move || run_live_relay_control(relay))
        .map_err(|error| format!("spawn live relay control worker: {error}"))
}

fn run_live_relay_control(relay: Arc<LiveRelaySession>) {
    let mut after = 0_u64;
    while !relay.stop.load(Ordering::SeqCst) {
        match poll_live_relay_events_blocking(&relay, after) {
            Ok(response) => {
                if response.reset {
                    fail_live_relay_control(
                        &relay,
                        "control_history_reset",
                        "Loom live control history no longer contains every required event",
                    );
                    let _ = revoke_live_relay_after_failure(&relay);
                    after = response.next;
                    continue;
                }
                if let Err(error) = apply_live_relay_events(&relay, &response, &mut after) {
                    fail_live_relay_control(&relay, "control_event_rejected", error);
                    let _ = revoke_live_relay_after_failure(&relay);
                    live_relay_reconnect_delay(&relay.stop);
                    continue;
                }
            }
            Err(error) => {
                fail_live_relay_control(&relay, "control_poll_failed", error);
                live_relay_reconnect_delay(&relay.stop);
            }
        }
    }
    clear_live_relay_authority(&relay);
}

fn poll_live_relay_events_blocking(
    relay: &LiveRelaySession,
    after: u64,
) -> Result<LiveRelayEventsResponse, String> {
    let client =
        crate::network_proxy::blocking_client(&relay.base_url, Some(Duration::from_secs(3)))
            .map_err(|error| format!("build Loom live control client: {error}"))?;
    let mut url = live_relay_session_url(&relay.base_url, &relay.live_session_id, Some("events"))?;
    url.query_pairs_mut()
        .append_pair("after", &after.to_string())
        .append_pair("timeoutMs", &LIVE_RELAY_CONTROL_POLL_MS.to_string());
    let value = send_live_relay_json_blocking(
        relay.authorization.apply_blocking(client.get(url)),
        "poll Loom live control events",
    )?;
    let response: LiveRelayEventsResponse = serde_json::from_value(value)
        .map_err(|error| format!("parse Loom live control events: {error}"))?;
    if response.protocol_version != LIVE_RELAY_PROTOCOL_VERSION || response.next < after {
        return Err("Loom live control response identity or cursor is invalid".to_owned());
    }
    Ok(response)
}

fn apply_live_relay_events(
    relay: &LiveRelaySession,
    response: &LiveRelayEventsResponse,
    after: &mut u64,
) -> Result<(), String> {
    for event in &response.events {
        let expected = after.saturating_add(1);
        if event.protocol_version != LIVE_RELAY_PROTOCOL_VERSION
            || event.session_id != relay.live_session_id
            || event.epoch
                != relay
                    .state
                    .lock()
                    .map_err(|_| "live relay state poisoned".to_owned())?
                    .epoch
            || event.sequence != expected
        {
            return Err("Loom live control event identity or ordering is invalid".to_owned());
        }
        *after = event.sequence;
        match event.message_type.as_str() {
            "session_state" => apply_live_relay_session_state(relay, &event.payload)?,
            "input_event" if relay.role == LiveRelayRole::Source => {
                apply_live_relay_source_input(relay, &event.payload)?
            }
            "input_event" => {}
            "observation" => apply_live_relay_observation_event(relay, &event.payload)?,
            "trigger_event" => apply_live_relay_trigger_event(relay, &event.payload)?,
            _ => {}
        }
    }
    if response.next != *after {
        return Err("Loom live control response cursor does not match its events".to_owned());
    }
    Ok(())
}

fn send_live_relay_input_blocking(
    relay: &LiveRelaySession,
    input: &LiveCaptureInputRequest,
) -> Result<(), String> {
    if relay.role != LiveRelayRole::Viewer {
        return Err("only a live relay viewer can send remote input".to_owned());
    }
    if !relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned".to_owned())?
        .controller_owned
    {
        return Err("live relay viewer does not own controller authority".to_owned());
    }
    let mut control_sequence = relay
        .control_sequence
        .lock()
        .map_err(|_| "live relay control sequence poisoned".to_owned())?;
    let mut input_sequence = relay
        .input_sequence
        .lock()
        .map_err(|_| "live relay input sequence poisoned".to_owned())?;
    let next_control = control_sequence.saturating_add(1);
    let next_input = input_sequence.saturating_add(1);
    if input.sequence != next_input || input.sequence > LIVE_INPUT_MAX_SAFE_SEQUENCE {
        return Err(format!(
            "live relay input sequence must be exactly {next_input}"
        ));
    }
    let body = build_live_relay_input_body(relay, input, next_control)?;
    let client =
        crate::network_proxy::blocking_client(&relay.base_url, Some(Duration::from_secs(10)))
            .map_err(|error| format!("build Loom live input client: {error}"))?;
    let url = live_relay_session_url(&relay.base_url, &relay.live_session_id, Some("input"))?;
    send_live_relay_json_blocking(
        relay
            .authorization
            .apply_blocking(client.post(url))
            .json(&body),
        "send Loom live input",
    )?;
    *control_sequence = next_control;
    *input_sequence = next_input;
    Ok(())
}

fn build_live_relay_input_body(
    relay: &LiveRelaySession,
    input: &LiveCaptureInputRequest,
    control_sequence: u64,
) -> Result<serde_json::Value, String> {
    let kind = match input.kind.as_str() {
        "mouse_move" => serde_json::json!({
            "kind": "mouse_move",
            "data": { "x": input.normalized_x, "y": input.normalized_y }
        }),
        "mouse_button_down" | "mouse_button_up" => serde_json::json!({
            "kind": "mouse_button",
            "data": {
                "button": input.button,
                "state": if input.kind == "mouse_button_down" { "pressed" } else { "released" },
                "x": input.normalized_x,
                "y": input.normalized_y,
                "clickCount": input.click_count.unwrap_or(1),
            }
        }),
        "mouse_wheel" => {
            let delta = input
                .wheel_delta
                .ok_or_else(|| "wheel delta is required".to_owned())?;
            let (horizontal_delta, vertical_delta) =
                match input.wheel_axis.as_deref().unwrap_or("vertical") {
                    "horizontal" => (delta, 0),
                    "vertical" => (0, delta),
                    _ => return Err("wheel axis is invalid".to_owned()),
                };
            serde_json::json!({
                "kind": "wheel",
                "data": {
                    "deltaX": horizontal_delta,
                    "deltaY": vertical_delta,
                    "x": input.normalized_x,
                    "y": input.normalized_y,
                }
            })
        }
        "key_down" | "key_up" => serde_json::json!({
            "kind": "key",
            "data": {
                "code": format!("vk:{}", input.virtual_key.ok_or_else(|| "virtual key is required".to_owned())?),
                "state": if input.kind == "key_down" { "pressed" } else { "released" },
                "modifiers": 0,
            }
        }),
        "cancel" => serde_json::json!({ "kind": "cancel" }),
        _ => return Err("live relay input kind is unsupported".to_owned()),
    };
    let epoch = relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned".to_owned())?
        .epoch;
    Ok(serde_json::json!({
        "surfaceInstanceId": relay.surface_instance_id,
        "attachmentId": relay.attachment_id,
        "envelope": {
            "protocolVersion": LIVE_RELAY_PROTOCOL_VERSION,
            "sessionId": relay.live_session_id,
            "epoch": epoch,
            "sequence": control_sequence,
            "messageType": "input_event",
            "payload": {
                "inputSequence": input.sequence,
                "issuedAtMs": live_capture_now_ms(),
                "sourceDeviceId": relay.authorization.device_id,
                "kind": kind,
            }
        }
    }))
}

fn set_live_relay_source_interaction(
    relay: &LiveRelaySession,
    enabled: bool,
) -> Result<(), String> {
    let capture = relay
        .capture
        .as_ref()
        .ok_or_else(|| "live relay source capture is unavailable".to_owned());
    if !enabled && capture.is_err() {
        return Ok(());
    }
    let capture = capture?;
    let source_window = capture
        .source_window
        .as_ref()
        .ok_or_else(|| "live relay source has no interactive window".to_owned());
    if !enabled && source_window.is_err() {
        return Ok(());
    }
    let source_window = source_window?;
    let mut source = source_window
        .lock()
        .map_err(|_| "live source window lock poisoned".to_owned())?;
    source.set_interaction_enabled(enabled)?;
    update_live_source_status(capture, &source)
}

fn clear_live_relay_authority(relay: &LiveRelaySession) {
    if relay.role == LiveRelayRole::Source {
        let _ = set_live_relay_source_interaction(relay, false);
    }
    if let Ok(mut state) = relay.state.lock() {
        state.controller_owned = false;
        state.remote_control_active = false;
        state.controller_device_id = None;
    }
}

fn fail_live_relay_control(relay: &LiveRelaySession, code: &str, error: impl Into<String>) {
    clear_live_relay_authority(relay);
    if let Ok(mut state) = relay.state.lock() {
        state.error_code = Some(code.to_owned());
        state.error_message = Some(sanitize_live_relay_error(error.into()));
    }
}

fn revoke_live_relay_after_failure(relay: &LiveRelaySession) -> Result<(), String> {
    if relay.role == LiveRelayRole::Source {
        change_live_controller_blocking(relay, LiveRelayControlAction::Revoke, None)?;
    }
    Ok(())
}

#[cfg(test)]
mod live_relay_input_tests {
    use super::*;

    #[test]
    fn maps_protocol_input_to_existing_window_message_requests() {
        let request = live_relay_input_to_capture(LiveRelayInputEvent {
            input_sequence: 7,
            issued_at_ms: 10,
            source_device_id: "viewer:test".to_owned(),
            kind: LiveRelayInputKind::Key(LiveRelayKey {
                code: "vk:32".to_owned(),
                state: "pressed".to_owned(),
                modifiers: 0,
            }),
        })
        .expect("map key input");
        assert_eq!(request.sequence, 7);
        assert_eq!(request.kind, "key_down");
        assert_eq!(request.virtual_key, Some(32));
        assert!(parse_live_relay_virtual_key("KeyA").is_err());
    }

    #[test]
    fn source_input_requires_the_exact_active_controller() {
        let mut state = LiveRelayRuntimeState::starting(1, Vec::new(), None);
        assert!(!live_relay_input_authorized(&state, "viewer-a"));
        state.remote_control_active = true;
        state.controller_device_id = Some("viewer-a".to_owned());
        assert!(live_relay_input_authorized(&state, "viewer-a"));
        assert!(!live_relay_input_authorized(&state, "viewer-b"));
    }
}
