// Owns app-data resolution, managed settings state, and settings-dependent file naming.
const APP_DATA_OVERRIDE_ENV: &str = "HOOK_APPDATA_DIR";

fn resolve_effective_app_data_dir(current_dir: &Path) -> PathBuf {
    current_dir.to_path_buf()
}

fn configured_app_data_dir_override() -> Option<PathBuf> {
    std::env::var_os(APP_DATA_OVERRIDE_ENV)
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

fn resolve_effective_app_data_dir_from(current_dir: &Path, override_dir: Option<&Path>) -> PathBuf {
    if let Some(override_dir) = override_dir {
        return resolve_effective_app_data_dir(override_dir);
    }

    resolve_effective_app_data_dir(current_dir)
}

fn effective_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let current_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let override_dir = configured_app_data_dir_override();
    Ok(resolve_effective_app_data_dir_from(
        &current_dir,
        override_dir.as_deref(),
    ))
}

struct AppSettingsState {
    current: Mutex<app_settings::AppSettings>,
    save_lock: Mutex<()>,
}

static RUNTIME_HOOK_CACHE_SETTINGS: OnceLock<Mutex<app_settings::CacheSettings>> = OnceLock::new();
static SESSION_FILE_IO_LOCK: Mutex<()> = Mutex::new(());

fn set_runtime_hook_cache_settings(settings: app_settings::CacheSettings) {
    let cache = RUNTIME_HOOK_CACHE_SETTINGS
        .get_or_init(|| Mutex::new(app_settings::CacheSettings::default()));
    if let Ok(mut current) = cache.lock() {
        *current = settings;
    }
}

fn runtime_hook_cache_settings() -> app_settings::CacheSettings {
    RUNTIME_HOOK_CACHE_SETTINGS
        .get_or_init(|| Mutex::new(app_settings::CacheSettings::default()))
        .lock()
        .map(|settings| settings.clone())
        .unwrap_or_default()
}

impl AppSettingsState {
    fn new(settings: app_settings::AppSettings) -> Self {
        Self {
            current: Mutex::new(settings),
            save_lock: Mutex::new(()),
        }
    }

    fn snapshot(&self) -> Result<app_settings::AppSettings, String> {
        self.current
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| "App settings cache lock is poisoned".to_string())
    }

    fn save(
        &self,
        app_data_dir: &Path,
        settings: app_settings::AppSettings,
    ) -> Result<app_settings::AppSettings, String> {
        let _save_guard = self
            .save_lock
            .lock()
            .map_err(|_| "App settings save lock is poisoned".to_string())?;
        let saved = app_settings::save_app_settings(app_data_dir, settings)?;
        *self
            .current
            .lock()
            .map_err(|_| "App settings cache lock is poisoned".to_string())? = saved.clone();
        Ok(saved)
    }
}

fn current_file_naming_settings(app: &tauri::AppHandle) -> Result<FileNamingSettings, String> {
    app.try_state::<AppSettingsState>()
        .ok_or_else(|| "App settings cache is not initialized".to_string())?
        .snapshot()
        .map(|settings| settings.file_naming)
}

fn image_dimensions_from_bytes(image_data: &[u8]) -> Result<(u32, u32), String> {
    let image = image::load_from_memory(image_data)
        .map_err(|error| format!("Image load failed while preparing filename: {error}"))?;
    Ok((image.width(), image.height()))
}

fn prepare_file_naming_context(
    context: Option<FileNamingContext>,
    default_kind: &str,
    default_label: &str,
    width: u32,
    height: u32,
) -> FileNamingContext {
    let mut context = context.unwrap_or_default().with_dimensions(width, height);
    if context.app.trim().is_empty() {
        context.app = "Hook".to_string();
    }
    if context.kind.trim().is_empty() {
        context.kind = default_kind.to_string();
    }
    if context.label.trim().is_empty() {
        context.label = default_label.to_string();
    }
    context
}

fn render_user_file_stem(
    app: &tauri::AppHandle,
    pattern_kind: FileNamingPatternKind,
    context: FileNamingContext,
) -> Result<String, String> {
    let settings = current_file_naming_settings(app)?;
    Ok(render_file_stem(&settings, pattern_kind, context))
}

fn write_allocated_bytes(
    mut file: File,
    path: &Path,
    bytes: &[u8],
    action: &str,
) -> Result<(), String> {
    if let Err(error) = file.write_all(bytes) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(format!("Failed to {action}: {error}"));
    }
    Ok(())
}

#[tauri::command]
fn load_app_settings(
    state: tauri::State<'_, AppSettingsState>,
) -> Result<app_settings::AppSettings, String> {
    state.snapshot()
}

#[tauri::command]
fn save_app_settings(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppSettingsState>,
    settings: app_settings::AppSettings,
) -> Result<app_settings::AppSettings, String> {
    let saved = state.save(&effective_app_data_dir(&app)?, settings)?;
    set_runtime_hook_cache_settings(saved.cache.clone());
    Ok(saved)
}
