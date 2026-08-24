// Owns bounded shader-input materialization and stale temporary-file cleanup.
fn cleanup_stale_shader_temp_files(dir: &std::path::Path, max_age_secs: u64) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    let now = std::time::SystemTime::now();
    let max_age = Duration::from_secs(max_age_secs);
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_shader_temp = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with("loom_hook_shader_"))
            .unwrap_or(false);
        if !is_shader_temp {
            continue;
        }
        let modified = match entry.metadata().and_then(|m| m.modified()) {
            Ok(modified) => modified,
            Err(_) => continue,
        };
        if now.duration_since(modified).unwrap_or_default() > max_age {
            let _ = std::fs::remove_file(&path);
        }
    }
}

fn materialize_shader_image_input(value: Option<&String>, label: &str) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }

    if let Some(path) = decode_asset_localhost_path(raw).or_else(|| decode_file_url_path(raw)) {
        return Some(path);
    }

    if raw.len() == 36 && raw.matches('-').count() == 4 {
        return resolve_image_path(raw).or_else(|| Some(raw.to_string()));
    }

    if raw.starts_with("data:") {
        let encoded = raw.split_once(',').map(|(_, data)| data).unwrap_or(raw);
        match base64::engine::general_purpose::STANDARD.decode(encoded) {
            Ok(bytes) => {
                let filename_prefix = match label {
                    "input" => "loom_hook_shader_input",
                    "reference" => "loom_hook_shader_reference",
                    _ => "loom_hook_shader_image",
                };
                // Age out previously materialized shader temp files so this
                // directory does not grow without bound. The freshly written file
                // is returned for downstream use, so we only drop stale ones.
                cleanup_stale_shader_temp_files(&std::env::temp_dir(), 3600);
                let path = std::env::temp_dir().join(format!(
                    "{}_{}.png",
                    filename_prefix,
                    Uuid::new_v4()
                ));
                match std::fs::write(&path, bytes) {
                    Ok(_) => {
                        return Some(path.to_string_lossy().to_string());
                    }
                    Err(error) => {
                        console_line!(
                            "[LoomHook] Failed to write materialized shader {} image: {}",
                            label,
                            error
                        );
                        return None;
                    }
                }
            }
            Err(error) => {
                console_line!(
                    "[LoomHook] Failed to decode shader {} data URI: {}",
                    label,
                    error
                );
                return None;
            }
        }
    }

    Some(raw.to_string())
}

