//! User-selected LAN targets use origin-scoped trust-on-first-use. Discovery alone
//! never trusts a certificate; existing pins cannot be replaced by advertisements.
use crate::loom_tls::ScopedTrust;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex, OnceLock},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pairing {
    version: u8,
    origin: String,
    loom_id: String,
    certificate: String,
}
static TRUSTED: OnceLock<Mutex<HashMap<String, Arc<ScopedTrust>>>> = OnceLock::new();
fn trusted() -> &'static Mutex<HashMap<String, Arc<ScopedTrust>>> {
    TRUSTED.get_or_init(|| Mutex::new(HashMap::new()))
}

fn validate(pair: &Pairing) -> Result<ScopedTrust, String> {
    let url = reqwest::Url::parse(&pair.origin).map_err(|_| "发现信息地址无效")?;
    let host = url
        .host_str()
        .and_then(|host| host.parse::<std::net::Ipv4Addr>().ok())
        .ok_or("发现信息需要局域网 IPv4 地址")?;
    if pair.version != 1
        || !(host.is_private() || host.is_loopback())
        || pair.certificate.len() > 8192
        || pair.loom_id.len() > 160
        || !pair.loom_id.starts_with("loom-")
    {
        return Err("Loom 发现信息无效".into());
    }
    let bytes = STANDARD
        .decode(&pair.certificate)
        .map_err(|_| "发现信息证书无效")?;
    let certificate = STANDARD.encode(bytes);
    let pem = format!("-----BEGIN CERTIFICATE-----\n{certificate}\n-----END CERTIFICATE-----\n");
    ScopedTrust::from_pem(&pair.origin, pem.as_bytes()).map_err(|_| "发现信息证书或地址无效".into())
}

fn load(root: &Path) -> Result<Vec<Pairing>, String> {
    let file = match std::fs::File::open(root.join("loom-lan-trust.json")) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("读取 Loom 证书记录失败".into()),
    };
    let mut bytes = Vec::new();
    file.take(160 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取 Loom 证书记录失败")?;
    if bytes.len() > 160 * 1024 {
        return Err("Loom 证书记录过大".into());
    }
    let pairs: Vec<Pairing> = serde_json::from_slice(&bytes).map_err(|_| "Loom 证书记录无效")?;
    if pairs.len() > 16 {
        return Err("Loom 证书数量超过上限".into());
    }
    for pair in &pairs {
        validate(pair)?;
    }
    Ok(pairs)
}

pub(crate) fn initialize(root: &Path) -> Result<(), String> {
    let pairs = load(root)?;
    let mut next = HashMap::new();
    for pair in pairs {
        next.insert(pair.origin.clone(), Arc::new(validate(&pair)?));
    }
    *trusted().lock().map_err(|_| "Loom 证书状态不可用")? = next;
    Ok(())
}

pub(crate) fn for_endpoint(endpoint: &str) -> Option<Arc<ScopedTrust>> {
    trusted()
        .lock()
        .ok()?
        .values()
        .find(|trust| trust.matches(endpoint))
        .cloned()
}

#[tauri::command]
pub(crate) async fn loom_connection_prepare_discovered(
    app: tauri::AppHandle,
    origin: String,
    loom_id: String,
    certificate: String,
) -> Result<serde_json::Value, String> {
    use futures_util::StreamExt;
    let mut pair = Pairing {
        version: 1,
        origin,
        loom_id,
        certificate,
    };
    let trust = validate(&pair)?;
    pair.origin = reqwest::Url::parse(&pair.origin)
        .map_err(|_| "发现信息地址无效")?
        .origin()
        .ascii_serialization();
    let root = crate::effective_app_data_dir(&app)?;
    check_existing(&load(&root)?, &pair)?;
    let client = trust
        .apply_http(
            reqwest::Client::builder()
                .no_proxy()
                .timeout(std::time::Duration::from_secs(8)),
        )
        .build()
        .map_err(|_| "无法创建安全连接")?;
    let response = client
        .get(format!("{}/v1/otter/identity", pair.origin))
        .send()
        .await
        .map_err(|_| "无法访问 Loom，请检查局域网地址和 Windows 防火墙")?;
    if !response.status().is_success() {
        return Err("Loom 身份验证失败".into());
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "读取 Loom 身份失败")?;
        if body.len() + chunk.len() > 65536 {
            return Err("Loom 身份响应过大".into());
        }
        body.extend_from_slice(&chunk);
    }
    let info: serde_json::Value = serde_json::from_slice(&body).map_err(|_| "Loom 身份无效")?;
    if info["loomId"].as_str() != Some(&pair.loom_id)
        || info["protocolVersion"] != "loom.connection.v1"
    {
        return Err("Loom 身份与发现信息不一致".into());
    }
    // Serialize read-modify-write so concurrent imports cannot lose another origin.
    let mut state = trusted().lock().map_err(|_| "Loom 证书状态不可用")?;
    let mut pairs = load(&root)?;
    check_existing(&pairs, &pair)?;
    pairs.retain(|old| old.origin != pair.origin);
    if pairs.len() >= 16 {
        return Err("已信任的 Loom 数量达到上限".into());
    }
    pairs.push(pair.clone());
    std::fs::create_dir_all(&root).map_err(|_| "无法保存 Loom 证书")?;
    let temporary = root.join(format!("loom-lan-trust-{}.tmp", uuid::Uuid::new_v4()));
    let saved = (|| -> Result<(), String> {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| "无法保存 Loom 证书")?;
        file.write_all(&serde_json::to_vec(&pairs).map_err(|_| "无法编码 Loom 证书")?)
            .and_then(|_| file.sync_all())
            .map_err(|_| "无法保存 Loom 证书")?;
        drop(file);
        crate::app_settings::replace_file(&temporary, &root.join("loom-lan-trust.json"))
    })();
    if saved.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    saved?;
    state.insert(pair.origin.clone(), Arc::new(trust));
    Ok(serde_json::json!({"origin":pair.origin,"info":info}))
}

fn check_existing(pairs: &[Pairing], pair: &Pairing) -> Result<(), String> {
    if pairs.iter().any(|old| {
        old.origin == pair.origin
            && (old.loom_id != pair.loom_id || old.certificate != pair.certificate)
    }) {
        return Err(
            "Loom 身份或证书已变化，已阻止连接；请核实目标，不能通过重新发现覆盖原有信任".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lan_pairing_trust_is_private_origin_scoped_and_rejects_invalid_input() {
        let cert = rcgen::generate_simple_self_signed(vec!["192.168.1.20".into()]).unwrap();
        let pair = Pairing {
            version: 1,
            origin: "https://192.168.1.20:8766".into(),
            loom_id: "loom-test".into(),
            certificate: STANDARD.encode(cert.cert.der()),
        };
        let trust = validate(&pair).unwrap();
        assert!(check_existing(&[pair.clone()], &pair).is_ok());
        let mut changed = pair.clone();
        changed.certificate = "changed".into();
        assert!(check_existing(&[pair.clone()], &changed).is_err());
        changed = pair.clone();
        changed.loom_id = "loom-other".into();
        assert!(check_existing(&[pair.clone()], &changed).is_err());
        assert!(trust.matches("https://192.168.1.20:8766/v1/otter/identity"));
        assert!(!trust.matches("https://192.168.1.20:8767"));
        for origin in [
            "http://192.168.1.20:8766",
            "https://8.8.8.8:8766",
            "https://192.168.1.20:8766/path",
            "https://user:password@192.168.1.20:8766",
        ] {
            let mut invalid = pair.clone();
            invalid.origin = origin.into();
            assert!(validate(&invalid).is_err());
        }
        let mut invalid = pair.clone();
        invalid.certificate = "broken".into();
        assert!(validate(&invalid).is_err());
        invalid = pair;
        invalid.version = 2;
        assert!(validate(&invalid).is_err());
    }
}
