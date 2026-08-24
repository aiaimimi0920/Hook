// Owns Surface event submission and convergence polling for snapshot/result state.
async fn send_surface_event_to_loom(
    app: &AppHandle,
    event: serde_json::Value,
) -> Result<(), String> {
    let instance_id = event
        .get("instanceId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Surface event has no instance id".to_owned())?;
    let instance_id = validate_surface_identifier(instance_id, "instance id")?;
    let attachment_id = event
        .get("attachmentId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Surface event has no attachment id".to_owned())?;
    let attachment_id = validate_surface_identifier(attachment_id, "attachment id")?;
    let event_id = event
        .get("eventId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Surface event has no event id".to_owned())?;
    let event_id = validate_surface_identifier(event_id, "event id")?;
    let base_revision = event
        .get("baseRevision")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "Surface event has no base revision".to_owned())?;
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface event: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::shared_client(base, Some(Duration::from_secs(10)))
        .map_err(|error| format!("build Surface event client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, &manifest).await?;
    let event_url = surface_instance_endpoint(base, instance_id, "events")?;
    let response = authorization
        .apply(client.post(event_url))
        .json(&event)
        .send()
        .await
        .map_err(|error| format!("Surface event request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Surface event request returned {status}"));
    }

    converge_surface_event_from_instance(
        app,
        &client,
        &authorization,
        base,
        instance_id,
        attachment_id,
        event_id,
        base_revision,
    )
    .await
}

struct SurfaceEventInstanceState {
    hook_node_id: String,
    snapshot: serde_json::Value,
    generation: u64,
    revision: u64,
    action_status: Option<String>,
    action_error: Option<String>,
    result_commit: Option<serde_json::Value>,
}

fn surface_event_instance_state(
    instance: &serde_json::Value,
    instance_id: &str,
    attachment_id: &str,
    event_id: &str,
) -> Result<SurfaceEventInstanceState, String> {
    if instance
        .pointer("/descriptor/instanceId")
        .and_then(serde_json::Value::as_str)
        != Some(instance_id)
    {
        return Err("Surface instance response identity does not match the event".to_owned());
    }
    let generation = instance
        .pointer("/descriptor/generation")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default();
    let attachment = instance
        .get("attachments")
        .and_then(serde_json::Value::as_object)
        .and_then(|attachments| attachments.get(attachment_id))
        .ok_or_else(|| "Surface instance response has no event attachment".to_owned())?;
    let hook_node_id = attachment
        .pointer("/descriptor/hookNodeId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Surface instance attachment has no Hook node id".to_owned())?
        .to_owned();
    let snapshot = attachment
        .get("snapshot")
        .cloned()
        .ok_or_else(|| "Surface instance attachment has no snapshot".to_owned())?;
    if snapshot
        .get("instanceId")
        .and_then(serde_json::Value::as_str)
        != Some(instance_id)
        || snapshot
            .get("attachmentId")
            .and_then(serde_json::Value::as_str)
            != Some(attachment_id)
    {
        return Err("Surface instance snapshot identity does not match the event".to_owned());
    }
    let revision = snapshot
        .get("revision")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "Surface instance snapshot has no revision".to_owned())?;
    let ack = instance
        .get("eventAcks")
        .and_then(serde_json::Value::as_object)
        .and_then(|acks| acks.get(event_id));
    let action_status = ack
        .and_then(|value| value.get("status"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    let action_error = ack
        .and_then(|value| value.pointer("/error/message"))
        .and_then(serde_json::Value::as_str)
        .map(|message| sanitize_untrusted_message(message, "Surface action failed"));
    let request_id = ack
        .and_then(|value| value.get("requestId"))
        .and_then(serde_json::Value::as_str);
    let result_commit = instance
        .get("latestResult")
        .filter(|commit| {
            request_id.is_some()
                && commit.get("requestId").and_then(serde_json::Value::as_str) == request_id
        })
        .cloned();
    Ok(SurfaceEventInstanceState {
        hook_node_id,
        snapshot,
        generation,
        revision,
        action_status,
        action_error,
        result_commit,
    })
}

async fn converge_surface_event_from_instance(
    app: &AppHandle,
    client: &reqwest::Client,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    base: &str,
    instance_id: &str,
    attachment_id: &str,
    event_id: &str,
    base_revision: u64,
) -> Result<(), String> {
    const POLL_INTERVAL: Duration = Duration::from_millis(200);
    const CONVERGENCE_TIMEOUT: Duration = Duration::from_secs(25);

    let deadline = tokio::time::Instant::now() + CONVERGENCE_TIMEOUT;
    let instance_url = surface_instance_endpoint(base, instance_id, "")?;
    let mut instance_url = instance_url;
    {
        let mut segments = instance_url
            .path_segments_mut()
            .map_err(|_| "Surface instance URL cannot carry path segments".to_owned())?;
        segments.pop_if_empty();
    }
    let mut last_error: Option<String>;
    loop {
        let response = authorization
            .apply(client.get(instance_url.clone()))
            .send()
            .await;
        match response {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    let body = read_bounded_loom_json_body(
                        response,
                        "Surface convergence response",
                    )
                    .await?;
                    match serde_json::from_slice::<serde_json::Value>(&body)
                        .map_err(|error| format!("parse Surface convergence response: {error}"))
                        .and_then(|instance| {
                            surface_event_instance_state(
                                &instance,
                                instance_id,
                                attachment_id,
                                event_id,
                            )
                        }) {
                        Ok(state) => {
                            if matches!(
                                state.action_status.as_deref(),
                                Some("failed" | "cancelled" | "interrupted")
                            ) {
                                return Err(state.action_error.unwrap_or_else(|| {
                                    format!(
                                        "Surface action ended with status {}",
                                        state.action_status.as_deref().unwrap_or("failed")
                                    )
                                }));
                            }
                            if state.revision > base_revision
                                || state.action_status.as_deref() == Some("succeeded")
                            {
                                app.emit(
                                    "surface/snapshot",
                                    serde_json::json!({
                                        "hookNodeId": state.hook_node_id,
                                        "snapshot": state.snapshot,
                                        "generation": state.generation,
                                    }),
                                )
                                .map_err(|error| {
                                    format!("emit converged Surface snapshot: {error}")
                                })?;
                                if let Some(commit) = state.result_commit {
                                    app.emit(
                                        "surface/result",
                                        serde_json::json!({
                                            "hookNodeId": state.hook_node_id,
                                            "commit": commit,
                                        }),
                                    )
                                    .map_err(|error| {
                                        format!("emit converged Surface result: {error}")
                                    })?;
                                }
                                crate::append_runtime_log_line(&format!(
                                    "loom_hook_surface_event_converged :: instance_id={} event_id={} revision={}",
                                    instance_id, event_id, state.revision
                                ));
                                return Ok(());
                            }
                            last_error = None;
                        }
                        Err(error) => last_error = Some(error),
                    }
                } else {
                    if status.as_u16() == 401 {
                        crate::device_session::invalidate_surface_sessions(base);
                    }
                    last_error = Some(format!("Surface convergence request returned {status}"));
                }
            }
            Err(error) => last_error = Some(format!("Surface convergence request failed: {error}")),
        }

        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "Surface action did not publish an updated snapshot within {} seconds{}",
                CONVERGENCE_TIMEOUT.as_secs(),
                last_error
                    .as_deref()
                    .map(|error| format!(": {error}"))
                    .unwrap_or_default()
            ));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}
