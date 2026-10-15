//! Persist connection intent separately from history; never persist passwords or leases.
use super::{history::Target, Runtime};
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::Path,
};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u8,
    target: Option<Target>,
}

fn validate(target: &Target) -> Result<(), String> {
    if super::protocol::origin(&target.origin)? != target.origin
        || !target.loom_id.starts_with("loom-")
        || target.loom_id.len() > 160
        || target.device_id.is_empty()
        || target.device_id.len() > 160
        || target.name.len() > 256
    {
        return Err("Loom 自动连接记录无效".into());
    }
    Ok(())
}

pub(super) fn load(root: &Path) -> Result<Option<Target>, String> {
    let file = match std::fs::File::open(root.join("loom-resume.json")) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("读取 Loom 自动连接记录失败".into()),
    };
    let mut bytes = Vec::new();
    file.take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取 Loom 自动连接记录失败")?;
    if bytes.len() > 4096 {
        return Err("Loom 自动连接记录过大".into());
    }
    let record: Record = serde_json::from_slice(&bytes).map_err(|_| "Loom 自动连接记录损坏")?;
    if record.version != 1 {
        return Err("Loom 自动连接记录版本无效".into());
    }
    if let Some(target) = &record.target {
        validate(target)?;
    }
    Ok(record.target)
}

pub(super) fn save(root: &Path, target: Option<Target>) -> Result<(), String> {
    if let Some(target) = &target {
        validate(target)?;
    }
    let bytes = serde_json::to_vec(&Record { version: 1, target })
        .map_err(|_| "无法编码 Loom 自动连接记录")?;
    std::fs::create_dir_all(root).map_err(|_| "无法保存 Loom 自动连接记录")?;
    let temporary = root.join(format!("loom-resume-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "无法保存 Loom 自动连接记录")?;
    let result = (|| {
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "无法保存 Loom 自动连接记录")?;
        drop(file);
        crate::app_settings::replace_file(&temporary, &root.join("loom-resume.json"))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

// Called under the connection owner lock, so disconnect cannot race persistence.
pub(super) fn remember_connected(
    state: &Runtime,
    generation: u64,
    root: &Path,
    target: Target,
) -> Result<(), String> {
    if state.exiting || state.generation != generation {
        return Err("连接已取消".into());
    }
    super::history::remember(root, target.clone())?;
    save(root, Some(target))
}

pub(super) fn prepare_replace(
    state: &Runtime,
    expected: Option<u64>,
    clear: Option<&Path>,
) -> Result<(), String> {
    if state.exiting || expected.is_some_and(|generation| state.generation != generation) {
        return Err("连接已取消".into());
    }
    // Manual disconnect (including cancel) must be durable before reporting success.
    if let Some(root) = clear {
        save(root, None)?;
    }
    Ok(())
}

pub(crate) fn startup(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let result = async {
            let root = crate::effective_app_data_dir(&app)?;
            let Some(target) = load(&root)? else {
                return Ok::<(), String>(());
            };
            // Generation zero ensures a delayed startup cannot replace a user action.
            super::connect(app, target.origin, target.loom_id, String::new(), Some(0)).await
        }
        .await;
        if let Err(error) = result {
            crate::append_runtime_log_line(&format!("loom_connection_resume_failed :: {error}"));
        }
    });
}
