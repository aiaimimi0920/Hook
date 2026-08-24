// Owns session locking, schema/revision checks, atomic writes, and library clearing.

struct SessionFileLease {
    file: File,
}

impl SessionFileLease {
    fn acquire(session_file: &Path) -> Result<Self, String> {
        let parent = session_file
            .parent()
            .ok_or_else(|| "Hook session path has no parent directory".to_string())?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let file_name = session_file
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Hook session path has no UTF-8 file name".to_string())?;
        let lock_path = parent.join(format!("{file_name}.lock"));
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .open(&lock_path)
            .map_err(|error| format!("Failed to open Hook session lock: {error}"))?;
        let started_at = Instant::now();
        loop {
            match file.try_lock_exclusive() {
                Ok(()) => return Ok(Self { file }),
                Err(error)
                    if session_lock_is_busy(&error)
                        && started_at.elapsed() < SESSION_FILE_LOCK_TIMEOUT =>
                {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(error) if session_lock_is_busy(&error) => {
                    return Err(format!(
                        "SESSION_LOCK_TIMEOUT failed to acquire `{}` within {} ms",
                        lock_path.display(),
                        SESSION_FILE_LOCK_TIMEOUT.as_millis()
                    ));
                }
                Err(error) => {
                    return Err(format!("Failed to lock Hook session: {error}"));
                }
            }
        }
    }
}

impl Drop for SessionFileLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

fn session_lock_is_busy(error: &std::io::Error) -> bool {
    error.kind() == std::io::ErrorKind::WouldBlock || matches!(error.raw_os_error(), Some(32 | 33))
}

fn session_document_revision(root: &serde_json::Value) -> Result<u64, String> {
    let schema = root.get("documentSchemaVersion");
    let revision = root.get("documentRevision");
    if schema.is_none() && revision.is_none() {
        return Ok(0);
    }
    let schema = schema.and_then(serde_json::Value::as_u64).ok_or_else(|| {
        "SESSION_SCHEMA_INVALID documentSchemaVersion must be an unsigned integer".to_string()
    })?;
    if schema != u64::from(SESSION_DOCUMENT_SCHEMA_VERSION) {
        return Err(format!(
            "SESSION_SCHEMA_UNSUPPORTED documentSchemaVersion {schema} is not supported; expected {SESSION_DOCUMENT_SCHEMA_VERSION}"
        ));
    }
    revision.and_then(serde_json::Value::as_u64).ok_or_else(|| {
        "SESSION_SCHEMA_INVALID documentRevision must be an unsigned integer".to_string()
    })
}

fn ensure_expected_session_revision(
    expected_revision: Option<u64>,
    current_revision: u64,
) -> Result<(), String> {
    if let Some(expected_revision) = expected_revision {
        if expected_revision != current_revision {
            return Err(format!(
                "SESSION_REVISION_CONFLICT expected {expected_revision}, current {current_revision}; refresh the Hook session before retrying"
            ));
        }
    }
    Ok(())
}

fn deserialize_session_document(bytes: &[u8]) -> Result<SessionData, String> {
    let root: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("Failed to parse Hook session JSON: {error}"))?;
    let revision = session_document_revision(&root)?;
    let mut session: SessionData = serde_json::from_value(root)
        .map_err(|error| format!("Failed to read Hook session: {error}"))?;
    session.document_schema_version = SESSION_DOCUMENT_SCHEMA_VERSION;
    session.document_revision = revision;
    Ok(session)
}

fn replace_session_file(temp_path: &Path, session_file: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let from = temp_path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        let to = session_file
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>();
        for attempt in 0..20 {
            let moved = unsafe {
                MoveFileExW(
                    from.as_ptr(),
                    to.as_ptr(),
                    MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
                )
            };
            if moved != 0 {
                return Ok(());
            }
            if attempt < 19 {
                std::thread::sleep(Duration::from_millis(5));
            }
        }
        Err(format!(
            "Failed to atomically replace Hook session: {}",
            std::io::Error::last_os_error()
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        fs::rename(temp_path, session_file)
            .map_err(|error| format!("Failed to atomically replace Hook session: {error}"))
    }
}

fn write_session_document_atomically(
    session_file: &Path,
    session: &SessionData,
) -> Result<(), String> {
    let parent = session_file
        .parent()
        .ok_or_else(|| "Hook session path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let json = serde_json::to_vec_pretty(session).map_err(|error| error.to_string())?;
    let file_name = session_file
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Hook session path has no UTF-8 file name".to_string())?;
    let mut temporary = None;
    for attempt in 0..100u32 {
        let path = parent.join(format!(
            ".{file_name}.tmp-{}-{}-{attempt}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => {
                temporary = Some((path, file));
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create Hook session temporary: {error}")),
        }
    }
    let (temp_path, mut file) =
        temporary.ok_or_else(|| "Failed to allocate a Hook session temporary file".to_string())?;
    let result = (|| {
        file.write_all(&json).map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        if let Ok(metadata) = fs::metadata(session_file) {
            let _ = fs::set_permissions(&temp_path, metadata.permissions());
        }
        replace_session_file(&temp_path, session_file)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

pub(crate) fn clear_persisted_session_library(
    app: &tauri::AppHandle,
    action: &str,
) -> Result<(), String> {
    let app_dir = effective_app_data_dir(app)?;
    let session_file = app_dir.join("session.json");
    let _guard = SESSION_FILE_IO_LOCK
        .lock()
        .map_err(|_| "Session file I/O lock is poisoned".to_string())?;
    clear_persisted_session_library_file(&session_file, action)
}

fn clear_persisted_session_library_file(session_file: &Path, action: &str) -> Result<(), String> {
    if !session_file.is_file() {
        return Ok(());
    }
    let _lease = SessionFileLease::acquire(session_file)?;
    let mut session =
        deserialize_session_document(&fs::read(session_file).map_err(|error| error.to_string())?)?;
    match action {
        "clearRecycleBin" => session.recycle_bin.clear(),
        "clearReferenceLibrary" => session.reference_library.clear(),
        _ => return Err("Unsupported Hook session library clear action".to_string()),
    }
    session.document_revision = session
        .document_revision
        .checked_add(1)
        .ok_or_else(|| "SESSION_REVISION_EXHAUSTED Hook session revision overflow".to_string())?;
    write_session_document_atomically(session_file, &session)?;
    Ok(())
}
