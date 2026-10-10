// Device-authorized convergence reuses the existing filtered Surface stream.
// It never asks for an administrator credential or another attachment's state.
struct SurfaceEventStreamState {
    instance_id: String,
    attachment_id: String,
    event_id: String,
    request_id: String,
    generation: u64,
    base_revision: u64,
    succeeded: bool,
    snapshot: Option<serde_json::Value>,
    result: Option<serde_json::Value>,
}

impl SurfaceEventStreamState {
    fn new(
        instance_id: &str,
        attachment_id: &str,
        event_id: &str,
        generation: u64,
        base_revision: u64,
        ack: &serde_json::Value,
    ) -> Result<Self, String> {
        let request_id = ack
            .get("requestId")
            .and_then(serde_json::Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Surface acknowledgement has no request id".to_owned())?;
        if ack["protocolVersion"] != "loom.surface.v1"
            || ack["instanceId"] != instance_id
            || ack["eventId"] != event_id
            || ack["accepted"] != true
        {
            return Err("Surface acknowledgement identity does not match the event".to_owned());
        }
        let mut state = Self {
            instance_id: instance_id.to_owned(),
            attachment_id: attachment_id.to_owned(),
            event_id: event_id.to_owned(),
            request_id: request_id.to_owned(),
            generation,
            base_revision,
            succeeded: false,
            snapshot: None,
            result: None,
        };
        state.accept_ack(ack)?;
        Ok(state)
    }

    fn accept_ack(&mut self, ack: &serde_json::Value) -> Result<(), String> {
        if ack["protocolVersion"] != "loom.surface.v1"
            || ack["instanceId"] != self.instance_id
            || ack["eventId"] != self.event_id
            || ack["requestId"] != self.request_id
        {
            return Ok(());
        }
        match ack["status"].as_str() {
            Some("failed" | "cancelled" | "interrupted") => {
                return Err(ack
                    .pointer("/error/message")
                    .and_then(serde_json::Value::as_str)
                    .map(|message| sanitize_untrusted_message(message, "Surface action failed"))
                    .unwrap_or_else(|| "Surface action did not succeed".to_owned()))
            }
            Some("succeeded") => self.succeeded = true,
            _ => {}
        }
        Ok(())
    }

    fn accept_messages(&mut self, messages: &[serde_json::Value]) -> Result<(), String> {
        // Process the whole batch before accepting success: a newer terminal
        // failure or generation change must not be hidden by an earlier snapshot.
        for message in messages {
            let params = &message["params"];
            match message["method"].as_str() {
                Some("loom.surface.action.ack") => self.accept_ack(params)?,
                Some("loom.surface.snapshot") => {
                    let snapshot = &params["snapshot"];
                    if snapshot["instanceId"] != self.instance_id
                        || snapshot["attachmentId"] != self.attachment_id
                    {
                        continue;
                    }
                    let generation = params["generation"]
                        .as_u64()
                        .ok_or_else(|| "Surface stream snapshot has no generation".to_owned())?;
                    if generation < self.generation {
                        continue;
                    }
                    if generation > self.generation {
                        return Err(
                            "Surface generation changed during event convergence".to_owned()
                        );
                    }
                    let revision = snapshot["revision"]
                        .as_u64()
                        .ok_or_else(|| "Surface stream snapshot has no revision".to_owned())?;
                    if revision >= self.base_revision
                        && self
                            .snapshot
                            .as_ref()
                            .and_then(|value| value.pointer("/snapshot/revision"))
                            .and_then(serde_json::Value::as_u64)
                            .is_none_or(|old| revision >= old)
                    {
                        self.snapshot = Some(params.clone());
                    }
                }
                Some("loom.surface.result") => {
                    let commit = &params["commit"];
                    if commit["instanceId"] == self.instance_id
                        && commit["requestId"] == self.request_id
                        && commit["generation"].as_u64() == Some(self.generation)
                    {
                        self.result = Some(params.clone());
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn ready(&self) -> bool {
        self.succeeded && self.snapshot.is_some()
    }
}

async fn converge_surface_event_from_stream(
    app: &AppHandle,
    client: &reqwest::Client,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    base: &str,
    mut state: SurfaceEventStreamState,
) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(25);
    let mut cursor = 0;
    loop {
        let (next, reset, messages) = tokio::time::timeout_at(
            deadline,
            read_surface_event_stream(client, authorization, base, cursor),
        )
        .await
        .map_err(|_| "Surface action did not converge within 25 seconds".to_owned())??;
        if reset && cursor != 0 {
            return Err("Surface event convergence lost its stream history".to_owned());
        }
        state.accept_messages(&messages)?;
        cursor = next;
        if state.succeeded {
            // Patches may have arrived after the initial recovery snapshot. Only
            // recover the final snapshot after this exact action's success ack;
            // never re-emit the pre-action snapshot as successful convergence.
            let (_, _, messages) = tokio::time::timeout_at(
                deadline,
                read_surface_event_stream(client, authorization, base, 0),
            )
            .await
            .map_err(|_| "Surface action did not converge within 25 seconds".to_owned())??;
            state.snapshot = None;
            state.accept_messages(&messages)?;
        }
        if state.ready() {
            app.emit(
                "surface/snapshot",
                state.snapshot.as_ref().expect("ready snapshot"),
            )
            .map_err(|error| format!("emit converged Surface snapshot: {error}"))?;
            if let Some(result) = &state.result {
                app.emit("surface/result", result)
                    .map_err(|error| format!("emit converged Surface result: {error}"))?;
            }
            crate::append_runtime_log_line(&format!(
                "loom_hook_surface_event_converged :: instance_id={} event_id={} transport=device_stream",
                state.instance_id, state.event_id
            ));
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("Surface action did not converge within 25 seconds".to_owned());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn read_surface_event_stream(
    client: &reqwest::Client,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    base: &str,
    cursor: u64,
) -> Result<(u64, bool, Vec<serde_json::Value>), String> {
    let response = authorization
        .apply(client.get(format!(
            "{base}/v1/surfaces/stream?after={cursor}&timeoutMs=0"
        )))
        .send()
        .await
        .map_err(|error| format!("Surface convergence stream failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        if status.as_u16() == 401 {
            crate::device_session::invalidate_surface_sessions(base);
        }
        return Err(format!("Surface convergence stream returned {status}"));
    }
    let body = read_bounded_loom_json_body(response, "Surface convergence stream").await?;
    let envelope = serde_json::from_slice(&body)
        .map_err(|error| format!("parse Surface convergence stream: {error}"))?;
    surface_stream_envelope(&envelope, cursor)
}
