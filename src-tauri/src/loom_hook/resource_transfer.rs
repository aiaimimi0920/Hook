// Owns leased Surface resource validation, transfer, digest verification, and emission.
const MAX_SURFACE_RESOURCE_BYTES: usize = 16 * 1024 * 1024;

fn current_unix_time_ms() -> Result<u64, String> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("read system clock for Surface resource: {error}"))
        .and_then(|duration| {
            u64::try_from(duration.as_millis())
                .map_err(|_| "Surface resource system time exceeds u64".to_owned())
        })
}

fn validate_surface_resource_lease_time(expires_at_ms: u64) -> Result<(), String> {
    let now_ms = current_unix_time_ms()?;
    if expires_at_ms <= now_ms || expires_at_ms > now_ms.saturating_add(60 * 60 * 1_000) {
        return Err("Surface resource lease is expired or exceeds the lease budget".to_owned());
    }
    Ok(())
}

fn append_surface_chunk_with_limit(
    bytes: &mut Vec<u8>,
    chunk: &[u8],
    max_bytes: usize,
) -> Result<(), String> {
    let next_len = bytes
        .len()
        .checked_add(chunk.len())
        .ok_or_else(|| "Surface resource response size overflow".to_owned())?;
    if next_len > max_bytes {
        return Err("Surface resource response exceeds the Hook budget".to_owned());
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}

fn append_bounded_surface_chunk(bytes: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    append_surface_chunk_with_limit(bytes, chunk, MAX_SURFACE_RESOURCE_BYTES)
}

async fn fetch_surface_resource_from_loom(
    app: &AppHandle,
    lease: &serde_json::Value,
) -> Result<(), String> {
    use sha2::{Digest as _, Sha256};

    let resource_id = lease
        .pointer("/resource/resourceId")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Surface resource lease has no resource id".to_owned())?;
    let lease_id = lease
        .get("leaseId")
        .and_then(serde_json::Value::as_str)
        .filter(|lease_id| {
            !lease_id.is_empty()
                && lease_id.len() <= 160
                && lease_id.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
                })
        })
        .ok_or_else(|| "Surface resource lease id is invalid".to_owned())?;
    let digest = resource_id
        .strip_prefix("sha256:")
        .filter(|digest| digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| "Surface resource id is not a SHA-256 digest".to_owned())?;
    let expected_size = lease
        .pointer("/resource/size")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "Surface resource lease has no size".to_owned())?;
    if expected_size == 0 || expected_size > MAX_SURFACE_RESOURCE_BYTES as u64 {
        return Err("Surface resource size exceeds the Hook budget".to_owned());
    }
    let expires_at_ms = lease
        .get("expiresAtMs")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "Surface resource lease has no expiry".to_owned())?;
    validate_surface_resource_lease_time(expires_at_ms)?;
    let mime = lease
        .pointer("/resource/mime")
        .and_then(serde_json::Value::as_str)
        .filter(|mime| !mime.trim().is_empty() && mime.len() <= 160 && mime.is_ascii())
        .ok_or_else(|| "Surface resource MIME type is invalid".to_owned())?;
    let transport_kind = lease
        .pointer("/transport/kind")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Surface resource transport is missing".to_owned())?;
    let verify_digest = |bytes: &[u8]| -> Result<(), String> {
        if bytes.len() as u64 != expected_size || bytes.len() > MAX_SURFACE_RESOURCE_BYTES {
            return Err("Surface resource size does not match its descriptor".to_owned());
        }
        let actual = Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        if !actual.eq_ignore_ascii_case(digest) {
            return Err("Surface resource failed digest validation".to_owned());
        }
        Ok(())
    };
    let to_data_url = |bytes: Vec<u8>| -> Result<String, String> {
        if mime != "application/x-neuro-rgba8" {
            return Ok(format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ));
        }
        let width = lease
            .pointer("/resource/width")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| "Surface RGBA resource has no valid width".to_owned())?;
        let height = lease
            .pointer("/resource/height")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| "Surface RGBA resource has no valid height".to_owned())?;
        let rgba_size = u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| "Surface RGBA dimensions overflow".to_owned())?;
        if rgba_size != bytes.len() as u64 {
            return Err("Surface RGBA dimensions do not match its payload".to_owned());
        }
        let image = RgbaImage::from_raw(width, height, bytes)
            .ok_or_else(|| "Surface RGBA payload is invalid".to_owned())?;
        let mut encoded = Cursor::new(Vec::new());
        image
            .write_to(&mut encoded, image::ImageFormat::Png)
            .map_err(|error| format!("encode Surface RGBA resource: {error}"))?;
        Ok(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(encoded.into_inner())
        ))
    };
    let emit_resource = |data_url: String| -> Result<(), String> {
        app.emit(
            "surface/resource",
            serde_json::json!({
                "leaseId": lease_id,
                "resourceId": resource_id,
                "dataUrl": data_url,
                "expiresAtMs": expires_at_ms,
            }),
        )
        .map_err(|error| format!("emit Surface resource: {error}"))
    };
    if transport_kind == "shared_memory" {
        if mime != "application/x-neuro-rgba8" {
            return Err("Surface shared memory uses an unsupported MIME type".to_owned());
        }
        let handle = lease
            .pointer("/transport/handle")
            .and_then(serde_json::Value::as_str)
            .filter(|handle| {
                !handle.is_empty()
                    && handle.len() <= 160
                    && handle.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric()
                            || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
                    })
            })
            .ok_or_else(|| "Surface shared-memory handle is invalid".to_owned())?;
        let expected_size = usize::try_from(expected_size)
            .map_err(|_| "Surface resource size exceeds this platform".to_owned())?;
        let memory = ShmemConf::new()
            .size(expected_size)
            .os_id(handle)
            .open()
            .map_err(|error| format!("open Surface shared memory: {error}"))?;
        if memory.len() < expected_size {
            return Err("Surface shared-memory mapping is smaller than its descriptor".to_owned());
        }
        let bytes = unsafe { memory.as_slice()[..expected_size].to_vec() };
        validate_surface_resource_lease_time(expires_at_ms)?;
        verify_digest(&bytes)?;
        return emit_resource(to_data_url(bytes)?);
    }
    if transport_kind != "loom_resource" {
        return Err("Surface resource transport is not supported".to_owned());
    }
    let path = lease
        .pointer("/transport/path")
        .and_then(serde_json::Value::as_str)
        .filter(|path| {
            *path == format!("/v1/surfaces/resources/{digest}")
                && !path.contains('?')
                && !path.contains('#')
        })
        .ok_or_else(|| "Surface resource path is invalid".to_owned())?;
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface resource: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::shared_client(base, Some(Duration::from_secs(20)))
        .map_err(|error| format!("build Surface resource client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, &manifest).await?;
    let request = authorization
        .apply(client.get(format!("{base}{path}")))
        .header("X-Loom-Surface-Lease", lease_id);
    let response = request
        .send()
        .await
        .map_err(|error| format!("Surface resource request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Surface resource request returned {}",
            response.status()
        ));
    }
    if let Some(size) = response.content_length() {
        if size > MAX_SURFACE_RESOURCE_BYTES as u64 || size != expected_size {
            return Err("Surface resource response size does not match its descriptor".to_owned());
        }
    }
    let capacity = usize::try_from(expected_size)
        .map_err(|_| "Surface resource size exceeds this platform".to_owned())?;
    let mut bytes = Vec::with_capacity(capacity);
    let mut response = response;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("read Surface resource response: {error}"))?
    {
        append_bounded_surface_chunk(&mut bytes, &chunk)?;
    }
    validate_surface_resource_lease_time(expires_at_ms)?;
    verify_digest(&bytes)?;
    emit_resource(to_data_url(bytes)?)
}
