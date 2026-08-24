// Owns Surface attach and remount recovery requests.
async fn attach_surface_via_loom(
    app: &AppHandle,
    art_id: &str,
    hook_node_id: &str,
    capabilities: serde_json::Value,
) -> Result<(), String> {
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface attach: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::shared_client(base, Some(Duration::from_secs(10)))
        .map_err(|error| format!("build Surface HTTP client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, &manifest).await?;
    let send_json = |request: reqwest::RequestBuilder| async {
        let response = request
            .send()
            .await
            .map_err(|error| format!("Surface request failed: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("Surface request returned {status}"));
        }
        let body = read_bounded_loom_json_body(response, "Surface attach response").await?;
        serde_json::from_slice::<serde_json::Value>(&body)
            .map_err(|error| format!("parse Surface response: {error}"))
    };

    let mounted = send_json(
        authorization
            .apply(client.post(format!("{base}/v1/surfaces/attach")))
            .json(&serde_json::json!({
                "artId": art_id,
                "hookNodeId": hook_node_id,
                "deviceId": authorization.device_id,
                "capabilities": capabilities,
                "persistence": "persistent",
            })),
    )
    .await?;
    let instance_id = mounted
        .pointer("/instance/descriptor/instanceId")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Surface attach response has no instance id".to_owned())?;
    let attachments = mounted
        .pointer("/instance/attachments")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "Surface attach response has no attachments".to_owned())?;
    let (attachment_id, attachment) = attachments
        .iter()
        .find(|(_, attachment)| {
            attachment
                .pointer("/descriptor/hookNodeId")
                .and_then(serde_json::Value::as_str)
                == Some(hook_node_id)
        })
        .ok_or_else(|| "Surface attach response has no matching attachment".to_owned())?;
    let snapshot = mounted
        .pointer(&format!(
            "/instance/attachments/{}/snapshot",
            escape_json_pointer_token(attachment_id)
        ))
        .cloned()
        .ok_or_else(|| "Surface mount response has no snapshot".to_owned())?;
    let generation = mounted
        .pointer("/instance/descriptor/generation")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default();
    let lifecycle_revision = attachment
        .get("lifecycleRevision")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(1);
    app.emit(
        "surface/snapshot",
        serde_json::json!({
            "hookNodeId": hook_node_id,
            "snapshot": snapshot,
            "generation": generation,
        }),
    )
    .map_err(|error| format!("emit mounted Surface snapshot: {error}"))?;
    send_surface_lifecycle_to_loom(
        app,
        serde_json::json!({
            "protocolVersion": "loom.surface.v1",
            "instanceId": instance_id,
            "attachmentId": attachment_id,
            "state": "active",
            "revision": lifecycle_revision.saturating_add(1),
        }),
    )
    .await?;
    Ok(())
}

async fn remount_surface_via_loom(
    app: &AppHandle,
    instance_id: &str,
    attachment_id: &str,
    hook_node_id: &str,
) -> Result<(), String> {
    validate_surface_identifier(instance_id, "instance id")?;
    validate_surface_identifier(attachment_id, "attachment id")?;
    validate_surface_identifier(hook_node_id, "Hook node id")?;
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface remount: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::shared_client(base, Some(Duration::from_secs(10)))
        .map_err(|error| format!("build Surface remount client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, &manifest).await?;
    let mut mount_url = reqwest::Url::parse(base)
        .map_err(|error| format!("parse Surface remount base URL: {error}"))?;
    mount_url
        .path_segments_mut()
        .map_err(|_| "Surface remount base URL cannot carry path segments".to_owned())?
        .extend(["v1", "surfaces", "instances", instance_id, "mount"]);
    let response = authorization
        .apply(client.post(mount_url))
        .json(&serde_json::json!({ "attachmentId": attachment_id }))
        .send()
        .await
        .map_err(|error| format!("Surface remount request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Surface remount request returned {status}"));
    }
    let body = read_bounded_loom_json_body(response, "Surface remount response").await?;
    let mounted = serde_json::from_slice::<serde_json::Value>(&body)
        .map_err(|error| format!("parse Surface remount response: {error}"))?;
    let snapshot = mounted
        .pointer(&format!(
            "/instance/attachments/{}/snapshot",
            escape_json_pointer_token(attachment_id)
        ))
        .cloned()
        .ok_or_else(|| "Surface remount response has no snapshot".to_owned())?;
    let generation = mounted
        .pointer("/instance/descriptor/generation")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default();
    app.emit(
        "surface/snapshot",
        serde_json::json!({
            "hookNodeId": hook_node_id,
            "snapshot": snapshot,
            "generation": generation,
        }),
    )
    .map_err(|error| format!("emit recovered Surface snapshot: {error}"))?;
    Ok(())
}
