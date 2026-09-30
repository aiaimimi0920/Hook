// Owns persisted session save/load commands and asset restoration.

#[tauri::command]
async fn save_session(
    app: tauri::AppHandle,
    stickers: Vec<StickerData>,
    links: Vec<LinkData>,
    groups: Option<Vec<serde_json::Value>>,
    recycle_bin: Option<Vec<FrozenStickerEntry>>,
    reference_library: Option<Vec<FrozenStickerEntry>>,
    workflow_asset_archive_hints: Option<WorkflowAssetArchiveHints>,
    expected_document_revision: Option<u64>,
    managed_asset_paths: Option<Vec<String>>,
) -> Result<SessionSaveResult, String> {
    let app_dir = effective_app_data_dir(&app)?;
    let permit = SessionIoPermit::acquire(&SESSION_IO_ACTIVE)?;
    let request = SessionSaveRequest {
        stickers,
        links,
        groups,
        recycle_bin,
        reference_library,
        workflow_asset_archive_hints,
        expected_document_revision,
        managed_asset_paths,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        save_session_to_dir(app_dir, request)
    })
    .await
    .map_err(|error| format!("Session save worker failed: {error}"))?
}

fn save_session_to_dir(
    app_dir: PathBuf,
    request: SessionSaveRequest,
) -> Result<SessionSaveResult, String> {
    let SessionSaveRequest {
        stickers,
        links,
        groups,
        recycle_bin,
        reference_library,
        workflow_asset_archive_hints,
        expected_document_revision,
        managed_asset_paths,
    } = request;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }

    let session_file = app_dir.join("session.json");
    let _session_guard = SESSION_FILE_IO_LOCK
        .lock()
        .map_err(|_| "Session file I/O lock is poisoned".to_string())?;
    let _lease = SessionFileLease::acquire(&session_file)?;
    let existing_session = if session_file.exists() {
        Some(deserialize_session_document(
            &fs::read(&session_file).map_err(|error| error.to_string())?,
        )?)
    } else {
        None
    };
    let current_revision = existing_session
        .as_ref()
        .map(|session| session.document_revision)
        .unwrap_or(0);
    ensure_expected_session_revision(expected_document_revision, current_revision)?;
    let next_revision = current_revision
        .checked_add(1)
        .ok_or_else(|| "SESSION_REVISION_EXHAUSTED Hook session revision overflow".to_string())?;
    let prepared_ocr_migration = match existing_session.as_ref() {
        Some(existing) => prepare_ocr_migration_backup(&app_dir, existing, &stickers)?,
        None => false,
    };
    let existing_archive_index = existing_session
        .map(|session| session.workflow_asset_archive_index)
        .unwrap_or_default();

    // Validate the caller's revision before creating or writing any image asset.
    // The session lease also serializes identical fingerprint paths across processes.
    let images_dir = app_dir.join("images");
    if !images_dir.exists() {
        fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    }

    // Only references introduced by the optimization require existence. Legacy
    // file-backed documents retain their existing missing-file behavior.
    for value in managed_asset_paths.unwrap_or_default() {
        let path = Path::new(&value);
        if !is_session_managed_image_asset_path(&images_dir, path) || !path.is_file() {
            return Err(
                "SESSION_ASSET_MISSING managed image must be restored from its pixels".to_string(),
            );
        }
    }

    let mut processed_stickers = stickers;
    let mut image_assets = Vec::new();
    for sticker in &mut processed_stickers {
        let source_was_inline = sticker.src.starts_with("data:image");
        let preview_was_inline = sticker
            .preview_src
            .as_deref()
            .is_some_and(|src| src.starts_with("data:image"));
        sticker.src = persist_session_image_asset(&images_dir, &sticker.id, "source", &sticker.src)
            .map_err(|e| format!("Failed to persist source image for {}: {}", sticker.id, e))?;

        if let Some(ref mut p_src) = sticker.preview_src {
            *p_src = persist_session_image_asset(&images_dir, &sticker.id, "preview", p_src)
                .map_err(|e| {
                    format!("Failed to persist preview image for {}: {}", sticker.id, e)
                })?;
        }
        if source_was_inline || preview_was_inline {
            image_assets.push(SessionImageAsset {
                id: sticker.id.clone(),
                src: source_was_inline.then(|| sticker.src.clone()),
                preview_src: if preview_was_inline {
                    sticker.preview_src.clone()
                } else {
                    None
                },
            });
        }
    }

    let workflow_asset_archive_index = merge_workflow_asset_archive_index(
        &existing_archive_index,
        &workflow_asset_archive_hints.unwrap_or_default(),
        &processed_stickers,
    );

    // Save as SessionData with both stickers and links
    let session_data = SessionData {
        document_schema_version: SESSION_DOCUMENT_SCHEMA_VERSION,
        document_revision: next_revision,
        stickers: processed_stickers,
        links: links,
        groups: groups.unwrap_or_default(),
        recycle_bin: recycle_bin.unwrap_or_default(),
        reference_library: reference_library.unwrap_or_default(),
        workflow_asset_archive_index,
    };
    write_session_document_atomically(&session_file, &session_data)?;
    if prepared_ocr_migration {
        if let Err(error) = finalize_ocr_migration_backup(&app_dir, next_revision) {
            console_line!(
                "Warning: OCR migration journal remained prepared: {}",
                error
            );
        }
    }

    if let Err(error) =
        cleanup_unreferenced_session_image_assets(&images_dir, &session_data, SystemTime::now())
    {
        console_line!("Warning: session image asset cleanup skipped: {}", error);
    }

    console_line!(
        "Session saved with {} stickers and {} links.",
        session_data.stickers.len(),
        session_data.links.len()
    );
    Ok(SessionSaveResult {
        document_revision: next_revision,
        image_assets,
    })
}

fn restore_loaded_session_stickers(stickers: &mut [StickerData]) {
    for sticker in stickers {
        if sticker.src.starts_with("data:image") {
            continue;
        }

        let path = std::path::Path::new(&sticker.src);
        if !path.exists() {
            console_line!(
                "Warning: Image file not found for sticker {}: {}",
                sticker.id,
                sticker.src
            );
        }
    }
}

#[tauri::command]
async fn load_session(app: tauri::AppHandle) -> Result<SessionData, String> {
    let app_dir = effective_app_data_dir(&app)?;
    let permit = SessionIoPermit::acquire(&SESSION_IO_ACTIVE)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        load_session_from_dir(&app_dir)
    })
    .await
    .map_err(|error| format!("Session load worker failed: {error}"))?
}

fn load_session_from_dir(app_dir: &Path) -> Result<SessionData, String> {
    let session_file = app_dir.join("session.json");
    let _session_guard = SESSION_FILE_IO_LOCK
        .lock()
        .map_err(|_| "Session file I/O lock is poisoned".to_string())?;

    if !session_file.exists() {
        return Ok(SessionData {
            document_schema_version: SESSION_DOCUMENT_SCHEMA_VERSION,
            document_revision: 0,
            stickers: Vec::new(),
            links: Vec::new(),
            groups: Vec::new(),
            recycle_bin: Vec::new(),
            reference_library: Vec::new(),
            workflow_asset_archive_index: WorkflowAssetArchiveIndex::default(),
        });
    }

    let mut session_data =
        deserialize_session_document(&fs::read(&session_file).map_err(|error| error.to_string())?)?;

    restore_loaded_session_stickers(&mut session_data.stickers);

    console_line!(
        "Session loaded with {} stickers and {} links.",
        session_data.stickers.len(),
        session_data.links.len()
    );
    Ok(session_data)
}
