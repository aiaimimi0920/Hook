//! Challenge signing and bounded polling for an approved Loom device session.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD as BASE64_URL};
use base64::Engine as _;
use ed25519_dalek::Signer as _;
use futures_util::StreamExt;
use rand_core::{OsRng, RngCore};
use serde::Deserialize;

use super::identity::{decode_signing_key, DeviceIdentityDocument};

const DEVICE_PAIRING_APPROVAL_TIMEOUT: Duration = Duration::from_secs(90);
const DEVICE_PAIRING_APPROVAL_POLL_INTERVAL: Duration = Duration::from_millis(250);
const MAX_SURFACE_RESPONSE_BODY_BYTES: usize = 256 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceSessionChallenge {
    challenge_id: String,
    device_id: String,
    challenge: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct DeviceSessionResponse {
    pub(super) device_id: String,
    pub(super) token: String,
    pub(super) expires_at_ms: u64,
}

#[derive(Debug)]
enum DeviceSessionAttemptError {
    PendingApproval(String),
    Fatal(String),
}

pub(super) async fn wait_for_approved_device_session(
    base_url: &str,
    identity: &DeviceIdentityDocument,
) -> Result<DeviceSessionResponse, String> {
    let deadline = tokio::time::Instant::now() + DEVICE_PAIRING_APPROVAL_TIMEOUT;
    loop {
        match create_device_session_attempt(base_url, identity).await {
            Ok(session) => return Ok(session),
            Err(DeviceSessionAttemptError::PendingApproval(error)) => {
                if tokio::time::Instant::now() >= deadline {
                    return Err(format!(
                        "Loom did not approve this Hook device within {} seconds: {error}",
                        DEVICE_PAIRING_APPROVAL_TIMEOUT.as_secs()
                    ));
                }
                tokio::time::sleep(DEVICE_PAIRING_APPROVAL_POLL_INTERVAL).await;
            }
            Err(DeviceSessionAttemptError::Fatal(error)) => return Err(error),
        }
    }
}

async fn create_device_session_attempt(
    base_url: &str,
    identity: &DeviceIdentityDocument,
) -> Result<DeviceSessionResponse, DeviceSessionAttemptError> {
    let base = base_url.trim_end_matches('/');
    let device_id = identity.device_id.as_deref().ok_or_else(|| {
        DeviceSessionAttemptError::Fatal("Hook device identity is not paired".to_owned())
    })?;
    let client = surface_client(base).map_err(DeviceSessionAttemptError::Fatal)?;
    let challenge_response = client
        .post(format!("{base}/v1/device-sessions/challenges"))
        .json(&serde_json::json!({"deviceId": device_id}))
        .send()
        .await
        .map_err(|error| {
            DeviceSessionAttemptError::Fatal(format!("request Loom device challenge: {error}"))
        })?;
    let challenge_status = challenge_response.status();
    let challenge_body = read_surface_response_body(challenge_response)
        .await
        .map_err(DeviceSessionAttemptError::Fatal)?;
    if !challenge_status.is_success() {
        let error = format!(
            "Loom has not approved this Hook device or cannot issue a session ({challenge_status}): {challenge_body}"
        );
        return if is_pending_device_approval(challenge_status.as_u16(), &challenge_body) {
            Err(DeviceSessionAttemptError::PendingApproval(error))
        } else {
            Err(DeviceSessionAttemptError::Fatal(error))
        };
    }
    let challenge =
        serde_json::from_str::<DeviceSessionChallenge>(&challenge_body).map_err(|error| {
            DeviceSessionAttemptError::Fatal(format!("parse Loom device challenge: {error}"))
        })?;
    if challenge.device_id != device_id {
        return Err(DeviceSessionAttemptError::Fatal(
            "Loom device challenge identity mismatch".to_owned(),
        ));
    }

    let client_nonce = random_url_safe(24);
    let message = device_session_signature_message(
        device_id,
        &challenge.challenge_id,
        &challenge.challenge,
        &client_nonce,
    );
    let signature = decode_signing_key(&identity.private_key)
        .map_err(DeviceSessionAttemptError::Fatal)?
        .sign(message.as_bytes());
    let session_response = client
        .post(format!("{base}/v1/device-sessions"))
        .json(&serde_json::json!({
            "deviceId": device_id,
            "challengeId": challenge.challenge_id,
            "clientNonce": client_nonce,
            "signature": BASE64.encode(signature.to_bytes()),
        }))
        .send()
        .await
        .map_err(|error| {
            DeviceSessionAttemptError::Fatal(format!("create Loom device session: {error}"))
        })?;
    let session_status = session_response.status();
    let session_body = read_surface_response_body(session_response)
        .await
        .map_err(DeviceSessionAttemptError::Fatal)?;
    if !session_status.is_success() {
        return Err(DeviceSessionAttemptError::Fatal(format!(
            "Loom device session request returned {session_status}: {session_body}"
        )));
    }
    serde_json::from_str::<DeviceSessionResponse>(&session_body).map_err(|error| {
        DeviceSessionAttemptError::Fatal(format!("parse Loom device session: {error}"))
    })
}

pub(super) fn is_pending_device_approval(status: u16, body: &str) -> bool {
    status == 403
        && serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|value| {
                value
                    .pointer("/error/code")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)
            })
            .as_deref()
            == Some("device_not_authorized")
}

pub(super) fn surface_client(base_url: &str) -> Result<reqwest::Client, String> {
    crate::network_proxy::shared_client(base_url, Some(Duration::from_secs(10)))
        .map_err(|error| format!("build Hook device session client: {error}"))
}

pub(super) async fn read_surface_response_body(
    response: reqwest::Response,
) -> Result<String, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_SURFACE_RESPONSE_BODY_BYTES as u64)
    {
        return Err(format!(
            "Loom Surface response exceeds {} bytes",
            MAX_SURFACE_RESPONSE_BODY_BYTES
        ));
    }
    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(MAX_SURFACE_RESPONSE_BODY_BYTES as u64) as usize,
    );
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("read Loom Surface response: {error}"))?;
        let next_len = body
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| "Loom Surface response length overflow".to_owned())?;
        if next_len > MAX_SURFACE_RESPONSE_BODY_BYTES {
            return Err(format!(
                "Loom Surface response exceeds {} bytes",
                MAX_SURFACE_RESPONSE_BODY_BYTES
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

pub(super) fn device_session_signature_message(
    device_id: &str,
    challenge_id: &str,
    challenge: &str,
    client_nonce: &str,
) -> String {
    format!("loom.device-session.v1\n{device_id}\n{challenge_id}\n{challenge}\n{client_nonce}")
}

pub(super) fn random_url_safe(byte_count: usize) -> String {
    let mut bytes = vec![0_u8; byte_count];
    OsRng.fill_bytes(&mut bytes);
    BASE64_URL.encode(bytes)
}

pub(super) fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn response_accumulator_limit_is_finite() {
        assert_eq!(MAX_SURFACE_RESPONSE_BODY_BYTES, 256 * 1024);
    }
}
