// Owns clipboard-cache lifetime, containment, staging, and log-safe file naming.

fn clipboard_cache_dir() -> PathBuf {
    std::env::var("HOOK_CLIPBOARD_CACHE_DIR")
        .ok()
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .or_else(|| {
            std::env::var("LOCALAPPDATA")
                .ok()
                .map(PathBuf::from)
                .filter(|path| !path.as_os_str().is_empty())
                .map(|path| path.join("Hook").join("clipboard_cache"))
        })
        .unwrap_or_else(|| std::env::temp_dir().join("Hook").join("clipboard_cache"))
}

fn cleanup_clipboard_cache() -> Result<(), String> {
    let dir = clipboard_cache_dir();
    let settings = runtime_hook_cache_settings();
    cleanup_clipboard_cache_dir(
        &dir,
        SystemTime::now(),
        settings.temp_cache_max_bytes,
        settings.temp_cache_max_bytes / 2,
    )
}

fn cleanup_clipboard_cache_dir(
    dir: &Path,
    now: SystemTime,
    max_total_bytes: u64,
    target_total_bytes: u64,
) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    let retention_days = runtime_hook_cache_settings().temp_cache_retention_days;
    let max_age = std::time::Duration::from_secs(u64::from(retention_days) * 24 * 60 * 60);
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("Failed to read clipboard cache: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to inspect clipboard cache: {}", e))?;
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if metadata.is_dir() {
            let is_native_drag_staging = entry
                .file_name()
                .to_string_lossy()
                .starts_with("native-drag-");
            if is_native_drag_staging
                && retention_days > 0
                && now.duration_since(modified).unwrap_or_default() > max_age
            {
                let _ = fs::remove_dir_all(entry.path());
            }
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        if retention_days > 0 && now.duration_since(modified).unwrap_or_default() > max_age {
            let _ = fs::remove_file(entry.path());
            continue;
        }
        entries.push((entry.path(), modified, metadata.len()));
    }

    let mut total_bytes: u64 = entries.iter().map(|(_, _, len)| *len).sum();
    if max_total_bytes == 0 {
        return Ok(());
    }
    if total_bytes < max_total_bytes {
        return Ok(());
    }

    entries.sort_by_key(|(_, modified, _)| *modified);
    for (path, _, len) in entries {
        if total_bytes <= target_total_bytes {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            total_bytes = total_bytes.saturating_sub(len);
        }
    }

    Ok(())
}

fn ensure_clipboard_cache_dir() -> Result<PathBuf, String> {
    let cache_dir = clipboard_cache_dir();
    fs::create_dir_all(&cache_dir).map_err(|e| format!("Failed to create cache dir: {}", e))?;
    let settings = runtime_hook_cache_settings();
    let _ = cleanup_clipboard_cache_dir(
        &cache_dir,
        SystemTime::now(),
        settings.temp_cache_max_bytes,
        settings.temp_cache_max_bytes / 2,
    );
    Ok(cache_dir)
}

// Confirm `candidate` resolves to a location inside `root`. Both are canonicalized
// so `..` traversal and symlinks cannot escape the allowed root.
fn path_is_within(candidate: &Path, root: &Path) -> bool {
    let candidate = match candidate.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let root = match root.canonicalize() {
        Ok(p) => p,
        Err(_) => return false,
    };
    candidate.starts_with(&root)
}

#[cfg(target_os = "windows")]
fn copy_file_with_limit(
    source_path: &Path,
    target_file: &mut File,
    max_bytes: u64,
    operation: &str,
) -> Result<u64, String> {
    let source_file =
        File::open(source_path).map_err(|error| format!("Failed to open {operation}: {error}"))?;
    let metadata = source_file
        .metadata()
        .map_err(|error| format!("Failed to inspect {operation}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("{operation} source is not a regular file"));
    }
    if metadata.len() > max_bytes {
        return Err(format!("{operation} exceeds the {max_bytes}-byte limit"));
    }

    // The handle may grow after metadata was read, so also bound the actual copy.
    let mut bounded_source = std::io::Read::take(source_file, max_bytes.saturating_add(1));
    let copied = std::io::copy(&mut bounded_source, target_file)
        .map_err(|error| format!("Failed to copy {operation}: {error}"))?;
    if copied > max_bytes {
        return Err(format!("{operation} exceeds the {max_bytes}-byte limit"));
    }
    Ok(copied)
}

#[cfg(target_os = "windows")]
fn stage_drag_out_file_copy(
    source_path: &Path,
    preferred_stem: Option<&str>,
) -> Result<PathBuf, String> {
    let cache_dir = ensure_clipboard_cache_dir()?;
    let staging_dir = cache_dir.join(format!("native-drag-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to create native drag staging dir: {}", e))?;
    let staged_extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .filter(|extension| !extension.trim().is_empty())
        .unwrap_or("png");
    let staged_stem = preferred_stem
        .filter(|stem| !stem.trim().is_empty())
        .or_else(|| source_path.file_stem().and_then(|stem| stem.to_str()))
        .unwrap_or("Hook");
    let (mut staged_file, staged_path) =
        create_unique_file(&staging_dir, staged_stem, Some(staged_extension))?;
    if let Err(error) = copy_file_with_limit(
        source_path,
        &mut staged_file,
        MAX_BASE64_IMAGE_ENCODED_BYTES as u64,
        "drag source",
    ) {
        drop(staged_file);
        let _ = fs::remove_file(&staged_path);
        return Err(error);
    }
    append_runtime_log_line(&format!(
        "native_drag_stage_created :: source={} staged={}",
        cache_file_name_for_log(source_path),
        cache_file_name_for_log(&staged_path)
    ));
    Ok(staged_path)
}

#[cfg(target_os = "windows")]
fn cleanup_staged_drag_file(path: &Path) {
    let _ = fs::remove_file(path);
    if let Some(parent) = path.parent() {
        let _ = fs::remove_dir(parent);
    }
}

fn cache_file_name_for_log(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "<unknown>".to_string())
}
