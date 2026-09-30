use super::protocol::MAX_BODY;
use serde_json::Value;
use std::time::Duration;

pub(super) fn request_permit(
    base_url: &str,
) -> Result<tokio::sync::SemaphorePermit<'static>, String> {
    use crate::loom_connector::{classify_loom_base_url, LoomBaseUrlKind};
    // A remote pairing wait must not exhaust the local Loom's creation capacity.
    static LOCAL: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    static REMOTE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    let pool = match classify_loom_base_url(base_url) {
        Ok(LoomBaseUrlKind::LoopbackHttp | LoomBaseUrlKind::LoopbackHttps) => &LOCAL,
        Ok(LoomBaseUrlKind::RemoteHttps) => &REMOTE,
        Err(_) => return Err("projection_invalid_origin".to_owned()),
    };
    pool.try_acquire().map_err(|_| "projection_busy".to_owned())
}

pub(super) async fn send(
    base_url: &str,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    path: &str,
    body: Value,
) -> Result<Value, String> {
    crate::loom_connector::classify_loom_base_url(base_url)
        .map_err(|_| "projection_invalid_origin")?;
    let bytes = serde_json::to_vec(&body).map_err(|_| "projection_invalid_request")?;
    let max_body = if path.ends_with("/edit") {
        super::edit::MAX_BYTES
    } else {
        MAX_BODY
    };
    if bytes.len() > max_body {
        return Err("projection_request_budget".to_owned());
    }
    let client = crate::network_proxy::shared_client_with(
        base_url,
        Some(Duration::from_secs(
            if path.starts_with("/v1/projections/v2/") {
                40
            } else {
                12
            },
        )),
        "qr-projection",
        |builder| builder.redirect(reqwest::redirect::Policy::none()),
    )
    .map_err(|_| "projection_transport_unavailable")?;
    let mut response = authorization
        .apply(
            client
                .post(format!("{}{path}", base_url.trim_end_matches('/')))
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .body(bytes),
        )
        .send()
        .await
        .map_err(|_| "projection_transport_failed")?;
    let status = response.status().as_u16();
    if status == 401 && !path.starts_with("/v1/projections/v2/") {
        crate::device_session::invalidate_surface_sessions(base_url);
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_body as u64)
    {
        return Err("projection_response_budget".to_owned());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "projection_transport_failed")?
    {
        if bytes.len() + chunk.len() > max_body {
            return Err("projection_response_budget".to_owned());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "projection_invalid_response")?;
    if !(200..300).contains(&status) {
        let code = value
            .get("code")
            .or_else(|| value.pointer("/error/code"))
            .and_then(Value::as_str)
            .filter(|code| {
                (code.starts_with("projection_")
                    || code.starts_with("account_")
                    || *code == "device_session_unavailable")
                    && code.len() <= 96
                    && code
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
            })
            .unwrap_or(if status == 401 {
                "projection_pairing_required"
            } else {
                "projection_request_failed"
            });
        return Err(code.to_owned());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_waits_cannot_starve_bounded_local_requests() {
        let remote_a = request_permit("https://unreachable.invalid").unwrap();
        let remote_b = request_permit("https://unreachable.invalid").unwrap();
        assert!(request_permit("https://unreachable.invalid").is_err());
        let local_a = request_permit("http://127.0.0.1:8765").unwrap();
        let local_b = request_permit("https://[::1]:8765").unwrap();
        assert!(request_permit("http://127.0.0.1:8765").is_err());
        drop((remote_a, remote_b, local_a, local_b));
        assert!(request_permit("http://127.0.0.1:8765").is_ok());
    }
}
