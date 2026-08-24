//! Loom brain.plan request construction and bounded HTTP invocation.

use super::discovery::read_default_loom_manifest;
use super::manifest::validate_loom_manifest_value;
use super::sanitize::sanitize_invoke_response_body;
use super::types::*;
use futures_util::StreamExt;
use std::time::Duration;
use uuid::Uuid;

pub fn build_brain_plan_envelope(request: LoomBrainPlanRequest) -> LoomInvokeEnvelope {
    LoomInvokeEnvelope {
        request_id: request
            .request_id
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        caller: HOOK_CALLER.to_string(),
        capability: BRAIN_PLAN.to_string(),
        input: LoomBrainPlanInput {
            goal: request.goal,
            constraints: request.constraints,
            context: request.context,
        },
    }
}

pub async fn invoke_brain_plan(
    request: LoomBrainPlanRequest,
) -> Result<LoomBrainPlanResult, LoomConnectorError> {
    let manifest = read_default_loom_manifest()?;
    invoke_brain_plan_with_manifest(manifest, request).await
}

pub async fn invoke_brain_plan_with_manifest(
    manifest: LoomManifest,
    request: LoomBrainPlanRequest,
) -> Result<LoomBrainPlanResult, LoomConnectorError> {
    let manifest = validate_loom_manifest_value(manifest)?;
    let timeout_ms = bounded_timeout_ms(request.timeout_ms);
    let envelope = build_brain_plan_envelope(request);
    let endpoint = format!(
        "{}/v1/invoke",
        manifest.transport.base_url.trim_end_matches('/')
    );

    let mut builder =
        crate::network_proxy::shared_client(&endpoint, Some(Duration::from_millis(timeout_ms)))?
            .post(endpoint)
            .json(&envelope);
    if manifest
        .transport
        .auth
        .as_deref()
        .unwrap_or("none")
        .eq_ignore_ascii_case("bearer")
    {
        if let Some(token) = manifest
            .transport
            .auth_token
            .as_deref()
            .map(str::trim)
            .filter(|token| !token.is_empty())
        {
            builder = builder.bearer_auth(token);
        }
    }

    let response = builder
        .send()
        .await
        .map_err(|error| map_transport_error(error, timeout_ms))?;
    let status = response.status();
    let body = read_bounded_response_body(response, timeout_ms).await?;
    let parsed_envelope = parse_invoke_response_envelope(&body);
    if !status.is_success() {
        if let Ok(envelope) = parsed_envelope {
            if envelope.status == "failed" {
                return Ok(result_from_invoke_response(envelope));
            }
        }
        return Err(LoomConnectorError::InvokeStatus {
            status: status.as_u16(),
            body: sanitize_invoke_response_body(&body),
        });
    }

    let envelope = parsed_envelope?;
    Ok(result_from_invoke_response(envelope))
}

fn bounded_timeout_ms(requested: Option<u64>) -> u64 {
    requested
        .unwrap_or(DEFAULT_LOOM_INVOKE_TIMEOUT_MS)
        .clamp(1, MAX_LOOM_INVOKE_TIMEOUT_MS)
}

async fn read_bounded_response_body(
    response: reqwest::Response,
    timeout_ms: u64,
) -> Result<String, LoomConnectorError> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_INVOKE_RESPONSE_BODY_BYTES as u64)
    {
        return Err(LoomConnectorError::InvokeResponseTooLarge(
            MAX_INVOKE_RESPONSE_BODY_BYTES,
        ));
    }

    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(MAX_INVOKE_RESPONSE_BODY_BYTES as u64) as usize,
    );
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| map_transport_error(error, timeout_ms))?;
        append_response_chunk(&mut body, &chunk)?;
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

fn append_response_chunk(body: &mut Vec<u8>, chunk: &[u8]) -> Result<(), LoomConnectorError> {
    let next_len =
        body.len()
            .checked_add(chunk.len())
            .ok_or(LoomConnectorError::InvokeResponseTooLarge(
                MAX_INVOKE_RESPONSE_BODY_BYTES,
            ))?;
    if next_len > MAX_INVOKE_RESPONSE_BODY_BYTES {
        return Err(LoomConnectorError::InvokeResponseTooLarge(
            MAX_INVOKE_RESPONSE_BODY_BYTES,
        ));
    }
    body.extend_from_slice(chunk);
    Ok(())
}

fn map_transport_error(error: reqwest::Error, timeout_ms: u64) -> LoomConnectorError {
    if error.is_timeout() {
        LoomConnectorError::InvokeTimeout(timeout_ms)
    } else {
        LoomConnectorError::InvokeHttp(error)
    }
}

fn parse_invoke_response_envelope(
    body: &str,
) -> Result<LoomInvokeResponseEnvelope, LoomConnectorError> {
    serde_json::from_str(body).map_err(|error| {
        LoomConnectorError::InvokeResponseParse(format!(
            "{error}; body={}",
            sanitize_invoke_response_body(body)
        ))
    })
}

fn result_from_invoke_response(envelope: LoomInvokeResponseEnvelope) -> LoomBrainPlanResult {
    LoomBrainPlanResult {
        request_id: envelope.request_id,
        status: envelope.status,
        run_id: envelope
            .output
            .as_ref()
            .and_then(|output| output.run_id.clone()),
        summary: envelope
            .output
            .as_ref()
            .and_then(|output| output.summary.clone()),
        steps: envelope
            .output
            .as_ref()
            .map(|output| output.steps.clone())
            .unwrap_or_default(),
        run: envelope
            .output
            .as_ref()
            .and_then(|output| output.run.clone()),
        error: envelope.error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invocation_timeout_and_response_buffer_are_bounded() {
        assert_eq!(bounded_timeout_ms(None), DEFAULT_LOOM_INVOKE_TIMEOUT_MS);
        assert_eq!(bounded_timeout_ms(Some(0)), 1);
        assert_eq!(
            bounded_timeout_ms(Some(u64::MAX)),
            MAX_LOOM_INVOKE_TIMEOUT_MS
        );

        let mut body = vec![0; MAX_INVOKE_RESPONSE_BODY_BYTES];
        assert!(append_response_chunk(&mut body, &[1]).is_err());
    }
}
