// Only an exact terminal signal on the admitted Device media socket ends local authorization.
fn close_live_relay_if_device_revoked(
    relay: &LiveRelaySession,
    close: Option<&tungstenite::protocol::CloseFrame<'_>>,
) -> bool {
    if !relay.authorization.uses_device_session()
        || !close.is_some_and(|close| {
            close.code == tungstenite::protocol::frame::coding::CloseCode::Policy
                && close.reason == "live_media_device_revoked"
        })
    {
        return false;
    }
    // Never join from a worker. Explicit disposal owns the bounded worker joins.
    relay.stop.store(true, Ordering::SeqCst);
    clear_live_relay_authority(relay);
    if let Ok(mut state) = relay.state.lock() {
        state.mark_closed();
        state.error_code = Some("live_media_device_revoked".to_owned());
        state.error_message = Some("Loom revoked this Device media authorization".to_owned());
        if let Ok(mut frames) = relay.frames.lock() {
            frames.clear();
        }
    } else if let Ok(mut frames) = relay.frames.lock() {
        frames.clear();
    }
    true
}

fn ensure_live_relay_not_revoked(relay: &LiveRelaySession) -> Result<(), String> {
    let state = relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned")?;
    if state.error_code.as_deref() == Some("live_media_device_revoked") {
        return Err(
            "source_recovery_unavailable: Device media authorization was revoked".to_owned(),
        );
    }
    Ok(())
}
