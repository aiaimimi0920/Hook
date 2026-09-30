// Source construction is shared by first publication and authenticated daemon recovery.
async fn live_source_context(
    app: &tauri::AppHandle,
    request: &LiveRelayPublishRequest,
) -> Result<(String, crate::device_session::DeviceSessionAuthorization), String> {
    if request.surface_instance_id.is_some() {
        return live_relay_context(app).await;
    }
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|_| "Loom manifest is unavailable")?;
    let authorization = crate::device_session::authorize_tile_request(app, &manifest).await?;
    Ok((
        manifest.transport.base_url.trim_end_matches('/').to_owned(),
        authorization,
    ))
}

fn new_live_relay_source(
    relay_id: String,
    request: LiveRelayPublishRequest,
    capture: Arc<LiveCaptureSession>,
    base_url: String,
    authorization: crate::device_session::DeviceSessionAuthorization,
    state: LiveRelayRuntimeState,
) -> Arc<LiveRelaySession> {
    Arc::new(LiveRelaySession {
        relay_id,
        live_session_id: request
            .live_session_id
            .clone()
            .expect("assigned source identity"),
        role: LiveRelayRole::Source,
        base_url,
        surface_instance_id: request.surface_instance_id.clone(),
        attachment_id: request.source_attachment_id.clone(),
        authorization,
        publication: Some(request),
        recovery_busy: AtomicBool::new(false),
        event_cursor: std::sync::atomic::AtomicU64::new(0),
        capture: Some(capture),
        state: Arc::new(Mutex::new(state)),
        frames: Arc::new(Mutex::new(LiveRelayFrameBuffer::new())),
        stop: Arc::new(AtomicBool::new(false)),
        reconnect: Arc::new(AtomicBool::new(false)),
        join: Mutex::new(None),
        control_join: Mutex::new(None),
        observation_join: Mutex::new(None),
        control_sequence: Mutex::new(1),
        input_sequence: Mutex::new(0),
    })
}

fn start_live_relay_source_workers(relay: &Arc<LiveRelaySession>) -> Result<(), String> {
    let capture = relay
        .capture
        .as_ref()
        .ok_or("source capture is unavailable")?;
    let worker = spawn_live_relay_source_worker(Arc::clone(relay), Arc::clone(capture))?;
    *relay
        .join
        .lock()
        .map_err(|_| "live relay worker lock poisoned")? = Some(worker);
    let worker = spawn_live_relay_control_worker(Arc::clone(relay))?;
    *relay
        .control_join
        .lock()
        .map_err(|_| "live relay control worker lock poisoned")? = Some(worker);
    let observe = relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned")?
        .observation_capabilities
        .iter()
        .any(|capability| capability == "uia_tree");
    if observe {
        let worker = spawn_live_observation_worker(Arc::clone(relay))?;
        *relay
            .observation_join
            .lock()
            .map_err(|_| "live observation worker lock poisoned")? = Some(worker);
    }
    Ok(())
}

impl SharedLiveRelaySessions {
    fn replace_source(
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
            return Err("source recovery cancelled: relay was removed or replaced".to_owned());
        }
        // Start and publish ownership under the same map lock so stop sees every worker handle.
        start_live_relay_source_workers(&next)?;
        sessions.insert(old.relay_id.clone(), next);
        Ok(())
    }
}
