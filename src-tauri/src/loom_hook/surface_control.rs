// Owns Surface lifecycle, confirmation, and cancellation requests.
async fn send_surface_lifecycle_to_loom(
    app: &AppHandle,
    event: serde_json::Value,
) -> Result<(), String> {
    let instance_id = event
        .get("instanceId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Surface lifecycle event has no instance id".to_owned())?;
    let instance_id = validate_surface_identifier(instance_id, "instance id")?;
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface lifecycle: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::shared_client(base, Some(Duration::from_secs(10)))
        .map_err(|error| format!("build Surface lifecycle client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, &manifest).await?;
    let lifecycle_url = surface_instance_endpoint(base, instance_id, "lifecycle")?;
    let request = authorization
        .apply(client.post(lifecycle_url))
        .json(&event);
    let response = request
        .send()
        .await
        .map_err(|error| format!("Surface lifecycle request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Surface lifecycle request returned {status}"));
    }
    Ok(())
}

async fn send_surface_confirmation_to_loom(
    app: &AppHandle,
    decision: serde_json::Value,
) -> Result<(), String> {
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface confirmation: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::shared_client(base, Some(Duration::from_secs(10)))
        .map_err(|error| format!("build Surface confirmation client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, &manifest).await?;
    let request = authorization
        .apply(client.post(format!("{base}/v1/surfaces/confirmations/decision")))
        .json(&decision);
    let response = request
        .send()
        .await
        .map_err(|error| format!("Surface confirmation request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Surface confirmation request returned {status}"));
    }
    Ok(())
}

async fn send_surface_cancel_to_loom(
    app: &AppHandle,
    mut request_body: serde_json::Value,
) -> Result<(), String> {
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface cancellation: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::shared_client(base, Some(Duration::from_secs(10)))
        .map_err(|error| format!("build Surface cancellation client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, &manifest).await?;
    request_body["deviceId"] = serde_json::Value::String(authorization.device_id.clone());
    let request = authorization
        .apply(client.post(format!("{base}/v1/surfaces/actions/cancel")))
        .json(&request_body);
    let response = request
        .send()
        .await
        .map_err(|error| format!("Surface cancellation request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Surface cancellation request returned {status}"));
    }
    Ok(())
}
