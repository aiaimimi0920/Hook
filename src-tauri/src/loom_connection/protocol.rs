//! Bounded native-only HTTP control protocol; receipts and session tokens never enter WebView.
use crate::device_session::DeviceSessionAuthorization;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoomInfo {
    pub protocol_version: String,
    pub loom_id: String,
    pub name: String,
    pub endpoint: Option<String>,
    pub discoverable: bool,
    pub approval: String,
    pub password_required: bool,
}

pub(crate) fn origin(value: &str) -> Result<String, String> {
    if value.len() > 512 {
        return Err("Loom 地址过长".into());
    }
    let value = value.trim().trim_end_matches('/');
    crate::loom_connector::classify_loom_base_url(value)
        .map_err(|_| "请输入有效地址；远程 Loom 必须使用 HTTPS".to_string())?;
    reqwest::Url::parse(value)
        .map(|url| url.origin().ascii_serialization())
        .map_err(|_| "Loom 地址无效".into())
}

pub(crate) fn validate_info(info: &LoomInfo) -> Result<(), String> {
    if info.protocol_version != "loom.connection.v1"
        || info.loom_id.len() > 160
        || !info.loom_id.starts_with("loom-")
        || info.name.len() > 256
        || info.name.chars().any(char::is_control)
        || !matches!(
            info.approval.as_str(),
            "manual" | "password" | "authenticated"
        )
    {
        return Err("Loom 连接协议或身份无效".into());
    }
    Ok(())
}

pub(crate) async fn request(
    base: &str,
    path: &str,
    body: Option<Value>,
    authorization: Option<&DeviceSessionAuthorization>,
) -> Result<Value, String> {
    let client = crate::network_proxy::loom_client(base, Some(Duration::from_secs(8)))
        .map_err(|_| "无法创建 Loom 连接".to_string())?;
    let url = format!("{base}{path}");
    let request = match body {
        Some(body) => client.post(url).json(&body),
        None => client.get(url),
    };
    let response = match authorization {
        Some(auth) => auth.apply(request),
        None => request,
    }
    .send()
    .await
    .map_err(|_| "无法访问 Loom，请检查地址、证书及网络".to_string())?;
    let status = response.status();
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "读取 Loom 响应失败".to_string())?;
        if bytes.len().saturating_add(chunk.len()) > 64 * 1024 {
            return Err("Loom 响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Loom 响应格式无效".to_string())?;
    if !status.is_success() {
        let code = value
            .pointer("/error/code")
            .and_then(Value::as_str)
            .unwrap_or("");
        return Err(match code {
            "connection_password_invalid" => "密码不正确",
            "connection_rate_limited" => "连接申请过于频繁，请稍后重试",
            "device_disabled" | "connection_authentication_revoked" => "设备授权已撤销",
            "connection_request_unavailable" => "连接申请已过期或取消",
            _ => "Loom 拒绝连接，请检查审批和设备授权",
        }
        .into());
    }
    Ok(value)
}

pub(crate) async fn probe(base: &str) -> Result<LoomInfo, String> {
    let info: LoomInfo =
        serde_json::from_value(request(base, "/v1/otter/identity", None, None).await?)
            .map_err(|_| "Loom 身份响应无效".to_string())?;
    validate_info(&info)?;
    Ok(info)
}

pub(crate) fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn connection_origins_do_not_accept_credentials_paths_or_remote_plaintext() {
        for invalid in [
            "http://192.168.1.2:8310",
            "https://u:p@localhost",
            "https://loom.test/path",
            "https://loom.test?a=1",
        ] {
            assert!(origin(invalid).is_err(), "{invalid}");
        }
        assert_eq!(
            origin("https://LOOM.test:443/").unwrap(),
            "https://loom.test"
        );
        assert!(origin("http://127.0.0.1:8310").is_ok());
    }
}
