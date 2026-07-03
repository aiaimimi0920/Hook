use crate::voice::core::VoiceConfig;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct LoomClaim {
    managed: bool,
}

#[derive(Debug, Deserialize)]
struct LoomVoiceConfigResponse {
    config: VoiceConfig,
}

pub async fn read_hook_voice_config(
    base_url: &str,
    auth_token: Option<&str>,
) -> Result<Option<VoiceConfig>, String> {
    let client = reqwest::Client::new();
    let base = base_url.trim_end_matches('/');
    let mut claim = client.get(format!("{base}/v1/configuration/claims?app=hook"));
    if let Some(token) = auth_token {
        claim = claim.bearer_auth(token);
    }
    let claim = claim
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<LoomClaim>()
        .await
        .map_err(|error| error.to_string())?;
    if !claim.managed {
        return Ok(None);
    }

    let mut request = client.get(format!("{base}/v1/configuration/apps/hook"));
    if let Some(token) = auth_token {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?
        .json::<LoomVoiceConfigResponse>()
        .await
        .map_err(|error| error.to_string())?;
    response
        .config
        .validate()
        .map_err(|error| error.to_string())?;
    Ok(Some(response.config))
}
