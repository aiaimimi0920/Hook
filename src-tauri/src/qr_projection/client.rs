use super::protocol::MAX_BODY;
use serde_json::Value;
use std::time::Duration;

pub(super) async fn send(
    base_url: &str,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    path: &str,
    body: Value,
) -> Result<Value, String> {
    crate::loom_connector::classify_loom_base_url(base_url)
        .map_err(|_| "projection_invalid_origin")?;
    let bytes = serde_json::to_vec(&body).map_err(|_| "projection_invalid_request")?;
    if bytes.len() > MAX_BODY {
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
        .is_some_and(|length| length > MAX_BODY as u64)
    {
        return Err("projection_response_budget".to_owned());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "projection_transport_failed")?
    {
        if bytes.len() + chunk.len() > MAX_BODY {
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
