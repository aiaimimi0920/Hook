// Replace only an expired viewer's exact owner. Renewal never pairs or acquires control.
fn ensure_live_viewer_renewable(old: &LiveRelaySession) -> Result<(), String> {
    let state = old.state.lock().map_err(|_| "live relay state poisoned")?;
    if old.role != LiveRelayRole::Viewer
        || !old.authorization.uses_device_session()
        || !old.stop.load(Ordering::SeqCst)
        || state.connection_state != "closed"
        || state.error_code.as_deref() != Some("live_viewer_authorization_required")
        || old
            .viewer_identity
            .as_ref()
            .is_none_or(|identity| identity.epoch != state.epoch)
    {
        return Err("live viewer is not eligible for credential renewal".to_owned());
    }
    Ok(())
}

async fn renew_live_relay_viewer(
    app: &tauri::AppHandle,
    relays: &SharedLiveRelaySessions,
    old: Arc<LiveRelaySession>,
) -> Result<LiveRelaySnapshot, String> {
    ensure_live_viewer_renewable(&old)?;
    // This retired Arc gets one attempt, including failure. Only a new owner resets it.
    if old.recovery_busy.swap(true, Ordering::SeqCst) {
        return Err("live viewer renewal was already attempted".to_owned());
    }
    let request = LiveRelayJoinRequest {
        live_session_id: old.live_session_id.clone(),
        surface_instance_id: old
            .surface_instance_id
            .clone()
            .ok_or("viewer Surface binding missing")?,
        attachment_id: old
            .attachment_id
            .clone()
            .ok_or("viewer attachment missing")?,
    };
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for viewer renewal: {error}"))?;
    if manifest.transport.base_url.trim_end_matches('/') != old.base_url {
        return Err("Loom viewer renewal origin changed".to_owned());
    }
    let worker = Arc::clone(&old);
    tokio::task::spawn_blocking(move || worker.stop_and_join())
        .await
        .map_err(|_| "viewer renewal shutdown worker failed")??;
    ensure_live_viewer_renewable(&old)?;
    if !Arc::ptr_eq(&relays.get(&old.relay_id)?, &old) {
        return Err("viewer renewal was superseded".to_owned());
    }
    let authorization = crate::device_session::renew_existing_device_session(
        app,
        &old.base_url,
        &old.authorization.device_id,
    )
    .await?;
    let next = prepare_live_relay_viewer(
        old.relay_id.clone(),
        old.base_url.clone(),
        authorization,
        request,
        old.viewer_identity.as_ref(),
    )
    .await?;
    let next_worker = Arc::clone(&next);
    let sessions = relays.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        sessions.replace_viewer(&old, Arc::clone(&next_worker))
    })
    .await
    .map_err(|_| "viewer renewal replacement worker failed".to_owned())
    .and_then(|result| result);
    if let Err(error) = outcome {
        let _ = tokio::task::spawn_blocking(move || next.stop_and_join()).await;
        return Err(error);
    }
    next.command_snapshot()
}

impl SharedLiveRelaySessions {
    fn replace_viewer(
        &self,
        old: &Arc<LiveRelaySession>,
        next: Arc<LiveRelaySession>,
    ) -> Result<(), String> {
        let mut sessions = self
            .0
            .lock()
            .map_err(|_| "live relay session map poisoned")?;
        if !sessions
            .get(&old.relay_id)
            .is_some_and(|current| Arc::ptr_eq(current, old))
        {
            return Err("viewer renewal cancelled: relay was removed or replaced".to_owned());
        }
        ensure_live_viewer_renewable(old)?;
        // Stop removes ownership under this lock, so no worker can escape a concurrent stop.
        start_live_relay_viewer_workers(&next)?;
        sessions.insert(old.relay_id.clone(), next);
        Ok(())
    }
}
