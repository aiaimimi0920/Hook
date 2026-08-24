// Owns persistent session image assets, archive references, and orphan cleanup.

fn session_image_asset_fingerprint(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn persist_session_image_asset(
    images_dir: &Path,
    sticker_id: &str,
    slot: &str,
    value: &str,
) -> Result<String, String> {
    if !value.starts_with("data:image") {
        return Ok(value.to_string());
    }

    let image_data = decode_base64_image_data(value)?;
    let sticker_stem = sanitize_internal_asset_component(Some(sticker_id));
    let slot_stem = sanitize_internal_asset_component(Some(slot));
    let fingerprint = session_image_asset_fingerprint(&image_data);
    let file_name = format!("{sticker_stem}_{slot_stem}_{fingerprint}.png");
    let file_path = images_dir.join(file_name);

    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file_path)
    {
        Ok(mut file) => {
            if let Err(error) = file
                .write_all(&image_data)
                .and_then(|_| file.sync_all())
            {
                drop(file);
                let _ = fs::remove_file(&file_path);
                return Err(error.to_string());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.to_string()),
    }

    Ok(file_path.to_string_lossy().to_string())
}

fn is_session_managed_image_asset_path(images_dir: &Path, path: &Path) -> bool {
    if path.parent() != Some(images_dir) {
        return false;
    }

    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    if !extension.eq_ignore_ascii_case("png") {
        return false;
    }

    let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some((_, fingerprint)) = stem.rsplit_once('_') else {
        return false;
    };

    fingerprint.len() == 16 && fingerprint.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn collect_referenced_session_image_assets(
    images_dir: &Path,
    session_data: &SessionData,
) -> std::collections::HashSet<PathBuf> {
    let mut referenced = std::collections::HashSet::new();

    let mut push_path = |value: Option<&str>| {
        let Some(raw) = value else {
            return;
        };
        let path = PathBuf::from(raw);
        if is_session_managed_image_asset_path(images_dir, &path) {
            referenced.insert(path);
        }
    };

    for sticker in &session_data.stickers {
        push_path(Some(sticker.src.as_str()));
        push_path(sticker.preview_src.as_deref());
    }

    for entry in session_data
        .recycle_bin
        .iter()
        .chain(session_data.reference_library.iter())
    {
        if let Some(snapshot) = entry.snapshot.as_object() {
            push_path(snapshot.get("src").and_then(|value| value.as_str()));
            push_path(snapshot.get("previewSrc").and_then(|value| value.as_str()));
            push_path(
                snapshot
                    .get("rasterizedAnnotationLayerSrc")
                    .and_then(|value| value.as_str()),
            );
        }
    }

    for workflow in session_data.workflow_asset_archive_index.workflows.values() {
        for node in workflow.nodes.values() {
            push_path(node.src.as_deref());
            push_path(node.preview_src.as_deref());
        }
    }

    referenced
}

fn merge_workflow_asset_archive_index(
    existing: &WorkflowAssetArchiveIndex,
    hints: &WorkflowAssetArchiveHints,
    processed_stickers: &[StickerData],
) -> WorkflowAssetArchiveIndex {
    let mut merged = existing.clone();
    let now = unix_timestamp_millis().to_string();

    let sticker_by_id: std::collections::HashMap<&str, &StickerData> = processed_stickers
        .iter()
        .map(|sticker| (sticker.id.as_str(), sticker))
        .collect();

    for (workflow_id, workflow_hint) in &hints.workflows {
        let mut nodes = std::collections::BTreeMap::new();

        for (node_id, node_hint) in &workflow_hint.nodes {
            let Some(sticker) = sticker_by_id.get(node_hint.sticker_id.as_str()) else {
                continue;
            };

            nodes.insert(
                node_id.clone(),
                WorkflowAssetArchiveNodeIndex {
                    sticker_id: sticker.id.clone(),
                    updated_at: now.clone(),
                    src: if sticker.src.is_empty() {
                        None
                    } else {
                        Some(sticker.src.clone())
                    },
                    preview_src: sticker.preview_src.clone(),
                },
            );
        }

        merged.workflows.insert(
            workflow_id.clone(),
            WorkflowAssetArchiveWorkflowIndex {
                updated_at: now.clone(),
                nodes,
            },
        );
    }

    if merged.version == 0 {
        merged.version = 1;
    }

    merged
}

fn cleanup_unreferenced_session_image_assets(
    images_dir: &Path,
    session_data: &SessionData,
    now: SystemTime,
) -> Result<(), String> {
    if !images_dir.exists() {
        return Ok(());
    }

    let referenced = collect_referenced_session_image_assets(images_dir, session_data);
    let retention = std::time::Duration::from_secs(SESSION_IMAGE_ASSET_RETENTION_SECS);

    for entry in fs::read_dir(images_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !is_session_managed_image_asset_path(images_dir, &path) {
            continue;
        }
        if referenced.contains(&path) {
            continue;
        }

        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            continue;
        }

        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if now.duration_since(modified).unwrap_or_default() <= retention {
            continue;
        }

        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }

    Ok(())
}
