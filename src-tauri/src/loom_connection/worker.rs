//! One generation owns its approval receipt, device session and expiring server lease.
use super::{
    history::Target,
    owner,
    protocol::{self, LoomInfo},
    publish, Receipt, View,
};
use crate::device_session::connection_identity::ConnectionIdentity;
use serde_json::{json, Value};
use std::{path::Path, time::Duration};

pub(super) async fn run(
    app: &tauri::AppHandle,
    generation: u64,
    root: &Path,
    history: &[Target],
    origin: &str,
    expected_id: &str,
    password: String,
) -> Result<(), String> {
    let info = protocol::probe(origin).await?;
    if info.loom_id != expected_id {
        return Err("Loom 身份已变化，请重新选择目标".into());
    }
    let known = history
        .iter()
        .find(|target| target.origin == origin && target.loom_id == info.loom_id);
    let mut identity = ConnectionIdentity::load(app, known.map(|target| target.device_id.clone()))?;
    let mut session = if known.is_some() {
        identity.session(origin).await.ok()
    } else {
        None
    };
    let created = protocol::request(origin, "/v1/otter/connections/request", Some(json!({
        "name":std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Otter".into()).chars().take(64).collect::<String>(),
        "publicKey":identity.public_key(), "password":password,
    })), session.as_ref().map(|pair| &pair.0)).await?;
    let receipt = Receipt {
        origin: origin.into(),
        body: json!({
            "requestId":text(&created["connection"], "id")?, "receipt":text(&created, "receipt")?,
        }),
    };
    {
        let mut state = owner()
            .lock()
            .map_err(|_| "Loom 连接状态不可用".to_string())?;
        if state.generation != generation {
            return Err("连接已取消".into());
        }
        state.receipt = Some(receipt.clone());
    }
    let mut connection = created["connection"].clone();
    let device_id = text(&connection, "deviceId")?.to_owned();
    identity.bind(device_id.clone());
    let deadline = tokio::time::Instant::now() + Duration::from_secs(300);
    while connection["phase"] == "pending" {
        if !publish(
            app,
            generation,
            View {
                phase: "waiting".into(),
                origin: Some(origin.into()),
                ..View::default()
            },
        ) {
            return Err("连接已取消".into());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("等待 Loom 审批超时".into());
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
        connection = protocol::request(
            origin,
            "/v1/otter/connections/status",
            Some(receipt.body.clone()),
            None,
        )
        .await?;
    }
    if connection["phase"] != "approved" {
        return Err("Loom 未批准此次连接".into());
    }
    session = Some(
        identity
            .session(origin)
            .await
            .map_err(|_| "Loom 设备认证失败".to_string())?,
    );
    let mut session = session.ok_or_else(|| "Loom 设备认证失败".to_string())?;
    let mut recorded = false;
    let mut lease_deadline = u64::MAX;
    let mut projection_origin = None;
    loop {
        if protocol::now() >= lease_deadline {
            return Err("Loom 连接已过期".into());
        }
        if session.1 <= protocol::now().saturating_add(60_000) {
            session = identity
                .session(origin)
                .await
                .map_err(|_| "Loom 设备授权已失效".to_string())?;
        }
        let active = protocol::request(
            origin,
            "/v1/otter/connections/activate",
            Some(receipt.body.clone()),
            Some(&session.0),
        )
        .await?;
        let active_info: LoomInfo = serde_json::from_value(active["loom"].clone())
            .map_err(|_| "Loom 身份响应无效".to_string())?;
        protocol::validate_info(&active_info)?;
        if active_info.loom_id != info.loom_id
            || active["connection"]["phase"] != "connected"
            || active["connection"]["deviceId"] != device_id
        {
            return Err("Loom 连接身份不匹配".into());
        }
        lease_deadline = active["connection"]["expiresAtMs"]
            .as_u64()
            .ok_or_else(|| "Loom 连接租约无效".to_string())?;
        if lease_deadline <= protocol::now() {
            return Err("Loom 连接租约已过期".into());
        }
        if !recorded {
            let state = owner()
                .lock()
                .map_err(|_| "Loom 连接状态不可用".to_string())?;
            super::resume::remember_connected(
                &state,
                generation,
                root,
                Target {
                    origin: origin.into(),
                    loom_id: info.loom_id.clone(),
                    name: info.name.clone(),
                    device_id: device_id.clone(),
                },
            )?;
            recorded = true;
        }
        let endpoint = super::projection::resolve_origin(
            app,
            origin,
            &active_info,
            projection_origin.as_deref(),
        )
        .await?;
        projection_origin = Some(endpoint.clone());
        super::projection::install(
            generation,
            endpoint,
            session.0.clone(),
            session.1.min(lease_deadline),
        )?;
        if !publish(
            app,
            generation,
            View {
                phase: "connected".into(),
                loom_id: Some(info.loom_id.clone()),
                name: Some(info.name.clone()),
                origin: Some(origin.into()),
                error: None,
                expires_at: lease_deadline,
            },
        ) {
            return Err("连接已取消".into());
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .filter(|value| !value.is_empty() && value.len() <= 256)
        .ok_or_else(|| "Loom 连接响应无效".to_string())
}
