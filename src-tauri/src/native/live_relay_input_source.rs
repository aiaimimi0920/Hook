// Applies authoritative controller events and input to the local source window.
fn apply_live_relay_session_state(
    relay: &LiveRelaySession,
    payload: &serde_json::Value,
) -> Result<(), String> {
    let event: LiveRelaySessionStateEvent = serde_json::from_value(payload.clone())
        .map_err(|error| format!("parse Loom live session state: {error}"))?;
    let _ = (
        event.revision,
        &event.visibility,
        &event.viewers,
        &event.reason,
    );
    let controller = event.controller_device_id;
    if relay.role == LiveRelayRole::Viewer {
        let mut state = relay
            .state
            .lock()
            .map_err(|_| "live relay state poisoned".to_owned())?;
        state.controller_owned =
            controller.as_deref() == Some(relay.authorization.device_id.as_str());
        state.controller_device_id = controller;
        return Ok(());
    }
    set_live_relay_source_interaction(relay, controller.is_some())?;
    let mut state = relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned".to_owned())?;
    state.remote_control_active = controller.is_some();
    state.controller_device_id = controller;
    Ok(())
}

fn apply_live_relay_source_input(
    relay: &LiveRelaySession,
    payload: &serde_json::Value,
) -> Result<(), String> {
    let event: LiveRelayInputEvent = serde_json::from_value(payload.clone())
        .map_err(|error| format!("parse Loom live input event: {error}"))?;
    let _ = event.issued_at_ms;
    if event.source_device_id == relay.authorization.device_id {
        return Err("Loom live input cannot originate from its source device".to_owned());
    }
    {
        let state = relay
            .state
            .lock()
            .map_err(|_| "live relay state poisoned".to_owned())?;
        if !live_relay_input_authorized(&state, &event.source_device_id) {
            return Err("Loom delivered input without matching controller authority".to_owned());
        }
    }
    if matches!(&event.kind, LiveRelayInputKind::Cancel) {
        return release_live_relay_source_inputs(relay);
    }
    let request = live_relay_input_to_capture(event)?;
    let capture = relay
        .capture
        .as_ref()
        .ok_or_else(|| "live relay source capture is unavailable".to_owned())?;
    let source_window = capture
        .source_window
        .as_ref()
        .ok_or_else(|| "live relay source has no interactive window".to_owned())?;
    let mut source = source_window
        .lock()
        .map_err(|_| "live source window lock poisoned".to_owned())?;
    if let Err(error) = source.send_input(&request) {
        let _ = source.set_interaction_enabled(false);
        update_live_source_status(capture, &source)?;
        return Err(error);
    }
    update_live_source_status(capture, &source)
}

fn live_relay_input_authorized(state: &LiveRelayRuntimeState, source_device_id: &str) -> bool {
    state.remote_control_active && state.controller_device_id.as_deref() == Some(source_device_id)
}

fn release_live_relay_source_inputs(relay: &LiveRelaySession) -> Result<(), String> {
    let capture = relay
        .capture
        .as_ref()
        .ok_or_else(|| "live relay source capture is unavailable".to_owned())?;
    let source_window = capture
        .source_window
        .as_ref()
        .ok_or_else(|| "live relay source has no interactive window".to_owned())?;
    let mut source = source_window
        .lock()
        .map_err(|_| "live source window lock poisoned".to_owned())?;
    source.release_pressed_inputs();
    update_live_source_status(capture, &source)
}

fn live_relay_input_to_capture(
    event: LiveRelayInputEvent,
) -> Result<LiveCaptureInputRequest, String> {
    let mut request = LiveCaptureInputRequest {
        sequence: event.input_sequence,
        kind: String::new(),
        normalized_x: None,
        normalized_y: None,
        button: None,
        wheel_delta: None,
        wheel_axis: None,
        click_count: None,
        virtual_key: None,
    };
    match event.kind {
        LiveRelayInputKind::MouseMove(point) => {
            request.kind = "mouse_move".to_owned();
            (request.normalized_x, request.normalized_y) = (Some(point.x), Some(point.y));
        }
        LiveRelayInputKind::MouseButton(button) => {
            request.kind = match button.state.as_str() {
                "pressed" => "mouse_button_down",
                "released" => "mouse_button_up",
                _ => return Err("remote mouse button state is invalid".to_owned()),
            }
            .to_owned();
            request.button = Some(button.button);
            request.normalized_x = Some(button.x);
            request.normalized_y = Some(button.y);
            request.click_count = Some(button.click_count);
        }
        LiveRelayInputKind::Wheel(wheel) => {
            let (axis, delta) = match (wheel.delta_x, wheel.delta_y) {
                (0, delta) if delta != 0 => ("vertical", delta),
                (delta, 0) if delta != 0 => ("horizontal", delta),
                _ => return Err("remote wheel must use exactly one non-zero axis".to_owned()),
            };
            request.kind = "mouse_wheel".to_owned();
            request.normalized_x = Some(wheel.x);
            request.normalized_y = Some(wheel.y);
            request.wheel_axis = Some(axis.to_owned());
            request.wheel_delta = Some(delta);
        }
        LiveRelayInputKind::Key(key) => {
            if key.modifiers != 0 {
                return Err("remote key modifiers are not supported by window messages".to_owned());
            }
            request.kind = match key.state.as_str() {
                "pressed" => "key_down",
                "released" => "key_up",
                _ => return Err("remote key state is invalid".to_owned()),
            }
            .to_owned();
            request.virtual_key = Some(parse_live_relay_virtual_key(&key.code)?);
        }
        LiveRelayInputKind::Cancel => unreachable!("cancel handled before input conversion"),
    }
    Ok(request)
}

fn parse_live_relay_virtual_key(code: &str) -> Result<u16, String> {
    code.strip_prefix("vk:")
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| (1..=254).contains(value))
        .ok_or_else(|| "remote key code must use vk:1 through vk:254".to_owned())
}
