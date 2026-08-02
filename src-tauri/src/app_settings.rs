use crate::file_naming::{
    normalize_file_naming_settings, validate_file_naming_settings, FileNamingSettings,
    FILE_NAMING_SCHEMA_VERSION,
};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const APP_SETTINGS_FILE_NAME: &str = "app-settings.json";

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
                let backup = corrupted_settings_backup_path(app_data_dir);
                std::fs::rename(&path, &backup).map_err(|backup_error| {
                    format!(
                        "App settings are invalid ({error}) and could not be backed up to {}: {backup_error}",
                        backup.to_string_lossy()
                    )
                })?;
                return Ok(AppSettings::default());
            }
            settings.file_naming = normalize_file_naming_settings(settings.file_naming);
            Ok(settings)
        }
        Err(error) => {
            let backup = corrupted_settings_backup_path(app_data_dir);
            std::fs::rename(&path, &backup).map_err(|backup_error| {
                format!(
                    "App settings are invalid ({error}) and could not be backed up to {}: {backup_error}",
                    backup.to_string_lossy()
                )
            })?;
            Ok(AppSettings::default())
        }
    }
}

pub fn save_app_settings(
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

fn corrupted_settings_backup_path(app_data_dir: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    for index in 1..10_000u32 {
        let suffix = if index == 1 {
            String::new()
        } else {
            format!("-{index}")
        };
        let candidate = app_data_dir.join(format!("app-settings.corrupt-{timestamp}{suffix}.json"));
        if !candidate.exists() {
            return candidate;
        }
    }
    app_data_dir.join(format!("app-settings.corrupt-{timestamp}-overflow.json"))
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
}
