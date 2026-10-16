// First join and credential renewal share the same authenticated attachment/bootstrap path.
#[derive(Clone, Debug, PartialEq, Eq)]
struct LiveViewerIdentity {
    source_device_id: String,
    source_hook_id: String,
    epoch: u64,
}

impl LiveViewerIdentity {
    fn from_snapshot(value: &serde_json::Value, session_id: &str) -> Result<Self, String> {
        let read = |key: &str| -> Result<String, String> {
            let id = value
                .pointer(key)
                .and_then(serde_json::Value::as_str)
                .ok_or("Loom viewer source identity is missing")?;
            validate_live_relay_identifier(id, "viewer source identity")?;
            Ok(id.to_owned())
        };
        Ok(Self {
            source_device_id: read("/session/sourceDeviceId")?,
            source_hook_id: read("/session/sourceHookId")?,
            epoch: validate_live_session_snapshot(value, session_id)?,
        })
    }

    fn validate(&self, value: &serde_json::Value, session_id: &str) -> Result<(), String> {
        if &Self::from_snapshot(value, session_id)? != self {
            return Err("Loom viewer source identity or epoch changed".to_owned());
        }
        Ok(())
    }
}

async fn prepare_live_relay_viewer(
    relay_id: String,
    base_url: String,
    authorization: crate::device_session::DeviceSessionAuthorization,
    request: LiveRelayJoinRequest,
    expected: Option<&LiveViewerIdentity>,
) -> Result<Arc<LiveRelaySession>, String> {
    let discovery = discover_live_sessions_http(&base_url, &authorization).await?;
    let preview = find_live_session_snapshot(&discovery, &request.live_session_id)?;
    let identity = LiveViewerIdentity::from_snapshot(preview, &request.live_session_id)?;
    if let Some(expected) = expected {
        expected.validate(preview, &request.live_session_id)?;
        // Renewal cannot turn a removed member into a fresh automatic join.
        if !preview
            .pointer("/session/viewerDevices")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|members| {
                members
                    .iter()
                    .any(|id| id.as_str() == Some(&authorization.device_id))
            })
        {
            return Err("Loom viewer renewal membership was removed".to_owned());
        }
    }
    let epoch = identity.epoch;
    let baseline = live_viewer_join_baseline(
        &base_url,
        &authorization,
        &request.live_session_id,
        preview,
        epoch,
    )
    .await?;
    let sequence = baseline.next_control()?;
    let remote = if expected.is_some() {
        attach_live_viewer_with_policy_http(
            &base_url,
            &authorization,
            &request,
            epoch,
            sequence,
            true,
        )
        .await?
    } else {
        attach_live_viewer_http(&base_url, &authorization, &request, epoch, sequence).await?
    };
    identity.validate(&remote, &request.live_session_id)?;
    let event_cursor =
        bootstrap_live_viewer_cursor(&base_url, &authorization, &request, &remote).await?;
    let observation_capabilities = parse_live_observation_capabilities(&remote)?;
    let (trigger_registrations, trigger_audits) = parse_live_trigger_snapshot(&remote)?;
    let mut runtime_state = LiveRelayRuntimeState::starting(
        epoch,
        observation_capabilities.clone(),
        observation_capabilities
            .is_empty()
            .then(|| "source_did_not_advertise_observation".to_owned()),
    );
    runtime_state.trigger_registrations = trigger_registrations;
    runtime_state.trigger_audits = trigger_audits;
    runtime_state.observations = parse_live_viewer_observations(&remote)?;
    Ok(Arc::new(LiveRelaySession {
        relay_id,
        live_session_id: request.live_session_id,
        role: LiveRelayRole::Viewer,
        base_url,
        surface_instance_id: Some(request.surface_instance_id),
        attachment_id: Some(request.attachment_id),
        authorization,
        publication: None,
        viewer_identity: Some(identity),
        recovery_busy: AtomicBool::new(false),
        event_cursor: std::sync::atomic::AtomicU64::new(event_cursor),
        capture: None,
        state: Arc::new(Mutex::new(runtime_state)),
        frames: Arc::new(Mutex::new(LiveRelayFrameBuffer::new())),
        stop: Arc::new(AtomicBool::new(false)),
        reconnect: Arc::new(AtomicBool::new(false)),
        join: Mutex::new(None),
        control_join: Mutex::new(None),
        observation_join: Mutex::new(None),
        control_sequence: Mutex::new(sequence),
        input_sequence: Mutex::new(baseline.input),
    }))
}

fn start_live_relay_viewer_workers(relay: &Arc<LiveRelaySession>) -> Result<(), String> {
    refresh_live_observation_summary(relay)?;
    let worker = spawn_live_relay_viewer_worker(Arc::clone(relay))?;
    *relay
        .join
        .lock()
        .map_err(|_| "live relay worker lock poisoned")? = Some(worker);
    let worker = spawn_live_relay_control_worker(Arc::clone(relay))?;
    *relay
        .control_join
        .lock()
        .map_err(|_| "live relay control worker lock poisoned")? = Some(worker);
    Ok(())
}
