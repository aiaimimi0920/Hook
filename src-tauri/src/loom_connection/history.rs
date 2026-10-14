//! Bounded origin-scoped history. No passwords, private keys, receipts or session tokens.
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::Path,
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Target {
    pub origin: String,
    pub loom_id: String,
    pub name: String,
    pub device_id: String,
}

pub(crate) fn load(root: &Path) -> Result<Vec<Target>, String> {
    let file = match std::fs::File::open(root.join("loom-connections.json")) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("读取 Loom 历史记录失败".into()),
    };
    let mut bytes = Vec::new();
    file.take(32 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取 Loom 历史记录失败".to_string())?;
    if bytes.len() > 32 * 1024 {
        return Err("Loom 历史记录过大".into());
    }
    let targets: Vec<Target> =
        serde_json::from_slice(&bytes).map_err(|_| "Loom 历史记录损坏".to_string())?;
    if targets.len() > 20
        || targets.iter().any(|target| {
            super::protocol::origin(&target.origin).is_err()
                || target.loom_id.len() > 160
                || target.device_id.len() > 160
                || target.name.len() > 256
        })
    {
        return Err("Loom 历史记录无效".into());
    }
    Ok(targets)
}

pub(crate) fn remember(root: &Path, target: Target) -> Result<(), String> {
    let mut targets = load(root)?;
    targets.retain(|item| item.origin != target.origin);
    targets.insert(0, target);
    targets.truncate(20);
    std::fs::create_dir_all(root).map_err(|_| "无法保存 Loom 历史记录".to_string())?;
    let temporary = root.join(format!("loom-connections-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "无法保存 Loom 历史记录".to_string())?;
    let result = (|| {
        file.write_all(
            &serde_json::to_vec(&targets).map_err(|_| "无法编码 Loom 历史记录".to_string())?,
        )
        .and_then(|_| file.sync_all())
        .map_err(|_| "无法保存 Loom 历史记录".to_string())?;
        drop(file);
        crate::app_settings::replace_file(&temporary, &root.join("loom-connections.json"))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_is_bounded_deduplicated_and_has_no_secret_fields() {
        let root =
            std::env::temp_dir().join(format!("otter-loom-history-{}", uuid::Uuid::new_v4()));
        for index in 0..24 {
            remember(
                &root,
                Target {
                    origin: format!("https://loom-{index}.test"),
                    loom_id: format!("loom-{index}"),
                    name: "Loom".into(),
                    device_id: format!("device-{index}"),
                },
            )
            .unwrap();
        }
        let targets = load(&root).unwrap();
        assert_eq!(targets.len(), 20);
        remember(&root, targets[0].clone()).unwrap();
        assert_eq!(load(&root).unwrap().len(), 20);
        let text = std::fs::read_to_string(root.join("loom-connections.json")).unwrap();
        for field in ["password", "privateKey", "receipt", "token"] {
            assert!(!text.contains(field));
        }
        std::fs::write(root.join("loom-connections.json"), b"invalid").unwrap();
        assert!(load(&root).is_err());
    }
}
