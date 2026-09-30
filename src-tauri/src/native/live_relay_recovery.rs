// Reauthorize without changing origin, capture or public source identity. Never replay old input.
struct LiveSourceRecoveryPermit(Arc<LiveRelaySession>);
impl Drop for LiveSourceRecoveryPermit {
    fn drop(&mut self) {
        self.0.recovery_busy.store(false, Ordering::SeqCst);
    }
}

async fn recover_live_relay_source(
    app: &tauri::AppHandle,
    relays: &SharedLiveRelaySessions,
    old: Arc<LiveRelaySession>,
) -> Result<LiveRelaySnapshot, String> {
    if old.recovery_busy.swap(true, Ordering::SeqCst) {
        return Err("source_recovery_busy".to_owned());
    }
    let _permit = LiveSourceRecoveryPermit(Arc::clone(&old));
    let result = recover_live_relay_source_inner(app, relays, Arc::clone(&old)).await;
    if let Err(error) = &result {
        let code = if error.starts_with("source_recovery_unavailable") {
            "source_recovery_unavailable"
        } else {
            "source_recovery_failed"
        };
        mark_live_relay_recovering(&old, code, error.clone());
    }
    result
}

async fn recover_live_relay_source_inner(
    app: &tauri::AppHandle,
    relays: &SharedLiveRelaySessions,
    old: Arc<LiveRelaySession>,
) -> Result<LiveRelaySnapshot, String> {
    let request = old
        .publication
        .clone()
        .ok_or("source_recovery_unavailable: publication binding was not retained")?;
    let capture = old
        .capture
        .as_ref()
        .ok_or("source_recovery_unavailable: capture no longer exists")?;
    let status = snapshot_live_capture_state(&capture.state, &capture.dropped_frames)?;
    if matches!(status.capture_state.as_str(), "closed" | "failed") {
        return Err("source_recovery_unavailable: original capture is closed or failed".to_owned());
    }
    crate::device_session::invalidate_surface_sessions(&old.base_url);
    let (base_url, authorization) = live_source_context(app, &request).await?;
    if base_url != old.base_url || authorization.device_id != old.authorization.device_id {
        return Err(
            "source_recovery_unavailable: Loom origin or device identity changed".to_owned(),
        );
    }
    let discovery = discover_live_sessions_http(&base_url, &authorization).await?;
    let existing = recovery_source_snapshot(
        &discovery,
        &old.live_session_id,
        &authorization.device_id,
        &request.source_hook_id,
    )?;
    let old_worker = Arc::clone(&old);
    tokio::task::spawn_blocking(move || old_worker.stop_and_join())
        .await
        .map_err(|_| "source recovery shutdown worker failed")??;
    // User stop removes the old Arc. A late restore must not resurrect it.
    if !Arc::ptr_eq(&relays.get(&old.relay_id)?, &old) {
        return Err("source recovery was superseded".to_owned());
    }
    let old_state = old
        .state
        .lock()
        .map_err(|_| "live relay state poisoned")?
        .clone();
    let recreated = existing.is_none();
    let response = if let Some(value) = existing {
        value.clone()
    } else {
        let body = build_live_session_create_body(
            &request,
            &status,
            &authorization.device_id,
            &old.live_session_id,
            &old_state.observation_capabilities,
        );
        create_live_session_http(&base_url, &authorization, &body).await?
    };
    let epoch = validate_live_session_snapshot(&response, &old.live_session_id)?;
    let next = new_live_relay_source(
        old.relay_id.clone(),
        request,
        Arc::clone(capture),
        base_url,
        authorization,
        LiveRelayRuntimeState::starting(
            epoch,
            old_state.observation_capabilities,
            old_state.observation_reason,
        ),
    );
    if !recreated {
        *next
            .control_sequence
            .lock()
            .map_err(|_| "live relay control sequence poisoned")? = *old
            .control_sequence
            .lock()
            .map_err(|_| "live relay control sequence poisoned")?;
    }
    let next_worker = Arc::clone(&next);
    let relays = relays.clone();
    let outcome = tokio::task::spawn_blocking(move || {
        // Clear remote authority before sampling the cursor; no buffered down/up edges survive.
        revoke_live_relay_after_failure(&next_worker)?;
        let events = poll_live_relay_events_blocking(&next_worker, 0)?;
        next_worker
            .event_cursor
            .store(events.next, Ordering::SeqCst);
        relays.replace_source(&old, Arc::clone(&next_worker))
    })
    .await
    .map_err(|_| "source recovery worker failed".to_owned())
    .and_then(|result| result);
    if let Err(error) = outcome {
        let cleanup = Arc::clone(&next);
        let _ = tokio::task::spawn_blocking(move || {
            let _ = cleanup.stop_and_join();
            if recreated {
                let _ = close_live_session_blocking(&cleanup);
            }
        })
        .await;
        return Err(error);
    }
    next.snapshot()
}

fn recovery_source_snapshot<'a>(
    discovery: &'a serde_json::Value,
    session_id: &str,
    device_id: &str,
    hook_id: &str,
) -> Result<Option<&'a serde_json::Value>, String> {
    let sessions = discovery
        .get("sessions")
        .and_then(serde_json::Value::as_array)
        .ok_or("source recovery discovery is incomplete")?;
    let Some(source) = sessions.iter().find(|value| {
        value
            .pointer("/session/sessionId")
            .and_then(serde_json::Value::as_str)
            == Some(session_id)
    }) else {
        return Ok(None);
    };
    if source
        .pointer("/session/sourceDeviceId")
        .and_then(serde_json::Value::as_str)
        != Some(device_id)
        || source
            .pointer("/session/sourceHookId")
            .and_then(serde_json::Value::as_str)
            != Some(hook_id)
    {
        return Err("source_recovery_unavailable: existing source owner does not match".to_owned());
    }
    validate_live_session_snapshot(source, session_id)
        .map_err(|_| "source_recovery_unavailable: source was closed or has an invalid identity")?;
    Ok(Some(source))
}

#[cfg(test)]
mod live_source_recovery_tests {
    use super::*;
    #[test]
    fn recovery_distinguishes_absence_from_closed_foreign_and_incomplete_sources() {
        let source = serde_json::json!({"closed":false,"epoch":1,"session":{
            "protocolVersion":"loom.live.v1","sessionId":"live:a",
            "sourceDeviceId":"device:a","sourceHookId":"unit:a"}});
        let discovery = serde_json::json!({"sessions":[source]});
        assert!(
            recovery_source_snapshot(&discovery, "live:a", "device:a", "unit:a")
                .unwrap()
                .is_some()
        );
        assert!(
            recovery_source_snapshot(&discovery, "live:b", "device:a", "unit:a")
                .unwrap()
                .is_none()
        );
        assert!(recovery_source_snapshot(&discovery, "live:a", "device:b", "unit:a").is_err());
        assert!(recovery_source_snapshot(&discovery, "live:a", "device:a", "unit:b").is_err());
        let mut closed = discovery;
        closed["sessions"][0]["closed"] = serde_json::json!(true);
        assert!(recovery_source_snapshot(&closed, "live:a", "device:a", "unit:a").is_err());
        assert!(
            recovery_source_snapshot(&serde_json::json!({}), "live:a", "device:a", "unit:a")
                .is_err()
        );
    }
}
