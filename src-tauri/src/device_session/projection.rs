//! Per-origin projection pairing reuses the local key without changing the default Loom ID.
use super::{
    cache, identity, pairing, session_attempt, DeviceSessionAuthorization, SurfaceRequestCredential,
};

pub(super) async fn authorize(
    app: &tauri::AppHandle,
    base_url: &str,
) -> Result<DeviceSessionAuthorization, String> {
    super::validate_secure_loom_base_url(base_url)?;
    let mut identity = identity::load_or_create_device_identity(app)?;
    let cache_key = format!(
        "{}\nprojection:{}",
        base_url.trim_end_matches('/'),
        identity.public_key
    );
    if let Some(authorization) = cache::get(&cache_key, session_attempt::unix_time_millis())? {
        return Ok(authorization);
    }
    let manifest = crate::loom_connector::read_default_loom_manifest().ok();
    identity.device_id = Some(
        match super::local_projection::register(base_url, &identity.public_key, manifest.as_ref())
            .await?
        {
            Some(device_id) => device_id,
            None => pairing::register_device_identity(base_url, &identity).await?,
        },
    );
    let session = session_attempt::wait_for_approved_device_session(base_url, &identity).await?;
    if identity.device_id.as_deref() != Some(session.device_id.as_str()) {
        return Err("projection_pairing_mismatch".to_owned());
    }
    let authorization = DeviceSessionAuthorization {
        device_id: session.device_id.clone(),
        credential: SurfaceRequestCredential::Device(session.token.clone()),
    };
    cache::insert(
        cache_key,
        session.device_id,
        session.token,
        session.expires_at_ms,
        session_attempt::unix_time_millis(),
    )?;
    Ok(authorization)
}
