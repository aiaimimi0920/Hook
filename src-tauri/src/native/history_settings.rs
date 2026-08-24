// Owns bounded history and tool-settings persistence commands.

const HISTORY_MAX_COLORS: usize = 64;
const HISTORY_MAX_SCREENSHOTS: usize = 64;
const HISTORY_SETTINGS_MAX_JSON_BYTES: usize = 8 * 1024 * 1024;
static HISTORY_SETTINGS_FILE_IO_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn history_settings_file_io_lock() -> &'static Mutex<()> {
    HISTORY_SETTINGS_FILE_IO_LOCK.get_or_init(|| Mutex::new(()))
}

fn write_history_settings_json_atomically(path: &Path, json: &[u8]) -> Result<(), String> {
    if json.len() > HISTORY_SETTINGS_MAX_JSON_BYTES {
        return Err(format!(
            "History/settings payload too large: {} bytes exceeds limit {}",
            json.len(), HISTORY_SETTINGS_MAX_JSON_BYTES
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| "History/settings path has no parent directory".to_string())?;
    let (mut temp_file, temp_path) = create_unique_file(parent, ".hook-json", Some("tmp"))?;
    if let Err(error) = temp_file.write_all(json).and_then(|_| temp_file.sync_all()) {
        drop(temp_file);
        let _ = fs::remove_file(&temp_path);
        return Err(error.to_string());
    }
    drop(temp_file);
    if let Err(error) = replace_session_file(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error.replace("Hook session", "Hook history/settings"));
    }
    Ok(())
}

fn read_history_settings_json(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > HISTORY_SETTINGS_MAX_JSON_BYTES as u64 {
        return Err(format!(
            "History/settings file too large: {} bytes exceeds limit {}",
            metadata.len(), HISTORY_SETTINGS_MAX_JSON_BYTES
        ));
    }
    fs::read(path).map_err(|error| error.to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryData {
    #[serde(default)]
    pub colors: Vec<serde_json::Value>,
    #[serde(default)]
    pub screenshots: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolSettingsData {
    #[serde(default)]
    pub sticker_tool_settings: Option<serde_json::Value>,
}

/// Persist the color/screenshot history to app_data_dir/history.json.
/// Entries are capped on write so a runaway caller cannot grow the file
/// unbounded; the most recent entries (front of the list) are kept.
#[tauri::command]
fn save_history(
    app: tauri::AppHandle,
    colors: Vec<serde_json::Value>,
    screenshots: Vec<serde_json::Value>,
) -> Result<(), String> {
    let app_dir = effective_app_data_dir(&app)?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }

    let mut bounded_colors = colors;
    bounded_colors.truncate(HISTORY_MAX_COLORS);
    let mut bounded_screenshots = screenshots;
    bounded_screenshots.truncate(HISTORY_MAX_SCREENSHOTS);

    let history = HistoryData {
        colors: bounded_colors,
        screenshots: bounded_screenshots,
    };

    let history_file = app_dir.join("history.json");
    let json = serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?;
    let _guard = history_settings_file_io_lock()
        .lock()
        .map_err(|_| "History/settings file I/O lock is poisoned".to_string())?;
    write_history_settings_json_atomically(&history_file, json.as_bytes())
}

#[tauri::command]
fn load_history(app: tauri::AppHandle) -> Result<HistoryData, String> {
    let app_dir = effective_app_data_dir(&app)?;
    let history_file = app_dir.join("history.json");
    if !history_file.exists() {
        return Ok(HistoryData::default());
    }

    let _guard = history_settings_file_io_lock()
        .lock()
        .map_err(|_| "History/settings file I/O lock is poisoned".to_string())?;
    let content = read_history_settings_json(&history_file)?;
    let mut history: HistoryData = serde_json::from_slice(&content)
        .map_err(|_| "Hook history file contains malformed JSON".to_string())?;
    history.colors.truncate(HISTORY_MAX_COLORS);
    history.screenshots.truncate(HISTORY_MAX_SCREENSHOTS);
    Ok(history)
}

#[tauri::command]
fn save_tool_settings(
    app: tauri::AppHandle,
    sticker_tool_settings: serde_json::Value,
) -> Result<(), String> {
    let app_dir = effective_app_data_dir(&app)?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }

    let payload = ToolSettingsData {
        sticker_tool_settings: Some(sticker_tool_settings),
    };

    let tool_settings_file = app_dir.join("tool-settings.json");
    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    let _guard = history_settings_file_io_lock()
        .lock()
        .map_err(|_| "History/settings file I/O lock is poisoned".to_string())?;
    write_history_settings_json_atomically(&tool_settings_file, json.as_bytes())
}

#[tauri::command]
fn load_tool_settings(app: tauri::AppHandle) -> Result<ToolSettingsData, String> {
    let app_dir = effective_app_data_dir(&app)?;
    let tool_settings_file = app_dir.join("tool-settings.json");
    if !tool_settings_file.exists() {
        return Ok(ToolSettingsData::default());
    }

    let _guard = history_settings_file_io_lock()
        .lock()
        .map_err(|_| "History/settings file I/O lock is poisoned".to_string())?;
    let content = read_history_settings_json(&tool_settings_file)?;
    let payload: ToolSettingsData = serde_json::from_slice(&content)
        .map_err(|_| "Hook tool settings file contains malformed JSON".to_string())?;
    Ok(payload)
}
