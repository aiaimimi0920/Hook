use std::net::IpAddr;
use std::sync::{OnceLock, RwLock};

use reqwest::{ClientBuilder, Proxy, Url};
use serde::Deserialize;

#[derive(Clone, Debug, Eq, PartialEq)]
enum RuntimeProxy {
    System,
    Disabled,
    Custom(String),
}

impl Default for RuntimeProxy {
    fn default() -> Self {
        Self::System
    }
}

#[derive(Deserialize)]
struct LoomSettings {
    #[serde(default)]
    network: LoomNetworkSettings,
}

#[derive(Default, Deserialize)]
struct LoomNetworkSettings {
    #[serde(default)]
    hook: LoomProxySettings,
}

#[derive(Default, Deserialize)]
struct LoomProxySettings {
    #[serde(default)]
    mode: String,
    #[serde(default)]
    protocol: String,
    #[serde(default)]
    address: String,
}

static RUNTIME_PROXY: OnceLock<RwLock<RuntimeProxy>> = OnceLock::new();

fn proxy_store() -> &'static RwLock<RuntimeProxy> {
    RUNTIME_PROXY.get_or_init(|| RwLock::new(RuntimeProxy::System))
}

pub fn apply_loom_settings(settings: &serde_json::Value) -> Result<(), String> {
    let settings: LoomSettings =
        serde_json::from_value(settings.clone()).map_err(|error| error.to_string())?;
    let proxy = match settings.network.hook.mode.as_str() {
        "" | "system" => RuntimeProxy::System,
        "disabled" => RuntimeProxy::Disabled,
        "custom" => {
            let protocol = settings.network.hook.protocol.trim();
            let address = settings.network.hook.address.trim();
            if !matches!(protocol, "http" | "https" | "socks5") || address.is_empty() {
                return Err("Hook 自定义代理配置无效".to_owned());
            }
            let url = format!("{protocol}://{address}");
            Proxy::all(&url).map_err(|error| format!("Hook 自定义代理配置无效：{error}"))?;
            RuntimeProxy::Custom(url)
        }
        mode => return Err(format!("Hook 不支持代理模式 `{mode}`")),
    };
    *proxy_store()
        .write()
        .map_err(|_| "无法锁定 Hook 代理设置".to_owned())? = proxy;
    Ok(())
}

fn endpoint_is_loopback(endpoint: &str) -> bool {
    let Ok(url) = Url::parse(endpoint) else {
        return false;
    };
    let Some(host) = url.host_str() else {
        return false;
    };
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

pub fn apply_to_url(
    builder: ClientBuilder,
    endpoint: &str,
) -> Result<ClientBuilder, reqwest::Error> {
    if endpoint_is_loopback(endpoint) {
        return Ok(builder.no_proxy());
    }
    let proxy = proxy_store()
        .read()
        .map(|proxy| proxy.clone())
        .unwrap_or_default();
    match proxy {
        RuntimeProxy::System => Ok(builder),
        RuntimeProxy::Disabled => Ok(builder.no_proxy()),
        RuntimeProxy::Custom(url) => Ok(builder.proxy(Proxy::all(url)?)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loom_settings_update_hook_proxy_runtime() {
        apply_loom_settings(&serde_json::json!({
            "network": {
                "hook": {
                    "mode": "custom",
                    "protocol": "socks5",
                    "address": "127.0.0.1:7890"
                }
            }
        }))
        .unwrap();
        assert_eq!(
            *proxy_store().read().unwrap(),
            RuntimeProxy::Custom("socks5://127.0.0.1:7890".to_owned())
        );
        assert!(apply_to_url(reqwest::Client::builder(), "https://example.com").is_ok());
        assert!(apply_to_url(reqwest::Client::builder(), "http://127.0.0.1:8765").is_ok());
        apply_loom_settings(&serde_json::json!({
            "network": { "hook": { "mode": "system" } }
        }))
        .unwrap();
    }
}
