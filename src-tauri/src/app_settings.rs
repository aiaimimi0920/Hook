use crate::file_naming::{
    normalize_file_naming_settings, validate_file_naming_settings, FileNamingSettings,
    FILE_NAMING_SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const APP_SETTINGS_FILE_NAME: &str = "app-settings.json";
static APP_SETTINGS_IO_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub schema_version: u32,
    pub file_naming: FileNamingSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: FILE_NAMING_SCHEMA_VERSION,
            file_naming: FileNamingSettings::default(),
        }
    }
}

pub fn load_app_settings(app_data_dir: &Path) -> Result<AppSettings, String> {
    let _io_guard = APP_SETTINGS_IO_LOCK
        .lock()
        .map_err(|_| "App settings I/O lock is poisoned".to_string())?;
    load_app_settings_unlocked(app_data_dir)
}

fn load_app_settings_unlocked(app_data_dir: &Path) -> Result<AppSettings, String> {
    let path = app_data_dir.join(APP_SETTINGS_FILE_NAME);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(AppSettings::default())
        }
        Err(error) => return Err(format!("Failed to read app settings: {error}")),
    };

    match serde_json::from_slice::<AppSettings>(&bytes) {
        Ok(mut settings) => {
            settings.schema_version = FILE_NAMING_SCHEMA_VERSION;
            if let Err(error) = validate_file_naming_settings(&settings.file_naming) {
                backup_corrupted_settings(app_data_dir, &path, &bytes).map_err(|backup_error| {
                    format!("App settings are invalid ({error}) and could not be backed up: {backup_error}")
                })?;
                return Ok(AppSettings::default());
            }
            settings.file_naming = normalize_file_naming_settings(settings.file_naming);
            Ok(settings)
        }
        Err(error) => {
            backup_corrupted_settings(app_data_dir, &path, &bytes).map_err(|backup_error| {
                format!(
                    "App settings are invalid ({error}) and could not be backed up: {backup_error}"
                )
            })?;
            Ok(AppSettings::default())
        }
    }
}

pub fn save_app_settings(
    app_data_dir: &Path,
    settings: AppSettings,
) -> Result<AppSettings, String> {
    let _io_guard = APP_SETTINGS_IO_LOCK
        .lock()
        .map_err(|_| "App settings I/O lock is poisoned".to_string())?;
    save_app_settings_unlocked(app_data_dir, settings)
}

fn save_app_settings_unlocked(
    app_data_dir: &Path,
    mut settings: AppSettings,
) -> Result<AppSettings, String> {
    settings.schema_version = FILE_NAMING_SCHEMA_VERSION;
    validate_file_naming_settings(&settings.file_naming)?;
    settings.file_naming = normalize_file_naming_settings(settings.file_naming);
    std::fs::create_dir_all(app_data_dir)
        .map_err(|error| format!("Failed to create app settings directory: {error}"))?;

    let path = app_data_dir.join(APP_SETTINGS_FILE_NAME);
    let (temp_file, temp_path) = allocate_settings_temp_file(app_data_dir)?;
    let result = write_and_replace_settings(temp_file, &temp_path, &path, &settings);
    if result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    result?;
    Ok(settings)
}

fn write_and_replace_settings(
    mut file: File,
    temp_path: &Path,
    target_path: &Path,
    settings: &AppSettings,
) -> Result<(), String> {
    serde_json::to_writer_pretty(&mut file, settings)
        .map_err(|error| format!("Failed to serialize app settings: {error}"))?;
    file.write_all(b"\n")
        .map_err(|error| format!("Failed to finish app settings temp file: {error}"))?;
    file.flush()
        .map_err(|error| format!("Failed to flush app settings temp file: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Failed to sync app settings temp file: {error}"))?;
    drop(file);

    replace_file(temp_path, target_path)
}

fn allocate_settings_temp_file(app_data_dir: &Path) -> Result<(File, PathBuf), String> {
    for attempt in 0..100u32 {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let path = app_data_dir.join(format!(".{APP_SETTINGS_FILE_NAME}.{nonce}.{attempt}.tmp"));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((file, path)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "Failed to allocate app settings temp path: {error}"
                ))
            }
        }
    }
    Err("Failed to allocate app settings temp path".to_string())
}

fn allocate_corrupted_settings_backup_file(
    app_data_dir: &Path,
    timestamp: u128,
) -> Result<(File, PathBuf), String> {
    for index in 1..10_000u32 {
        let suffix = if index == 1 {
            String::new()
        } else {
            format!("-{index}")
        };
        let candidate = app_data_dir.join(format!(
            "app-settings.corrupt-{timestamp}-{process_id}{suffix}.json",
            process_id = std::process::id(),
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((file, candidate)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "Failed to allocate corrupt settings backup {}: {error}",
                    candidate.to_string_lossy(),
                ))
            }
        }
    }
    Err("Failed to allocate corrupt settings backup".to_string())
}

fn backup_corrupted_settings(
    app_data_dir: &Path,
    source_path: &Path,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(app_data_dir)
        .map_err(|error| format!("Failed to create app settings backup directory: {error}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let (mut backup_file, backup_path) =
        allocate_corrupted_settings_backup_file(app_data_dir, timestamp)?;
    if let Err(error) = backup_file
        .write_all(bytes)
        .and_then(|_| backup_file.sync_all())
    {
        drop(backup_file);
        let _ = std::fs::remove_file(&backup_path);
        return Err(format!("Failed to write corrupt settings backup: {error}"));
    }
    drop(backup_file);

    remove_corrupted_settings_source_if_unchanged(source_path, bytes)?;
    Ok(backup_path)
}

fn remove_corrupted_settings_source_if_unchanged(
    source_path: &Path,
    corrupted_bytes: &[u8],
) -> Result<(), String> {
    for attempt in 0..4 {
        match std::fs::read(source_path) {
            Ok(current_bytes) if current_bytes != corrupted_bytes => return Ok(()),
            Ok(_) => match std::fs::remove_file(source_path) {
                Ok(()) => return Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(error)
                    if error.kind() == std::io::ErrorKind::PermissionDenied && attempt < 3 =>
                {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(error) => {
                    return Err(format!(
                        "Failed to remove corrupt settings source after backup: {error}"
                    ))
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                return Err(format!(
                    "Failed to verify corrupt settings source after backup: {error}"
                ))
            }
        }
    }

    Err("Failed to remove corrupt settings source after backup retries".to_string())
}

#[cfg(target_os = "windows")]
fn replace_file(temp_path: &Path, target_path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let from: Vec<u16> = temp_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let to: Vec<u16> = target_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let moved = unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        return Err(format!(
            "Failed to atomically replace app settings: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn replace_file(temp_path: &Path, target_path: &Path) -> Result<(), String> {
    std::fs::rename(temp_path, target_path)
        .map_err(|error| format!("Failed to atomically replace app settings: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "hook-app-settings-{name}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    #[test]
    fn missing_settings_load_defaults() {
        let root = test_dir("missing");
        assert_eq!(load_app_settings(&root).unwrap(), AppSettings::default());
    }

    #[test]
    fn settings_round_trip_through_atomic_file() {
        let root = test_dir("roundtrip");
        let mut settings = AppSettings::default();
        settings.file_naming.drag_export_pattern = "{label}_{unitId}".to_string();
        let saved = save_app_settings(&root, settings.clone()).unwrap();
        assert_eq!(saved, settings);
        assert_eq!(load_app_settings(&root).unwrap(), settings);
        assert!(root.join(APP_SETTINGS_FILE_NAME).is_file());
        assert!(std::fs::read_dir(&root).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn invalid_settings_are_backed_up_and_defaulted() {
        let root = test_dir("corrupt");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join(APP_SETTINGS_FILE_NAME),
            b"{ definitely invalid json",
        )
        .unwrap();
        assert_eq!(load_app_settings(&root).unwrap(), AppSettings::default());
        assert!(!root.join(APP_SETTINGS_FILE_NAME).exists());
        assert!(std::fs::read_dir(&root).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("app-settings.corrupt-")));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn save_rejects_unknown_placeholders() {
        let root = test_dir("invalid-pattern");
        let mut settings = AppSettings::default();
        settings.file_naming.sticker_save_pattern = "Hook_{missing}".to_string();
        assert!(save_app_settings(&root, settings).is_err());
        assert!(!root.join(APP_SETTINGS_FILE_NAME).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn semantically_invalid_settings_are_backed_up_and_defaulted() {
        let root = test_dir("invalid-pattern-load");
        std::fs::create_dir_all(&root).unwrap();
        let mut settings = AppSettings::default();
        settings.file_naming.drag_export_pattern = "{unsupported}".to_string();
        std::fs::write(
            root.join(APP_SETTINGS_FILE_NAME),
            serde_json::to_vec(&settings).unwrap(),
        )
        .unwrap();
        assert_eq!(load_app_settings(&root).unwrap(), AppSettings::default());
        assert!(!root.join(APP_SETTINGS_FILE_NAME).exists());
        assert!(std::fs::read_dir(&root).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("app-settings.corrupt-")));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_backup_allocation_never_overwrites_an_existing_candidate() {
        let root = test_dir("corrupt-collision");
        std::fs::create_dir_all(&root).unwrap();
        let timestamp = 42u128;
        let first_path = root.join(format!(
            "app-settings.corrupt-{timestamp}-{}.json",
            std::process::id(),
        ));
        std::fs::write(&first_path, b"existing backup").unwrap();

        let (mut file, second_path) =
            allocate_corrupted_settings_backup_file(&root, timestamp).unwrap();
        file.write_all(b"new backup").unwrap();
        drop(file);

        assert_ne!(first_path, second_path);
        assert_eq!(std::fs::read(&first_path).unwrap(), b"existing backup");
        assert_eq!(std::fs::read(&second_path).unwrap(), b"new backup");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_corrupt_backups_allocate_distinct_files_without_errors() {
        use std::sync::{Arc, Barrier};

        let root = test_dir("corrupt-concurrent");
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join(APP_SETTINGS_FILE_NAME);
        std::fs::write(&source_path, b"{ invalid").unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let handles = (0..2)
            .map(|_| {
                let root = root.clone();
                let source_path = source_path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    backup_corrupted_settings(&root, &source_path, b"{ invalid")
                })
            })
            .collect::<Vec<_>>();
        let backups = handles
            .into_iter()
            .map(|handle| handle.join().unwrap().unwrap())
            .collect::<Vec<_>>();

        assert_ne!(backups[0], backups[1]);
        assert!(backups
            .iter()
            .all(|path| std::fs::read(path).unwrap() == b"{ invalid"));
        assert!(!source_path.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_backup_cleanup_does_not_remove_a_newer_replacement() {
        let root = test_dir("corrupt-newer-replacement");
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join(APP_SETTINGS_FILE_NAME);
        let corrupted_bytes = b"{ invalid";
        let replacement_bytes = serde_json::to_vec(&AppSettings::default()).unwrap();
        std::fs::write(&source_path, replacement_bytes.as_slice()).unwrap();

        remove_corrupted_settings_source_if_unchanged(&source_path, corrupted_bytes).unwrap();

        assert_eq!(std::fs::read(&source_path).unwrap(), replacement_bytes);
        let _ = std::fs::remove_dir_all(root);
    }
}
