// Viewer-authorized live trigger registration over Loom's ordered control plane.
fn configure_live_trigger_blocking(
    session: &LiveRelaySession,
    request: &LiveRelayTriggerConfigureRequest,
) -> Result<serde_json::Value, String> {
    if session.role != LiveRelayRole::Viewer {
        return Err("only a live relay viewer can authorize Art triggers".to_owned());
    }
    if session
        .state
        .lock()
        .map_err(|_| "live relay state poisoned".to_owned())?
        .connection_state
        != "connected"
    {
        return Err("remote Art triggers are paused while the viewer is offline".to_owned());
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
        "bindingId": request.binding_id,
        "enabled": request.enabled,
        "target": request.target,
        "envelope": {
            "protocolVersion": LIVE_RELAY_PROTOCOL_VERSION,
            "sessionId": session.live_session_id,
            "epoch": epoch,
            "sequence": next,
            "messageType": "trigger_condition",
            "payload": request.condition,
        }
    });
    let client =
        crate::network_proxy::blocking_client(&session.base_url, Some(Duration::from_secs(10)))
            .map_err(|error| format!("build Loom live trigger client: {error}"))?;
    let url = live_relay_session_url(
        &session.base_url,
        &session.live_session_id,
        Some("triggers"),
    )?;
    let response = send_live_relay_json_blocking(
        session
            .authorization
            .apply_blocking(client.post(url))
            .json(&body),
        "configure Loom live trigger",
    )?;
    let response_epoch = validate_live_session_snapshot(&response, &session.live_session_id)?;
    if response_epoch != epoch {
        return Err("Loom live trigger response changed the session epoch".to_owned());
    }
    *sequence = next;
    Ok(response)
}
