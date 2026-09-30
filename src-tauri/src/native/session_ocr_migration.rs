// Owns the bounded backup journal for the one-time legacy OCR attachment import.

const OCR_MIGRATION_DIR: &str = "session-migrations";
const OCR_MIGRATION_BACKUP: &str = "ocr-result-v1-backup.json";
const OCR_MIGRATION_JOURNAL: &str = "ocr-result-v1-journal.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OcrMigrationJournal {
    schema_version: u32,
    source_revision: u64,
    target_revision: Option<u64>,
    status: String,
}

fn has_migrated_ocr_attachment(sticker: &StickerData) -> bool {
    sticker
        .extension_state
        .as_ref()
        .and_then(|state| state.get("attachments"))
        .and_then(serde_json::Value::as_array)
        .is_some_and(|attachments| {
            attachments.iter().any(|attachment| {
                attachment.get("attachmentId").and_then(serde_json::Value::as_str)
                    == Some("neuro.official/ocr.result")
                    && attachment.get("pluginId").and_then(serde_json::Value::as_str)
                        == Some("neuro.official/ocr")
                    && attachment.pointer("/payload/migration/source")
                        .and_then(serde_json::Value::as_str)
                        == Some("hook.unitData.ocrResult")
                    && attachment.pointer("/payload/migration/version")
                        .and_then(serde_json::Value::as_u64)
                        == Some(1)
            })
        })
}

fn is_ocr_migration_save(existing: &SessionData, incoming: &[StickerData]) -> bool {
    existing.stickers.iter().any(|source| {
        source.ocr_result.is_some()
            && incoming.iter().any(|target| {
                target.id == source.id && target.ocr_result.is_none() && has_migrated_ocr_attachment(target)
            })
    })
}

fn migration_paths(app_dir: &Path) -> (PathBuf, PathBuf) {
    let root = app_dir.join(OCR_MIGRATION_DIR);
    (root.join(OCR_MIGRATION_BACKUP), root.join(OCR_MIGRATION_JOURNAL))
}

fn write_migration_journal(path: &Path, journal: &OcrMigrationJournal) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(journal).map_err(|error| error.to_string())?;
    let parent = path.parent().ok_or_else(|| "OCR migration journal has no parent".to_string())?;
    let temp_path = parent.join(format!(
        ".{OCR_MIGRATION_JOURNAL}.tmp-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
    ));
    let write_result = (|| {
        let mut file = OpenOptions::new().write(true).create_new(true).open(&temp_path)
            .map_err(|error| format!("Failed to create OCR migration journal: {error}"))?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        Ok(())
    })();
    let result = write_result.and_then(|()| replace_session_file(&temp_path, path));
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

fn load_migration_journal(path: &Path) -> Result<Option<OcrMigrationJournal>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let journal: OcrMigrationJournal = serde_json::from_slice(
        &fs::read(path).map_err(|error| error.to_string())?,
    ).map_err(|error| format!("Failed to parse OCR migration journal: {error}"))?;
    if journal.schema_version != 1 || !matches!(journal.status.as_str(), "prepared" | "committed" | "rolledBack") {
        return Err("OCR migration journal is invalid".to_string());
    }
    Ok(Some(journal))
}

fn prepare_ocr_migration_backup(
    app_dir: &Path,
    existing: &SessionData,
    incoming: &[StickerData],
) -> Result<bool, String> {
    prepare_ocr_migration_backup_with_fault(app_dir, existing, incoming, None)
}

fn prepare_ocr_migration_backup_with_fault(
    app_dir: &Path,
    existing: &SessionData,
    incoming: &[StickerData],
    backup_fault: Option<AtomicSessionWriteFault>,
) -> Result<bool, String> {
    if !is_ocr_migration_save(existing, incoming) {
        return Ok(false);
    }
    let (backup_path, journal_path) = migration_paths(app_dir);
    let migration_dir = backup_path.parent().expect("migration path has parent");
    fs::create_dir_all(migration_dir)
        .map_err(|error| format!("Failed to create OCR migration backup directory: {error}"))?;
    let prior_journal = load_migration_journal(&journal_path)?;
    if prior_journal.as_ref().is_some_and(|journal| journal.status == "rolledBack") {
        write_session_document_atomically_with_fault(&backup_path, existing, backup_fault)?;
        write_migration_journal(&journal_path, &OcrMigrationJournal {
            schema_version: 1,
            source_revision: existing.document_revision,
            target_revision: None,
            status: "prepared".to_string(),
        })?;
        return Ok(true);
    }
    let backup = if backup_path.is_file() {
        deserialize_session_document(&fs::read(&backup_path).map_err(|error| error.to_string())?)?
    } else {
        write_session_document_atomically_with_fault(&backup_path, existing, backup_fault)?;
        existing.clone()
    };
    if backup.document_revision != existing.document_revision
        || !backup.stickers.iter().any(|sticker| sticker.ocr_result.is_some())
    {
        return Err("OCR migration backup does not match the source session".to_string());
    }
    if let Some(journal) = prior_journal {
        if journal.status != "prepared" || journal.source_revision != existing.document_revision {
            return Err("OCR migration journal does not match the source session".to_string());
        }
    } else {
        write_migration_journal(&journal_path, &OcrMigrationJournal {
            schema_version: 1,
            source_revision: existing.document_revision,
            target_revision: None,
            status: "prepared".to_string(),
        })?;
    }
    Ok(true)
}

fn finalize_ocr_migration_backup(app_dir: &Path, target_revision: u64) -> Result<(), String> {
    let (_, journal_path) = migration_paths(app_dir);
    let Some(mut journal) = load_migration_journal(&journal_path)? else {
        return Err("OCR migration journal disappeared before commit".to_string());
    };
    journal.target_revision = Some(target_revision);
    journal.status = "committed".to_string();
    write_migration_journal(&journal_path, &journal)
}

fn rollback_ocr_attachment_migration_file(
    app_dir: &Path,
    expected_document_revision: Option<u64>,
) -> Result<SessionSaveResult, String> {
    let session_file = app_dir.join("session.json");
    let (backup_path, journal_path) = migration_paths(app_dir);
    let mut journal = load_migration_journal(&journal_path)?
        .ok_or_else(|| "OCR migration backup is unavailable".to_string())?;
    if journal.status == "rolledBack" {
        return Err("OCR migration backup has already been restored".to_string());
    }
    let current = deserialize_session_document(
        &fs::read(&session_file).map_err(|error| error.to_string())?,
    )?;
    ensure_expected_session_revision(expected_document_revision, current.document_revision)?;
    let expected_target = match journal.target_revision {
        Some(revision) => revision,
        None => journal.source_revision.checked_add(1)
            .ok_or_else(|| "OCR migration journal revision overflow".to_string())?,
    };
    if current.document_revision != expected_target {
        return Err("OCR_MIGRATION_ROLLBACK_STALE session changed after migration".to_string());
    }
    let mut backup = deserialize_session_document(
        &fs::read(&backup_path).map_err(|error| error.to_string())?,
    )?;
    backup.document_revision = current.document_revision.checked_add(1)
        .ok_or_else(|| "SESSION_REVISION_EXHAUSTED Hook session revision overflow".to_string())?;
    write_session_document_atomically(&session_file, &backup)?;
    journal.target_revision = Some(backup.document_revision);
    journal.status = "rolledBack".to_string();
    write_migration_journal(&journal_path, &journal)?;
    Ok(SessionSaveResult { document_revision: backup.document_revision })
}

#[tauri::command]
fn rollback_ocr_attachment_migration(
    app: tauri::AppHandle,
    expected_document_revision: Option<u64>,
) -> Result<SessionSaveResult, String> {
    let app_dir = effective_app_data_dir(&app)?;
    let session_file = app_dir.join("session.json");
    let _guard = SESSION_FILE_IO_LOCK.lock()
        .map_err(|_| "Session file I/O lock is poisoned".to_string())?;
    let _lease = SessionFileLease::acquire(&session_file)?;
    rollback_ocr_attachment_migration_file(&app_dir, expected_document_revision)
}
