mod app_settings;
mod capture;
mod capture_coords;
mod capture_windows;
pub mod emergency_watchdog;
mod file_naming;
mod long_capture;
mod loom_config;
pub mod loom_connector;
mod mock_artloom; // Integration
mod mouse_monitor;
mod screenshot;
mod single_instance;
pub mod talk_connector;
pub mod tea_client;
pub mod voice;

use capture::{CaptureMetadata, CaptureResponse};
use capture_coords::{normalize_global_physical_to_local_logical, CaptureWindowMetrics};
use file_naming::{
    create_unique_file, render_file_stem, FileNamingContext, FileNamingPatternKind,
    FileNamingSettings,
};
use mock_artloom::MockArtLoom;
use single_instance::{single_instance_name, try_acquire_single_instance};

use base64::Engine as _;
use mouse_monitor::SharedHitMap;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::collections::VecDeque;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
#[cfg(target_os = "windows")]
use std::sync::Condvar;
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, Size, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
// Windows Imports
#[cfg(target_os = "windows")]
use uiautomation::types::Point as UiaPoint;
#[cfg(target_os = "windows")]
use uiautomation::UIAutomation;

// Import Windows specific modules for shared memory
#[cfg(target_os = "windows")]
use windows::core::{Interface, BOOL, PCWSTR, PWSTR};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{
    CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_OR,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_READ, MEMORY_MAPPED_VIEW_ADDRESS,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{
    GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Variant::{VARIANT, VARIANT_0, VARIANT_0_0, VARIANT_0_0_0, VT_I4};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Controls::Dialogs::{
    CommDlgExtendedError, GetOpenFileNameW, GetSaveFileNameW, CDN_INITDONE, OFN_ENABLEHOOK,
    OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST,
    OPENFILENAMEW,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_BACK, VK_CONTROL, VK_DELETE, VK_ESCAPE, VK_LBUTTON, VK_LMENU, VK_LSHIFT,
    VK_MENU, VK_RMENU, VK_RSHIFT, VK_SHIFT, VK_TAB,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Shell::{
    IShellWindows, IWebBrowser2, SHChangeNotify, ShellWindows, SHCNE_UPDATEDIR, SHCNE_UPDATEITEM,
    SHCNF_FLUSHNOWAIT, SHCNF_PATHW,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, CallWindowProcW, CopyIcon, CreateWindowExW, DefWindowProcW, DispatchMessageW,
    EnumWindows, GetAncestor, GetClassNameW, GetCursorPos, GetForegroundWindow, GetMessageW,
    GetParent, GetWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId,
    IsWindowVisible, LoadCursorW, SetLayeredWindowAttributes, SetSystemCursor, SetWindowLongPtrW,
    SetWindowPos, SetWindowsHookExW, ShowWindow, SystemParametersInfoW, TranslateMessage,
    UnhookWindowsHookEx, WindowFromPoint, GA_ROOT, GWLP_WNDPROC, GWL_EXSTYLE, GW_HWNDPREV, HCURSOR,
    HC_ACTION, HICON, HWND_NOTOPMOST, HWND_TOPMOST, IDC_CROSS, KBDLLHOOKSTRUCT, LWA_ALPHA,
    MA_NOACTIVATE, MSG, MSLLHOOKSTRUCT, OCR_CROSS, OCR_HAND, OCR_IBEAM, OCR_NO, OCR_NORMAL,
    OCR_SIZEALL, OCR_SIZENESW, OCR_SIZENS, OCR_SIZENWSE, OCR_SIZEWE, OCR_UP, SPI_SETCURSORS,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW,
    SW_HIDE, SW_SHOWNA, SYSTEM_CURSOR_ID, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP,
    WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEACTIVATE, WM_MOUSEMOVE,
    WM_MOUSEWHEEL, WM_NOTIFY, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    WM_XBUTTONDOWN, WM_XBUTTONUP, WNDPROC, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TRANSPARENT, WS_POPUP,
};

// =====================================
// New WinAPI helpers for Shared Memory
// =====================================

#[cfg(target_os = "windows")]
fn read_shm_winapi(name: &str, size: usize) -> Result<Vec<u8>, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    println!("Backend: Opening SHM via WinAPI: {}", name);

    // Convert string to wide string (UTF-16) + null terminator
    let wide_name: Vec<u16> = OsStr::new(name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        // 1. Open File Mapping
        let handle = OpenFileMappingW(
            FILE_MAP_READ.0, // Read access
            false,           // Inherit handle
            PCWSTR(wide_name.as_ptr()),
        )
        .map_err(|e| format!("OpenFileMappingW failed: {:?}", e))?;

        if handle.is_invalid() {
            return Err("Invalid handle returned from OpenFileMappingW".to_string());
        }

        // 2. Map View of File
        let ptr = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, size);

        if ptr.Value.is_null() {
            let _ = CloseHandle(handle);
            return Err("MapViewOfFile failed".to_string());
        }

        // 3. Copy Data
        let slice = std::slice::from_raw_parts(ptr.Value as *const u8, size);
        let data = slice.to_vec();

        // 4. Cleanup
        let _ = UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS { Value: ptr.Value });
        let _ = CloseHandle(handle);

        Ok(data)
    }
}

#[cfg(not(target_os = "windows"))]
fn read_shm_winapi(_name: &str, _size: usize) -> Result<Vec<u8>, String> {
    Err("Shared Memory (WinAPI) not supported on non-Windows OS".to_string())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BootProfile {
    startup_mode: String,
    initial_ui_mode: String,
    auto_start_capture: bool,
    art_loom_enabled: bool,
    art_loom_ws_url: String,
}

fn read_env_bool(key: &str, default: bool) -> bool {
    std::env::var(key)
        .ok()
        .map(|value| {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        })
        .unwrap_or(default)
}

fn boot_profile_from_env() -> BootProfile {
    let startup_mode = match std::env::var("HOOK_STARTUP_MODE") {
        Ok(value) if value.trim().eq_ignore_ascii_case("visible") => "visible".to_string(),
        _ => "silent".to_string(),
    };

    let initial_ui_mode = match std::env::var("HOOK_INITIAL_UI_MODE") {
        Ok(value) if value.trim().eq_ignore_ascii_case("overlay") => "overlay".to_string(),
        Ok(value) if value.trim().eq_ignore_ascii_case("canvas") => "canvas".to_string(),
        Ok(value) if value.trim().eq_ignore_ascii_case("tray") => "tray".to_string(),
        _ if startup_mode == "visible" => "overlay".to_string(),
        _ => "overlay".to_string(),
    };

    let art_loom_ws_url = std::env::var("ARTLOOM_WS_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ws://127.0.0.1:19820".to_string());

    BootProfile {
        startup_mode,
        initial_ui_mode,
        auto_start_capture: read_env_bool("HOOK_AUTOSTART_CAPTURE", false),
        art_loom_enabled: read_env_bool("HOOK_ENABLE_ARTLOOM", false),
        art_loom_ws_url,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfCheckCapabilities {
    desktop: bool,
    capture: bool,
    loom_connector: bool,
    talk_connector: bool,
    tea_connector: bool,
    voice: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfCheckReport {
    app: &'static str,
    binary: &'static str,
    version: &'static str,
    status: &'static str,
    capabilities: SelfCheckCapabilities,
}

pub fn self_check_report() -> SelfCheckReport {
    SelfCheckReport {
        app: "Hook",
        binary: "hook.exe",
        version: env!("CARGO_PKG_VERSION"),
        status: "ok",
        capabilities: SelfCheckCapabilities {
            desktop: true,
            capture: true,
            loom_connector: true,
            talk_connector: true,
            tea_connector: true,
            voice: true,
        },
    }
}

pub fn self_check_report_json() -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&self_check_report())
}

pub fn loom_brain_plan_smoke_request() -> loom_connector::LoomBrainPlanRequest {
    loom_connector::LoomBrainPlanRequest {
        request_id: Some("hook-loom-smoke-1".to_string()),
        goal: "Hook Loom release smoke".to_string(),
        constraints: vec!["no-ui".to_string()],
        context: Some(serde_json::json!({
            "source": "hook-cli-smoke"
        })),
        timeout_ms: Some(5_000),
    }
}

pub fn loom_brain_plan_smoke_report_json() -> Result<String, String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("failed to create Loom smoke runtime: {error}"))?;
    let result = runtime
        .block_on(loom_connector::invoke_brain_plan(
            loom_brain_plan_smoke_request(),
        ))
        .map_err(|error| error.to_string())?;
    if result.status != "succeeded" {
        let body = serde_json::to_string(&result)
            .unwrap_or_else(|error| format!("failed to serialize failed result: {error}"));
        return Err(format!(
            "Loom brain plan smoke returned non-succeeded status: {body}"
        ));
    }
    serde_json::to_string_pretty(&result)
        .map_err(|error| format!("failed to serialize Loom smoke result: {error}"))
}

pub fn talk_capture_smoke_request() -> talk_connector::TalkVoiceCaptureRequest {
    talk_connector::TalkVoiceCaptureRequest {
        request_id: Some("hook-talk-smoke-1".to_string()),
        mode: Some("dictation".to_string()),
        context: Some(serde_json::json!({
            "source": "hook-cli-smoke"
        })),
        timeout_ms: Some(5_000),
    }
}

pub fn talk_capture_smoke_report_json() -> Result<String, String> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("failed to create Talk smoke runtime: {error}"))?;
    let result = runtime
        .block_on(talk_connector::capture_voice_once(
            talk_capture_smoke_request(),
        ))
        .map_err(|error| error.to_string())?;
    if result.status != "succeeded" {
        let body = serde_json::to_string(&result)
            .unwrap_or_else(|error| format!("failed to serialize failed result: {error}"));
        return Err(format!(
            "Talk voice capture smoke returned non-succeeded status: {body}"
        ));
    }
    serde_json::to_string_pretty(&result)
        .map_err(|error| format!("failed to serialize Talk smoke result: {error}"))
}

pub fn hook_help_text() -> &'static str {
    concat!(
        "Usage: hook [OPTIONS]\n",
        "\n",
        "Options:\n",
        "  --self-check              Print a no-GUI JSON self-check report and exit\n",
        "  --loom-brain-plan-smoke   Invoke Loom brain.plan through local capability discovery and exit\n",
        "  --talk-voice-capture-smoke Invoke Talk voice.capture.once through local capability discovery and exit\n",
        "  -h, --help                Print help\n",
        "  -V, --version             Print version\n",
        "\n",
        "Emergency exit:\n",
        "  Double-press Esc within 400 ms, or press Ctrl+Alt+Shift+F12.\n",
        "\n",
        "Environment:\n",
        "  HOOK_SELF_CHECK_OUTPUT          Optional file path for --self-check JSON output\n",
        "  HOOK_LOOM_BRAIN_PLAN_OUTPUT    Optional file path for --loom-brain-plan-smoke JSON output\n",
        "  HOOK_TALK_VOICE_CAPTURE_OUTPUT Optional file path for --talk-voice-capture-smoke JSON output\n",
        "  HOOK_CLI_OUTPUT                 Optional file path for --help/--version text output\n",
        "  HOOK_CAPTURE_DYNAMIC_RANGE      Region capture mode: auto (default), hdr, or sdr\n",
    )
}

pub fn hook_version_text() -> String {
    format!("hook {}", env!("CARGO_PKG_VERSION"))
}

pub fn write_optional_cli_output(env_name: &str, text: &str) -> std::io::Result<()> {
    if let Ok(path) = std::env::var(env_name) {
        if !path.trim().is_empty() {
            std::fs::write(path, text)?;
        }
    }
    Ok(())
}

fn runtime_log_dir() -> PathBuf {
    std::env::var("HOOK_LOG_DIR")
        .ok()
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(default_runtime_log_dir)
}

fn default_runtime_log_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .ok()
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(std::env::temp_dir)
        .join("Hook")
        .join("logs")
}

const LEGACY_TAURI_IDENTIFIERS: &[&str] = &["io.github.aiaimimi0920.hook", "com.vmjcv.hook"];
const APP_DATA_OVERRIDE_ENV: &str = "HOOK_APPDATA_DIR";

fn legacy_app_data_dirs_from_current(current_dir: &Path) -> Vec<PathBuf> {
    let current_name = current_dir.file_name().and_then(|name| name.to_str());
    LEGACY_TAURI_IDENTIFIERS
        .iter()
        .filter(|identifier| {
            current_name
                .map(|name| !name.eq_ignore_ascii_case(identifier))
                .unwrap_or(true)
        })
        .map(|identifier| current_dir.with_file_name(identifier))
        .collect()
}

fn app_data_dir_contains_user_state(dir: &Path) -> bool {
    [
        "session.json",
        "history.json",
        "tool-settings.json",
        "app-settings.json",
        "images",
        "saved",
    ]
    .iter()
    .any(|entry| dir.join(entry).exists())
}

fn resolve_effective_app_data_dir(current_dir: &Path) -> PathBuf {
    for legacy_dir in legacy_app_data_dirs_from_current(current_dir) {
        if legacy_dir.exists()
            && (!current_dir.exists()
                || (!app_data_dir_contains_user_state(current_dir)
                    && app_data_dir_contains_user_state(&legacy_dir)))
        {
            return legacy_dir;
        }
    }
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
    state.save(&effective_app_data_dir(&app)?, settings)
}

const RUNTIME_LOG_QUEUE_CAPACITY: usize = 512;
static RUNTIME_LOG_SENDER: OnceLock<mpsc::SyncSender<String>> = OnceLock::new();
static INSTALLED_FONT_FAMILIES: OnceLock<Vec<String>> = OnceLock::new();

fn append_runtime_log_line_sync(line: &str) {
    let dir = runtime_log_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }

    let path = dir.join("hook-runtime.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{}", line);
    }
}

fn runtime_log_sender() -> &'static mpsc::SyncSender<String> {
    RUNTIME_LOG_SENDER.get_or_init(|| {
        let (sender, receiver) = mpsc::sync_channel::<String>(RUNTIME_LOG_QUEUE_CAPACITY);
        let _ = std::thread::Builder::new()
            .name("hook-runtime-log".to_string())
            .spawn(move || {
                while let Ok(line) = receiver.recv() {
                    append_runtime_log_line_sync(&line);
                }
            });
        sender
    })
}

pub(crate) fn append_runtime_log_line(message: &str) {
    let timestamp = runtime_log_timestamp();
    let line = format!("[{}] {}", timestamp, message);
    let _ = runtime_log_sender().try_send(line);
}

// Install a process-wide panic hook that records the panic message, location,
// and thread name to the runtime log BEFORE the runtime aborts. The release
// profile is `panic = "abort"` with `strip = true` and no symbols, so a panic
// (on the UI thread OR any worker like the mock ArtLoom processing thread)
// otherwise vanishes as a bare Windows fast-fail (0xc0000409) with no message.
// Writing synchronously here — not via the async runtime-log channel — is
// essential: the channel's background thread may never drain before abort.
fn install_panic_logger() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        prepare_for_hook_process_exit("panic");
        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "<unknown location>".to_string());
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "<non-string panic payload>".to_string()
        };
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("<unnamed>").to_string();
        let line = format!(
            "[{}] PANIC in thread '{}' at {}: {}",
            runtime_log_timestamp(),
            thread_name,
            location,
            message
        );
        // Synchronous write so the record survives the imminent abort.
        append_runtime_log_line_sync(&line);
        eprintln!("{line}");
        // Preserve default behavior (prints to stderr) for good measure.
        default_hook(info);
    }));
}

fn unix_timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn runtime_log_timestamp() -> String {
    unix_timestamp_millis().to_string()
}

fn file_timestamp_component() -> String {
    unix_timestamp_millis().to_string()
}

fn create_internal_capture_file(
    cache_dir: &Path,
    prefix: &str,
    timestamp: &str,
) -> Result<(File, PathBuf), String> {
    create_unique_file(cache_dir, &format!("{prefix}_{timestamp}"), Some("png"))
}

fn sanitize_internal_asset_component(hint: Option<&str>) -> String {
    let sanitized: String = hint
        .unwrap_or("hook")
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();

    let collapsed = sanitized.trim_matches('_');
    if collapsed.is_empty() {
        "hook".to_string()
    } else {
        collapsed.chars().take(48).collect()
    }
}

const MAX_BASE64_IMAGE_ENCODED_BYTES: usize = 64 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 100_000_000;
// Per-image limits above bound a single frame, but a stitch call takes a whole
// Vec of frames that are each decoded to a full bitmap. Without an aggregate cap
// a caller can submit thousands of max-size frames and exhaust memory. This caps
// the frame count; combined with the per-frame pixel limit it bounds peak memory.
const MAX_STITCH_FRAME_COUNT: usize = 512;
const CLIPBOARD_CACHE_MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;
const CLIPBOARD_CACHE_MAX_BYTES: u64 = 256 * 1024 * 1024;
const CLIPBOARD_CACHE_TARGET_BYTES: u64 = 128 * 1024 * 1024;
const SESSION_IMAGE_ASSET_RETENTION_SECS: u64 = 30 * 24 * 60 * 60;

fn decode_base64_image_data(base64_image: &str) -> Result<Vec<u8>, String> {
    let base64_data = base64_image.split(",").last().unwrap_or(base64_image);
    if base64_data.len() > MAX_BASE64_IMAGE_ENCODED_BYTES {
        return Err(format!(
            "Image payload too large: {} encoded bytes exceeds limit {}",
            base64_data.len(),
            MAX_BASE64_IMAGE_ENCODED_BYTES
        ));
    }

    let image_data = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;
    validate_image_data_limits(&image_data)?;
    Ok(image_data)
}

fn validate_image_data_limits(image_data: &[u8]) -> Result<(), String> {
    let image =
        image::load_from_memory(image_data).map_err(|e| format!("Image load failed: {}", e))?;
    let pixels = u64::from(image.width()) * u64::from(image.height());
    if pixels > MAX_IMAGE_PIXELS {
        return Err(format!(
            "Image dimensions too large: {}x{} exceeds {} pixels",
            image.width(),
            image.height(),
            MAX_IMAGE_PIXELS
        ));
    }
    Ok(())
}

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
    cleanup_clipboard_cache_dir(
        &dir,
        SystemTime::now(),
        CLIPBOARD_CACHE_MAX_BYTES,
        CLIPBOARD_CACHE_TARGET_BYTES,
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

    let max_age = std::time::Duration::from_secs(CLIPBOARD_CACHE_MAX_AGE_SECS);
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
            if is_native_drag_staging && now.duration_since(modified).unwrap_or_default() > max_age
            {
                let _ = fs::remove_dir_all(entry.path());
            }
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        if now.duration_since(modified).unwrap_or_default() > max_age {
            let _ = fs::remove_file(entry.path());
            continue;
        }
        entries.push((entry.path(), modified, metadata.len()));
    }

    let mut total_bytes: u64 = entries.iter().map(|(_, _, len)| *len).sum();
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
    let _ = cleanup_clipboard_cache_dir(
        &cache_dir,
        SystemTime::now(),
        CLIPBOARD_CACHE_MAX_BYTES,
        CLIPBOARD_CACHE_TARGET_BYTES,
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
    let mut source_file =
        File::open(source_path).map_err(|e| format!("Failed to open drag source: {}", e))?;
    if let Err(error) = std::io::copy(&mut source_file, &mut staged_file) {
        drop(staged_file);
        let _ = fs::remove_file(&staged_path);
        return Err(format!("Failed to stage drag file copy: {}", error));
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

fn ensure_image_search_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cache_dir = effective_app_data_dir(app)?.join("image-search-cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create image-search cache dir: {}", e))?;
    Ok(cache_dir)
}

fn remote_image_cache_key(url: &str) -> String {
    session_image_asset_fingerprint(url.as_bytes())
}

fn find_cached_remote_image_path(cache_dir: &Path, url: &str) -> Result<Option<PathBuf>, String> {
    if !cache_dir.exists() {
        return Ok(None);
    }

    let prefix = format!("remote_{}.", remote_image_cache_key(url));
    for entry in fs::read_dir(cache_dir)
        .map_err(|e| format!("Failed to read image-search cache dir: {}", e))?
    {
        let entry =
            entry.map_err(|e| format!("Failed to inspect image-search cache entry: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.starts_with(&prefix)
            && fs::metadata(&path)
                .map(|metadata| metadata.len() > 0)
                .unwrap_or(false)
        {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

fn remote_image_cache_extension(
    url: &str,
    bytes: &[u8],
    content_type: Option<&str>,
) -> &'static str {
    if let Ok(format) = image::guess_format(bytes) {
        return match format {
            image::ImageFormat::Png => "png",
            image::ImageFormat::Jpeg => "jpg",
            image::ImageFormat::WebP => "webp",
            image::ImageFormat::Bmp => "bmp",
            image::ImageFormat::Gif => "gif",
            _ => "png",
        };
    }

    if let Some(content_type) = content_type {
        let normalized = content_type.to_ascii_lowercase();
        if normalized.contains("png") {
            return "png";
        }
        if normalized.contains("jpeg") || normalized.contains("jpg") {
            return "jpg";
        }
        if normalized.contains("webp") {
            return "webp";
        }
        if normalized.contains("bmp") {
            return "bmp";
        }
        if normalized.contains("gif") {
            return "gif";
        }
    }

    let path_part = url.split('?').next().unwrap_or(url);
    let path_part = path_part.split('#').next().unwrap_or(path_part);
    let lower = path_part.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "jpg"
    } else if lower.ends_with(".webp") {
        "webp"
    } else if lower.ends_with(".bmp") {
        "bmp"
    } else if lower.ends_with(".gif") {
        "gif"
    } else {
        "png"
    }
}

const IMAGE_SEARCH_FETCH_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const IMAGE_SEARCH_FETCH_ACCEPT: &str =
    "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
const IMAGE_SEARCH_FETCH_ACCEPT_LANGUAGE: &str = "zh-CN,zh;q=0.9,en;q=0.8";

fn looks_like_remote_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

async fn download_remote_image_bytes_with_reqwest(
    url: &str,
    referer: Option<&str>,
) -> Result<(Option<String>, Vec<u8>), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(IMAGE_SEARCH_FETCH_USER_AGENT)
        .no_proxy()
        .build()
        .map_err(|e| format!("Failed to build remote image client: {}", e))?;
    let mut request = client
        .get(url)
        .header(reqwest::header::ACCEPT, IMAGE_SEARCH_FETCH_ACCEPT)
        .header(
            reqwest::header::ACCEPT_LANGUAGE,
            IMAGE_SEARCH_FETCH_ACCEPT_LANGUAGE,
        );
    if let Some(referer) = referer.filter(|value| looks_like_remote_url(value)) {
        request = request.header(reqwest::header::REFERER, referer);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Failed to download remote image: {}", e))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Remote image download failed: HTTP {}",
            status.as_u16()
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read remote image response: {}", e))?
        .to_vec();
    Ok((content_type, bytes))
}

#[cfg(target_os = "windows")]
fn download_remote_image_bytes_with_powershell_httpclient(
    url: &str,
    referer: Option<&str>,
) -> Result<(Option<String>, Vec<u8>), String> {
    let script = r#"
Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(30)
$client.DefaultRequestHeaders.UserAgent.ParseAdd($env:HOOK_FETCH_USER_AGENT)
$client.DefaultRequestHeaders.Accept.ParseAdd($env:HOOK_FETCH_ACCEPT)
$client.DefaultRequestHeaders.AcceptLanguage.ParseAdd($env:HOOK_FETCH_ACCEPT_LANGUAGE)
if ($env:HOOK_FETCH_REFERER) {
  try {
    $client.DefaultRequestHeaders.Referrer = [Uri]$env:HOOK_FETCH_REFERER
  } catch {
  }
}
try {
  $resp = $client.GetAsync($env:HOOK_FETCH_URL).GetAwaiter().GetResult()
  if (-not $resp.IsSuccessStatusCode) {
    exit 22
  }
  $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
  $contentType = ''
  if ($resp.Content.Headers.ContentType) {
    $contentType = $resp.Content.Headers.ContentType.MediaType
  }
  @{ contentType = $contentType; dataBase64 = [Convert]::ToBase64String($bytes) } | ConvertTo-Json -Compress
} finally {
  $client.Dispose()
  $handler.Dispose()
}
"#;

    let mut command = std::process::Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .env("HOOK_FETCH_URL", url)
        .env("HOOK_FETCH_USER_AGENT", IMAGE_SEARCH_FETCH_USER_AGENT)
        .env("HOOK_FETCH_ACCEPT", IMAGE_SEARCH_FETCH_ACCEPT)
        .env(
            "HOOK_FETCH_ACCEPT_LANGUAGE",
            IMAGE_SEARCH_FETCH_ACCEPT_LANGUAGE,
        )
        .env(
            "HOOK_FETCH_REFERER",
            referer
                .filter(|value| looks_like_remote_url(value))
                .unwrap_or(""),
        )
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command
        .output()
        .map_err(|e| format!("PowerShell remote image download failed: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if stderr.is_empty() {
            return Err("PowerShell remote image download failed".to_string());
        }
        return Err(format!(
            "PowerShell remote image download failed: {}",
            stderr
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if stdout.is_empty() {
        return Err("PowerShell remote image download returned empty stdout".to_string());
    }
    let response = serde_json::from_str::<serde_json::Value>(&stdout)
        .map_err(|e| format!("Failed to parse PowerShell remote image response: {}", e))?;
    let bytes = response
        .get("dataBase64")
        .and_then(serde_json::Value::as_str)
        .and_then(|base64| {
            base64::engine::general_purpose::STANDARD
                .decode(base64)
                .ok()
        })
        .ok_or_else(|| "PowerShell remote image response contained no bytes".to_string())?;
    let content_type = response
        .get("contentType")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    Ok((content_type, bytes))
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
struct SaveDialogPlacement {
    target_x: i32,
    target_y: i32,
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
unsafe fn move_save_dialog_to_target(dialog_hwnd: HWND, placement: SaveDialogPlacement) {
    let parent_hwnd = GetParent(dialog_hwnd).unwrap_or(dialog_hwnd);
    let mut rect = RECT::default();
    if GetWindowRect(parent_hwnd, &mut rect).is_err() {
        return;
    }

    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    let x = placement.target_x - width / 2;
    let y = placement.target_y - height / 2;
    let _ = SetWindowPos(
        parent_hwnd,
        None,
        x,
        y,
        0,
        0,
        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
    );
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn save_dialog_hook(
    dialog_hwnd: HWND,
    message: u32,
    _wparam: WPARAM,
    lparam: LPARAM,
) -> usize {
    if message != WM_NOTIFY {
        return 0;
    }

    let notification = lparam.0 as *const windows::Win32::UI::Controls::Dialogs::OFNOTIFYW;
    if notification.is_null() || (*notification).hdr.code != CDN_INITDONE {
        return 0;
    }

    let open_file_name = (*notification).lpOFN;
    if open_file_name.is_null() {
        return 0;
    }

    let placement = (*open_file_name).lCustData.0 as *const SaveDialogPlacement;
    if placement.is_null() {
        return 0;
    }

    move_save_dialog_to_target(dialog_hwnd, *placement);
    0
}

#[cfg(target_os = "windows")]
fn resolve_save_dialog_placement(
    app: &tauri::AppHandle,
    dialog_center_x: f64,
    dialog_center_y: f64,
) -> Result<(HWND, SaveDialogPlacement), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok((
            HWND(std::ptr::null_mut()),
            SaveDialogPlacement {
                target_x: dialog_center_x.round() as i32,
                target_y: dialog_center_y.round() as i32,
            },
        ));
    };

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let origin = window
        .outer_position()
        .unwrap_or(PhysicalPosition { x: 0, y: 0 });
    let owner = window.hwnd().map_err(|e| e.to_string())?;
    let owner = HWND(owner.0);

    Ok((
        owner,
        SaveDialogPlacement {
            target_x: origin.x + (dialog_center_x * scale_factor).round() as i32,
            target_y: origin.y + (dialog_center_y * scale_factor).round() as i32,
        },
    ))
}

#[cfg(target_os = "windows")]
fn select_sticker_save_path(
    app: &tauri::AppHandle,
    dialog_center_x: f64,
    dialog_center_y: f64,
    default_filename: &str,
) -> Result<Option<PathBuf>, String> {
    let window = app.get_webview_window("main");
    let (owner, placement) = resolve_save_dialog_placement(app, dialog_center_x, dialog_center_y)?;

    let default_filename_wide = wide_null(default_filename);
    let filter_wide: Vec<u16> = "PNG Image (*.png)\0*.png\0All Files (*.*)\0*.*\0\0"
        .encode_utf16()
        .collect();
    let title_wide = wide_null("另存为贴图图片");
    let default_extension_wide = wide_null("png");
    let mut file_buffer = vec![0u16; 32768];
    let copy_len = default_filename_wide.len().min(file_buffer.len());
    file_buffer[..copy_len].copy_from_slice(&default_filename_wide[..copy_len]);

    let mut dialog = OPENFILENAMEW::default();
    dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    dialog.hwndOwner = owner;
    dialog.lpstrFilter = PCWSTR(filter_wide.as_ptr());
    dialog.lpstrFile = PWSTR(file_buffer.as_mut_ptr());
    dialog.nMaxFile = file_buffer.len() as u32;
    dialog.lpstrTitle = PCWSTR(title_wide.as_ptr());
    dialog.Flags =
        OFN_EXPLORER | OFN_ENABLEHOOK | OFN_NOCHANGEDIR | OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST;
    dialog.lpstrDefExt = PCWSTR(default_extension_wide.as_ptr());
    dialog.lCustData = LPARAM((&placement as *const SaveDialogPlacement) as isize);
    dialog.lpfnHook = Some(save_dialog_hook);

    run_with_native_file_dialog_input_passthrough(window.as_ref(), || {
        let accepted = unsafe { GetSaveFileNameW(&mut dialog).as_bool() };
        if !accepted {
            let error = unsafe { CommDlgExtendedError() };
            if error.0 == 0 {
                return Ok(None);
            }
            return Err(format!("Save dialog failed: {}", error.0));
        }

        let end = file_buffer
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(file_buffer.len());
        if end == 0 {
            return Ok(None);
        }

        let selected = String::from_utf16_lossy(&file_buffer[..end]);
        Ok(Some(PathBuf::from(selected)))
    })
}

#[cfg(target_os = "windows")]
fn select_image_open_path() -> Result<Option<PathBuf>, String> {
    let filter_wide: Vec<u16> =
        "图片文件 (*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.webp)\0*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.webp\0所有文件 (*.*)\0*.*\0\0"
            .encode_utf16()
            .collect();
    let title_wide = wide_null("打开图片进行编辑");
    let mut file_buffer = vec![0u16; 32768];

    let mut dialog = OPENFILENAMEW::default();
    dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    dialog.lpstrFilter = PCWSTR(filter_wide.as_ptr());
    dialog.lpstrFile = PWSTR(file_buffer.as_mut_ptr());
    dialog.nMaxFile = file_buffer.len() as u32;
    dialog.lpstrTitle = PCWSTR(title_wide.as_ptr());
    dialog.Flags = OFN_EXPLORER | OFN_NOCHANGEDIR | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;

    let accepted = unsafe { GetOpenFileNameW(&mut dialog).as_bool() };
    if !accepted {
        let error = unsafe { CommDlgExtendedError() };
        if error.0 == 0 {
            return Ok(None);
        }
        return Err(format!("Open dialog failed: {}", error.0));
    }

    let end = file_buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(file_buffer.len());
    if end == 0 {
        return Ok(None);
    }

    let selected = String::from_utf16_lossy(&file_buffer[..end]);
    Ok(Some(PathBuf::from(selected)))
}

/// Open a native file picker and return the chosen image decoded as a data URL.
/// The original file is read only (never modified), matching the "edit a copy"
/// behavior of capcap's Finder edit entry. Returns Ok(None) if the user cancels.
#[cfg(target_os = "windows")]
#[tauri::command]
fn open_image_for_edit() -> Result<Option<String>, String> {
    let Some(path) = select_image_open_path()? else {
        return Ok(None);
    };
    read_image_from_path(path.to_string_lossy().to_string()).map(Some)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn open_image_for_edit() -> Result<Option<String>, String> {
    Err("Open image dialog is only supported on Windows".to_string())
}

/// Try to read an image from the clipboard. Returns the image as a data URL if
/// available, or the first file path from the clipboard if the clipboard contains
/// a file list (CF_HDROP). Returns Ok(None) if no image or file is found.
#[cfg(target_os = "windows")]
#[tauri::command]
fn read_clipboard_image() -> Result<Option<String>, String> {
    use arboard::Clipboard;
    use clipboard_win::{formats, get_clipboard};

    // Try image first (arboard handles PNG/BMP/etc.)
    if let Ok(mut clipboard) = Clipboard::new() {
        if let Ok(image_data) = clipboard.get_image() {
            let width = image_data.width;
            let height = image_data.height;
            let rgba = image_data.bytes.into_owned();

            let img = image::RgbaImage::from_raw(width as u32, height as u32, rgba)
                .ok_or_else(|| "Failed to construct image from clipboard RGBA data".to_string())?;

            let mut buf = Vec::new();
            img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
                .map_err(|e| format!("PNG encode failed: {}", e))?;

            let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
            return Ok(Some(format!("data:image/png;base64,{}", encoded)));
        }
    }

    // Try file list (CF_HDROP) via clipboard-win
    if let Ok(file_paths) = get_clipboard::<Vec<String>, _>(formats::FileList) {
        if let Some(first_path) = file_paths.into_iter().next() {
            let lower = first_path.to_lowercase();
            if lower.ends_with(".png")
                || lower.ends_with(".jpg")
                || lower.ends_with(".jpeg")
                || lower.ends_with(".bmp")
            {
                return read_image_from_path(first_path).map(Some);
            }
        }
    }

    Ok(None)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn read_clipboard_image() -> Result<Option<String>, String> {
    Err("Clipboard image reading is only supported on Windows".to_string())
}

fn capture_window_metrics(window: &tauri::WebviewWindow) -> Option<CaptureWindowMetrics> {
    let monitor = window.current_monitor().ok().flatten()?;
    let position = monitor.position();
    let physical_size = monitor.size();
    let scale_factor = monitor.scale_factor();

    Some(CaptureWindowMetrics {
        physical_origin_x: position.x as f64,
        physical_origin_y: position.y as f64,
        scale_factor,
        logical_width: physical_size.width as f64 / scale_factor,
        logical_height: physical_size.height as f64 / scale_factor,
    })
}

#[tauri::command]
fn list_capture_window_targets(
    window: tauri::WebviewWindow,
) -> Vec<capture_windows::CaptureWindowTarget> {
    capture_window_metrics(&window)
        .map(capture_windows::list_capture_window_targets)
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_capture_cursor_position(
    window: tauri::WebviewWindow,
) -> Result<PhysicalPosition<f64>, String> {
    let metrics = capture_window_metrics(&window)
        .ok_or_else(|| "Capture window monitor metrics are unavailable".to_string())?;
    let (global_x, global_y) = current_cursor_position_physical()
        .ok_or_else(|| "System cursor position is unavailable".to_string())?;
    let local = normalize_global_physical_to_local_logical(global_x, global_y, metrics);
    Ok(PhysicalPosition::new(local.x, local.y))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_capture_cursor_position(
    window: tauri::WebviewWindow,
) -> Result<PhysicalPosition<f64>, String> {
    window.cursor_position().map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Copy)]
struct ModifierSnapshot {
    ctrl_pressed: bool,
    alt_pressed: bool,
    shift_pressed: bool,
}

fn emit_capture_mouse_event(
    window: &tauri::WebviewWindow,
    event_name: &str,
    global_x: f64,
    global_y: f64,
    modifiers: ModifierSnapshot,
    native_drag_preflight: bool,
    metrics: Option<CaptureWindowMetrics>,
) {
    let sample = if event_name.starts_with("capture/")
        && DESKTOP_COLOR_PICKER_ACTIVE.load(Ordering::Relaxed)
    {
        sample_screen_color_physical(global_x.round() as i32, global_y.round() as i32).ok()
    } else {
        None
    };
    if let Some(metrics) = metrics {
        let local = normalize_global_physical_to_local_logical(global_x, global_y, metrics);
        let mut payload = serde_json::json!({
            "x": local.x,
            "y": local.y,
            "globalX": global_x,
            "globalY": global_y,
            "scaleFactor": metrics.scale_factor,
            "physicalOriginX": metrics.physical_origin_x,
            "physicalOriginY": metrics.physical_origin_y,
            "ctrlKey": modifiers.ctrl_pressed,
            "altKey": modifiers.alt_pressed,
            "shiftKey": modifiers.shift_pressed,
            "nativeDragPreflight": native_drag_preflight,
        });
        if let Some(sample) = sample.as_ref() {
            payload["hex"] = serde_json::json!(sample.hex);
            payload["rgb"] = serde_json::json!(sample.rgb);
        }
        let _ = window.emit(event_name, payload);
    } else {
        let mut payload = serde_json::json!({
            "x": global_x,
            "y": global_y,
            "globalX": global_x,
            "globalY": global_y,
            "ctrlKey": modifiers.ctrl_pressed,
            "altKey": modifiers.alt_pressed,
            "shiftKey": modifiers.shift_pressed,
            "nativeDragPreflight": native_drag_preflight,
        });
        if let Some(sample) = sample.as_ref() {
            payload["hex"] = serde_json::json!(sample.hex);
            payload["rgb"] = serde_json::json!(sample.rgb);
        }
        let _ = window.emit(event_name, payload);
    }
}

#[cfg(target_os = "windows")]
fn current_modifier_snapshot() -> ModifierSnapshot {
    ModifierSnapshot {
        ctrl_pressed: unsafe { GetAsyncKeyState(VK_CONTROL.0 as i32) } < 0,
        alt_pressed: unsafe { GetAsyncKeyState(VK_MENU.0 as i32) } < 0,
        shift_pressed: unsafe { GetAsyncKeyState(VK_SHIFT.0 as i32) } < 0
            || OVERLAY_SHIFT_KEY_DOWN.load(Ordering::SeqCst),
    }
}

#[cfg(not(target_os = "windows"))]
fn current_modifier_snapshot() -> ModifierSnapshot {
    ModifierSnapshot {
        ctrl_pressed: false,
        alt_pressed: false,
        shift_pressed: false,
    }
}

fn emit_overlay_wheel_event(
    window: &tauri::WebviewWindow,
    event_name: &str,
    global_x: f64,
    global_y: f64,
    delta_y: f64,
    modifiers: ModifierSnapshot,
    metrics: Option<CaptureWindowMetrics>,
) {
    if let Some(metrics) = metrics {
        let local = normalize_global_physical_to_local_logical(global_x, global_y, metrics);
        let payload = serde_json::json!({
            "x": local.x,
            "y": local.y,
            "globalX": global_x,
            "globalY": global_y,
            "scaleFactor": metrics.scale_factor,
            "physicalOriginX": metrics.physical_origin_x,
            "physicalOriginY": metrics.physical_origin_y,
            "ctrlKey": modifiers.ctrl_pressed,
            "altKey": modifiers.alt_pressed,
            "shiftKey": modifiers.shift_pressed,
            "deltaY": -delta_y,
        });
        let _ = window.emit(event_name, payload);
    } else {
        let payload = serde_json::json!({
            "x": global_x,
            "y": global_y,
            "globalX": global_x,
            "globalY": global_y,
            "ctrlKey": modifiers.ctrl_pressed,
            "altKey": modifiers.alt_pressed,
            "shiftKey": modifiers.shift_pressed,
            "deltaY": -delta_y,
        });
        let _ = window.emit(event_name, payload);
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
enum CaptureMouseHookEvent {
    Move {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
    Down {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
    Up {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
    Wheel {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
    OverlayDown {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        native_drag_preflight: bool,
        source: OverlayPointerSource,
        continuation: bool,
    },
    OverlayMove {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        native_drag_preflight: bool,
    },
    OverlayUp {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        native_drag_preflight: bool,
        source: OverlayPointerSource,
    },
    OverlayWheel {
        x: f64,
        y: f64,
        delta_y: f64,
        modifiers: ModifierSnapshot,
    },
    OverlayContextMenu {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
}

#[cfg(target_os = "windows")]
impl CaptureMouseHookEvent {
    fn is_move_sample(&self) -> bool {
        matches!(self, Self::Move { .. } | Self::OverlayMove { .. })
    }

    fn can_replace_move_sample(&self, previous: &Self) -> bool {
        match (previous, self) {
            (Self::Move { .. }, Self::Move { .. }) => true,
            (
                Self::OverlayMove {
                    native_drag_preflight: previous_preflight,
                    ..
                },
                Self::OverlayMove {
                    native_drag_preflight: next_preflight,
                    ..
                },
            ) => previous_preflight == next_preflight,
            _ => false,
        }
    }
}

#[cfg(target_os = "windows")]
const CAPTURE_MOUSE_EVENT_QUEUE_CAPACITY: usize = 2048;
#[cfg(target_os = "windows")]
const CAPTURE_MOUSE_EVENT_EDGE_RESERVE: usize = 64;
#[cfg(target_os = "windows")]
const CAPTURE_MOUSE_QUEUE_DIAGNOSTIC_INTERVAL: Duration = Duration::from_secs(5);

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct CaptureMouseEventQueueDiagnostics {
    current_depth: usize,
    max_depth: usize,
    coalesced_moves: u64,
    evicted_moves: u64,
    dropped_moves: u64,
    critical_overflows: u64,
    enqueued_edges: u64,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CaptureMouseEventEnqueueResult {
    Enqueued,
    CoalescedMove,
    EnqueuedAfterEvictingMove,
    DroppedMove,
    CriticalOverflow,
}

#[cfg(target_os = "windows")]
struct CaptureMouseEventQueueState {
    events: VecDeque<CaptureMouseHookEvent>,
    diagnostics: CaptureMouseEventQueueDiagnostics,
}

#[cfg(target_os = "windows")]
struct CaptureMouseEventQueue {
    capacity: usize,
    move_capacity: usize,
    state: Mutex<CaptureMouseEventQueueState>,
    event_available: Condvar,
}

#[cfg(target_os = "windows")]
impl CaptureMouseEventQueue {
    fn new(capacity: usize, edge_reserve: usize) -> Self {
        assert!(
            capacity > 0,
            "capture mouse queue capacity must be positive"
        );
        Self {
            capacity,
            move_capacity: capacity.saturating_sub(edge_reserve.min(capacity)),
            state: Mutex::new(CaptureMouseEventQueueState {
                events: VecDeque::with_capacity(capacity),
                diagnostics: CaptureMouseEventQueueDiagnostics::default(),
            }),
            event_available: Condvar::new(),
        }
    }

    fn enqueue(&self, event: CaptureMouseHookEvent) -> CaptureMouseEventEnqueueResult {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if event.is_move_sample() {
            if let Some(previous) = state.events.back_mut() {
                if event.can_replace_move_sample(previous) {
                    *previous = event;
                    state.diagnostics.coalesced_moves += 1;
                    return CaptureMouseEventEnqueueResult::CoalescedMove;
                }
            }

            let evicted_move = if state.events.len() >= self.move_capacity {
                if let Some(index) = state
                    .events
                    .iter()
                    .position(CaptureMouseHookEvent::is_move_sample)
                {
                    state.events.remove(index);
                    state.diagnostics.evicted_moves += 1;
                    true
                } else {
                    state.diagnostics.dropped_moves += 1;
                    return CaptureMouseEventEnqueueResult::DroppedMove;
                }
            } else {
                false
            };

            state.events.push_back(event);
            state.diagnostics.current_depth = state.events.len();
            state.diagnostics.max_depth = state
                .diagnostics
                .max_depth
                .max(state.diagnostics.current_depth);
            self.event_available.notify_one();
            return if evicted_move {
                CaptureMouseEventEnqueueResult::EnqueuedAfterEvictingMove
            } else {
                CaptureMouseEventEnqueueResult::Enqueued
            };
        }

        let evicted_move = if state.events.len() >= self.capacity {
            if let Some(index) = state
                .events
                .iter()
                .position(CaptureMouseHookEvent::is_move_sample)
            {
                state.events.remove(index);
                state.diagnostics.evicted_moves += 1;
                true
            } else {
                state.diagnostics.critical_overflows += 1;
                return CaptureMouseEventEnqueueResult::CriticalOverflow;
            }
        } else {
            false
        };

        state.events.push_back(event);
        state.diagnostics.enqueued_edges += 1;
        state.diagnostics.current_depth = state.events.len();
        state.diagnostics.max_depth = state
            .diagnostics
            .max_depth
            .max(state.diagnostics.current_depth);
        self.event_available.notify_one();
        if evicted_move {
            CaptureMouseEventEnqueueResult::EnqueuedAfterEvictingMove
        } else {
            CaptureMouseEventEnqueueResult::Enqueued
        }
    }

    fn pop_front_locked(state: &mut CaptureMouseEventQueueState) -> Option<CaptureMouseHookEvent> {
        let event = state.events.pop_front();
        state.diagnostics.current_depth = state.events.len();
        event
    }

    fn diagnostics(&self) -> CaptureMouseEventQueueDiagnostics {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .diagnostics
    }
}

#[cfg(target_os = "windows")]
trait CaptureMouseEventReceiver {
    fn recv(&self) -> Result<CaptureMouseHookEvent, mpsc::RecvError>;
    fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> Result<CaptureMouseHookEvent, mpsc::RecvTimeoutError>;
    fn try_recv(&self) -> Result<CaptureMouseHookEvent, mpsc::TryRecvError>;
}

#[cfg(target_os = "windows")]
impl CaptureMouseEventReceiver for mpsc::Receiver<CaptureMouseHookEvent> {
    fn recv(&self) -> Result<CaptureMouseHookEvent, mpsc::RecvError> {
        mpsc::Receiver::recv(self)
    }

    fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> Result<CaptureMouseHookEvent, mpsc::RecvTimeoutError> {
        mpsc::Receiver::recv_timeout(self, timeout)
    }

    fn try_recv(&self) -> Result<CaptureMouseHookEvent, mpsc::TryRecvError> {
        mpsc::Receiver::try_recv(self)
    }
}

#[cfg(target_os = "windows")]
impl CaptureMouseEventReceiver for CaptureMouseEventQueue {
    fn recv(&self) -> Result<CaptureMouseHookEvent, mpsc::RecvError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        loop {
            if let Some(event) = Self::pop_front_locked(&mut state) {
                return Ok(event);
            }
            state = self
                .event_available
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> Result<CaptureMouseHookEvent, mpsc::RecvTimeoutError> {
        let deadline = Instant::now() + timeout;
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        loop {
            if let Some(event) = Self::pop_front_locked(&mut state) {
                return Ok(event);
            }

            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(mpsc::RecvTimeoutError::Timeout);
            }
            let (next_state, wait_result) = self
                .event_available
                .wait_timeout(state, remaining)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state = next_state;
            if wait_result.timed_out() && state.events.is_empty() {
                return Err(mpsc::RecvTimeoutError::Timeout);
            }
        }
    }

    fn try_recv(&self) -> Result<CaptureMouseHookEvent, mpsc::TryRecvError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Self::pop_front_locked(&mut state).ok_or(mpsc::TryRecvError::Empty)
    }
}

#[cfg(target_os = "windows")]
const CAPTURE_MOUSE_UP_BOUNCE_WINDOW: Duration = Duration::from_millis(35);
#[cfg(target_os = "windows")]
const OVERLAY_MOUSE_UP_BOUNCE_WINDOW: Duration = Duration::from_millis(35);
#[cfg(target_os = "windows")]
const CAPTURE_MOUSE_MOVE_EMIT_INTERVAL: Duration = Duration::from_millis(8);
#[cfg(target_os = "windows")]
const OVERLAY_MOUSE_MOVE_EMIT_INTERVAL: Duration = Duration::from_millis(8);

#[cfg(target_os = "windows")]
const OVERLAY_POINTER_STATE_NONE: u8 = 0;

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum OverlayPointerSource {
    LowLevelHook = 1,
    InputShield = 2,
}

#[cfg(target_os = "windows")]
impl OverlayPointerSource {
    fn down_state(self) -> u8 {
        match self {
            Self::LowLevelHook => 1,
            Self::InputShield => 3,
        }
    }

    fn up_pending_state(self) -> u8 {
        match self {
            Self::LowLevelHook => 2,
            Self::InputShield => 4,
        }
    }

    fn log_name(self) -> &'static str {
        match self {
            Self::LowLevelHook => "low_level_hook",
            Self::InputShield => "input_shield",
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverlayPointerDownTransition {
    Started,
    Continued,
    IgnoredDuplicate,
    IgnoredForeignOwner,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverlayPointerUpTransition {
    Candidate,
    IgnoredDuplicate,
    IgnoredUnpaired,
    IgnoredForeignOwner,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverlayPointerReleaseResult {
    Released,
    SuppressedPhysicalDown,
    Superseded,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
enum CaptureMouseUpDebounceResult {
    Release {
        deferred_event: Option<CaptureMouseHookEvent>,
    },
    Continue {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
    Disconnected,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
enum OverlayMouseUpDebounceResult {
    Release {
        deferred_event: Option<CaptureMouseHookEvent>,
        latest_move: Option<OverlayMouseMoveSnapshot>,
    },
    Continue {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        native_drag_preflight: bool,
    },
    Disconnected,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
struct OverlayMouseMoveSnapshot {
    x: f64,
    y: f64,
    modifiers: ModifierSnapshot,
    native_drag_preflight: bool,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
enum CaptureMouseMoveCoalesceResult {
    Ready {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        deferred_event: Option<CaptureMouseHookEvent>,
    },
    Disconnected,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
enum OverlayMouseMoveCoalesceResult {
    Ready {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        native_drag_preflight: bool,
        deferred_event: Option<CaptureMouseHookEvent>,
    },
    Disconnected,
}

#[cfg(target_os = "windows")]
fn wait_for_capture_mouse_up_debounce<R: CaptureMouseEventReceiver + ?Sized>(
    receiver: &R,
    timeout: Duration,
) -> CaptureMouseUpDebounceResult {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(CaptureMouseHookEvent::Down { x, y, modifiers }) => {
                return CaptureMouseUpDebounceResult::Continue { x, y, modifiers };
            }
            Ok(CaptureMouseHookEvent::Move { .. })
            | Ok(CaptureMouseHookEvent::Up { .. })
            | Ok(CaptureMouseHookEvent::Wheel { .. }) => {
                // Moves after a candidate Up do not alter its final coordinates.
                // A Down inside the bounce window is the only event that turns
                // this release into a continuation of the current drag.
            }
            Ok(other) => {
                return CaptureMouseUpDebounceResult::Release {
                    deferred_event: Some(other),
                };
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return CaptureMouseUpDebounceResult::Release {
                    deferred_event: None,
                };
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return CaptureMouseUpDebounceResult::Disconnected;
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn wait_for_overlay_mouse_up_debounce<R: CaptureMouseEventReceiver + ?Sized>(
    receiver: &R,
    source: OverlayPointerSource,
    timeout: Duration,
) -> OverlayMouseUpDebounceResult {
    let deadline = Instant::now() + timeout;
    let mut latest_move = None;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(CaptureMouseHookEvent::OverlayDown {
                x,
                y,
                modifiers,
                native_drag_preflight,
                source: down_source,
                continuation: true,
            }) if down_source == source => {
                return OverlayMouseUpDebounceResult::Continue {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight,
                };
            }
            Ok(CaptureMouseHookEvent::OverlayMove {
                x,
                y,
                modifiers,
                native_drag_preflight,
            }) => {
                latest_move = Some(OverlayMouseMoveSnapshot {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight,
                });
                // Keep the shield and drag session alive while the candidate Up
                // settles. A matching recovery Down, or the physical button
                // state checked by the worker, decides whether this is release.
            }
            Ok(other) => {
                return OverlayMouseUpDebounceResult::Release {
                    deferred_event: Some(other),
                    latest_move,
                };
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return OverlayMouseUpDebounceResult::Release {
                    deferred_event: None,
                    latest_move,
                };
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return OverlayMouseUpDebounceResult::Disconnected;
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn coalesce_capture_mouse_move_until_emit<R: CaptureMouseEventReceiver + ?Sized>(
    receiver: &R,
    mut x: f64,
    mut y: f64,
    mut modifiers: ModifierSnapshot,
    last_emit: Instant,
    interval: Duration,
) -> CaptureMouseMoveCoalesceResult {
    let deadline = last_emit + interval;

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(CaptureMouseHookEvent::Move {
                x: next_x,
                y: next_y,
                modifiers: next_modifiers,
            }) => {
                x = next_x;
                y = next_y;
                modifiers = next_modifiers;
            }
            Ok(other_event) => {
                return CaptureMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    deferred_event: Some(other_event),
                };
            }
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return CaptureMouseMoveCoalesceResult::Disconnected;
            }
        }
    }

    loop {
        match receiver.try_recv() {
            Ok(CaptureMouseHookEvent::Move {
                x: next_x,
                y: next_y,
                modifiers: next_modifiers,
            }) => {
                x = next_x;
                y = next_y;
                modifiers = next_modifiers;
            }
            Ok(other_event) => {
                return CaptureMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    deferred_event: Some(other_event),
                };
            }
            Err(mpsc::TryRecvError::Empty) => {
                return CaptureMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    deferred_event: None,
                };
            }
            Err(mpsc::TryRecvError::Disconnected) => {
                return CaptureMouseMoveCoalesceResult::Disconnected;
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn coalesce_overlay_mouse_move_until_emit<R: CaptureMouseEventReceiver + ?Sized>(
    receiver: &R,
    mut x: f64,
    mut y: f64,
    mut modifiers: ModifierSnapshot,
    native_drag_preflight: bool,
    last_emit: Instant,
    interval: Duration,
) -> OverlayMouseMoveCoalesceResult {
    let deadline = last_emit + interval;

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(CaptureMouseHookEvent::OverlayMove {
                x: next_x,
                y: next_y,
                modifiers: next_modifiers,
                native_drag_preflight: next_native_drag_preflight,
            }) if next_native_drag_preflight == native_drag_preflight => {
                x = next_x;
                y = next_y;
                modifiers = next_modifiers;
            }
            Ok(other_event) => {
                return OverlayMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight,
                    deferred_event: Some(other_event),
                };
            }
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return OverlayMouseMoveCoalesceResult::Disconnected;
            }
        }
    }

    loop {
        match receiver.try_recv() {
            Ok(CaptureMouseHookEvent::OverlayMove {
                x: next_x,
                y: next_y,
                modifiers: next_modifiers,
                native_drag_preflight: next_native_drag_preflight,
            }) if next_native_drag_preflight == native_drag_preflight => {
                x = next_x;
                y = next_y;
                modifiers = next_modifiers;
            }
            Ok(other_event) => {
                return OverlayMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight,
                    deferred_event: Some(other_event),
                };
            }
            Err(mpsc::TryRecvError::Empty) => {
                return OverlayMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight,
                    deferred_event: None,
                };
            }
            Err(mpsc::TryRecvError::Disconnected) => {
                return OverlayMouseMoveCoalesceResult::Disconnected;
            }
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
enum OverlayKeyboardHookEvent {
    Escape,
    Delete,
    Copy,
    Paste,
    // A sticker-selected DOM shortcut (Tab, Shift+1, Alt+2, ...) captured while
    // the webview lacks OS keyboard focus, forwarded so the frontend can run it
    // without the overlay having to steal foreground focus from video below.
    Shortcut {
        key: String,
        ctrl: bool,
        shift: bool,
        alt: bool,
    },
}

// Serialized payload for the `overlay/global_shortcut` event. Field names match
// the DOM KeyboardEvent init the frontend reconstructs.
#[cfg(target_os = "windows")]
#[derive(Clone, serde::Serialize)]
struct ForwardedShortcutPayload {
    key: String,
    #[serde(rename = "ctrlKey")]
    ctrl_key: bool,
    #[serde(rename = "shiftKey")]
    shift_key: bool,
    #[serde(rename = "altKey")]
    alt_key: bool,
}

#[cfg(target_os = "windows")]
static CAPTURE_MOUSE_EVENT_QUEUE: OnceLock<Arc<CaptureMouseEventQueue>> = OnceLock::new();
static DESKTOP_COLOR_PICKER_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_KEYBOARD_EVENT_SENDER: OnceLock<mpsc::SyncSender<OverlayKeyboardHookEvent>> =
    OnceLock::new();
#[cfg(target_os = "windows")]
static CAPTURE_MOUSE_HOOK_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static CAPTURE_MOUSE_HOOK_BUTTON_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_KEYBOARD_CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_SHIFT_KEY_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static CAPTURE_SYSTEM_CURSOR_OVERRIDDEN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HIT_MAP: OnceLock<Arc<std::sync::Mutex<Vec<mouse_monitor::Rect>>>> =
    OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HIT_MAP_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_POINTER_STATE: AtomicU8 = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HOOK_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HOOK_HOVER_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static NATIVE_FILE_DIALOG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static NATIVE_FILE_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static MAIN_UI_THREAD_ID: OnceLock<std::thread::ThreadId> = OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_CLICK_THROUGH_ACTIVE: AtomicBool = AtomicBool::new(true);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_ACTIVATE_WNDPROC_INSTALLED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_ACTIVATE_WNDPROC_PREVIOUS: OnceLock<isize> = OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_INPUT_SHIELD_HWND: OnceLock<isize> = OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_INPUT_SHIELD_WNDPROC_PREVIOUS: OnceLock<isize> = OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_INPUT_SHIELD_ALT_PASSTHROUGH: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_MAIN_HWND: OnceLock<isize> = OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_TOPMOST_MAINTENANCE_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_VISUALLY_OCCLUDED_BY_FULLSCREEN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_FULLSCREEN_OCCLUSION_PASSTHROUGH_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_FULLSCREEN_OCCLUSION_PREVIOUS_CLICK_THROUGH: AtomicBool = AtomicBool::new(true);
#[cfg(target_os = "windows")]
const OVERLAY_TOPMOST_MAINTENANCE_INTERVAL_MS: u64 = 250;
#[cfg(target_os = "windows")]
const OVERLAY_FULLSCREEN_COVERAGE_TOLERANCE_PX: i32 = 8;
#[cfg(target_os = "windows")]
static OVERLAY_HWND_RETRY_THREAD_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
const OVERLAY_HWND_RETRY_INTERVAL_MS: u64 = 250;
#[cfg(target_os = "windows")]
const OVERLAY_HWND_RETRY_ATTEMPTS: usize = 80;
static UIACCESS_OVERLAY_STARTUP_STAGED: AtomicBool = AtomicBool::new(false);
static UIACCESS_FRONTEND_MOUNTED: AtomicBool = AtomicBool::new(false);
static UIACCESS_PENDING_OVERLAY_CLICK_THROUGH: AtomicBool = AtomicBool::new(true);

#[cfg(target_os = "windows")]
const EMERGENCY_ESCAPE_WINDOW: Duration = Duration::from_millis(400);
#[cfg(target_os = "windows")]
static ESCAPE_KEY_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static EMERGENCY_ESCAPE_TRACKER: OnceLock<Mutex<EmergencyEscapeTracker>> = OnceLock::new();
#[cfg(target_os = "windows")]
static RDEV_ESCAPE_KEY_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static RDEV_EMERGENCY_ESCAPE_TRACKER: OnceLock<Mutex<EmergencyEscapeTracker>> = OnceLock::new();

#[cfg(target_os = "windows")]
#[derive(Default)]
struct EmergencyEscapeTracker {
    last_press: Option<Instant>,
}

#[cfg(target_os = "windows")]
impl EmergencyEscapeTracker {
    fn record_press(&mut self, now: Instant) -> bool {
        let should_exit = self
            .last_press
            .map(|last_press| now.duration_since(last_press) < EMERGENCY_ESCAPE_WINDOW)
            .unwrap_or(false);
        self.last_press = Some(now);
        should_exit
    }
}

fn uiaccess_build_enabled() -> bool {
    cfg!(target_os = "windows") && option_env!("HOOK_WINDOWS_UIACCESS_BUILD").is_some()
}

#[cfg(target_os = "windows")]
fn queue_capture_mouse_hook_event(event: CaptureMouseHookEvent) {
    if matches!(event, CaptureMouseHookEvent::Wheel { .. }) {
        return;
    }

    if let Some(queue) = CAPTURE_MOUSE_EVENT_QUEUE.get() {
        let _ = queue.enqueue(event);
    }
}

#[cfg(target_os = "windows")]
fn log_capture_mouse_queue_diagnostics_if_due(
    queue: &CaptureMouseEventQueue,
    last_log: &mut Instant,
    last_diagnostics: &mut CaptureMouseEventQueueDiagnostics,
) {
    let diagnostics = queue.diagnostics();
    let critical_overflow_changed =
        diagnostics.critical_overflows != last_diagnostics.critical_overflows;
    if !critical_overflow_changed && last_log.elapsed() < CAPTURE_MOUSE_QUEUE_DIAGNOSTIC_INTERVAL {
        return;
    }

    let pressure_changed = diagnostics.coalesced_moves != last_diagnostics.coalesced_moves
        || diagnostics.evicted_moves != last_diagnostics.evicted_moves
        || diagnostics.dropped_moves != last_diagnostics.dropped_moves
        || diagnostics.critical_overflows != last_diagnostics.critical_overflows;
    if pressure_changed {
        append_runtime_log_line(&format!(
            "capture_mouse_queue :: depth={} max_depth={} coalesced_moves={} evicted_moves={} dropped_moves={} critical_overflows={} enqueued_edges={}",
            diagnostics.current_depth,
            diagnostics.max_depth,
            diagnostics.coalesced_moves,
            diagnostics.evicted_moves,
            diagnostics.dropped_moves,
            diagnostics.critical_overflows,
            diagnostics.enqueued_edges,
        ));
    }
    *last_diagnostics = diagnostics;
    *last_log = Instant::now();
}

#[cfg(target_os = "windows")]
fn claim_capture_button_transition(state: &AtomicBool, pressed: bool) -> bool {
    if pressed {
        !state.swap(true, Ordering::SeqCst)
    } else {
        state.swap(false, Ordering::SeqCst)
    }
}

#[cfg(target_os = "windows")]
fn claim_overlay_pointer_down(
    state: &AtomicU8,
    source: OverlayPointerSource,
) -> OverlayPointerDownTransition {
    loop {
        let current = state.load(Ordering::SeqCst);
        if current == source.down_state() {
            return OverlayPointerDownTransition::IgnoredDuplicate;
        }
        let pending_release = current == OverlayPointerSource::LowLevelHook.up_pending_state()
            || current == OverlayPointerSource::InputShield.up_pending_state();
        if current != OVERLAY_POINTER_STATE_NONE && !pending_release {
            return OverlayPointerDownTransition::IgnoredForeignOwner;
        }

        let transition = if pending_release {
            OverlayPointerDownTransition::Continued
        } else {
            OverlayPointerDownTransition::Started
        };
        if state
            .compare_exchange(
                current,
                source.down_state(),
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
        {
            return transition;
        }
    }
}

#[cfg(target_os = "windows")]
fn claim_overlay_pointer_up(
    state: &AtomicU8,
    source: OverlayPointerSource,
) -> OverlayPointerUpTransition {
    loop {
        let current = state.load(Ordering::SeqCst);
        if current == OVERLAY_POINTER_STATE_NONE {
            return OverlayPointerUpTransition::IgnoredUnpaired;
        }
        if current == source.up_pending_state() {
            return OverlayPointerUpTransition::IgnoredDuplicate;
        }
        if current != source.down_state() {
            return OverlayPointerUpTransition::IgnoredForeignOwner;
        }

        if state
            .compare_exchange(
                current,
                source.up_pending_state(),
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
        {
            return OverlayPointerUpTransition::Candidate;
        }
    }
}

#[cfg(target_os = "windows")]
fn resolve_overlay_pointer_release(
    state: &AtomicU8,
    source: OverlayPointerSource,
    primary_button_physically_down: bool,
) -> OverlayPointerReleaseResult {
    if primary_button_physically_down {
        return match state.compare_exchange(
            source.up_pending_state(),
            source.down_state(),
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => OverlayPointerReleaseResult::SuppressedPhysicalDown,
            Err(current) if current == source.down_state() => {
                OverlayPointerReleaseResult::SuppressedPhysicalDown
            }
            Err(_) => OverlayPointerReleaseResult::Superseded,
        };
    }

    match state.compare_exchange(
        source.up_pending_state(),
        OVERLAY_POINTER_STATE_NONE,
        Ordering::SeqCst,
        Ordering::SeqCst,
    ) {
        Ok(_) => OverlayPointerReleaseResult::Released,
        Err(_) => OverlayPointerReleaseResult::Superseded,
    }
}

#[cfg(target_os = "windows")]
fn overlay_pointer_source_owns_session(source: OverlayPointerSource) -> bool {
    matches!(
        OVERLAY_POINTER_STATE.load(Ordering::SeqCst),
        current if current == source.down_state() || current == source.up_pending_state()
    )
}

#[cfg(target_os = "windows")]
fn reset_overlay_pointer_session() {
    OVERLAY_POINTER_STATE.store(OVERLAY_POINTER_STATE_NONE, Ordering::SeqCst);
    OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(false, Ordering::SeqCst);
    OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.store(false, Ordering::SeqCst);
    OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.store(false, Ordering::SeqCst);
    OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.store(false, Ordering::SeqCst);
}

#[cfg(target_os = "windows")]
fn overlay_primary_button_physically_down() -> bool {
    (unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) }) < 0
}

#[cfg(target_os = "windows")]
fn handle_emergency_escape_transition_with(
    key_down: &AtomicBool,
    tracker: &OnceLock<Mutex<EmergencyEscapeTracker>>,
    pressed: bool,
    source: &str,
) -> bool {
    if !pressed {
        key_down.store(false, Ordering::SeqCst);
        return false;
    }

    if key_down.swap(true, Ordering::SeqCst) {
        return false;
    }

    let should_exit = tracker
        .get_or_init(|| Mutex::new(EmergencyEscapeTracker::default()))
        .lock()
        .map(|mut tracker| tracker.record_press(Instant::now()))
        .unwrap_or(false);
    append_runtime_log_line(&format!("emergency_escape_press :: source={}", source));
    if should_exit {
        append_runtime_log_line_sync(&format!(
            "[{}] emergency_double_escape_exit :: source={}",
            runtime_log_timestamp(),
            source
        ));
        prepare_for_hook_process_exit("double_escape");
        std::process::exit(0);
    }
    true
}

#[cfg(target_os = "windows")]
fn handle_emergency_escape_transition(pressed: bool, source: &str) -> bool {
    handle_emergency_escape_transition_with(
        &ESCAPE_KEY_DOWN,
        &EMERGENCY_ESCAPE_TRACKER,
        pressed,
        source,
    )
}

#[cfg(target_os = "windows")]
fn handle_rdev_emergency_escape_transition(pressed: bool) -> bool {
    handle_emergency_escape_transition_with(
        &RDEV_ESCAPE_KEY_DOWN,
        &RDEV_EMERGENCY_ESCAPE_TRACKER,
        pressed,
        "rdev",
    )
}

#[cfg(target_os = "windows")]
fn queue_overlay_keyboard_hook_event(event: OverlayKeyboardHookEvent) {
    if let Some(sender) = OVERLAY_KEYBOARD_EVENT_SENDER.get() {
        let _ = sender.try_send(event);
    }
}

#[cfg(target_os = "windows")]
fn try_begin_capture_input_runtime() -> bool {
    if CAPTURE_MOUSE_HOOK_ACTIVE.swap(true, Ordering::SeqCst) {
        return false;
    }

    CAPTURE_MOUSE_HOOK_BUTTON_DOWN.store(false, Ordering::SeqCst);
    append_runtime_log_line("capture_mouse_hook_active :: true");
    set_capture_cursor_crosshair();
    true
}

#[cfg(not(target_os = "windows"))]
fn try_begin_capture_input_runtime() -> bool {
    set_capture_input_runtime_active(true);
    true
}

#[cfg(target_os = "windows")]
fn is_main_ui_thread() -> bool {
    MAIN_UI_THREAD_ID
        .get()
        .map(|thread_id| *thread_id == std::thread::current().id())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn overlay_mouse_hit_map() -> &'static Arc<std::sync::Mutex<Vec<mouse_monitor::Rect>>> {
    OVERLAY_MOUSE_HIT_MAP.get_or_init(|| Arc::new(std::sync::Mutex::new(Vec::new())))
}

#[cfg(target_os = "windows")]
fn is_sticker_body_synthetic_rect(rect: &mouse_monitor::Rect) -> bool {
    rect.name == "MINI" || rect.name == "FULL"
}

#[cfg(target_os = "windows")]
fn is_overlay_ui_synthetic_rect(rect: &mouse_monitor::Rect) -> bool {
    matches!(
        rect.name.as_str(),
        "STICKER_TOP_STRIP"
            | "STICKER_TOP_STRIP_MENU"
            | "STICKER_CONTEXT_MENU_ROOT"
            | "ACTIONS_MENU"
            | "PARAMS_PANEL"
            | "TEXT_EDITOR"
            | "EXEC_SETTINGS"
            | "COLOR_PICKER"
    ) || rect.name.starts_with("PORT_IN_")
        || rect.name.starts_with("PORT_OUT_")
}

#[cfg(target_os = "windows")]
fn is_synthetic_overlay_rect(rect: &mouse_monitor::Rect) -> bool {
    is_sticker_body_synthetic_rect(rect) || is_overlay_ui_synthetic_rect(rect)
}

#[cfg(target_os = "windows")]
fn should_overlay_window_ignore_cursor_events(
    rects: &[mouse_monitor::Rect],
    x: f64,
    y: f64,
) -> bool {
    !rects
        .iter()
        .any(|rect| !is_synthetic_overlay_rect(rect) && rect.contains(x, y))
}

#[cfg(target_os = "windows")]
fn should_suppress_overlay_interaction_for_occlusion(
    occluded: bool,
    capture_active: bool,
    drag_active: bool,
    native_drag_preflight_active: bool,
    pointer_session_active: bool,
) -> bool {
    occluded
        && !capture_active
        && !drag_active
        && !native_drag_preflight_active
        && !pointer_session_active
}

#[cfg(target_os = "windows")]
fn should_suppress_overlay_interaction_for_current_occlusion() -> bool {
    let drag_active = OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.load(Ordering::SeqCst);
    should_suppress_overlay_interaction_for_occlusion(
        OVERLAY_VISUALLY_OCCLUDED_BY_FULLSCREEN.load(Ordering::SeqCst),
        CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst),
        drag_active,
        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst),
        OVERLAY_POINTER_STATE.load(Ordering::SeqCst) != OVERLAY_POINTER_STATE_NONE,
    )
}

#[cfg(target_os = "windows")]
fn should_route_overlay_mouse_events(x: f64, y: f64) -> bool {
    if OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst) {
        return true;
    }
    if OVERLAY_VISUALLY_OCCLUDED_BY_FULLSCREEN.load(Ordering::SeqCst) {
        return false;
    }
    if !OVERLAY_MOUSE_HIT_MAP_ACTIVE.load(Ordering::SeqCst) {
        return false;
    }
    overlay_mouse_hit_map()
        .lock()
        .ok()
        .map(|rects| {
            rects
                .iter()
                .any(|rect| is_synthetic_overlay_rect(rect) && rect.contains(x, y))
        })
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn is_pointer_over_sticker_body_synthetic_rect(x: f64, y: f64) -> bool {
    if !OVERLAY_MOUSE_HIT_MAP_ACTIVE.load(Ordering::SeqCst) {
        return false;
    }
    overlay_mouse_hit_map()
        .lock()
        .ok()
        .map(|rects| {
            rects
                .iter()
                .any(|rect| is_sticker_body_synthetic_rect(rect) && rect.contains(x, y))
        })
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn refresh_overlay_interactivity_from_runtime_state(
    window: &tauri::WebviewWindow,
    fallback_click_through: bool,
) {
    if NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst) {
        hide_overlay_input_shield_window();
        set_overlay_click_through_impl(window, true);
        append_runtime_log_line("native_file_dialog_overlay_passthrough");
        return;
    }
    if should_suppress_overlay_interaction_for_current_occlusion() {
        hide_overlay_input_shield_window();
        set_overlay_click_through_impl(window, true);
        append_runtime_log_line("fullscreen_occlusion_overlay_passthrough");
        return;
    }

    let active = OVERLAY_MOUSE_HIT_MAP_ACTIVE.load(Ordering::SeqCst);
    if !active {
        set_overlay_click_through_impl(window, fallback_click_through);
        return;
    }

    let rects = overlay_mouse_hit_map()
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    if let Some((cursor_x, cursor_y)) = current_cursor_position_physical() {
        let should_ignore = should_overlay_window_ignore_cursor_events(&rects, cursor_x, cursor_y);
        set_overlay_click_through_impl(window, should_ignore);
        append_runtime_log_line(&format!(
            "refresh_overlay_interactivity_runtime_state :: cursor_x={} cursor_y={} should_ignore={}",
            cursor_x, cursor_y, should_ignore
        ));
        return;
    }

    set_overlay_click_through_impl(window, fallback_click_through);
}

#[cfg(not(target_os = "windows"))]
fn refresh_overlay_interactivity_from_runtime_state(
    _window: &tauri::WebviewWindow,
    _fallback_click_through: bool,
) {
}

#[cfg(target_os = "windows")]
fn run_with_native_file_dialog_input_passthrough<T, F>(
    window: Option<&tauri::WebviewWindow>,
    action: F,
) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String>,
{
    let previous_click_through = OVERLAY_CLICK_THROUGH_ACTIVE.load(Ordering::SeqCst);
    NATIVE_FILE_DIALOG_ACTIVE.store(true, Ordering::SeqCst);
    reset_overlay_pointer_session();
    OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(false, Ordering::SeqCst);
    if let Some(window) = window {
        hide_overlay_input_shield_window();
        set_overlay_click_through_impl(window, true);
    }
    append_runtime_log_line("native_file_dialog_input_passthrough_start");

    let result = action();

    NATIVE_FILE_DIALOG_ACTIVE.store(false, Ordering::SeqCst);
    if let Some(window) = window {
        refresh_overlay_interactivity_from_runtime_state(window, previous_click_through);
        sync_overlay_input_shield_from_runtime_state(window);
    }
    append_runtime_log_line("native_file_dialog_input_passthrough_end");
    result
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn capture_mouse_hook_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code != HC_ACTION as i32 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    if lparam.0 == 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    if NATIVE_FILE_DRAG_ACTIVE.load(Ordering::SeqCst)
        || NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst)
    {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let mouse = unsafe { *(lparam.0 as *const MSLLHOOKSTRUCT) };
    let x = mouse.pt.x as f64;
    let y = mouse.pt.y as f64;
    let mouse_flags = mouse.flags;
    let message = wparam.0 as u32;
    let capture_active = CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst);

    // Capture has a dedicated global pointer stream. Keep this hot path free of
    // overlay hit-map locks, foreground-window checks, window-style changes,
    // and other work that can make a WH_MOUSE_LL callback fall behind a
    // high-polling-rate mouse.
    if capture_active {
        let modifiers = current_modifier_snapshot();
        match message {
            WM_MOUSEMOVE => {
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::Move { x, y, modifiers });
                return unsafe { CallNextHookEx(None, code, wparam, lparam) };
            }
            WM_LBUTTONDOWN => {
                if claim_capture_button_transition(&CAPTURE_MOUSE_HOOK_BUTTON_DOWN, true) {
                    append_runtime_log_line(&format!(
                        "capture_mouse_down :: x={} y={} flags={}",
                        x, y, mouse_flags
                    ));
                    queue_capture_mouse_hook_event(CaptureMouseHookEvent::Down { x, y, modifiers });
                } else {
                    append_runtime_log_line("capture_mouse_down_ignored_duplicate");
                }
                return LRESULT(1);
            }
            WM_LBUTTONUP => {
                if claim_capture_button_transition(&CAPTURE_MOUSE_HOOK_BUTTON_DOWN, false) {
                    append_runtime_log_line(&format!(
                        "capture_mouse_up :: x={} y={} flags={}",
                        x, y, mouse_flags
                    ));
                    queue_capture_mouse_hook_event(CaptureMouseHookEvent::Up { x, y, modifiers });
                } else {
                    append_runtime_log_line("capture_mouse_up_ignored_unpaired");
                }
                return LRESULT(1);
            }
            WM_MOUSEWHEEL => {
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::Wheel { x, y, modifiers });
                return LRESULT(1);
            }
            WM_RBUTTONDOWN | WM_RBUTTONUP | WM_MBUTTONDOWN | WM_MBUTTONUP | WM_XBUTTONDOWN
            | WM_XBUTTONUP => {
                return LRESULT(1);
            }
            _ => {
                return unsafe { CallNextHookEx(None, code, wparam, lparam) };
            }
        }
    }

    let modifiers = current_modifier_snapshot();
    let should_route_overlay_mouse = should_route_overlay_mouse_events(x, y);
    let overlay_hover_active = OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.load(Ordering::SeqCst);
    let overlay_drag_active = OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.load(Ordering::SeqCst);
    let native_drag_preflight_active =
        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
    let hook_pointer_owner =
        overlay_pointer_source_owns_session(OverlayPointerSource::LowLevelHook);
    let overlay_pointer_session_active =
        OVERLAY_POINTER_STATE.load(Ordering::SeqCst) != OVERLAY_POINTER_STATE_NONE;
    if modifiers.alt_pressed
        && should_passthrough_foreign_alt_mouse_input(
            true,
            capture_active,
            overlay_drag_active,
            native_drag_preflight_active,
            hook_process_has_foreground_window(),
            message == WM_MOUSEWHEEL,
            should_route_overlay_mouse,
        )
    {
        set_overlay_input_shield_alt_passthrough(true);
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }
    if !modifiers.alt_pressed {
        set_overlay_input_shield_alt_passthrough(false);
    }
    if !capture_active
        && !should_route_overlay_mouse
        && !overlay_hover_active
        && !overlay_drag_active
        && !native_drag_preflight_active
        && !overlay_pointer_session_active
    {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    match message {
        WM_MOUSEMOVE => {
            if overlay_pointer_session_active && !hook_pointer_owner {
                return unsafe { CallNextHookEx(None, code, wparam, lparam) };
            }
            if should_route_overlay_mouse || overlay_drag_active || native_drag_preflight_active {
                OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayMove {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight: native_drag_preflight_active,
                });
            }
            if !should_route_overlay_mouse
                && !overlay_drag_active
                && !native_drag_preflight_active
                && overlay_hover_active
            {
                OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(false, Ordering::SeqCst);
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayMove {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight: native_drag_preflight_active,
                });
            }
        }
        WM_LBUTTONDOWN => {
            if should_route_overlay_mouse || overlay_pointer_session_active {
                let source = OverlayPointerSource::LowLevelHook;
                match claim_overlay_pointer_down(&OVERLAY_POINTER_STATE, source) {
                    OverlayPointerDownTransition::Started => {
                        let shift_sticker_native_drag_preflight = modifiers.shift_pressed
                            && is_pointer_over_sticker_body_synthetic_rect(x, y);
                        if shift_sticker_native_drag_preflight {
                            OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(false, Ordering::SeqCst);
                            OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.store(false, Ordering::SeqCst);
                            OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE
                                .store(true, Ordering::SeqCst);
                            OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
                            append_runtime_log_line(&format!(
                                "overlay_native_drag_preflight_start :: x={} y={}",
                                x, y
                            ));
                            queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown {
                                x,
                                y,
                                modifiers,
                                native_drag_preflight: true,
                                source,
                                continuation: false,
                            });
                            return LRESULT(1);
                        }
                        OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                        OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE
                            .store(false, Ordering::SeqCst);
                        OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
                        promote_overlay_input_shield_to_fullscreen();
                        append_runtime_log_line(&format!(
                            "overlay_drag_start :: synthetic={} x={} y={}",
                            true, x, y
                        ));
                        queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown {
                            x,
                            y,
                            modifiers,
                            native_drag_preflight: false,
                            source,
                            continuation: false,
                        });
                        return LRESULT(1);
                    }
                    OverlayPointerDownTransition::Continued => {
                        let native_drag_preflight =
                            OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
                        if !native_drag_preflight {
                            OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                            OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                            promote_overlay_input_shield_to_fullscreen();
                        }
                        OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
                        append_runtime_log_line(&format!(
                            "overlay_drag_recovery_down :: source={} x={} y={}",
                            source.log_name(),
                            x,
                            y
                        ));
                        queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown {
                            x,
                            y,
                            modifiers,
                            native_drag_preflight,
                            source,
                            continuation: true,
                        });
                        return LRESULT(1);
                    }
                    OverlayPointerDownTransition::IgnoredDuplicate => {
                        append_runtime_log_line("overlay_drag_down_ignored_duplicate");
                        return LRESULT(1);
                    }
                    OverlayPointerDownTransition::IgnoredForeignOwner => {
                        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
                    }
                }
            }
        }
        WM_LBUTTONUP => {
            let source = OverlayPointerSource::LowLevelHook;
            match claim_overlay_pointer_up(&OVERLAY_POINTER_STATE, source) {
                OverlayPointerUpTransition::Candidate => {
                    let native_drag_preflight =
                        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
                    append_runtime_log_line(&format!(
                        "overlay_drag_up_candidate :: source={} x={} y={}",
                        source.log_name(),
                        x,
                        y
                    ));
                    queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayUp {
                        x,
                        y,
                        modifiers,
                        native_drag_preflight,
                        source,
                    });
                    return LRESULT(1);
                }
                OverlayPointerUpTransition::IgnoredDuplicate => {
                    append_runtime_log_line("overlay_drag_up_ignored_duplicate");
                    return LRESULT(1);
                }
                OverlayPointerUpTransition::IgnoredUnpaired => {}
                OverlayPointerUpTransition::IgnoredForeignOwner => {
                    return unsafe { CallNextHookEx(None, code, wparam, lparam) };
                }
            }
        }
        WM_MOUSEWHEEL => {
            if should_route_overlay_mouse {
                let delta_y = (((mouse.mouseData >> 16) & 0xffff) as i16) as f64;
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayWheel {
                    x,
                    y,
                    delta_y,
                    modifiers,
                });
                OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
                return LRESULT(1);
            }
        }
        WM_RBUTTONDOWN | WM_RBUTTONUP | WM_MBUTTONDOWN | WM_MBUTTONUP | WM_XBUTTONDOWN
        | WM_XBUTTONUP => {
            if should_route_overlay_mouse {
                OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
                if wparam.0 as u32 == WM_RBUTTONUP {
                    queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayContextMenu {
                        x,
                        y,
                        modifiers,
                    });
                }
                return LRESULT(1);
            }
        }
        _ => {}
    }

    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn install_capture_mouse_hook_thread(window: tauri::WebviewWindow) {
    let queue = Arc::new(CaptureMouseEventQueue::new(
        CAPTURE_MOUSE_EVENT_QUEUE_CAPACITY,
        CAPTURE_MOUSE_EVENT_EDGE_RESERVE,
    ));
    if CAPTURE_MOUSE_EVENT_QUEUE.set(Arc::clone(&queue)).is_err() {
        append_runtime_log_line("capture_mouse_event_queue_already_initialized");
        return;
    }

    let emit_window = window.clone();
    let _ = std::thread::Builder::new()
        .name("hook-capture-mouse-events".to_string())
        .spawn(move || {
            let mut deferred_event: Option<CaptureMouseHookEvent> = None;
            let mut cached_metrics = capture_window_metrics(&emit_window);
            let mut last_capture_move_emit = Instant::now() - CAPTURE_MOUSE_MOVE_EMIT_INTERVAL;
            let mut last_overlay_move_emit = Instant::now() - OVERLAY_MOUSE_MOVE_EMIT_INTERVAL;
            let mut last_queue_diagnostic_log = Instant::now();
            let mut last_queue_diagnostics = queue.diagnostics();
            loop {
                let event = match deferred_event.take() {
                    Some(event) => event,
                    None => match queue.recv() {
                        Ok(event) => event,
                        Err(_) => break,
                    },
                };
                log_capture_mouse_queue_diagnostics_if_due(
                    &queue,
                    &mut last_queue_diagnostic_log,
                    &mut last_queue_diagnostics,
                );

                match event {
                    CaptureMouseHookEvent::Move {
                        x,
                        y,
                        modifiers,
                    } => {
                        match coalesce_capture_mouse_move_until_emit(
                            queue.as_ref(),
                            x,
                            y,
                            modifiers,
                            last_capture_move_emit,
                            CAPTURE_MOUSE_MOVE_EMIT_INTERVAL,
                        ) {
                            CaptureMouseMoveCoalesceResult::Ready {
                                x: latest_x,
                                y: latest_y,
                                modifiers: latest_modifiers,
                                deferred_event: next,
                            } => {
                                deferred_event = next;
                                emit_capture_mouse_event(
                                    &emit_window,
                                    "capture/global_mouse_move",
                                    latest_x,
                                    latest_y,
                                    latest_modifiers,
                                    false,
                                    cached_metrics,
                                );
                                last_capture_move_emit = Instant::now();
                            }
                            CaptureMouseMoveCoalesceResult::Disconnected => return,
                        }
                    }
                    CaptureMouseHookEvent::Down { x, y, modifiers } => {
                        cached_metrics = capture_window_metrics(&emit_window).or(cached_metrics);
                        emit_capture_mouse_event(
                            &emit_window,
                            "capture/global_mouse_down",
                            x,
                            y,
                            modifiers,
                            false,
                            cached_metrics,
                        );
                    }
                    CaptureMouseHookEvent::OverlayDown {
                        x,
                        y,
                        modifiers,
                        native_drag_preflight,
                        source,
                        continuation,
                    } => {
                        cached_metrics = capture_window_metrics(&emit_window).or(cached_metrics);
                        sync_overlay_input_shield_from_runtime_state(&emit_window);
                        emit_capture_mouse_event(
                            &emit_window,
                            if continuation {
                                append_runtime_log_line(&format!(
                                    "overlay_mouse_up_down_bounce_suppressed :: source={} continue_x={} continue_y={}",
                                    source.log_name(),
                                    x,
                                    y
                                ));
                                "overlay/global_mouse_move"
                            } else {
                                "overlay/global_mouse_down"
                            },
                            x,
                            y,
                            modifiers,
                            native_drag_preflight,
                            cached_metrics,
                        );
                        if continuation {
                            last_overlay_move_emit = Instant::now();
                        }
                    }
                    CaptureMouseHookEvent::OverlayMove {
                        x,
                        y,
                        modifiers,
                        native_drag_preflight,
                    } => match coalesce_overlay_mouse_move_until_emit(
                        queue.as_ref(),
                        x,
                        y,
                        modifiers,
                        native_drag_preflight,
                        last_overlay_move_emit,
                        OVERLAY_MOUSE_MOVE_EMIT_INTERVAL,
                    ) {
                        OverlayMouseMoveCoalesceResult::Ready {
                            x: latest_x,
                            y: latest_y,
                            modifiers: latest_modifiers,
                            native_drag_preflight: latest_native_drag_preflight,
                            deferred_event: next,
                        } => {
                            deferred_event = next;
                            emit_capture_mouse_event(
                                &emit_window,
                                "overlay/global_mouse_move",
                                latest_x,
                                latest_y,
                                latest_modifiers,
                                latest_native_drag_preflight,
                                cached_metrics,
                            );
                            last_overlay_move_emit = Instant::now();
                        }
                        OverlayMouseMoveCoalesceResult::Disconnected => return,
                    },
                    CaptureMouseHookEvent::Up { x, y, modifiers } => {
                        match wait_for_capture_mouse_up_debounce(
                            queue.as_ref(),
                            CAPTURE_MOUSE_UP_BOUNCE_WINDOW,
                        ) {
                            CaptureMouseUpDebounceResult::Continue {
                                x: continue_x,
                                y: continue_y,
                                modifiers: continue_modifiers,
                            } => {
                                append_runtime_log_line(&format!(
                                    "capture_mouse_up_down_bounce_suppressed :: up_x={} up_y={} continue_x={} continue_y={}",
                                    x, y, continue_x, continue_y
                                ));
                                emit_capture_mouse_event(
                                    &emit_window,
                                    "capture/global_mouse_move",
                                    continue_x,
                                    continue_y,
                                    continue_modifiers,
                                    false,
                                    cached_metrics,
                                );
                                last_capture_move_emit = Instant::now();
                            }
                            CaptureMouseUpDebounceResult::Release { deferred_event: next } => {
                                deferred_event = next;
                                emit_capture_mouse_event(
                                    &emit_window,
                                    "capture/global_mouse_up",
                                    x,
                                    y,
                                    modifiers,
                                    false,
                                    cached_metrics,
                                );
                            }
                            CaptureMouseUpDebounceResult::Disconnected => return,
                        }
                    }
                    CaptureMouseHookEvent::OverlayUp {
                        x,
                        y,
                        modifiers,
                        native_drag_preflight,
                        source,
                    } => {
                        match wait_for_overlay_mouse_up_debounce(
                            queue.as_ref(),
                            source,
                            OVERLAY_MOUSE_UP_BOUNCE_WINDOW,
                        ) {
                            OverlayMouseUpDebounceResult::Continue {
                                x: continue_x,
                                y: continue_y,
                                modifiers: continue_modifiers,
                                native_drag_preflight: continue_native_drag_preflight,
                            } => {
                                append_runtime_log_line(&format!(
                                    "overlay_mouse_up_down_bounce_suppressed :: source={} up_x={} up_y={} continue_x={} continue_y={}",
                                    source.log_name(),
                                    x,
                                    y,
                                    continue_x,
                                    continue_y
                                ));
                                sync_overlay_input_shield_from_runtime_state(&emit_window);
                                emit_capture_mouse_event(
                                    &emit_window,
                                    "overlay/global_mouse_move",
                                    continue_x,
                                    continue_y,
                                    continue_modifiers,
                                    continue_native_drag_preflight,
                                    cached_metrics,
                                );
                                last_overlay_move_emit = Instant::now();
                            }
                            OverlayMouseUpDebounceResult::Release {
                                deferred_event: next,
                                latest_move,
                            } => {
                                deferred_event = next;
                                match resolve_overlay_pointer_release(
                                    &OVERLAY_POINTER_STATE,
                                    source,
                                    overlay_primary_button_physically_down(),
                                ) {
                                    OverlayPointerReleaseResult::SuppressedPhysicalDown => {
                                        let resume_point = latest_move.unwrap_or(
                                            OverlayMouseMoveSnapshot {
                                                x,
                                                y,
                                                modifiers,
                                                native_drag_preflight,
                                            },
                                        );
                                        append_runtime_log_line(&format!(
                                            "overlay_mouse_up_physical_button_down_suppressed :: source={} x={} y={}",
                                            source.log_name(),
                                            resume_point.x,
                                            resume_point.y
                                        ));
                                        sync_overlay_input_shield_from_runtime_state(&emit_window);
                                        emit_capture_mouse_event(
                                            &emit_window,
                                            "overlay/global_mouse_move",
                                            resume_point.x,
                                            resume_point.y,
                                            resume_point.modifiers,
                                            resume_point.native_drag_preflight,
                                            cached_metrics,
                                        );
                                        last_overlay_move_emit = Instant::now();
                                    }
                                    OverlayPointerReleaseResult::Released => {
                                        OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(false, Ordering::SeqCst);
                                        let synthetic_drag_active =
                                            OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE
                                                .swap(false, Ordering::SeqCst);
                                        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE
                                            .store(false, Ordering::SeqCst);
                                        let direct_drag_active =
                                            OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE
                                                .swap(false, Ordering::SeqCst);
                                        let pointer_still_over_overlay =
                                            should_route_overlay_mouse_events(x, y);
                                        OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(
                                            pointer_still_over_overlay,
                                            Ordering::SeqCst,
                                        );
                                        match source {
                                            OverlayPointerSource::LowLevelHook => {
                                                append_runtime_log_line(&format!(
                                                    "overlay_drag_end :: synthetic={} x={} y={}",
                                                    synthetic_drag_active, x, y
                                                ));
                                            }
                                            OverlayPointerSource::InputShield => {
                                                append_runtime_log_line(&format!(
                                                    "overlay_input_shield_drag_end :: direct={} x={} y={}",
                                                    direct_drag_active, x, y
                                                ));
                                            }
                                        }
                                        sync_overlay_input_shield_from_runtime_state(&emit_window);
                                        emit_capture_mouse_event(
                                            &emit_window,
                                            "overlay/global_mouse_up",
                                            x,
                                            y,
                                            modifiers,
                                            native_drag_preflight,
                                            cached_metrics,
                                        );
                                    }
                                    OverlayPointerReleaseResult::Superseded => {
                                        append_runtime_log_line(&format!(
                                            "overlay_mouse_up_release_superseded :: source={} x={} y={}",
                                            source.log_name(),
                                            x,
                                            y
                                        ));
                                    }
                                }
                            }
                            OverlayMouseUpDebounceResult::Disconnected => return,
                        }
                    }
                    CaptureMouseHookEvent::Wheel { x, y, modifiers } => {
                        let _ = (x, y, modifiers);
                    }
                    CaptureMouseHookEvent::OverlayWheel {
                        x,
                        y,
                        delta_y,
                        modifiers,
                    } => {
                        emit_overlay_wheel_event(
                            &emit_window,
                            "overlay/global_mouse_wheel",
                            x,
                            y,
                            delta_y,
                            modifiers,
                            cached_metrics,
                        );
                    }
                    CaptureMouseHookEvent::OverlayContextMenu { x, y, modifiers } => {
                        emit_capture_mouse_event(
                            &emit_window,
                            "overlay/global_context_menu",
                            x,
                            y,
                            modifiers,
                            false,
                            cached_metrics,
                        );
                    }
                }
            }
        });

    let _ = std::thread::Builder::new()
        .name("hook-capture-mouse-hook".to_string())
        .spawn(move || {
            let hook = match unsafe {
                SetWindowsHookExW(WH_MOUSE_LL, Some(capture_mouse_hook_proc), None, 0)
            } {
                Ok(hook) => {
                    append_runtime_log_line("capture_mouse_hook_install_success");
                    hook
                }
                Err(error) => {
                    append_runtime_log_line(&format!(
                        "capture_mouse_hook_install_failed :: {}",
                        error
                    ));
                    return;
                }
            };

            let mut msg = MSG::default();
            while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
                let _ = unsafe { TranslateMessage(&msg) };
                unsafe { DispatchMessageW(&msg) };
            }
            let _ = unsafe { UnhookWindowsHookEx(hook) };
            append_runtime_log_line("capture_mouse_hook_thread_exited");
        });
}

#[cfg(not(target_os = "windows"))]
fn install_capture_mouse_hook_thread(_window: tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
const VK_KEY_C: u32 = b'C' as u32;
#[cfg(target_os = "windows")]
const VK_KEY_V: u32 = b'V' as u32;

#[cfg(target_os = "windows")]
fn update_overlay_modifier_key_state(vk_code: u32, pressed: bool) {
    if vk_code == VK_SHIFT.0 as u32
        || vk_code == VK_LSHIFT.0 as u32
        || vk_code == VK_RSHIFT.0 as u32
    {
        OVERLAY_SHIFT_KEY_DOWN.store(pressed, Ordering::SeqCst);
    }
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_hook_event_for_keydown(
    vk_code: u32,
    modifiers: ModifierSnapshot,
) -> Option<OverlayKeyboardHookEvent> {
    if vk_code == VK_ESCAPE.0 as u32 {
        return Some(OverlayKeyboardHookEvent::Escape);
    }
    if vk_code == VK_DELETE.0 as u32 || vk_code == VK_BACK.0 as u32 {
        return Some(OverlayKeyboardHookEvent::Delete);
    }
    if modifiers.ctrl_pressed && vk_code == VK_KEY_C {
        return Some(OverlayKeyboardHookEvent::Copy);
    }
    if modifiers.ctrl_pressed && vk_code == VK_KEY_V {
        return Some(OverlayKeyboardHookEvent::Paste);
    }
    None
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_hook_should_consume_keyup(vk_code: u32, modifiers: ModifierSnapshot) -> bool {
    vk_code == VK_ESCAPE.0 as u32
        || vk_code == VK_DELETE.0 as u32
        || vk_code == VK_BACK.0 as u32
        || (modifiers.ctrl_pressed && (vk_code == VK_KEY_C || vk_code == VK_KEY_V))
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_hook_should_capture_semantic_keydown(
    vk_code: u32,
    modifiers: ModifierSnapshot,
    webview_has_focus: bool,
) -> Option<OverlayKeyboardHookEvent> {
    if webview_has_focus {
        return None;
    }
    overlay_keyboard_hook_event_for_keydown(vk_code, modifiers)
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_hook_should_capture_semantic_keyup(
    vk_code: u32,
    modifiers: ModifierSnapshot,
    webview_has_focus: bool,
) -> bool {
    !webview_has_focus && overlay_keyboard_hook_should_consume_keyup(vk_code, modifiers)
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RdevAppScopedShortcut {
    Escape,
    Delete,
}

#[cfg(target_os = "windows")]
fn rdev_should_dispatch_app_scoped_shortcut(
    shortcut: RdevAppScopedShortcut,
    app_has_focus: bool,
    capture_active: bool,
) -> bool {
    match shortcut {
        RdevAppScopedShortcut::Escape => app_has_focus || capture_active,
        RdevAppScopedShortcut::Delete => app_has_focus,
    }
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_capture_should_handle_current_cursor() -> bool {
    if NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst) {
        return false;
    }

    if !OVERLAY_KEYBOARD_CAPTURE_ACTIVE.load(Ordering::SeqCst) {
        return false;
    }

    let Some((x, y)) = current_cursor_position_physical() else {
        return false;
    };

    should_route_overlay_mouse_events(x, y)
}

#[cfg(target_os = "windows")]
fn overlay_webview_has_foreground_focus() -> bool {
    // If the HWND is unknown, assume focused so we do NOT intercept keys
    // (safe fallback: let the normal DOM path handle them).
    let Some(&main_hwnd) = OVERLAY_MAIN_HWND.get() else {
        return true;
    };
    let foreground = unsafe { GetForegroundWindow() };
    foreground.0 as isize == main_hwnd
}

#[cfg(target_os = "windows")]
fn hook_process_has_foreground_window() -> bool {
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0.is_null() {
        return false;
    }

    let mut foreground_pid = 0;
    unsafe { GetWindowThreadProcessId(foreground, Some(&mut foreground_pid)) };
    foreground_pid == std::process::id()
}

#[cfg(target_os = "windows")]
fn should_passthrough_foreign_alt_input(
    alt_pressed: bool,
    capture_active: bool,
    drag_active: bool,
    native_drag_preflight_active: bool,
    hook_has_foreground_window: bool,
) -> bool {
    alt_pressed
        && !capture_active
        && !drag_active
        && !native_drag_preflight_active
        && !hook_has_foreground_window
}

#[cfg(target_os = "windows")]
fn should_passthrough_foreign_alt_mouse_input(
    alt_pressed: bool,
    capture_active: bool,
    drag_active: bool,
    native_drag_preflight_active: bool,
    hook_has_foreground_window: bool,
    is_wheel_message: bool,
    should_route_overlay_mouse: bool,
) -> bool {
    let routed_overlay_wheel = is_wheel_message && should_route_overlay_mouse;
    should_passthrough_foreign_alt_input(
        alt_pressed,
        capture_active,
        drag_active,
        native_drag_preflight_active,
        hook_has_foreground_window,
    ) && !routed_overlay_wheel
}

// A sticker-selected DOM shortcut the native hook can forward. `key`/`ctrl`/
// `shift`/`alt` mirror the DOM KeyboardEvent the frontend reconstructs.
#[cfg(target_os = "windows")]
struct ForwardedShortcut {
    key: &'static str,
    ctrl: bool,
    shift: bool,
    alt: bool,
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_should_consume_forwarded_shortcut(shortcut: &ForwardedShortcut) -> bool {
    // Alt combinations must remain visible to the foreground application. Hook
    // can mirror Alt+2/Alt+3 into its unfocused WebView without suppressing the
    // original system key event.
    !shortcut.alt
}

// Maps a physical key + modifier state to the DOM shortcut it should trigger,
// for the "unit-selected" sticker shortcuts that are handled in the webview DOM
// (i.e. NOT the native semantic set Escape/Delete/Copy/Paste, and NOT the global
// shortcuts Ctrl+E/1/2/3). Kept in sync with src/services/shortcuts.ts; a
// contract test guards the mapping.
#[cfg(target_os = "windows")]
fn overlay_keyboard_forwardable_shortcut(
    vk_code: u32,
    modifiers: ModifierSnapshot,
) -> Option<ForwardedShortcut> {
    let ctrl = modifiers.ctrl_pressed;
    let shift = modifiers.shift_pressed;
    let alt = modifiers.alt_pressed;
    let none = !ctrl && !shift && !alt;
    let only_ctrl = ctrl && !shift && !alt;
    let only_shift = shift && !ctrl && !alt;
    let only_alt = alt && !ctrl && !shift;

    let make = |key: &'static str| {
        Some(ForwardedShortcut {
            key,
            ctrl,
            shift,
            alt,
        })
    };

    if none && vk_code == VK_TAB.0 as u32 {
        return make("Tab"); // toggle-params
    }
    if only_shift && vk_code == b'1' as u32 {
        return make("!"); // toggle-actions (Shift+1)
    }
    if only_alt && vk_code == b'2' as u32 {
        return make("2"); // toggle-ocr
    }
    if only_alt && vk_code == b'3' as u32 {
        return make("3"); // toggle-translation
    }
    if only_ctrl {
        let key = match vk_code {
            v if v == b'S' as u32 => Some("s"), // save
            v if v == b'Z' as u32 => Some("z"), // undo-edit
            v if v == b'Y' as u32 => Some("y"), // redo-edit
            v if v == b'H' as u32 => Some("h"), // toggle-history
            v if v == b'O' as u32 => Some("o"), // open-image
            v if v == b'4' as u32 => Some("4"), // toggle-clean-view
            _ => None,
        };
        if let Some(key) = key {
            return make(key);
        }
    }
    if none {
        let key = match vk_code {
            v if v == b'Q' as u32 => Some("q"), // transform-select
            v if v == b'W' as u32 => Some("w"), // transform-move
            v if v == b'E' as u32 => Some("e"), // transform-rotate
            v if v == b'R' as u32 => Some("r"), // transform-scale
            _ => None,
        };
        if let Some(key) = key {
            return make(key);
        }
    }
    None
}

#[cfg(all(test, target_os = "windows"))]
mod overlay_forwardable_shortcut_tests {
    use super::{
        overlay_keyboard_forwardable_shortcut, overlay_keyboard_should_consume_forwarded_shortcut,
        ModifierSnapshot, VK_TAB,
    };

    fn mods(ctrl: bool, shift: bool, alt: bool) -> ModifierSnapshot {
        ModifierSnapshot {
            ctrl_pressed: ctrl,
            alt_pressed: alt,
            shift_pressed: shift,
        }
    }

    #[test]
    fn forwards_tab_as_toggle_params() {
        let sc = overlay_keyboard_forwardable_shortcut(VK_TAB.0 as u32, mods(false, false, false))
            .expect("Tab should forward");
        assert_eq!(sc.key, "Tab");
        assert!(!sc.ctrl && !sc.shift && !sc.alt);
    }

    #[test]
    fn forwards_shift_1_as_bang() {
        let sc = overlay_keyboard_forwardable_shortcut(b'1' as u32, mods(false, true, false))
            .expect("Shift+1 should forward");
        assert_eq!(sc.key, "!");
        assert!(sc.shift && !sc.ctrl && !sc.alt);
    }

    #[test]
    fn forwards_alt_digit_toggles() {
        let alt_2 =
            overlay_keyboard_forwardable_shortcut(b'2' as u32, mods(false, false, true)).unwrap();
        let alt_3 =
            overlay_keyboard_forwardable_shortcut(b'3' as u32, mods(false, false, true)).unwrap();
        assert_eq!(alt_2.key, "2");
        assert_eq!(alt_3.key, "3");
        assert!(!overlay_keyboard_should_consume_forwarded_shortcut(&alt_2));
        assert!(!overlay_keyboard_should_consume_forwarded_shortcut(&alt_3));
    }

    #[test]
    fn still_consumes_non_alt_hook_shortcuts() {
        let tab = overlay_keyboard_forwardable_shortcut(VK_TAB.0 as u32, mods(false, false, false))
            .unwrap();
        assert!(overlay_keyboard_should_consume_forwarded_shortcut(&tab));
    }

    #[test]
    fn forwards_ctrl_shortcuts() {
        for (vk, expected) in [
            (b'S', "s"),
            (b'Z', "z"),
            (b'Y', "y"),
            (b'H', "h"),
            (b'O', "o"),
            (b'4', "4"),
        ] {
            let sc = overlay_keyboard_forwardable_shortcut(vk as u32, mods(true, false, false))
                .unwrap_or_else(|| panic!("Ctrl+{} should forward", expected));
            assert_eq!(sc.key, expected);
            assert!(sc.ctrl && !sc.shift && !sc.alt);
        }
    }

    #[test]
    fn forwards_bare_transform_letters() {
        for (vk, expected) in [(b'Q', "q"), (b'W', "w"), (b'E', "e"), (b'R', "r")] {
            assert_eq!(
                overlay_keyboard_forwardable_shortcut(vk as u32, mods(false, false, false))
                    .unwrap()
                    .key,
                expected
            );
        }
    }

    #[test]
    fn rejects_wrong_modifiers() {
        // Tab requires no modifiers.
        assert!(
            overlay_keyboard_forwardable_shortcut(VK_TAB.0 as u32, mods(true, false, false))
                .is_none()
        );
        // Ctrl+E is a GLOBAL shortcut, must not be forwarded as the bare-'e' transform.
        assert!(
            overlay_keyboard_forwardable_shortcut(b'E' as u32, mods(true, false, false)).is_none()
        );
        // A plain letter that is not a shortcut is not forwarded.
        assert!(
            overlay_keyboard_forwardable_shortcut(b'A' as u32, mods(false, false, false)).is_none()
        );
        // Shift+2 (=@) is not a shortcut.
        assert!(
            overlay_keyboard_forwardable_shortcut(b'2' as u32, mods(false, true, false)).is_none()
        );
    }
}

#[cfg(all(test, target_os = "windows"))]
mod overlay_semantic_shortcut_focus_tests {
    use super::{
        overlay_keyboard_hook_should_capture_semantic_keydown,
        overlay_keyboard_hook_should_capture_semantic_keyup, ModifierSnapshot, VK_BACK, VK_DELETE,
        VK_ESCAPE,
    };

    fn mods(ctrl: bool, shift: bool, alt: bool) -> ModifierSnapshot {
        ModifierSnapshot {
            ctrl_pressed: ctrl,
            alt_pressed: alt,
            shift_pressed: shift,
        }
    }

    #[test]
    fn keeps_semantic_keys_in_dom_when_webview_is_focused() {
        let focused = true;
        for vk_code in [VK_BACK.0 as u32, VK_DELETE.0 as u32, VK_ESCAPE.0 as u32] {
            assert!(
                overlay_keyboard_hook_should_capture_semantic_keydown(
                    vk_code,
                    mods(false, false, false),
                    focused,
                )
                .is_none(),
                "focused DOM should keep vk_code={vk_code}",
            );
            assert!(
                !overlay_keyboard_hook_should_capture_semantic_keyup(
                    vk_code,
                    mods(false, false, false),
                    focused,
                ),
                "focused DOM should keep keyup for vk_code={vk_code}",
            );
        }
    }

    #[test]
    fn still_intercepts_semantic_keys_when_webview_is_unfocused() {
        let focused = false;
        for (vk_code, modifiers) in [
            (VK_BACK.0 as u32, mods(false, false, false)),
            (VK_DELETE.0 as u32, mods(false, false, false)),
            (VK_ESCAPE.0 as u32, mods(false, false, false)),
            (b'C' as u32, mods(true, false, false)),
            (b'V' as u32, mods(true, false, false)),
        ] {
            assert!(
                overlay_keyboard_hook_should_capture_semantic_keydown(vk_code, modifiers, focused,)
                    .is_some(),
                "unfocused overlay should intercept vk_code={vk_code}",
            );
            assert!(
                overlay_keyboard_hook_should_capture_semantic_keyup(vk_code, modifiers, focused,),
                "unfocused overlay should consume keyup for vk_code={vk_code}",
            );
        }
    }
}

#[cfg(all(test, target_os = "windows"))]
mod rdev_app_scoped_shortcut_tests {
    use super::{rdev_should_dispatch_app_scoped_shortcut, RdevAppScopedShortcut};

    #[test]
    fn delete_requires_hook_foreground_focus() {
        assert!(rdev_should_dispatch_app_scoped_shortcut(
            RdevAppScopedShortcut::Delete,
            true,
            false,
        ));
        assert!(!rdev_should_dispatch_app_scoped_shortcut(
            RdevAppScopedShortcut::Delete,
            false,
            false,
        ));
    }

    #[test]
    fn escape_requires_focus_unless_capture_is_active() {
        assert!(rdev_should_dispatch_app_scoped_shortcut(
            RdevAppScopedShortcut::Escape,
            true,
            false,
        ));
        assert!(rdev_should_dispatch_app_scoped_shortcut(
            RdevAppScopedShortcut::Escape,
            false,
            true,
        ));
        assert!(!rdev_should_dispatch_app_scoped_shortcut(
            RdevAppScopedShortcut::Escape,
            false,
            false,
        ));
    }
}

#[cfg(all(test, target_os = "windows"))]
mod input_lifecycle_hardening_tests {
    use super::{
        claim_capture_button_transition, claim_overlay_pointer_down, claim_overlay_pointer_up,
        coalesce_capture_mouse_move_until_emit, coalesce_overlay_mouse_move_until_emit,
        handle_emergency_escape_transition_with, rect_covers_rect_with_tolerance,
        resolve_overlay_pointer_release, should_passthrough_foreign_alt_input,
        should_passthrough_foreign_alt_mouse_input,
        should_suppress_overlay_interaction_for_occlusion, wait_for_capture_mouse_up_debounce,
        wait_for_overlay_mouse_up_debounce, CaptureMouseEventEnqueueResult, CaptureMouseEventQueue,
        CaptureMouseEventReceiver, CaptureMouseHookEvent, CaptureMouseMoveCoalesceResult,
        CaptureMouseUpDebounceResult, EmergencyEscapeTracker, ModifierSnapshot,
        OverlayMouseMoveCoalesceResult, OverlayMouseUpDebounceResult, OverlayPointerDownTransition,
        OverlayPointerReleaseResult, OverlayPointerSource, OverlayPointerUpTransition,
        EMERGENCY_ESCAPE_WINDOW, OVERLAY_POINTER_STATE_NONE,
    };
    use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::RECT;

    fn modifiers() -> ModifierSnapshot {
        ModifierSnapshot {
            ctrl_pressed: false,
            alt_pressed: false,
            shift_pressed: false,
        }
    }

    #[test]
    fn capture_button_edges_require_a_real_down_up_pair() {
        let state = AtomicBool::new(false);

        assert!(claim_capture_button_transition(&state, true));
        assert!(!claim_capture_button_transition(&state, true));
        assert!(claim_capture_button_transition(&state, false));
        assert!(!claim_capture_button_transition(&state, false));
    }

    #[test]
    fn capture_up_followed_immediately_by_down_continues_the_same_drag() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::Move {
                x: 110.0,
                y: 120.0,
                modifiers: modifiers(),
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::Down {
                x: 130.0,
                y: 140.0,
                modifiers: modifiers(),
            })
            .unwrap();

        match wait_for_capture_mouse_up_debounce(&receiver, Duration::from_millis(1)) {
            CaptureMouseUpDebounceResult::Continue { x, y, .. } => {
                assert_eq!((x, y), (130.0, 140.0));
            }
            other => panic!("expected capture continuation, got {other:?}"),
        }
    }

    #[test]
    fn capture_up_without_a_following_down_is_released() {
        let (_sender, receiver) = mpsc::channel();

        match wait_for_capture_mouse_up_debounce(&receiver, Duration::ZERO) {
            CaptureMouseUpDebounceResult::Release {
                deferred_event: None,
            } => {}
            other => panic!("expected capture release, got {other:?}"),
        }
    }

    #[test]
    fn overlay_pointer_owner_rejects_cross_source_and_duplicate_edges() {
        let state = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);

        assert_eq!(
            claim_overlay_pointer_down(&state, OverlayPointerSource::LowLevelHook),
            OverlayPointerDownTransition::Started
        );
        assert_eq!(
            claim_overlay_pointer_down(&state, OverlayPointerSource::LowLevelHook),
            OverlayPointerDownTransition::IgnoredDuplicate
        );
        assert_eq!(
            claim_overlay_pointer_down(&state, OverlayPointerSource::InputShield),
            OverlayPointerDownTransition::IgnoredForeignOwner
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, OverlayPointerSource::InputShield),
            OverlayPointerUpTransition::IgnoredForeignOwner
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, OverlayPointerSource::LowLevelHook),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, OverlayPointerSource::LowLevelHook),
            OverlayPointerUpTransition::IgnoredDuplicate
        );
    }

    #[test]
    fn overlay_up_followed_by_down_continues_the_same_drag() {
        let state = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);
        let source = OverlayPointerSource::LowLevelHook;
        assert_eq!(
            claim_overlay_pointer_down(&state, source),
            OverlayPointerDownTransition::Started
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            claim_overlay_pointer_down(&state, source),
            OverlayPointerDownTransition::Continued
        );

        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 400.0,
                y: 410.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::OverlayDown {
                x: 420.0,
                y: 430.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
                source,
                continuation: true,
            })
            .unwrap();

        match wait_for_overlay_mouse_up_debounce(&receiver, source, Duration::from_millis(1)) {
            OverlayMouseUpDebounceResult::Continue { x, y, .. } => {
                assert_eq!((x, y), (420.0, 430.0));
            }
            other => panic!("expected overlay continuation, got {other:?}"),
        }
        assert_eq!(state.load(Ordering::SeqCst), source.down_state());
    }

    #[test]
    fn overlay_candidate_up_is_suppressed_while_primary_button_is_physically_down() {
        let state = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);
        let source = OverlayPointerSource::LowLevelHook;
        assert_eq!(
            claim_overlay_pointer_down(&state, source),
            OverlayPointerDownTransition::Started
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            resolve_overlay_pointer_release(&state, source, true),
            OverlayPointerReleaseResult::SuppressedPhysicalDown
        );
        assert_eq!(state.load(Ordering::SeqCst), source.down_state());

        assert_eq!(
            claim_overlay_pointer_up(&state, source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            resolve_overlay_pointer_release(&state, source, false),
            OverlayPointerReleaseResult::Released
        );
        assert_eq!(state.load(Ordering::SeqCst), OVERLAY_POINTER_STATE_NONE);
    }

    #[test]
    fn overlay_up_debounce_retains_the_latest_move_for_a_suppressed_release() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 500.0,
                y: 510.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 600.0,
                y: 610.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            })
            .unwrap();

        match wait_for_overlay_mouse_up_debounce(
            &receiver,
            OverlayPointerSource::LowLevelHook,
            Duration::from_millis(1),
        ) {
            OverlayMouseUpDebounceResult::Release {
                deferred_event: None,
                latest_move: Some(latest_move),
            } => {
                assert_eq!((latest_move.x, latest_move.y), (600.0, 610.0));
            }
            other => panic!("expected retained overlay move, got {other:?}"),
        }
    }

    #[test]
    fn late_recovery_down_wins_the_release_timeout_race() {
        let state = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);
        let source = OverlayPointerSource::InputShield;
        assert_eq!(
            claim_overlay_pointer_down(&state, source),
            OverlayPointerDownTransition::Started
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            claim_overlay_pointer_down(&state, source),
            OverlayPointerDownTransition::Continued
        );
        assert_eq!(
            resolve_overlay_pointer_release(&state, source, false),
            OverlayPointerReleaseResult::Superseded
        );
        assert_eq!(state.load(Ordering::SeqCst), source.down_state());
    }

    #[test]
    fn recovery_down_can_transfer_a_pending_session_to_the_fallback_input_source() {
        let state = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);
        let original_source = OverlayPointerSource::LowLevelHook;
        let fallback_source = OverlayPointerSource::InputShield;
        assert_eq!(
            claim_overlay_pointer_down(&state, original_source),
            OverlayPointerDownTransition::Started
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, original_source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            claim_overlay_pointer_down(&state, fallback_source),
            OverlayPointerDownTransition::Continued
        );
        assert_eq!(
            resolve_overlay_pointer_release(&state, original_source, false),
            OverlayPointerReleaseResult::Superseded
        );
        assert_eq!(state.load(Ordering::SeqCst), fallback_source.down_state());
        assert_eq!(
            claim_overlay_pointer_up(&state, fallback_source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            resolve_overlay_pointer_release(&state, fallback_source, false),
            OverlayPointerReleaseResult::Released
        );
    }

    #[test]
    fn capture_move_coalescing_emits_the_latest_point_before_a_deferred_up() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::Move {
                x: 200.0,
                y: 210.0,
                modifiers: modifiers(),
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::Move {
                x: 300.0,
                y: 310.0,
                modifiers: modifiers(),
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::Up {
                x: 320.0,
                y: 330.0,
                modifiers: modifiers(),
            })
            .unwrap();

        match coalesce_capture_mouse_move_until_emit(
            &receiver,
            100.0,
            110.0,
            modifiers(),
            Instant::now() - Duration::from_millis(10),
            Duration::from_millis(8),
        ) {
            CaptureMouseMoveCoalesceResult::Ready {
                x,
                y,
                deferred_event:
                    Some(CaptureMouseHookEvent::Up {
                        x: up_x, y: up_y, ..
                    }),
                ..
            } => {
                assert_eq!((x, y), (300.0, 310.0));
                assert_eq!((up_x, up_y), (320.0, 330.0));
            }
            other => panic!("expected latest move and deferred up, got {other:?}"),
        }
    }

    #[test]
    fn overlay_move_coalescing_emits_the_latest_point_before_a_deferred_up() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 200.0,
                y: 210.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 300.0,
                y: 310.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::OverlayUp {
                x: 320.0,
                y: 330.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
                source: OverlayPointerSource::LowLevelHook,
            })
            .unwrap();

        match coalesce_overlay_mouse_move_until_emit(
            &receiver,
            100.0,
            110.0,
            modifiers(),
            false,
            Instant::now() - Duration::from_millis(20),
            Duration::from_millis(16),
        ) {
            OverlayMouseMoveCoalesceResult::Ready {
                x,
                y,
                deferred_event:
                    Some(CaptureMouseHookEvent::OverlayUp {
                        x: up_x, y: up_y, ..
                    }),
                ..
            } => {
                assert_eq!((x, y), (300.0, 310.0));
                assert_eq!((up_x, up_y), (320.0, 330.0));
            }
            other => panic!("expected latest overlay move and deferred up, got {other:?}"),
        }
    }

    #[test]
    fn overlay_move_coalescing_does_not_cross_native_drag_preflight_boundaries() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 400.0,
                y: 410.0,
                modifiers: modifiers(),
                native_drag_preflight: true,
            })
            .unwrap();

        match coalesce_overlay_mouse_move_until_emit(
            &receiver,
            100.0,
            110.0,
            modifiers(),
            false,
            Instant::now() - Duration::from_millis(20),
            Duration::from_millis(16),
        ) {
            OverlayMouseMoveCoalesceResult::Ready {
                x,
                y,
                native_drag_preflight,
                deferred_event:
                    Some(CaptureMouseHookEvent::OverlayMove {
                        x: deferred_x,
                        y: deferred_y,
                        native_drag_preflight: deferred_preflight,
                        ..
                    }),
                ..
            } => {
                assert_eq!((x, y, native_drag_preflight), (100.0, 110.0, false));
                assert_eq!(
                    (deferred_x, deferred_y, deferred_preflight),
                    (400.0, 410.0, true)
                );
            }
            other => panic!("expected a deferred preflight stream boundary, got {other:?}"),
        }
    }

    #[test]
    fn bounded_mouse_queue_coalesces_a_large_capture_move_flood() {
        let queue = CaptureMouseEventQueue::new(32, 4);

        for index in 0..100_000 {
            let result = queue.enqueue(CaptureMouseHookEvent::Move {
                x: index as f64,
                y: (index + 1) as f64,
                modifiers: modifiers(),
            });
            assert!(matches!(
                result,
                CaptureMouseEventEnqueueResult::Enqueued
                    | CaptureMouseEventEnqueueResult::CoalescedMove
            ));
        }

        let diagnostics = queue.diagnostics();
        assert_eq!(diagnostics.current_depth, 1);
        assert_eq!(diagnostics.max_depth, 1);
        assert_eq!(diagnostics.coalesced_moves, 99_999);
        assert_eq!(diagnostics.evicted_moves, 0);
        assert_eq!(diagnostics.dropped_moves, 0);
        assert_eq!(diagnostics.critical_overflows, 0);
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::Move {
                x: 99_999.0,
                y: 100_000.0,
                ..
            })
        ));
    }

    #[test]
    fn bounded_mouse_queue_preserves_down_up_order_inside_move_floods() {
        let queue = CaptureMouseEventQueue::new(32, 4);

        for index in 0..10_000 {
            let _ = queue.enqueue(CaptureMouseHookEvent::Move {
                x: index as f64,
                y: 10.0,
                modifiers: modifiers(),
            });
        }
        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::Down {
                x: 10_000.0,
                y: 20.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::Enqueued
        );
        for index in 0..10_000 {
            let _ = queue.enqueue(CaptureMouseHookEvent::Move {
                x: (20_000 + index) as f64,
                y: 30.0,
                modifiers: modifiers(),
            });
        }
        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::Up {
                x: 30_000.0,
                y: 40.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::Enqueued
        );

        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::Move { x: 9_999.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::Down { x: 10_000.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::Move { x: 29_999.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::Up { x: 30_000.0, .. })
        ));
        assert!(matches!(queue.try_recv(), Err(mpsc::TryRecvError::Empty)));

        let diagnostics = queue.diagnostics();
        assert_eq!(diagnostics.current_depth, 0);
        assert_eq!(diagnostics.max_depth, 4);
        assert_eq!(diagnostics.enqueued_edges, 2);
        assert_eq!(diagnostics.critical_overflows, 0);
    }

    #[test]
    fn bounded_mouse_queue_keeps_overlay_preflight_stream_boundaries() {
        let queue = CaptureMouseEventQueue::new(16, 4);
        for (x, native_drag_preflight) in
            [(100.0, false), (200.0, true), (300.0, true), (400.0, false)]
        {
            let _ = queue.enqueue(CaptureMouseHookEvent::OverlayMove {
                x,
                y: x + 1.0,
                modifiers: modifiers(),
                native_drag_preflight,
            });
        }

        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayMove {
                x: 100.0,
                native_drag_preflight: false,
                ..
            })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayMove {
                x: 300.0,
                native_drag_preflight: true,
                ..
            })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayMove {
                x: 400.0,
                native_drag_preflight: false,
                ..
            })
        ));
        assert!(matches!(queue.try_recv(), Err(mpsc::TryRecvError::Empty)));
        assert_eq!(queue.diagnostics().coalesced_moves, 1);
    }

    #[test]
    fn bounded_mouse_queue_reserves_capacity_for_button_edges() {
        let queue = CaptureMouseEventQueue::new(8, 2);

        for index in 0..3 {
            let _ = queue.enqueue(CaptureMouseHookEvent::Move {
                x: index as f64,
                y: 0.0,
                modifiers: modifiers(),
            });
            let _ = queue.enqueue(CaptureMouseHookEvent::OverlayContextMenu {
                x: index as f64,
                y: 1.0,
                modifiers: modifiers(),
            });
        }
        assert_eq!(queue.diagnostics().current_depth, 6);
        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::Move {
                x: 99.0,
                y: 100.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::EnqueuedAfterEvictingMove
        );
        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::Down {
                x: 101.0,
                y: 102.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::Enqueued
        );
        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::Up {
                x: 103.0,
                y: 104.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::Enqueued
        );

        let mut saw_down = false;
        let mut saw_up = false;
        while let Ok(event) = queue.try_recv() {
            match event {
                CaptureMouseHookEvent::Down { .. } => saw_down = true,
                CaptureMouseHookEvent::Up { .. } => {
                    assert!(saw_down);
                    saw_up = true;
                }
                _ => {}
            }
        }
        assert!(saw_down && saw_up);
        let diagnostics = queue.diagnostics();
        assert_eq!(diagnostics.current_depth, 0);
        assert_eq!(diagnostics.max_depth, 8);
        assert_eq!(diagnostics.evicted_moves, 1);
        assert_eq!(diagnostics.critical_overflows, 0);
    }

    #[test]
    fn bounded_mouse_queue_reports_edge_only_overflow_without_growing() {
        let queue = CaptureMouseEventQueue::new(3, 1);
        let _ = queue.enqueue(CaptureMouseHookEvent::Down {
            x: 1.0,
            y: 2.0,
            modifiers: modifiers(),
        });
        let _ = queue.enqueue(CaptureMouseHookEvent::Up {
            x: 3.0,
            y: 4.0,
            modifiers: modifiers(),
        });
        let _ = queue.enqueue(CaptureMouseHookEvent::OverlayContextMenu {
            x: 5.0,
            y: 6.0,
            modifiers: modifiers(),
        });

        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::OverlayWheel {
                x: 7.0,
                y: 8.0,
                delta_y: 120.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::CriticalOverflow
        );
        let diagnostics = queue.diagnostics();
        assert_eq!(diagnostics.current_depth, 3);
        assert_eq!(diagnostics.max_depth, 3);
        assert_eq!(diagnostics.enqueued_edges, 3);
        assert_eq!(diagnostics.critical_overflows, 1);
    }

    #[test]
    fn bounded_mouse_queue_preserves_overlay_edges_and_actions_between_move_floods() {
        let queue = CaptureMouseEventQueue::new(12, 4);
        let source = OverlayPointerSource::LowLevelHook;
        let _ = queue.enqueue(CaptureMouseHookEvent::OverlayDown {
            x: 1.0,
            y: 2.0,
            modifiers: modifiers(),
            native_drag_preflight: false,
            source,
            continuation: false,
        });
        for index in 0..1_000 {
            let _ = queue.enqueue(CaptureMouseHookEvent::OverlayMove {
                x: index as f64,
                y: 3.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            });
        }
        let _ = queue.enqueue(CaptureMouseHookEvent::OverlayWheel {
            x: 1_000.0,
            y: 4.0,
            delta_y: 120.0,
            modifiers: modifiers(),
        });
        for index in 0..1_000 {
            let _ = queue.enqueue(CaptureMouseHookEvent::OverlayMove {
                x: (1_000 + index) as f64,
                y: 5.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            });
        }
        let _ = queue.enqueue(CaptureMouseHookEvent::OverlayContextMenu {
            x: 2_000.0,
            y: 6.0,
            modifiers: modifiers(),
        });
        let _ = queue.enqueue(CaptureMouseHookEvent::OverlayUp {
            x: 2_001.0,
            y: 7.0,
            modifiers: modifiers(),
            native_drag_preflight: false,
            source,
        });

        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayDown { .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayMove { x: 999.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayWheel { delta_y: 120.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayMove { x: 1_999.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayContextMenu { .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayUp { .. })
        ));
        assert!(matches!(queue.try_recv(), Err(mpsc::TryRecvError::Empty)));
        let diagnostics = queue.diagnostics();
        assert_eq!(diagnostics.enqueued_edges, 4);
        assert_eq!(diagnostics.coalesced_moves, 1_998);
        assert_eq!(diagnostics.critical_overflows, 0);
    }

    #[test]
    fn bounded_mouse_queue_receiver_times_out_and_wakes_for_an_edge() {
        let queue = Arc::new(CaptureMouseEventQueue::new(8, 2));
        assert!(matches!(
            queue.recv_timeout(Duration::ZERO),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        let producer_queue = Arc::clone(&queue);
        let producer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(5));
            producer_queue.enqueue(CaptureMouseHookEvent::Up {
                x: 10.0,
                y: 20.0,
                modifiers: modifiers(),
            })
        });

        assert!(matches!(
            queue.recv_timeout(Duration::from_secs(1)),
            Ok(CaptureMouseHookEvent::Up {
                x: 10.0,
                y: 20.0,
                ..
            })
        ));
        assert_eq!(
            producer.join().unwrap(),
            CaptureMouseEventEnqueueResult::Enqueued
        );
    }

    #[test]
    fn double_escape_requires_two_distinct_presses_inside_the_emergency_window() {
        let started_at = Instant::now();
        let mut tracker = EmergencyEscapeTracker::default();

        assert!(!tracker.record_press(started_at));
        assert!(
            tracker.record_press(started_at + EMERGENCY_ESCAPE_WINDOW - Duration::from_millis(1))
        );

        let mut expired_tracker = EmergencyEscapeTracker::default();
        assert!(!expired_tracker.record_press(started_at));
        assert!(!expired_tracker.record_press(started_at + EMERGENCY_ESCAPE_WINDOW));
    }

    #[test]
    fn keyboard_hook_and_rdev_escape_edges_do_not_suppress_each_other() {
        let keyboard_down = AtomicBool::new(false);
        let keyboard_tracker = OnceLock::<Mutex<EmergencyEscapeTracker>>::new();
        let rdev_down = AtomicBool::new(false);
        let rdev_tracker = OnceLock::<Mutex<EmergencyEscapeTracker>>::new();

        assert!(handle_emergency_escape_transition_with(
            &keyboard_down,
            &keyboard_tracker,
            true,
            "keyboard_test",
        ));
        assert!(handle_emergency_escape_transition_with(
            &rdev_down,
            &rdev_tracker,
            true,
            "rdev_test",
        ));
        assert!(!handle_emergency_escape_transition_with(
            &keyboard_down,
            &keyboard_tracker,
            true,
            "keyboard_test",
        ));
        assert!(!handle_emergency_escape_transition_with(
            &rdev_down,
            &rdev_tracker,
            true,
            "rdev_test",
        ));
    }

    #[test]
    fn fullscreen_occlusion_suppresses_only_new_overlay_interactions() {
        assert!(should_suppress_overlay_interaction_for_occlusion(
            true, false, false, false, false,
        ));
        assert!(!should_suppress_overlay_interaction_for_occlusion(
            false, false, false, false, false,
        ));
        assert!(!should_suppress_overlay_interaction_for_occlusion(
            true, true, false, false, false,
        ));
        assert!(!should_suppress_overlay_interaction_for_occlusion(
            true, false, true, false, false,
        ));
        assert!(!should_suppress_overlay_interaction_for_occlusion(
            true, false, false, true, false,
        ));
        assert!(!should_suppress_overlay_interaction_for_occlusion(
            true, false, false, false, true,
        ));
    }

    #[test]
    fn fullscreen_coverage_requires_the_foreground_window_to_cover_the_overlay() {
        let overlay = RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        };
        assert!(rect_covers_rect_with_tolerance(
            RECT {
                left: -8,
                top: -8,
                right: 1928,
                bottom: 1088,
            },
            overlay,
            8,
        ));
        assert!(!rect_covers_rect_with_tolerance(
            RECT {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1040,
            },
            overlay,
            8,
        ));
        assert!(!rect_covers_rect_with_tolerance(
            RECT {
                left: 300,
                top: 100,
                right: 1600,
                bottom: 1000,
            },
            overlay,
            8,
        ));
    }

    #[test]
    fn foreign_alt_input_fails_open_except_during_capture_or_an_existing_drag() {
        assert!(should_passthrough_foreign_alt_input(
            true, false, false, false, false,
        ));
        assert!(!should_passthrough_foreign_alt_input(
            false, false, false, false, false,
        ));
        assert!(!should_passthrough_foreign_alt_input(
            true, true, false, false, false,
        ));
        assert!(!should_passthrough_foreign_alt_input(
            true, false, true, false, false,
        ));
        assert!(!should_passthrough_foreign_alt_input(
            true, false, false, true, false,
        ));
        assert!(!should_passthrough_foreign_alt_input(
            true, false, false, false, true,
        ));
    }

    #[test]
    fn foreign_alt_wheel_routes_only_when_the_pointer_is_over_hook() {
        assert!(!should_passthrough_foreign_alt_mouse_input(
            true, false, false, false, false, true, true,
        ));
        assert!(should_passthrough_foreign_alt_mouse_input(
            true, false, false, false, false, true, false,
        ));
        assert!(should_passthrough_foreign_alt_mouse_input(
            true, false, false, false, false, false, true,
        ));
        assert!(!should_passthrough_foreign_alt_mouse_input(
            false, false, false, false, false, true, true,
        ));
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn overlay_keyboard_hook_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code != HC_ACTION as i32 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }
    if lparam.0 == 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let keyboard = unsafe { *(lparam.0 as *const KBDLLHOOKSTRUCT) };
    let vk_code = keyboard.vkCode;
    let message = wparam.0 as u32;
    let key_pressed = matches!(message, WM_KEYDOWN | WM_SYSKEYDOWN);
    let key_released = matches!(message, WM_KEYUP | WM_SYSKEYUP);
    match message {
        WM_KEYDOWN | WM_SYSKEYDOWN => {
            update_overlay_modifier_key_state(vk_code, true);
        }
        WM_KEYUP | WM_SYSKEYUP => {
            update_overlay_modifier_key_state(vk_code, false);
        }
        _ => {}
    }

    if vk_code == VK_ESCAPE.0 as u32 {
        if key_pressed && !handle_emergency_escape_transition(true, "keyboard_hook") {
            if overlay_keyboard_capture_should_handle_current_cursor() {
                return LRESULT(1);
            }
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }
        if key_released {
            handle_emergency_escape_transition(false, "keyboard_hook");
        }
    }

    let capture_active = CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst);
    let drag_active = OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.load(Ordering::SeqCst);
    let native_drag_preflight_active =
        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
    let is_alt_key =
        vk_code == VK_MENU.0 as u32 || vk_code == VK_LMENU.0 as u32 || vk_code == VK_RMENU.0 as u32;
    if is_alt_key {
        let passthrough = key_pressed
            && should_passthrough_foreign_alt_input(
                true,
                capture_active,
                drag_active,
                native_drag_preflight_active,
                hook_process_has_foreground_window(),
            );
        set_overlay_input_shield_alt_passthrough(passthrough);
    }

    let modifiers = current_modifier_snapshot();
    if modifiers.alt_pressed
        && should_passthrough_foreign_alt_input(
            true,
            capture_active,
            drag_active,
            native_drag_preflight_active,
            hook_process_has_foreground_window(),
        )
    {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    if !overlay_keyboard_capture_should_handle_current_cursor() {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let webview_has_focus = overlay_webview_has_foreground_focus();
    match message {
        WM_KEYDOWN | WM_SYSKEYDOWN => {
            if let Some(event) = overlay_keyboard_hook_should_capture_semantic_keydown(
                vk_code,
                modifiers,
                webview_has_focus,
            ) {
                queue_overlay_keyboard_hook_event(event);
                return LRESULT(1);
            }
            // Forward sticker-selected DOM shortcuts (Tab, Shift+1, ...) only when
            // the webview lacks OS focus (so the DOM listener would miss them).
            // When focused we do nothing here: the real keydown reaches the DOM,
            // preserving normal text typing during sticker edit.
            if !webview_has_focus {
                if let Some(shortcut) = overlay_keyboard_forwardable_shortcut(vk_code, modifiers) {
                    let should_consume =
                        overlay_keyboard_should_consume_forwarded_shortcut(&shortcut);
                    queue_overlay_keyboard_hook_event(OverlayKeyboardHookEvent::Shortcut {
                        key: shortcut.key.to_string(),
                        ctrl: shortcut.ctrl,
                        shift: shortcut.shift,
                        alt: shortcut.alt,
                    });
                    if should_consume {
                        return LRESULT(1);
                    }
                }
            }
        }
        WM_KEYUP | WM_SYSKEYUP => {
            if overlay_keyboard_hook_should_capture_semantic_keyup(
                vk_code,
                modifiers,
                webview_has_focus,
            ) {
                return LRESULT(1);
            }
        }
        _ => {}
    }

    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn install_overlay_keyboard_hook_thread(window: tauri::WebviewWindow) {
    let (sender, receiver) = mpsc::sync_channel::<OverlayKeyboardHookEvent>(256);
    if OVERLAY_KEYBOARD_EVENT_SENDER.set(sender).is_err() {
        append_runtime_log_line("overlay_keyboard_hook_sender_already_initialized");
        return;
    }

    let emit_window = window.clone();
    let _ = std::thread::Builder::new()
        .name("hook-overlay-keyboard-events".to_string())
        .spawn(move || {
            while let Ok(event) = receiver.recv() {
                match event {
                    OverlayKeyboardHookEvent::Shortcut {
                        key,
                        ctrl,
                        shift,
                        alt,
                    } => {
                        append_runtime_log_line(&format!(
                            "overlay_keyboard_hook_emit :: shortcut {}",
                            key
                        ));
                        let _ = emit_window.emit(
                            "overlay/global_shortcut",
                            ForwardedShortcutPayload {
                                key,
                                ctrl_key: ctrl,
                                shift_key: shift,
                                alt_key: alt,
                            },
                        );
                    }
                    other => {
                        let event_name = match other {
                            OverlayKeyboardHookEvent::Escape => "trigger-escape",
                            OverlayKeyboardHookEvent::Delete => "trigger-delete",
                            OverlayKeyboardHookEvent::Copy => "trigger-copy",
                            OverlayKeyboardHookEvent::Paste => "trigger-paste",
                            OverlayKeyboardHookEvent::Shortcut { .. } => "",
                        };
                        append_runtime_log_line(&format!(
                            "overlay_keyboard_hook_emit :: {}",
                            event_name
                        ));
                        let _ = emit_window.emit(event_name, ());
                    }
                }
            }
        });

    let _ = std::thread::Builder::new()
        .name("hook-overlay-keyboard-hook".to_string())
        .spawn(move || {
            let hook = unsafe {
                SetWindowsHookExW(WH_KEYBOARD_LL, Some(overlay_keyboard_hook_proc), None, 0)
            };
            let Ok(hook) = hook else {
                append_runtime_log_line("overlay_keyboard_hook_install_failed");
                return;
            };

            append_runtime_log_line("overlay_keyboard_hook_installed");
            let mut msg = MSG::default();
            while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
                let _ = unsafe { TranslateMessage(&msg) };
                unsafe { DispatchMessageW(&msg) };
            }
            let _ = unsafe { UnhookWindowsHookEx(hook) };
            append_runtime_log_line("overlay_keyboard_hook_thread_exited");
        });
}

#[cfg(not(target_os = "windows"))]
fn install_overlay_keyboard_hook_thread(_window: tauri::WebviewWindow) {}

fn refresh_overlay_interactivity_for_current_cursor(
    window: &tauri::WebviewWindow,
    hit_map: &SharedHitMap,
) {
    if NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst) {
        hide_overlay_input_shield_window();
        set_overlay_click_through_impl(window, true);
        append_runtime_log_line("refresh_overlay_interactivity_native_dialog_passthrough");
        return;
    }
    if should_suppress_overlay_interaction_for_current_occlusion() {
        hide_overlay_input_shield_window();
        set_overlay_click_through_impl(window, true);
        append_runtime_log_line("refresh_overlay_interactivity_fullscreen_occlusion_passthrough");
        return;
    }

    let active = match hit_map.active.lock() {
        Ok(guard) => *guard,
        Err(_) => return,
    };

    if !active {
        return;
    }

    let (cursor_x, cursor_y) = match current_cursor_position_physical() {
        Some(position) => position,
        None => return,
    };

    let rects = match hit_map.rectangles.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => return,
    };

    let should_ignore = should_overlay_window_ignore_cursor_events(&rects, cursor_x, cursor_y);

    set_overlay_click_through_impl(window, should_ignore);
    append_runtime_log_line(&format!(
        "refresh_overlay_interactivity :: cursor_x={} cursor_y={} should_ignore={}",
        cursor_x, cursor_y, should_ignore
    ));
}

#[cfg(target_os = "windows")]
fn current_cursor_position_physical() -> Option<(f64, f64)> {
    let mut point = POINT::default();
    if unsafe { GetCursorPos(&mut point) }.is_ok() {
        Some((point.x as f64, point.y as f64))
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn current_cursor_position_physical() -> Option<(f64, f64)> {
    None
}

#[cfg(target_os = "windows")]
fn set_system_cursor_to_crosshair(cursor_id: SYSTEM_CURSOR_ID) -> bool {
    let Ok(cursor) = (unsafe { LoadCursorW(None, IDC_CROSS) }) else {
        return false;
    };
    let Ok(cursor_copy) = (unsafe { CopyIcon(HICON(cursor.0)) }) else {
        return false;
    };
    unsafe { SetSystemCursor(HCURSOR(cursor_copy.0), cursor_id) }.is_ok()
}

#[cfg(target_os = "windows")]
fn set_capture_cursor_crosshair() {
    if CAPTURE_SYSTEM_CURSOR_OVERRIDDEN.load(Ordering::SeqCst) {
        return;
    }

    let mut updated_any = false;
    for cursor_id in [
        OCR_NORMAL,
        OCR_IBEAM,
        OCR_CROSS,
        OCR_HAND,
        OCR_NO,
        OCR_SIZEALL,
        OCR_SIZENESW,
        OCR_SIZENS,
        OCR_SIZENWSE,
        OCR_SIZEWE,
        OCR_UP,
    ] {
        updated_any |= set_system_cursor_to_crosshair(cursor_id);
    }

    if updated_any {
        CAPTURE_SYSTEM_CURSOR_OVERRIDDEN.store(true, Ordering::SeqCst);
        append_runtime_log_line("capture_cursor_crosshair_enabled");
    } else {
        append_runtime_log_line("capture_cursor_crosshair_failed");
    }
}

#[cfg(not(target_os = "windows"))]
fn set_capture_cursor_crosshair() {}

#[cfg(target_os = "windows")]
fn clear_capture_cursor_crosshair() {
    if CAPTURE_SYSTEM_CURSOR_OVERRIDDEN.swap(false, Ordering::SeqCst) {
        restore_system_cursors_unconditionally();
    }
}

#[cfg(not(target_os = "windows"))]
fn clear_capture_cursor_crosshair() {}

#[cfg(target_os = "windows")]
fn restore_system_cursors_unconditionally() {
    CAPTURE_SYSTEM_CURSOR_OVERRIDDEN.store(false, Ordering::SeqCst);
    match unsafe { SystemParametersInfoW(SPI_SETCURSORS, 0, None, Default::default()) } {
        Ok(()) => append_runtime_log_line("system_cursors_restored_unconditionally"),
        Err(error) => {
            append_runtime_log_line(&format!("system_cursors_restore_failed :: {}", error))
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn restore_system_cursors_unconditionally() {}

fn prepare_for_hook_process_exit(reason: &str) {
    #[cfg(target_os = "windows")]
    {
        CAPTURE_MOUSE_HOOK_ACTIVE.store(false, Ordering::SeqCst);
        CAPTURE_MOUSE_HOOK_BUTTON_DOWN.store(false, Ordering::SeqCst);
        OVERLAY_KEYBOARD_CAPTURE_ACTIVE.store(false, Ordering::SeqCst);
        reset_overlay_pointer_session();
        OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(false, Ordering::SeqCst);
        set_overlay_input_shield_alt_passthrough(false);
        hide_overlay_input_shield_window();
    }
    restore_system_cursors_unconditionally();
    append_runtime_log_line(&format!("hook_process_exit_cleanup :: reason={}", reason));
}

fn set_capture_input_runtime_active(active: bool) {
    #[cfg(target_os = "windows")]
    {
        CAPTURE_MOUSE_HOOK_ACTIVE.store(active, Ordering::SeqCst);
        if !active {
            CAPTURE_MOUSE_HOOK_BUTTON_DOWN.store(false, Ordering::SeqCst);
        }
        append_runtime_log_line(&format!("capture_mouse_hook_active :: {}", active));
    }

    if active {
        set_capture_cursor_crosshair();
    } else {
        clear_capture_cursor_crosshair();
    }
}

#[tauri::command]
fn read_shared_memory(
    handle: String,
    size: usize,
    width: u32,
    height: u32,
) -> Result<String, String> {
    println!(
        "Backend: read_shared_memory called for '{}' with size {}, dims {}x{}",
        handle, size, width, height
    );

    // Validate dimensions and that `size` is consistent with the declared
    // RGBA buffer before mapping memory. A mismatched/oversized `size` would
    // otherwise drive an out-of-bounds slice read in `read_shm_winapi`.
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 {
        return Err("Invalid shared memory dimensions: width/height must be non-zero".to_string());
    }
    if pixels > MAX_IMAGE_PIXELS {
        return Err(format!(
            "Shared memory dimensions too large: {}x{} exceeds {} pixels",
            width, height, MAX_IMAGE_PIXELS
        ));
    }
    let expected = (pixels * 4) as usize;
    if size != expected {
        return Err(format!(
            "Shared memory size mismatch: got {} bytes, expected {} for {}x{} RGBA",
            size, expected, width, height
        ));
    }

    // Read raw RGBA bytes from shared memory
    let data = read_shm_winapi(&handle, size)?;

    println!("Backend: Read {} bytes from shared memory", data.len());

    // Convert RGBA raw bytes to PNG
    let img = image::RgbaImage::from_raw(width, height, data)
        .ok_or_else(|| "Failed to create image from raw RGBA data".to_string())?;

    let mut png_buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut png_buf, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    // Encode as Base64 and return as data URL
    let b64 = base64::engine::general_purpose::STANDARD.encode(png_buf.into_inner());
    println!("Backend: Returning PNG base64 ({} chars)", b64.len());
    Ok(format!("data:image/png;base64,{}", b64))
}

#[tauri::command]
fn save_sticker_image(
    app: tauri::AppHandle,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    let image_data = decode_base64_image_data(&base64_image)?;
    let (width, height) = image_dimensions_from_bytes(&image_data)?;

    // 1. Resolve a user-writable destination. Writing next to the executable
    //    fails when Hook is installed under Program Files (read-only) and is
    //    poor practice; persist user data under the app data dir instead.
    let app_dir = effective_app_data_dir(&app)?;
    let saved_dir = app_dir.join("saved");
    fs::create_dir_all(&saved_dir).map_err(|e| format!("Failed to create save dir: {}", e))?;

    let context =
        prepare_file_naming_context(file_naming_context, "sticker", "image", width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::StickerSave, context)?;
    let (file, file_path) = create_unique_file(&saved_dir, &stem, Some("png"))?;
    write_allocated_bytes(file, &file_path, &image_data, "write saved sticker")?;

    println!("Saved sticker to: {:?}", file_path);
    Ok(file_path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn save_sticker_image_as(
    app: tauri::AppHandle,
    base64_image: String,
    dialog_center_x: f64,
    dialog_center_y: f64,
    file_naming_context: Option<FileNamingContext>,
) -> Result<Option<String>, String> {
    let image_data = decode_base64_image_data(&base64_image)?;
    let (width, height) = image_dimensions_from_bytes(&image_data)?;
    let context =
        prepare_file_naming_context(file_naming_context, "sticker", "image", width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::StickerSave, context)?;
    let default_filename = format!("{stem}.png");
    let Some(file_path) =
        select_sticker_save_path(&app, dialog_center_x, dialog_center_y, &default_filename)?
    else {
        return Ok(None);
    };

    let mut file = File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&image_data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    let path_string = file_path.to_string_lossy().to_string();
    println!("Saved sticker via save-as dialog to: {}", path_string);
    Ok(Some(path_string))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn save_sticker_image_as(
    app: tauri::AppHandle,
    base64_image: String,
    _dialog_center_x: f64,
    _dialog_center_y: f64,
    file_naming_context: Option<FileNamingContext>,
) -> Result<Option<String>, String> {
    save_sticker_image(app, base64_image, file_naming_context).map(Some)
}

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

    if !file_path.exists() {
        let mut file = File::create(&file_path).map_err(|e| e.to_string())?;
        file.write_all(&image_data).map_err(|e| e.to_string())?;
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

#[cfg(target_os = "windows")]
fn variant_i4(value: i32) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_I4,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: VARIANT_0_0_0 { lVal: value },
            }),
        },
    }
}

#[cfg(target_os = "windows")]
fn percent_decode_utf8(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let raw = input.as_bytes();
    let mut index = 0;
    while index < raw.len() {
        if raw[index] == b'%' && index + 2 < raw.len() {
            if let Ok(hex) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                bytes.push(hex);
                index += 3;
                continue;
            }
        }
        bytes.push(raw[index]);
        index += 1;
    }
    String::from_utf8_lossy(&bytes).to_string()
}

#[cfg(target_os = "windows")]
fn path_from_file_url(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("file://")?;
    let (host, path_part) = if let Some((host, path)) = rest.split_once('/') {
        (host, format!("/{}", path))
    } else {
        ("", String::new())
    };
    let decoded_path = percent_decode_utf8(&path_part);
    let path = if host.is_empty() {
        let without_leading_slash = if decoded_path.len() >= 3
            && decoded_path.as_bytes().first() == Some(&b'/')
            && decoded_path.as_bytes().get(2) == Some(&b':')
        {
            &decoded_path[1..]
        } else {
            decoded_path.as_str()
        };
        without_leading_slash.replace('/', "\\")
    } else {
        format!(
            "\\\\{}{}",
            percent_decode_utf8(host),
            decoded_path.replace('/', "\\")
        )
    };
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

#[cfg(target_os = "windows")]
fn point_in_rect(x: i32, y: i32, rect: &RECT) -> bool {
    x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
}

#[cfg(target_os = "windows")]
fn explorer_folder_candidates_at_point(x: i32, y: i32) -> Vec<(PathBuf, i64, bool)> {
    let mut candidates = Vec::new();
    let point = POINT { x, y };
    let point_root = unsafe {
        let hwnd = WindowFromPoint(point);
        if hwnd.0.is_null() {
            HWND(std::ptr::null_mut())
        } else {
            GetAncestor(hwnd, GA_ROOT)
        }
    };

    let com_initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok() };
    let shell_windows =
        unsafe { CoCreateInstance::<_, IShellWindows>(&ShellWindows, None, CLSCTX_ALL) };
    let Ok(shell_windows) = shell_windows else {
        if com_initialized {
            unsafe { CoUninitialize() };
        }
        return candidates;
    };

    let count = unsafe { shell_windows.Count().unwrap_or(0) };
    for index in 0..count {
        let item_variant = variant_i4(index);
        let Ok(dispatch) = (unsafe { shell_windows.Item(&item_variant) }) else {
            continue;
        };
        let Ok(browser) = dispatch.cast::<IWebBrowser2>() else {
            continue;
        };
        let Ok(shell_hwnd) = (unsafe { browser.HWND() }) else {
            continue;
        };
        let hwnd = HWND(shell_hwnd.0 as *mut _);
        if hwnd.0.is_null() {
            continue;
        }
        let mut rect = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() || !point_in_rect(x, y, &rect) {
            continue;
        }
        let Ok(location_url) = (unsafe { browser.LocationURL() }) else {
            continue;
        };
        let Some(folder_path) = path_from_file_url(&location_url.to_string()) else {
            continue;
        };
        if !folder_path.is_dir() {
            continue;
        }
        let area = i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top);
        candidates.push((
            folder_path,
            area,
            !point_root.0.is_null() && point_root == hwnd,
        ));
    }

    if com_initialized {
        unsafe { CoUninitialize() };
    }
    candidates
}

#[cfg(target_os = "windows")]
fn window_class_name_at_point(x: i32, y: i32) -> Option<String> {
    let hwnd = unsafe { WindowFromPoint(POINT { x, y }) };
    if hwnd.0.is_null() {
        return None;
    }
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let target = if root.0.is_null() { hwnd } else { root };
    let mut buffer = [0u16; 256];
    let len = unsafe { GetClassNameW(target, &mut buffer) };
    if len <= 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..len as usize]))
}

#[cfg(target_os = "windows")]
fn desktop_dir_for_drag_export() -> Option<PathBuf> {
    dirs::desktop_dir().filter(|path| path.is_dir())
}

#[cfg(target_os = "windows")]
fn explorer_child_folder_at_point(x: i32, y: i32, parent_dir: &Path) -> Option<PathBuf> {
    let automation = UIAutomation::new().ok()?;
    let element = automation.element_from_point(UiaPoint::new(x, y)).ok()?;
    let name = element.get_name().ok()?;
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.contains('\\') || trimmed.contains('/') {
        return None;
    }
    let candidate = parent_dir.join(trimmed);
    if candidate.is_dir() {
        Some(candidate)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn resolve_drag_export_target_dir(global_x: f64, global_y: f64) -> Result<PathBuf, String> {
    let x = global_x.round() as i32;
    let y = global_y.round() as i32;
    let mut candidates = explorer_folder_candidates_at_point(x, y);
    candidates.sort_by_key(|(_, area, root_match)| (!*root_match, *area));
    if let Some((path, _, root_match)) = candidates.into_iter().next() {
        if let Some(child_folder) = explorer_child_folder_at_point(x, y, &path) {
            append_runtime_log_line(&format!(
                "sticker_drag_export_target_explorer_child :: x={} y={} rootMatch={} parent={} path={}",
                x,
                y,
                root_match,
                path.to_string_lossy(),
                child_folder.to_string_lossy()
            ));
            return Ok(child_folder);
        }
        append_runtime_log_line(&format!(
            "sticker_drag_export_target_explorer :: x={} y={} rootMatch={} path={}",
            x,
            y,
            root_match,
            path.to_string_lossy()
        ));
        return Ok(path);
    }

    let class_name = window_class_name_at_point(x, y).unwrap_or_else(|| "unknown".to_string());
    if matches!(
        class_name.as_str(),
        "Progman" | "WorkerW" | "SHELLDLL_DefView" | "SysListView32"
    ) {
        if let Some(desktop) = desktop_dir_for_drag_export() {
            append_runtime_log_line(&format!(
                "sticker_drag_export_target_desktop :: x={} y={} class={} path={}",
                x,
                y,
                class_name,
                desktop.to_string_lossy()
            ));
            return Ok(desktop);
        }
    }

    append_runtime_log_line(&format!(
        "sticker_drag_export_target_missing :: x={} y={} class={}",
        x, y, class_name
    ));
    Err(format!(
        "No Explorer folder found under release cursor ({}, {})",
        x, y
    ))
}

#[cfg(target_os = "windows")]
fn prepare_drag_export_context(
    file_naming_context: Option<FileNamingContext>,
    source_path: Option<&Path>,
    width: u32,
    height: u32,
) -> FileNamingContext {
    let fallback_label = source_path
        .and_then(|path| path.file_stem())
        .and_then(|stem| stem.to_str())
        .unwrap_or("image");
    prepare_file_naming_context(
        file_naming_context,
        "sticker",
        fallback_label,
        width,
        height,
    )
}

#[cfg(target_os = "windows")]
fn notify_shell_path_changed(path: &Path) {
    use std::os::windows::ffi::OsStrExt;

    let notify_path = |event, target: &Path| {
        let wide_path: Vec<u16> = target
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            SHChangeNotify(
                event,
                SHCNF_PATHW | SHCNF_FLUSHNOWAIT,
                Some(wide_path.as_ptr() as *const core::ffi::c_void),
                None,
            );
        }
    };

    notify_path(SHCNE_UPDATEITEM, path);
    if let Some(parent) = path.parent() {
        notify_path(SHCNE_UPDATEDIR, parent);
    }
}

#[cfg(target_os = "windows")]
fn write_drag_export_bytes(
    app: &tauri::AppHandle,
    image_data: &[u8],
    file_naming_context: Option<FileNamingContext>,
    global_x: f64,
    global_y: f64,
) -> Result<String, String> {
    let target_dir = resolve_drag_export_target_dir(global_x, global_y)?;
    let (width, height) = image_dimensions_from_bytes(image_data)?;
    let context = prepare_drag_export_context(file_naming_context, None, width, height);
    let stem = render_user_file_stem(app, FileNamingPatternKind::DragExport, context)?;
    let (file, target_path) = create_unique_file(&target_dir, &stem, Some("png"))?;
    write_allocated_bytes(file, &target_path, image_data, "write drag export file")?;
    let path_string = target_path.to_string_lossy().to_string();
    append_runtime_log_line(&format!(
        "sticker_drag_export_saved :: path={}",
        path_string
    ));
    notify_shell_path_changed(&target_path);
    Ok(path_string)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn save_sticker_drag_export(
    app: tauri::AppHandle,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
    global_x: f64,
    global_y: f64,
) -> Result<String, String> {
    let image_data = decode_base64_image_data(&base64_image)?;
    write_drag_export_bytes(&app, &image_data, file_naming_context, global_x, global_y)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn save_sticker_drag_export(
    app: tauri::AppHandle,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
    _global_x: f64,
    _global_y: f64,
) -> Result<String, String> {
    save_sticker_image(app, base64_image, file_naming_context)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn save_sticker_drag_export_from_path(
    app: tauri::AppHandle,
    path: String,
    file_naming_context: Option<FileNamingContext>,
    global_x: f64,
    global_y: f64,
) -> Result<String, String> {
    let source_path = PathBuf::from(&path);
    if !source_path.is_file() {
        return Err(format!(
            "Sticker drag export source is not a file: {}",
            path
        ));
    }
    let target_dir = resolve_drag_export_target_dir(global_x, global_y)?;
    let (width, height) = image::image_dimensions(&source_path)
        .map_err(|e| format!("Failed to read drag export image dimensions: {}", e))?;
    let context =
        prepare_drag_export_context(file_naming_context, Some(&source_path), width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::DragExport, context)?;
    let extension = source_path
        .extension()
        .and_then(|extension| extension.to_str());
    let (mut target_file, target_path) = create_unique_file(&target_dir, &stem, extension)?;
    let mut source_file =
        File::open(&source_path).map_err(|e| format!("Failed to open drag export file: {}", e))?;
    if let Err(error) = std::io::copy(&mut source_file, &mut target_file) {
        drop(target_file);
        let _ = fs::remove_file(&target_path);
        return Err(format!("Failed to copy drag export file: {}", error));
    }
    let path_string = target_path.to_string_lossy().to_string();
    append_runtime_log_line(&format!(
        "sticker_drag_export_copied :: source={} target={}",
        source_path.to_string_lossy(),
        path_string
    ));
    notify_shell_path_changed(&target_path);
    Ok(path_string)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn save_sticker_drag_export_from_path(
    path: String,
    _file_naming_context: Option<FileNamingContext>,
    _global_x: f64,
    _global_y: f64,
) -> Result<String, String> {
    Ok(path)
}

#[cfg(target_os = "windows")]
fn start_native_file_drag_on_ui_thread(
    window: tauri::WebviewWindow,
    file_path: PathBuf,
    hit_map: SharedHitMap,
) -> Result<(), String> {
    reset_overlay_pointer_session();
    OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(false, Ordering::SeqCst);
    NATIVE_FILE_DRAG_ACTIVE.store(true, Ordering::SeqCst);
    hide_overlay_input_shield_window();
    let _ = window.set_ignore_cursor_events(true);
    set_overlay_transparent_style(&window, true);
    OVERLAY_CLICK_THROUGH_ACTIVE.store(true, Ordering::SeqCst);
    apply_overlay_no_activate(&window);
    append_runtime_log_line("native_drag_overlay_clickthrough :: true");
    append_runtime_log_line(&format!(
        "native_drag_start :: path={}",
        cache_file_name_for_log(&file_path)
    ));
    let drag_outcome = Arc::new(std::sync::Mutex::new(None));
    let drag_outcome_slot = Arc::clone(&drag_outcome);
    let drag_result = drag::start_drag(
        &window,
        drag::DragItem::Files(vec![file_path.clone()]),
        drag::Image::File(file_path),
        move |outcome| {
            if let Ok(mut guard) = drag_outcome_slot.lock() {
                *guard = Some(outcome);
            }
        },
        drag::Options {
            mode: drag::DragMode::Copy,
            ..Default::default()
        },
    )
    .map_err(|error| format!("Failed to start native drag: {}", error));
    NATIVE_FILE_DRAG_ACTIVE.store(false, Ordering::SeqCst);
    refresh_overlay_interactivity_for_current_cursor(&window, &hit_map);
    sync_overlay_input_shield_from_runtime_state(&window);
    append_runtime_log_line("native_drag_overlay_restored");
    drag_result?;
    if let Ok(guard) = drag_outcome.lock() {
        if let Some(drag_outcome) = *guard {
            append_runtime_log_line(&format!(
                "native_drag_result :: result={:?} effect={} hresult={} cursor_x={} cursor_y={}",
                drag_outcome.result,
                drag_outcome.performed_effect.unwrap_or(0),
                drag_outcome.platform_status.unwrap_or(0),
                drag_outcome.cursor_position.x,
                drag_outcome.cursor_position.y
            ));
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn start_native_file_drag(
    window: tauri::WebviewWindow,
    file_path: PathBuf,
    hit_map: &SharedHitMap,
) -> Result<(), String> {
    if is_main_ui_thread() {
        return start_native_file_drag_on_ui_thread(window, file_path, hit_map.clone());
    }

    append_runtime_log_line(&format!(
        "native_drag_main_thread_dispatch :: current={:?} main={:?}",
        std::thread::current().id(),
        MAIN_UI_THREAD_ID.get()
    ));

    let (drag_completion_sender, drag_completion_receiver) =
        mpsc::sync_channel::<Result<(), String>>(1);
    let window_for_main = window.clone();
    let file_path_for_main = file_path.clone();
    let hit_map_for_main = hit_map.clone();

    window
        .run_on_main_thread(move || {
            let result = start_native_file_drag_on_ui_thread(
                window_for_main,
                file_path_for_main,
                hit_map_for_main,
            );
            let _ = drag_completion_sender.send(result);
        })
        .map_err(|error| format!("Failed to dispatch native drag to main thread: {}", error))?;

    drag_completion_receiver
        .recv()
        .map_err(|_| "Main-thread native drag completion channel closed".to_string())?
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn begin_sticker_native_file_drag(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    hit_map: tauri::State<'_, SharedHitMap>,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    let image_data = decode_base64_image_data(&base64_image)?;
    let (width, height) = image_dimensions_from_bytes(&image_data)?;
    let cache_dir = ensure_clipboard_cache_dir()?;
    let context = prepare_drag_export_context(file_naming_context, None, width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::DragExport, context)?;
    let (file, file_path) = create_unique_file(&cache_dir, &stem, Some("png"))?;
    write_allocated_bytes(file, &file_path, &image_data, "write native drag file")?;

    let staged_drag_file = stage_drag_out_file_copy(&file_path, Some(&stem))?;
    let drag_result = start_native_file_drag(window, staged_drag_file.clone(), hit_map.inner());
    cleanup_staged_drag_file(&staged_drag_file);
    drag_result?;
    Ok(file_path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn begin_sticker_native_file_drag_from_path(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    hit_map: tauri::State<'_, SharedHitMap>,
    path: String,
    file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    let file_path = PathBuf::from(path.clone());
    let metadata =
        fs::metadata(&file_path).map_err(|e| format!("Failed to stat drag source file: {}", e))?;
    if !metadata.is_file() {
        return Err("Drag source path is not a regular file".to_string());
    }
    // Restrict direct path drag-out to files Hook itself staged in the clipboard
    // cache. The frontend falls back to a freshly rendered cache drag for any
    // external file path instead of widening this command to arbitrary disk files.
    if !path_is_within(&file_path, &clipboard_cache_dir()) {
        return Err("Drag source must be inside Hook's clipboard cache".to_string());
    }
    let (width, height) = image::image_dimensions(&file_path)
        .map_err(|e| format!("Failed to read native drag image dimensions: {}", e))?;
    let context = prepare_drag_export_context(file_naming_context, Some(&file_path), width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::DragExport, context)?;
    let staged_drag_file = stage_drag_out_file_copy(&file_path, Some(&stem))?;
    let drag_result = start_native_file_drag(window, staged_drag_file.clone(), hit_map.inner());
    cleanup_staged_drag_file(&staged_drag_file);
    drag_result?;
    Ok(path)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn begin_sticker_native_file_drag(
    _window: tauri::WebviewWindow,
    _hit_map: tauri::State<'_, SharedHitMap>,
    _base64_image: String,
    _file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    Err("Native sticker file drag is only supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn begin_sticker_native_file_drag_from_path(
    _window: tauri::WebviewWindow,
    _hit_map: tauri::State<'_, SharedHitMap>,
    _path: String,
    _file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    Err("Native sticker file drag from path is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn copy_node_image_to_clipboard(
    app: tauri::AppHandle,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    use clipboard_win::{formats, Clipboard, Setter};

    let image_data = decode_base64_image_data(&base64_image)?;
    let (width, height) = image_dimensions_from_bytes(&image_data)?;
    let cache_dir = ensure_clipboard_cache_dir()?;
    let context = prepare_file_naming_context(file_naming_context, "art", "art", width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::ClipboardFile, context)?;
    let (file, file_path) = create_unique_file(&cache_dir, &stem, Some("png"))?;
    write_allocated_bytes(file, &file_path, &image_data, "write Art clipboard file")?;

    let path_string = file_path.to_string_lossy().to_string();

    // 5. Write to Clipboard (CF_HDROP)
    let _clip = Clipboard::new_attempts(10).map_err(|e| format!("Clipboard open failed: {}", e))?;

    // formats::FileList expect a Vec<String>
    let paths = vec![path_string.clone()];

    formats::FileList
        .write_clipboard(&paths)
        .map_err(|e| format!("Clipboard write file list failed: {}", e))?;

    println!(
        "Copied file to clipboard cache: {}",
        cache_file_name_for_log(&file_path)
    );
    Ok(path_string)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn copy_node_image_to_clipboard(
    _base64_image: String,
    _file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    Err("File Copy not supported on non-Windows OS".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn copy_sticker_image_to_smart_clipboard(
    app: tauri::AppHandle,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    // Publish both clipboard representations from one command:
    // browsers/rich editors read the image formats, Explorer reads CF_HDROP.
    let image_data = decode_base64_image_data(&base64_image)?;

    let img =
        image::load_from_memory(&image_data).map_err(|e| format!("Image load failed: {}", e))?;

    let cache_dir = ensure_clipboard_cache_dir()?;

    let context = prepare_file_naming_context(
        file_naming_context,
        "sticker",
        "image",
        img.width(),
        img.height(),
    );
    let stem = render_user_file_stem(&app, FileNamingPatternKind::ClipboardFile, context)?;
    let (file, file_path) = create_unique_file(&cache_dir, &stem, Some("png"))?;
    write_allocated_bytes(
        file,
        &file_path,
        &image_data,
        "write sticker clipboard file",
    )?;

    let rgba = img.to_rgba8();
    let width = rgba.width() as usize;
    let height = rgba.height() as usize;
    let raw_bytes = rgba.into_raw();

    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard init failed: {}", e))?;
    let clipboard_image = arboard::ImageData {
        width,
        height,
        bytes: std::borrow::Cow::Owned(raw_bytes),
    };

    clipboard
        .set()
        .image(clipboard_image)
        .map_err(|e| format!("Clipboard image write failed: {}", e))?;
    clipboard
        .set()
        .file_list(&[file_path.as_path()])
        .map_err(|e| format!("Clipboard file-list write failed: {}", e))?;

    let path_string = file_path.to_string_lossy().to_string();
    println!(
        "Copied smart image/file clipboard cache payload: {}",
        cache_file_name_for_log(&file_path)
    );
    Ok(path_string)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn copy_sticker_image_to_smart_clipboard(
    base64_image: String,
    _file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    copy_to_clipboard(base64_image)?;
    Ok("image clipboard only; file-list paste is Windows-only".to_string())
}

#[tauri::command]
fn copy_to_clipboard(base64_image: String) -> Result<(), String> {
    let image_bytes = decode_base64_image_data(&base64_image)?;

    // 3. Load Image to identify format/dimensions
    let img =
        image::load_from_memory(&image_bytes).map_err(|e| format!("Image load failed: {}", e))?;

    let rgba = img.to_rgba8();
    let width = rgba.width() as usize;
    let height = rgba.height() as usize;
    let raw_bytes = rgba.into_raw();

    // 4. Write to Clipboard
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard init failed: {}", e))?;

    let image_data = arboard::ImageData {
        width,
        height,
        bytes: std::borrow::Cow::Owned(raw_bytes),
    };

    clipboard
        .set_image(image_data)
        .map_err(|e| format!("Clipboard write failed: {}", e))?;

    println!("Image copied to system clipboard");
    Ok(())
}

#[tauri::command]
fn update_pin_rects(
    app: tauri::AppHandle,
    state: tauri::State<SharedHitMap>,
    rects: Vec<mouse_monitor::Rect>,
) {
    let active = state.active.lock().map(|guard| *guard).unwrap_or(false);
    if let Ok(mut rectangles) = state.rectangles.lock() {
        *rectangles = rects.clone();
    } else {
        append_runtime_log_line("update_pin_rects_lock_failed");
        return;
    }
    if let Ok(mut overlay_rectangles) = overlay_mouse_hit_map().lock() {
        *overlay_rectangles = rects.clone();
    }

    if let Some(window) = app.get_webview_window("main") {
        sync_overlay_input_shield_region(&window, &rects, active);
        refresh_overlay_interactivity_for_current_cursor(&window, &state);
    }
}

#[tauri::command]
fn set_mouse_monitor_active(
    app: tauri::AppHandle,
    state: tauri::State<SharedHitMap>,
    active: bool,
) {
    if let Ok(mut state_active) = state.active.lock() {
        *state_active = active;
    } else {
        append_runtime_log_line("set_mouse_monitor_active_lock_failed");
        return;
    }
    OVERLAY_MOUSE_HIT_MAP_ACTIVE.store(active, Ordering::SeqCst);
    if !active {
        reset_overlay_pointer_session();
    }

    // Capture selection is driven by the backend global input hook. Keep the
    // caller in charge of hit-testing so capture mode can remain click-through
    // and avoid placing an interactive transparent WebView over video surfaces.
    if let Some(window) = app.get_webview_window("main") {
        let rects = state
            .rectangles
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default();
        sync_overlay_input_shield_region(&window, &rects, active);
        if active {
            refresh_overlay_interactivity_for_current_cursor(&window, &state);
        }
    }
}

#[tauri::command]
fn get_cursor_position(app: tauri::AppHandle) -> Result<PhysicalPosition<f64>, String> {
    if let Some(window) = app.get_webview_window("main") {
        window.cursor_position().map_err(|e| e.to_string())
    } else {
        Err("Window not found".to_string())
    }
}

#[tauri::command]
fn trigger_ocr_event(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.emit("trigger-ocr", ()).map_err(|e| e.to_string())?;
        return Ok(());
    }

    Err("Window not found".to_string())
}

fn mime_from_image_format(format: image::ImageFormat) -> Option<&'static str> {
    match format {
        image::ImageFormat::Png => Some("image/png"),
        image::ImageFormat::Jpeg => Some("image/jpeg"),
        image::ImageFormat::WebP => Some("image/webp"),
        image::ImageFormat::Bmp => Some("image/bmp"),
        image::ImageFormat::Gif => Some("image/gif"),
        _ => None,
    }
}

fn mime_from_image_path(path: &Path, bytes: &[u8]) -> &'static str {
    if let Some(mime) = image::guess_format(bytes)
        .ok()
        .and_then(mime_from_image_format)
    {
        return mime;
    }

    if let Some(mime) = image::ImageFormat::from_path(path)
        .ok()
        .and_then(mime_from_image_format)
    {
        return mime;
    }

    let lower = path.to_string_lossy().to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".bmp") {
        "image/bmp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else {
        "image/png"
    }
}

#[tauri::command]
fn read_image_from_path(path: String) -> Result<String, String> {
    println!("Backend: Reading image from path: {}", path);

    // Bound the read: refuse files above the encoded-image limit before
    // loading them into memory. This keeps the command a bounded image reader
    // rather than an arbitrary file-read primitive.
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to stat file: {}", e))?;
    if !metadata.is_file() {
        return Err("Path is not a regular file".to_string());
    }
    if metadata.len() > MAX_BASE64_IMAGE_ENCODED_BYTES as u64 {
        return Err(format!(
            "Image file too large: {} bytes exceeds limit {}",
            metadata.len(),
            MAX_BASE64_IMAGE_ENCODED_BYTES
        ));
    }

    // 1. Read Bytes
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    // 2. Require the bytes to be a decodable image within pixel limits.
    //    Rejects non-image files so this cannot be used to exfiltrate
    //    arbitrary local content as base64.
    validate_image_data_limits(&bytes)?;

    // 3. Encode Base64
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    // 4. Determine MIME from the actual image bytes first, then fall back to the path.
    let mime = mime_from_image_path(Path::new(&path), &bytes);

    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
async fn cache_remote_image_asset(
    app: tauri::AppHandle,
    url: String,
    referer: Option<String>,
) -> Result<String, String> {
    let normalized_url = url.trim().to_string();
    if normalized_url.is_empty() {
        return Err("Remote image URL is required".to_string());
    }

    let lower = normalized_url.to_ascii_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return Err("Only http/https remote image URLs are supported".to_string());
    }

    let cache_dir = ensure_image_search_cache_dir(&app)?;
    if let Some(existing_path) = find_cached_remote_image_path(&cache_dir, &normalized_url)? {
        return Ok(existing_path.to_string_lossy().to_string());
    }

    let normalized_referer = referer
        .as_deref()
        .map(str::trim)
        .filter(|value| looks_like_remote_url(value))
        .map(str::to_owned);
    let (content_type, bytes) = match download_remote_image_bytes_with_reqwest(
        &normalized_url,
        normalized_referer.as_deref(),
    )
    .await
    {
        Ok(result) => result,
        Err(reqwest_error) => {
            #[cfg(target_os = "windows")]
            {
                append_runtime_log_line(&format!(
                    "image_search_cache_reqwest_failed :: url={} error={}",
                    normalized_url, reqwest_error
                ));
                download_remote_image_bytes_with_powershell_httpclient(
                    &normalized_url,
                    normalized_referer.as_deref(),
                )
                .map_err(|powershell_error| {
                    format!("{}; fallback failed: {}", reqwest_error, powershell_error)
                })?
            }
            #[cfg(not(target_os = "windows"))]
            {
                return Err(reqwest_error);
            }
        }
    };
    if bytes.len() > MAX_BASE64_IMAGE_ENCODED_BYTES {
        return Err(format!(
            "Remote image payload too large: {} bytes exceeds limit {}",
            bytes.len(),
            MAX_BASE64_IMAGE_ENCODED_BYTES
        ));
    }

    validate_image_data_limits(bytes.as_ref())?;

    let extension =
        remote_image_cache_extension(&normalized_url, bytes.as_ref(), content_type.as_deref());
    let target_path = cache_dir.join(format!(
        "remote_{}.{}",
        remote_image_cache_key(&normalized_url),
        extension
    ));
    fs::write(&target_path, bytes.as_slice())
        .map_err(|e| format!("Failed to write cached remote image: {}", e))?;
    append_runtime_log_line(&format!(
        "image_search_cache_saved :: file={} bytes={}",
        cache_file_name_for_log(&target_path),
        bytes.len()
    ));

    Ok(target_path.to_string_lossy().to_string())
}

// --- Persistence ---

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")] // Match frontend naming convention
pub struct SimpleRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimplePoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StickerData {
    pub id: String,
    pub src: String, // Can be Base64 or File Path
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub minified: Option<bool>,
    pub saved_rect: Option<SimpleRect>,
    pub crop_offset: Option<SimplePoint>,
    pub opacity_normal: Option<f64>,
    pub opacity_mini: Option<f64>,
    #[serde(rename = "type")]
    pub node_type: Option<String>,
    #[serde(rename = "artId")]
    pub art_id: Option<String>,
    pub params: Option<serde_json::Value>, // Store params as JSON value
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    #[serde(rename = "previewSrc")]
    pub preview_src: Option<String>, // Processed image result
    #[serde(rename = "originWorkflowId")]
    pub origin_workflow_id: Option<String>,
    #[serde(rename = "originNodeId")]
    pub origin_node_id: Option<String>,
    #[serde(rename = "executionConfig")]
    pub execution_config: Option<serde_json::Value>,
    #[serde(rename = "annotationState")]
    pub annotation_state: Option<serde_json::Value>,
    #[serde(rename = "imageEditState")]
    pub image_edit_state: Option<serde_json::Value>,
    #[serde(rename = "stickerEditPropagation")]
    pub sticker_edit_propagation: Option<serde_json::Value>,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
    #[serde(rename = "captureMeta")]
    pub capture_meta: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkData {
    pub id: String,
    pub from_unit_id: String,
    pub from_port_id: String,
    pub to_unit_id: String,
    pub to_port_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FrozenStickerEntry {
    pub entry_id: String,
    pub source_sticker_id: String,
    pub created_at: String,
    pub snapshot: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveNodeIndex {
    pub sticker_id: String,
    pub updated_at: String,
    pub src: Option<String>,
    pub preview_src: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveWorkflowIndex {
    pub updated_at: String,
    #[serde(default)]
    pub nodes: std::collections::BTreeMap<String, WorkflowAssetArchiveNodeIndex>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveIndex {
    pub version: u32,
    #[serde(default)]
    pub workflows: std::collections::BTreeMap<String, WorkflowAssetArchiveWorkflowIndex>,
}

impl Default for WorkflowAssetArchiveIndex {
    fn default() -> Self {
        Self {
            version: 1,
            workflows: std::collections::BTreeMap::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveNodeHint {
    pub sticker_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveWorkflowHint {
    #[serde(default)]
    pub nodes: std::collections::BTreeMap<String, WorkflowAssetArchiveNodeHint>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveHints {
    #[serde(default)]
    pub workflows: std::collections::BTreeMap<String, WorkflowAssetArchiveWorkflowHint>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub stickers: Vec<StickerData>,
    pub links: Vec<LinkData>,
    #[serde(default)]
    pub groups: Vec<serde_json::Value>,
    #[serde(default)]
    pub recycle_bin: Vec<FrozenStickerEntry>,
    #[serde(default)]
    pub reference_library: Vec<FrozenStickerEntry>,
    #[serde(default)]
    pub workflow_asset_archive_index: WorkflowAssetArchiveIndex,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenColorSample {
    pub hex: String,
    pub rgb: ScreenColorRgb,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenColorRgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[tauri::command]
async fn get_precise_selection(
    _app: tauri::AppHandle,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<Option<SimpleRect>, String> {
    #[cfg(target_os = "windows")]
    {
        // Offload to a blocking thread to avoid freezing the main UI thread.
        // Tokio's spawn_blocking handles the thread pool.
        let result = tokio::task::spawn_blocking(move || {
            println!(
                "[Precise] get_precise_selection: ({}, {}, {}, {})",
                x, y, w, h
            );

            // Initialization
            let automation = match UIAutomation::new() {
                Ok(a) => a,
                Err(e) => {
                    println!("[Precise] ERROR: UIAutomation init failed: {}", e);
                    return None;
                }
            };

            // Define User Selection Rect
            let sel_left = x as i32;
            let sel_top = y as i32;
            let sel_right = (x + w) as i32;
            let sel_bottom = (y + h) as i32;
            let center_x = x as i32 + (w as i32 / 2);
            let center_y = y as i32 + (h as i32 / 2);

            let root = automation.get_root_element().ok()?;
            let walker = automation.get_control_view_walker().ok()?;

            // Walk top-level windows
            let mut target_window = None;
            let mut child = walker.get_first_child(&root);
            while let Ok(ref w) = child {
                if let Ok(rect) = w.get_bounding_rectangle() {
                    // Check intersection with center
                    if center_x >= rect.get_left()
                        && center_x <= rect.get_right()
                        && center_y >= rect.get_top()
                        && center_y <= rect.get_bottom()
                    {
                        let pid = w.get_process_id().unwrap_or(0);
                        let my_pid = std::process::id();

                        if pid != my_pid {
                            target_window = Some(w.clone());
                            break;
                        }
                    }
                }
                child = walker.get_next_sibling(w);
            }

            let search_root = target_window.unwrap_or(root);

            // Now Find All Descendants of this window that are FULLY contained in selection
            let mut contained_rects = Vec::new();

            // DFS Helper
            let mut stack = vec![search_root];
            let mut count = 0;

            while let Some(el) = stack.pop() {
                count += 1;
                if count > 5000 {
                    println!(
                        "[Precise] Warning: Element limit reached (5000). Stopping traversal."
                    );
                    break;
                }

                let mut should_descend = true;

                if let Ok(rect) = el.get_bounding_rectangle() {
                    let r_left = rect.get_left();
                    let r_top = rect.get_top();
                    let r_right = rect.get_right();
                    let r_bottom = rect.get_bottom();

                    // Check containment (Match)
                    if r_left >= sel_left
                        && r_right <= sel_right
                        && r_top >= sel_top
                        && r_bottom <= sel_bottom
                    {
                        let r_w = r_right - r_left;
                        let r_h = r_bottom - r_top;

                        // Fully contained!
                        if r_w > 0 && r_h > 0 {
                            // Valid rect
                            contained_rects.push(SimpleRect {
                                x: r_left as f64,
                                y: r_top as f64,
                                w: r_w as f64,
                                h: r_h as f64,
                            });
                            should_descend = false;
                        }
                    }

                    if r_right < sel_left
                        || r_left > sel_right
                        || r_bottom < sel_top
                        || r_top > sel_bottom
                    {
                        should_descend = false;
                    }
                }

                if should_descend {
                    if let Ok(child_walker) = automation.get_control_view_walker() {
                        if let Ok(first_child) = child_walker.get_first_child(&el) {
                            stack.push(first_child.clone());

                            let mut current_sibling = first_child;
                            while let Ok(next) = child_walker.get_next_sibling(&current_sibling) {
                                stack.push(next.clone());
                                current_sibling = next;
                            }
                        }
                    }
                }
            }

            if contained_rects.is_empty() {
                return None;
            }

            // Compute Union of all contained rects
            let mut min_x = f64::MAX;
            let mut min_y = f64::MAX;
            let mut max_x = f64::MIN;
            let mut max_y = f64::MIN;

            for r in contained_rects {
                if r.x < min_x {
                    min_x = r.x;
                }
                if r.y < min_y {
                    min_y = r.y;
                }
                if (r.x + r.w) > max_x {
                    max_x = r.x + r.w;
                }
                if (r.y + r.h) > max_y {
                    max_y = r.y + r.h;
                }
            }

            Some(SimpleRect {
                x: min_x,
                y: min_y,
                w: max_x - min_x,
                h: max_y - min_y,
            })
        })
        .await
        .unwrap_or(None);

        Ok(result)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[tauri::command]
async fn pick_screen_color_at_cursor() -> Result<ScreenColorSample, String> {
    let (x, y) = current_cursor_position_physical()
        .ok_or_else(|| "Cursor position unavailable".to_string())?;
    sample_screen_color_physical(x.round() as i32, y.round() as i32)
}

#[cfg(target_os = "windows")]
fn sample_screen_color_physical(x: i32, y: i32) -> Result<ScreenColorSample, String> {
    use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};

    let screen_dc = unsafe { GetDC(None) };
    if screen_dc.is_invalid() {
        return Err("Screen DC unavailable".to_string());
    }

    let color = unsafe { GetPixel(screen_dc, x, y) };
    unsafe {
        ReleaseDC(None, screen_dc);
    }

    if color.0 == u32::MAX {
        return Err("Screen pixel unavailable".to_string());
    }

    let raw = color.0;
    let r = (raw & 0x0000_00ff) as u8;
    let g = ((raw & 0x0000_ff00) >> 8) as u8;
    let b = ((raw & 0x00ff_0000) >> 16) as u8;

    Ok(ScreenColorSample {
        hex: format!("#{r:02x}{g:02x}{b:02x}"),
        rgb: ScreenColorRgb { r, g, b },
    })
}

#[cfg(not(target_os = "windows"))]
fn sample_screen_color_physical(_x: i32, _y: i32) -> Result<ScreenColorSample, String> {
    Err("Screen color picking is only supported on Windows".to_string())
}

#[tauri::command]
fn pick_screen_color_at(x: f64, y: f64) -> Result<ScreenColorSample, String> {
    sample_screen_color_physical(x.round() as i32, y.round() as i32)
}

#[tauri::command]
async fn capture_vertical_long_region(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    max_frames: Option<u32>,
    scroll_delta: Option<i32>,
    settle_ms: Option<u64>,
    overlap_scan: Option<u32>,
) -> Result<CaptureResponse, String> {
    let started_at = std::time::Instant::now();
    let stitched = long_capture::capture_vertical_long_region(
        x,
        y,
        w,
        h,
        max_frames.unwrap_or(8),
        scroll_delta.unwrap_or(-480),
        settle_ms.unwrap_or(180),
        overlap_scan.unwrap_or((h / 3).clamp(32, 240)),
    )
    .map_err(|error| error.to_string())?;

    let width = stitched.width();
    let height = stitched.height();
    let mut bytes = Vec::new();
    let dynamic_image = image::DynamicImage::ImageRgb8(stitched);
    dynamic_image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|error| error.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    append_runtime_log_line(&format!(
        "capture_vertical_long_region_metrics :: elapsed_ms={} png_bytes={} encoded_bytes={} width={} height={}",
        started_at.elapsed().as_millis(),
        bytes.len(),
        b64.len(),
        width,
        height
    ));

    Ok(CaptureResponse {
        base64: format!("data:image/png;base64,{}", b64),
        width,
        height,
        file_path: None,
        file_url: None,
        metadata: CaptureMetadata::sdr("long-capture", false),
    })
}

#[tauri::command]
async fn stitch_vertical_long_capture_frames(
    frames: Vec<String>,
    overlap_scan: Option<u32>,
) -> Result<CaptureResponse, String> {
    let started_at = std::time::Instant::now();
    let input_frame_count = frames.len();
    if input_frame_count > MAX_STITCH_FRAME_COUNT {
        return Err(format!(
            "Too many frames to stitch: {} exceeds limit of {}",
            input_frame_count, MAX_STITCH_FRAME_COUNT
        ));
    }
    let stitched = long_capture::stitch_vertical_frame_data_urls(
        &frames,
        overlap_scan.unwrap_or(160).clamp(32, 480),
    )
    .map_err(|error| error.to_string())?;

    let width = stitched.width();
    let height = stitched.height();
    let mut bytes = Vec::new();
    let dynamic_image = image::DynamicImage::ImageRgb8(stitched);
    dynamic_image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|error| error.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    append_runtime_log_line(&format!(
        "stitch_vertical_long_capture_frames_metrics :: elapsed_ms={} frames={} png_bytes={} encoded_bytes={} width={} height={}",
        started_at.elapsed().as_millis(),
        input_frame_count,
        bytes.len(),
        b64.len(),
        width,
        height
    ));

    Ok(CaptureResponse {
        base64: format!("data:image/png;base64,{}", b64),
        width,
        height,
        file_path: None,
        file_url: None,
        metadata: CaptureMetadata::sdr("long-capture-stitch", false),
    })
}

#[tauri::command]
async fn analyze_long_capture_pair(
    previous: String,
    current: String,
    axis: Option<long_capture::LongCaptureAxis>,
    direction: Option<long_capture::LongCaptureDirection>,
    max_scan: Option<u32>,
    min_overlap_px: Option<u32>,
    min_new_content_px: Option<u32>,
) -> Result<long_capture::LongCaptureOverlapAnalysis, String> {
    let started_at = std::time::Instant::now();
    let analysis = long_capture::analyze_long_capture_pair_data_urls(
        &previous,
        &current,
        long_capture::LongCaptureAnalyzeOptions {
            axis,
            direction,
            max_scan,
            min_overlap_px,
            min_new_content_px,
        },
    )
    .map_err(|error| error.to_string())?;
    append_runtime_log_line(&format!(
        "analyze_long_capture_pair_metrics :: elapsed_ms={} previous_chars={} current_chars={} status={:?} axis={:?} direction={:?} overlap_px={} append_px={} confidence={:.3}",
        started_at.elapsed().as_millis(),
        previous.len(),
        current.len(),
        analysis.status,
        analysis.axis,
        analysis.direction,
        analysis.overlap_px,
        analysis.append_px,
        analysis.confidence
    ));
    Ok(analysis)
}

#[tauri::command]
async fn stitch_long_capture_frames(
    frames: Vec<String>,
    axis: Option<long_capture::LongCaptureAxis>,
    direction: Option<long_capture::LongCaptureDirection>,
    max_scan: Option<u32>,
    min_overlap_px: Option<u32>,
) -> Result<CaptureResponse, String> {
    let started_at = std::time::Instant::now();
    let input_frame_count = frames.len();
    if input_frame_count > MAX_STITCH_FRAME_COUNT {
        return Err(format!(
            "Too many frames to stitch: {} exceeds limit of {}",
            input_frame_count, MAX_STITCH_FRAME_COUNT
        ));
    }
    let stitched = long_capture::stitch_long_capture_frame_data_urls(
        &frames,
        long_capture::LongCaptureStitchOptions {
            axis,
            direction,
            max_scan,
            min_overlap_px,
        },
    )
    .map_err(|error| error.to_string())?;

    let width = stitched.width();
    let height = stitched.height();
    let mut bytes = Vec::new();
    let dynamic_image = image::DynamicImage::ImageRgb8(stitched);
    dynamic_image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|error| error.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    append_runtime_log_line(&format!(
        "stitch_long_capture_frames_metrics :: elapsed_ms={} frames={} axis={:?} direction={:?} png_bytes={} encoded_bytes={} width={} height={}",
        started_at.elapsed().as_millis(),
        input_frame_count,
        axis,
        direction,
        bytes.len(),
        b64.len(),
        width,
        height
    ));

    Ok(CaptureResponse {
        base64: format!("data:image/png;base64,{}", b64),
        width,
        height,
        file_path: None,
        file_url: None,
        metadata: CaptureMetadata::sdr("long-capture-stitch", false),
    })
}

#[tauri::command]
fn save_session(
    app: tauri::AppHandle,
    stickers: Vec<StickerData>,
    links: Vec<LinkData>,
    groups: Option<Vec<serde_json::Value>>,
    recycle_bin: Option<Vec<FrozenStickerEntry>>,
    reference_library: Option<Vec<FrozenStickerEntry>>,
    workflow_asset_archive_hints: Option<WorkflowAssetArchiveHints>,
) -> Result<(), String> {
    let app_dir = effective_app_data_dir(&app)?;
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }

    let images_dir = app_dir.join("images");
    if !images_dir.exists() {
        fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    }

    let mut processed_stickers = stickers.clone();

    for sticker in &mut processed_stickers {
        sticker.src = persist_session_image_asset(&images_dir, &sticker.id, "source", &sticker.src)
            .map_err(|e| format!("Failed to persist source image for {}: {}", sticker.id, e))?;

        // Save Preview Image
        if let Some(ref mut p_src) = sticker.preview_src {
            *p_src = persist_session_image_asset(&images_dir, &sticker.id, "preview", p_src)
                .map_err(|e| {
                    format!("Failed to persist preview image for {}: {}", sticker.id, e)
                })?;
        }
    }

    let session_file = app_dir.join("session.json");
    let existing_archive_index = if session_file.exists() {
        fs::read_to_string(&session_file)
            .ok()
            .and_then(|content| serde_json::from_str::<SessionData>(&content).ok())
            .map(|session| session.workflow_asset_archive_index)
            .unwrap_or_default()
    } else {
        WorkflowAssetArchiveIndex::default()
    };
    let workflow_asset_archive_index = merge_workflow_asset_archive_index(
        &existing_archive_index,
        &workflow_asset_archive_hints.unwrap_or_default(),
        &processed_stickers,
    );

    // Save as SessionData with both stickers and links
    let session_data = SessionData {
        stickers: processed_stickers,
        links: links,
        groups: groups.unwrap_or_default(),
        recycle_bin: recycle_bin.unwrap_or_default(),
        reference_library: reference_library.unwrap_or_default(),
        workflow_asset_archive_index,
    };
    let json = serde_json::to_string_pretty(&session_data).map_err(|e| e.to_string())?;

    let mut file = File::create(session_file).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;

    if let Err(error) =
        cleanup_unreferenced_session_image_assets(&images_dir, &session_data, SystemTime::now())
    {
        println!("Warning: session image asset cleanup skipped: {}", error);
    }

    println!(
        "Session saved with {} stickers and {} links.",
        session_data.stickers.len(),
        session_data.links.len()
    );
    Ok(())
}

fn restore_loaded_session_stickers(stickers: &mut [StickerData]) {
    for sticker in stickers {
        if sticker.src.starts_with("data:image") {
            continue;
        }

        let path = std::path::Path::new(&sticker.src);
        if !path.exists() {
            println!(
                "Warning: Image file not found for sticker {}: {}",
                sticker.id, sticker.src
            );
        }
    }
}

#[tauri::command]
fn load_session(app: tauri::AppHandle) -> Result<SessionData, String> {
    let app_dir = effective_app_data_dir(&app)?;
    let session_file = app_dir.join("session.json");

    if !session_file.exists() {
        return Ok(SessionData {
            stickers: Vec::new(),
            links: Vec::new(),
            groups: Vec::new(),
            recycle_bin: Vec::new(),
            reference_library: Vec::new(),
            workflow_asset_archive_index: WorkflowAssetArchiveIndex::default(),
        });
    }

    let content = fs::read_to_string(&session_file).map_err(|e| e.to_string())?;

    // Try to parse as SessionData first, fallback to Vec<StickerData> for backwards compatibility
    let mut session_data: SessionData = match serde_json::from_str(&content) {
        Ok(data) => data,
        Err(_) => {
            // Backwards compatibility: old format was just Vec<StickerData>
            let stickers: Vec<StickerData> =
                serde_json::from_str(&content).map_err(|e| e.to_string())?;
            SessionData {
                stickers,
                links: Vec::new(),
                groups: Vec::new(),
                recycle_bin: Vec::new(),
                reference_library: Vec::new(),
                workflow_asset_archive_index: WorkflowAssetArchiveIndex::default(),
            }
        }
    };

    restore_loaded_session_stickers(&mut session_data.stickers);

    println!(
        "Session loaded with {} stickers and {} links.",
        session_data.stickers.len(),
        session_data.links.len()
    );
    Ok(session_data)
}

const HISTORY_MAX_COLORS: usize = 64;
const HISTORY_MAX_SCREENSHOTS: usize = 64;

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
    let mut file = File::create(history_file).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_history(app: tauri::AppHandle) -> Result<HistoryData, String> {
    let app_dir = effective_app_data_dir(&app)?;
    let history_file = app_dir.join("history.json");
    if !history_file.exists() {
        return Ok(HistoryData::default());
    }

    let content = fs::read_to_string(&history_file).map_err(|e| e.to_string())?;
    let mut history: HistoryData = serde_json::from_str(&content).unwrap_or_default();
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
    let mut file = File::create(tool_settings_file).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_tool_settings(app: tauri::AppHandle) -> Result<ToolSettingsData, String> {
    let app_dir = effective_app_data_dir(&app)?;
    let tool_settings_file = app_dir.join("tool-settings.json");
    if !tool_settings_file.exists() {
        return Ok(ToolSettingsData::default());
    }

    let content = fs::read_to_string(&tool_settings_file).map_err(|e| e.to_string())?;
    let payload: ToolSettingsData = serde_json::from_str(&content).unwrap_or_default();
    Ok(payload)
}

#[cfg(target_os = "windows")]
fn wide_face_name_to_string(face_name: &[u16]) -> String {
    let end = face_name
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(face_name.len());
    String::from_utf16_lossy(&face_name[..end])
        .trim()
        .to_string()
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn collect_installed_font_family_callback(
    logfont: *const windows::Win32::Graphics::Gdi::LOGFONTW,
    _metric: *const windows::Win32::Graphics::Gdi::TEXTMETRICW,
    _font_type: u32,
    lparam: LPARAM,
) -> i32 {
    if logfont.is_null() || lparam.0 == 0 {
        return 1;
    }

    let families = unsafe { &mut *(lparam.0 as *mut BTreeSet<String>) };
    let family_name = wide_face_name_to_string(unsafe { &(*logfont).lfFaceName });
    if !family_name.is_empty() && !family_name.starts_with('@') {
        families.insert(family_name);
    }

    1
}

#[cfg(target_os = "windows")]
fn collect_installed_font_families_windows() -> Result<Vec<String>, String> {
    use windows::Win32::Graphics::Gdi::{
        EnumFontFamiliesExW, GetDC, ReleaseDC, DEFAULT_CHARSET, LOGFONTW,
    };

    let screen_dc = unsafe { GetDC(None) };
    if screen_dc.is_invalid() {
        return Err("screen device context unavailable for font enumeration".to_string());
    }

    let mut search_filter = LOGFONTW::default();
    search_filter.lfCharSet = DEFAULT_CHARSET;

    let mut families = BTreeSet::new();
    let _ = unsafe {
        EnumFontFamiliesExW(
            screen_dc,
            &search_filter,
            Some(collect_installed_font_family_callback),
            LPARAM((&mut families as *mut BTreeSet<String>) as isize),
            0,
        )
    };
    unsafe {
        ReleaseDC(None, screen_dc);
    }

    Ok(families.into_iter().collect())
}

fn installed_font_families() -> Result<&'static Vec<String>, String> {
    if let Some(fonts) = INSTALLED_FONT_FAMILIES.get() {
        return Ok(fonts);
    }

    #[cfg(target_os = "windows")]
    let fonts = collect_installed_font_families_windows()?;

    #[cfg(not(target_os = "windows"))]
    let fonts = Vec::new();

    let _ = INSTALLED_FONT_FAMILIES.set(fonts);
    Ok(INSTALLED_FONT_FAMILIES
        .get()
        .expect("installed fonts cache must be initialized before read"))
}

#[tauri::command]
fn get_installed_fonts() -> Result<Vec<String>, String> {
    installed_font_families().map(|fonts| fonts.clone())
}

#[cfg(target_os = "windows")]
fn set_overlay_no_activate_flag(window: &tauri::WebviewWindow, enabled: bool) {
    let Some(hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_no_activate_hwnd_failed");
        return;
    };

    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let flag = WS_EX_NOACTIVATE.0 as isize;
        let next_style = if enabled { style | flag } else { style & !flag };
        if next_style != style {
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style);
        }
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

#[cfg(target_os = "windows")]
fn set_overlay_transparent_style(window: &tauri::WebviewWindow, enabled: bool) {
    let Some(hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_transparent_hwnd_failed");
        return;
    };

    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let flag = WS_EX_TRANSPARENT.0 as isize;
        let next_style = if enabled { style | flag } else { style & !flag };
        if next_style != style {
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style);
        }
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn set_overlay_transparent_style(_window: &tauri::WebviewWindow, _enabled: bool) {}

#[cfg(target_os = "windows")]
fn apply_overlay_no_activate(window: &tauri::WebviewWindow) {
    set_overlay_no_activate_flag(window, true);
    append_runtime_log_line("overlay_no_activate_applied");
}

#[cfg(not(target_os = "windows"))]
fn apply_overlay_no_activate(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn clear_overlay_no_activate(window: &tauri::WebviewWindow) {
    set_overlay_no_activate_flag(window, false);
    append_runtime_log_line("overlay_no_activate_cleared");
}

#[cfg(not(target_os = "windows"))]
fn clear_overlay_no_activate(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
unsafe extern "system" fn overlay_mouse_activate_wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_MOUSEACTIVATE {
        return LRESULT(MA_NOACTIVATE as isize);
    }

    if let Some(previous) = OVERLAY_MOUSE_ACTIVATE_WNDPROC_PREVIOUS.get().copied() {
        let previous_wndproc: WNDPROC = Some(std::mem::transmute(previous));
        return unsafe { CallWindowProcW(previous_wndproc, hwnd, message, wparam, lparam) };
    }

    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn install_overlay_mouse_activate_no_activate(window: &tauri::WebviewWindow) {
    if OVERLAY_MOUSE_ACTIVATE_WNDPROC_INSTALLED.load(Ordering::SeqCst) {
        return;
    }

    let Some(hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_mouse_activate_install_hwnd_failed");
        return;
    };

    let previous = unsafe {
        SetWindowLongPtrW(
            hwnd,
            GWLP_WNDPROC,
            overlay_mouse_activate_wndproc as *const () as usize as isize,
        )
    };
    if previous == 0 {
        append_runtime_log_line("overlay_mouse_activate_install_failed");
        return;
    }

    let _ = OVERLAY_MOUSE_ACTIVATE_WNDPROC_PREVIOUS.set(previous);
    OVERLAY_MOUSE_ACTIVATE_WNDPROC_INSTALLED.store(true, Ordering::SeqCst);
    append_runtime_log_line("overlay_mouse_activate_install_success");
}

#[cfg(not(target_os = "windows"))]
fn install_overlay_mouse_activate_no_activate(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn overlay_input_shield_hwnd() -> Option<HWND> {
    OVERLAY_INPUT_SHIELD_HWND
        .get()
        .copied()
        .map(|value| HWND(value as *mut core::ffi::c_void))
}

#[cfg(target_os = "windows")]
fn set_overlay_input_shield_alt_passthrough(active: bool) {
    if OVERLAY_INPUT_SHIELD_ALT_PASSTHROUGH.swap(active, Ordering::SeqCst) == active {
        return;
    }

    let Some(hwnd) = overlay_input_shield_hwnd() else {
        return;
    };
    let current_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let transparent_flag = WS_EX_TRANSPARENT.0 as isize;
    if (current_style & transparent_flag != 0) == active {
        return;
    }
    let next_style = if active {
        current_style | transparent_flag
    } else {
        current_style & !transparent_flag
    };
    let _ = unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style) };
    let _ = unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
    };
    append_runtime_log_line(if active {
        "overlay_input_shield_alt_passthrough_enabled"
    } else {
        "overlay_input_shield_alt_passthrough_disabled"
    });
}

#[cfg(not(target_os = "windows"))]
fn set_overlay_input_shield_alt_passthrough(_active: bool) {}

#[cfg(target_os = "windows")]
struct OverlayMainWindowSearchState {
    target_pid: u32,
    hwnd: Option<HWND>,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn find_overlay_main_window_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut OverlayMainWindowSearchState);
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == state.target_pid && unsafe { IsWindowVisible(hwnd) }.as_bool() {
        state.hwnd = Some(hwnd);
        return BOOL(0);
    }

    BOOL(1)
}

#[cfg(target_os = "windows")]
fn resolve_overlay_main_hwnd(window: &tauri::WebviewWindow) -> Option<HWND> {
    if let Ok(hwnd) = window.hwnd() {
        return Some(HWND(hwnd.0));
    }

    let mut state = OverlayMainWindowSearchState {
        target_pid: std::process::id(),
        hwnd: None,
    };
    let state_ptr = &mut state as *mut OverlayMainWindowSearchState;
    let _ = unsafe {
        EnumWindows(
            Some(find_overlay_main_window_proc),
            LPARAM(state_ptr as isize),
        )
    };
    state.hwnd
}

#[cfg(target_os = "windows")]
fn hide_overlay_input_shield_window() {
    let Some(hwnd) = overlay_input_shield_hwnd() else {
        return;
    };

    let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
    append_runtime_log_line("overlay_input_shield_native_drag_hidden");
}

#[cfg(not(target_os = "windows"))]
fn hide_overlay_input_shield_window() {}

#[cfg(target_os = "windows")]
fn promote_overlay_input_shield_to_fullscreen() {
    let Some(hwnd) = overlay_input_shield_hwnd() else {
        return;
    };

    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        append_runtime_log_line("overlay_input_shield_drag_rect_failed");
        return;
    }

    let width = (rect.right - rect.left).max(1);
    let height = (rect.bottom - rect.top).max(1);
    let full_region = unsafe { CreateRectRgn(0, 0, width, height) };
    let _ = unsafe { SetWindowRgn(hwnd, Some(full_region), true) };
    let _ = unsafe { ShowWindow(hwnd, SW_SHOWNA) };
    append_runtime_log_line("overlay_input_shield_drag_fullscreen");
}

#[cfg(not(target_os = "windows"))]
fn promote_overlay_input_shield_to_fullscreen() {}

#[cfg(target_os = "windows")]
fn route_overlay_input_shield_mouse_message(message: u32, wparam: WPARAM) -> Option<LRESULT> {
    if NATIVE_FILE_DRAG_ACTIVE.load(Ordering::SeqCst)
        || NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst)
    {
        return None;
    }

    let (x, y) = current_cursor_position_physical()?;
    let modifiers = current_modifier_snapshot();
    let should_route_overlay_mouse = should_route_overlay_mouse_events(x, y);
    let hook_hover_active = OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.load(Ordering::SeqCst);
    let direct_drag_active = OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.load(Ordering::SeqCst);
    let native_drag_preflight_active =
        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
    let overlay_pointer_session_active =
        OVERLAY_POINTER_STATE.load(Ordering::SeqCst) != OVERLAY_POINTER_STATE_NONE;
    if modifiers.alt_pressed
        && should_passthrough_foreign_alt_mouse_input(
            true,
            CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst),
            direct_drag_active,
            native_drag_preflight_active,
            hook_process_has_foreground_window(),
            message == WM_MOUSEWHEEL,
            should_route_overlay_mouse,
        )
    {
        set_overlay_input_shield_alt_passthrough(true);
        return None;
    }
    if !modifiers.alt_pressed {
        set_overlay_input_shield_alt_passthrough(false);
    }

    match message {
        WM_MOUSEMOVE => {
            if overlay_pointer_source_owns_session(OverlayPointerSource::LowLevelHook) {
                return Some(LRESULT(1));
            }
            if direct_drag_active || native_drag_preflight_active {
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayMove {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight: native_drag_preflight_active,
                });
                return Some(LRESULT(1));
            }

            if should_route_overlay_mouse && !hook_hover_active {
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayMove {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight: false,
                });
                return Some(LRESULT(1));
            }
        }
        WM_LBUTTONDOWN => {
            if should_route_overlay_mouse || overlay_pointer_session_active {
                let source = OverlayPointerSource::InputShield;
                match claim_overlay_pointer_down(&OVERLAY_POINTER_STATE, source) {
                    OverlayPointerDownTransition::Started => {
                        let shift_sticker_native_drag_preflight = modifiers.shift_pressed
                            && is_pointer_over_sticker_body_synthetic_rect(x, y);
                        if shift_sticker_native_drag_preflight {
                            OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.store(false, Ordering::SeqCst);
                            OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE
                                .store(true, Ordering::SeqCst);
                            append_runtime_log_line(&format!(
                                "overlay_input_shield_native_drag_preflight_start :: x={} y={}",
                                x, y
                            ));
                            queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown {
                                x,
                                y,
                                modifiers,
                                native_drag_preflight: true,
                                source,
                                continuation: false,
                            });
                            return Some(LRESULT(1));
                        }

                        OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE
                            .store(false, Ordering::SeqCst);
                        promote_overlay_input_shield_to_fullscreen();
                        append_runtime_log_line(&format!(
                            "overlay_input_shield_drag_start :: x={} y={}",
                            x, y
                        ));
                        queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown {
                            x,
                            y,
                            modifiers,
                            native_drag_preflight: false,
                            source,
                            continuation: false,
                        });
                        return Some(LRESULT(1));
                    }
                    OverlayPointerDownTransition::Continued => {
                        let native_drag_preflight =
                            OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
                        if !native_drag_preflight {
                            OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                            promote_overlay_input_shield_to_fullscreen();
                        }
                        append_runtime_log_line(&format!(
                            "overlay_drag_recovery_down :: source={} x={} y={}",
                            source.log_name(),
                            x,
                            y
                        ));
                        queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown {
                            x,
                            y,
                            modifiers,
                            native_drag_preflight,
                            source,
                            continuation: true,
                        });
                        return Some(LRESULT(1));
                    }
                    OverlayPointerDownTransition::IgnoredDuplicate
                    | OverlayPointerDownTransition::IgnoredForeignOwner => {
                        return Some(LRESULT(1));
                    }
                }
            }
        }
        WM_LBUTTONUP => {
            let source = OverlayPointerSource::InputShield;
            match claim_overlay_pointer_up(&OVERLAY_POINTER_STATE, source) {
                OverlayPointerUpTransition::Candidate => {
                    let native_drag_preflight =
                        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
                    append_runtime_log_line(&format!(
                        "overlay_drag_up_candidate :: source={} x={} y={}",
                        source.log_name(),
                        x,
                        y
                    ));
                    queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayUp {
                        x,
                        y,
                        modifiers,
                        native_drag_preflight,
                        source,
                    });
                    return Some(LRESULT(1));
                }
                OverlayPointerUpTransition::IgnoredDuplicate
                | OverlayPointerUpTransition::IgnoredForeignOwner => {
                    return Some(LRESULT(1));
                }
                OverlayPointerUpTransition::IgnoredUnpaired => {}
            }
        }
        WM_MOUSEWHEEL => {
            if should_route_overlay_mouse && !hook_hover_active {
                let delta_y = (((wparam.0 >> 16) & 0xffff) as i16) as f64;
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayWheel {
                    x,
                    y,
                    delta_y,
                    modifiers,
                });
                return Some(LRESULT(1));
            }
        }
        WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_MBUTTONUP | WM_XBUTTONDOWN | WM_XBUTTONUP => {
            if should_route_overlay_mouse {
                return Some(LRESULT(1));
            }
        }
        WM_RBUTTONUP => {
            if should_route_overlay_mouse {
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayContextMenu {
                    x,
                    y,
                    modifiers,
                });
                return Some(LRESULT(1));
            }
        }
        _ => {}
    }

    None
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn overlay_input_shield_wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if let Some(result) = route_overlay_input_shield_mouse_message(message, wparam) {
        return result;
    }

    if let Some(previous) = OVERLAY_INPUT_SHIELD_WNDPROC_PREVIOUS.get().copied() {
        let previous_wndproc: WNDPROC = Some(std::mem::transmute(previous));
        return unsafe { CallWindowProcW(previous_wndproc, hwnd, message, wparam, lparam) };
    }

    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn ensure_overlay_input_shield_window(window: &tauri::WebviewWindow) -> Option<HWND> {
    if let Some(hwnd) = overlay_input_shield_hwnd() {
        return Some(hwnd);
    }

    let Some(main_hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_input_shield_hwnd_failed");
        return None;
    };
    let mut main_rect = RECT::default();
    if unsafe { GetWindowRect(main_hwnd, &mut main_rect) }.is_err() {
        append_runtime_log_line("overlay_input_shield_main_rect_failed");
        return None;
    }

    let class_name: Vec<u16> = "STATIC".encode_utf16().chain(std::iter::once(0)).collect();
    let window_name: Vec<u16> = "HookOverlayInputShield"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let width = (main_rect.right - main_rect.left).max(1);
    let height = (main_rect.bottom - main_rect.top).max(1);

    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            PCWSTR(class_name.as_ptr()),
            PCWSTR(window_name.as_ptr()),
            WS_POPUP,
            main_rect.left,
            main_rect.top,
            width,
            height,
            None,
            None,
            None,
            None,
        )
    };
    let Ok(hwnd) = hwnd else {
        append_runtime_log_line("overlay_input_shield_create_failed");
        return None;
    };

    let previous = unsafe {
        SetWindowLongPtrW(
            hwnd,
            GWLP_WNDPROC,
            overlay_input_shield_wndproc as *const () as usize as isize,
        )
    };
    if previous == 0 {
        append_runtime_log_line("overlay_input_shield_wndproc_install_failed");
    } else {
        let _ = OVERLAY_INPUT_SHIELD_WNDPROC_PREVIOUS.set(previous);
        append_runtime_log_line("overlay_input_shield_wndproc_install_success");
    }

    let _ = unsafe { SetLayeredWindowAttributes(hwnd, Default::default(), 1, LWA_ALPHA) };
    let _ = unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            main_rect.left,
            main_rect.top,
            width,
            height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    };
    let _ = unsafe { ShowWindow(hwnd, SW_SHOWNA) };
    let _ = OVERLAY_INPUT_SHIELD_HWND.set(hwnd.0 as isize);
    if OVERLAY_INPUT_SHIELD_ALT_PASSTHROUGH.load(Ordering::SeqCst) {
        OVERLAY_INPUT_SHIELD_ALT_PASSTHROUGH.store(false, Ordering::SeqCst);
        set_overlay_input_shield_alt_passthrough(true);
    }
    append_runtime_log_line("overlay_input_shield_create_success");
    Some(hwnd)
}

#[cfg(target_os = "windows")]
fn sync_overlay_input_shield_region(
    window: &tauri::WebviewWindow,
    rects: &[mouse_monitor::Rect],
    active: bool,
) {
    if NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst) {
        hide_overlay_input_shield_window();
        return;
    }
    if should_suppress_overlay_interaction_for_current_occlusion() {
        hide_overlay_input_shield_window();
        append_runtime_log_line("overlay_input_shield_fullscreen_occlusion_hidden");
        return;
    }

    let Some(hwnd) = ensure_overlay_input_shield_window(window) else {
        return;
    };
    let Some(main_hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_input_shield_main_hwnd_failed");
        return;
    };
    let mut main_rect = RECT::default();
    if unsafe { GetWindowRect(main_hwnd, &mut main_rect) }.is_err() {
        append_runtime_log_line("overlay_input_shield_main_rect_failed");
        return;
    }

    let width = (main_rect.right - main_rect.left).max(1);
    let height = (main_rect.bottom - main_rect.top).max(1);
    let capture_active = CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst);
    let overlay_drag_active = OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.load(Ordering::SeqCst);
    let _ = unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            main_rect.left,
            main_rect.top,
            width,
            height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    };

    if capture_active || overlay_drag_active {
        let full_region = unsafe { CreateRectRgn(0, 0, width, height) };
        let _ = unsafe { SetWindowRgn(hwnd, Some(full_region), true) };
        let _ = unsafe { ShowWindow(hwnd, SW_SHOWNA) };
        append_runtime_log_line(if capture_active {
            "overlay_input_shield_capture_fullscreen"
        } else {
            "overlay_input_shield_drag_fullscreen_synced"
        });
        return;
    }

    let shield_rects: Vec<&mouse_monitor::Rect> = if active {
        rects
            .iter()
            .filter(|rect| rect.width > 0 && rect.height > 0 && is_synthetic_overlay_rect(rect))
            .collect()
    } else {
        Vec::new()
    };
    let empty_region = unsafe { CreateRectRgn(0, 0, 0, 0) };
    if shield_rects.is_empty() {
        let _ = unsafe { SetWindowRgn(hwnd, Some(empty_region), true) };
        let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
        append_runtime_log_line("overlay_input_shield_hidden");
        return;
    }

    let union_region = empty_region;
    for rect in shield_rects {
        let next_region =
            unsafe { CreateRectRgn(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height) };
        let _ = unsafe {
            CombineRgn(
                Some(union_region),
                Some(union_region),
                Some(next_region),
                RGN_OR,
            )
        };
        let _ = unsafe { DeleteObject(next_region.into()) };
    }
    let _ = unsafe { SetWindowRgn(hwnd, Some(union_region), true) };
    let _ = unsafe { ShowWindow(hwnd, SW_SHOWNA) };
    append_runtime_log_line("overlay_input_shield_region_synced");
}

#[cfg(not(target_os = "windows"))]
fn sync_overlay_input_shield_region(
    _window: &tauri::WebviewWindow,
    _rects: &[mouse_monitor::Rect],
    _active: bool,
) {
}

#[cfg(target_os = "windows")]
fn sync_overlay_input_shield_from_runtime_state(window: &tauri::WebviewWindow) {
    let rects = overlay_mouse_hit_map()
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let active = OVERLAY_MOUSE_HIT_MAP_ACTIVE.load(Ordering::SeqCst);
    sync_overlay_input_shield_region(window, &rects, active);
}

#[cfg(not(target_os = "windows"))]
fn sync_overlay_input_shield_from_runtime_state(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn rect_covers_rect_with_tolerance(cover: RECT, target: RECT, tolerance: i32) -> bool {
    cover.left <= target.left.saturating_add(tolerance)
        && cover.top <= target.top.saturating_add(tolerance)
        && cover.right >= target.right.saturating_sub(tolerance)
        && cover.bottom >= target.bottom.saturating_sub(tolerance)
}

#[cfg(target_os = "windows")]
fn overlay_window_class_name(hwnd: HWND) -> Option<String> {
    let mut buffer = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
    if len <= 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..len as usize]))
}

#[cfg(target_os = "windows")]
fn is_desktop_shell_window_class(class_name: &str) -> bool {
    matches!(class_name, "Progman" | "WorkerW" | "Shell_TrayWnd")
}

#[cfg(target_os = "windows")]
fn window_is_above_overlay_in_z_order(candidate: HWND, overlay: HWND) -> bool {
    let mut current = unsafe { GetWindow(overlay, GW_HWNDPREV) }.ok();
    let mut remaining = 4096usize;
    while let Some(current_hwnd) = current {
        if remaining == 0 {
            break;
        }
        if current_hwnd == candidate {
            return true;
        }
        current = unsafe { GetWindow(current_hwnd, GW_HWNDPREV) }.ok();
        remaining -= 1;
    }
    false
}

#[cfg(target_os = "windows")]
fn foreign_fullscreen_foreground_covers_overlay(main_hwnd: HWND) -> bool {
    if !unsafe { IsWindowVisible(main_hwnd) }.as_bool() {
        return false;
    }

    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0.is_null() {
        return false;
    }
    let foreground_root = unsafe { GetAncestor(foreground, GA_ROOT) };
    let foreground_root = if foreground_root.0.is_null() {
        foreground
    } else {
        foreground_root
    };
    if foreground_root == main_hwnd || !unsafe { IsWindowVisible(foreground_root) }.as_bool() {
        return false;
    }

    let mut foreground_pid = 0;
    unsafe { GetWindowThreadProcessId(foreground_root, Some(&mut foreground_pid)) };
    if foreground_pid == 0 || foreground_pid == std::process::id() {
        return false;
    }
    if overlay_window_class_name(foreground_root)
        .as_deref()
        .is_some_and(is_desktop_shell_window_class)
    {
        return false;
    }

    let mut overlay_rect = RECT::default();
    let mut foreground_rect = RECT::default();
    if unsafe { GetWindowRect(main_hwnd, &mut overlay_rect) }.is_err()
        || unsafe { GetWindowRect(foreground_root, &mut foreground_rect) }.is_err()
    {
        return false;
    }
    rect_covers_rect_with_tolerance(
        foreground_rect,
        overlay_rect,
        OVERLAY_FULLSCREEN_COVERAGE_TOLERANCE_PX,
    ) && window_is_above_overlay_in_z_order(foreground_root, main_hwnd)
}

#[cfg(target_os = "windows")]
fn enter_overlay_fullscreen_occlusion_passthrough(window: &tauri::WebviewWindow, main_hwnd: HWND) {
    OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(false, Ordering::SeqCst);
    hide_overlay_input_shield_window();
    set_overlay_click_through_impl(window, true);
    let _ = unsafe {
        SetWindowPos(
            main_hwnd,
            Some(HWND_NOTOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    };
    append_runtime_log_line("overlay_fullscreen_occlusion_passthrough_entered");
}

#[cfg(target_os = "windows")]
fn leave_overlay_fullscreen_occlusion_passthrough(window: &tauri::WebviewWindow, main_hwnd: HWND) {
    if !unsafe { IsWindowVisible(main_hwnd) }.as_bool() {
        hide_overlay_input_shield_window();
        append_runtime_log_line("overlay_fullscreen_occlusion_passthrough_left_hidden");
        return;
    }

    reassert_overlay_topmost_window(main_hwnd);
    if CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst) {
        set_overlay_click_through_impl(window, true);
    } else {
        refresh_overlay_interactivity_from_runtime_state(
            window,
            OVERLAY_FULLSCREEN_OCCLUSION_PREVIOUS_CLICK_THROUGH.load(Ordering::SeqCst),
        );
    }
    sync_overlay_input_shield_from_runtime_state(window);
    append_runtime_log_line("overlay_fullscreen_occlusion_passthrough_left");
}

#[cfg(target_os = "windows")]
fn reassert_overlay_topmost_window(hwnd: HWND) {
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return;
    }

    let _ = unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    };
}

#[cfg(target_os = "windows")]
fn install_overlay_hwnd_retry_thread(window: &tauri::WebviewWindow) {
    if OVERLAY_HWND_RETRY_THREAD_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let app_handle = window.app_handle().clone();
    let _ = std::thread::Builder::new()
        .name("hook-overlay-hwnd-retry".to_string())
        .spawn(move || {
            for _attempt in 0..OVERLAY_HWND_RETRY_ATTEMPTS {
                let Some(window) = app_handle.get_webview_window("main") else {
                    std::thread::sleep(Duration::from_millis(OVERLAY_HWND_RETRY_INTERVAL_MS));
                    continue;
                };

                if let Some(hwnd) = resolve_overlay_main_hwnd(&window) {
                    let _ = OVERLAY_MAIN_HWND.set(hwnd.0 as isize);
                    apply_overlay_no_activate(&window);
                    install_overlay_mouse_activate_no_activate(&window);
                    set_overlay_transparent_style(
                        &window,
                        OVERLAY_CLICK_THROUGH_ACTIVE.load(Ordering::SeqCst),
                    );
                    install_overlay_topmost_maintenance_thread(&window);
                    append_runtime_log_line("overlay_hwnd_retry_completed");
                    return;
                }

                std::thread::sleep(Duration::from_millis(OVERLAY_HWND_RETRY_INTERVAL_MS));
            }

            append_runtime_log_line("overlay_hwnd_retry_exhausted");
        });
}

#[cfg(not(target_os = "windows"))]
fn install_overlay_hwnd_retry_thread(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn install_overlay_topmost_maintenance_thread(window: &tauri::WebviewWindow) {
    let Some(hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_topmost_maintenance_hwnd_failed");
        return;
    };
    let _ = OVERLAY_MAIN_HWND.set(hwnd.0 as isize);

    if OVERLAY_TOPMOST_MAINTENANCE_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let maintenance_window = window.clone();
    let _ = std::thread::Builder::new()
        .name("hook-overlay-topmost-maintenance".to_string())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(
                OVERLAY_TOPMOST_MAINTENANCE_INTERVAL_MS,
            ));

            if NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst) {
                continue;
            }

            let main_hwnd = OVERLAY_MAIN_HWND
                .get()
                .copied()
                .map(|value| HWND(value as *mut core::ffi::c_void));
            let visually_occluded = main_hwnd
                .map(foreign_fullscreen_foreground_covers_overlay)
                .unwrap_or(false);
            OVERLAY_VISUALLY_OCCLUDED_BY_FULLSCREEN.store(visually_occluded, Ordering::SeqCst);

            if should_suppress_overlay_interaction_for_current_occlusion() {
                if !OVERLAY_FULLSCREEN_OCCLUSION_PASSTHROUGH_ACTIVE.swap(true, Ordering::SeqCst) {
                    OVERLAY_FULLSCREEN_OCCLUSION_PREVIOUS_CLICK_THROUGH.store(
                        OVERLAY_CLICK_THROUGH_ACTIVE.load(Ordering::SeqCst),
                        Ordering::SeqCst,
                    );
                    if let Some(main_hwnd) = main_hwnd {
                        enter_overlay_fullscreen_occlusion_passthrough(
                            &maintenance_window,
                            main_hwnd,
                        );
                    }
                }
                continue;
            }

            if OVERLAY_FULLSCREEN_OCCLUSION_PASSTHROUGH_ACTIVE.swap(false, Ordering::SeqCst) {
                if let Some(main_hwnd) = main_hwnd {
                    leave_overlay_fullscreen_occlusion_passthrough(&maintenance_window, main_hwnd);
                }
            }

            let needs_topmost_maintenance = OVERLAY_MOUSE_HIT_MAP_ACTIVE.load(Ordering::SeqCst)
                || CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst)
                || OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst)
                || OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.load(Ordering::SeqCst)
                || OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst)
                || OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.load(Ordering::SeqCst);
            if !needs_topmost_maintenance {
                continue;
            }

            if let Some(main_hwnd) = main_hwnd {
                reassert_overlay_topmost_window(main_hwnd);
            }
            if let Some(shield_hwnd) = overlay_input_shield_hwnd() {
                reassert_overlay_topmost_window(shield_hwnd);
            }
        });

    append_runtime_log_line("overlay_topmost_maintenance_started");
}

#[cfg(not(target_os = "windows"))]
fn install_overlay_topmost_maintenance_thread(_window: &tauri::WebviewWindow) {}

fn apply_overlay_window_bounds(window: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let position = monitor.position();

        let _ = window.set_decorations(false);
        let _ = window.set_position(tauri::Position::Physical(*position));
        let _ = window.set_size(tauri::Size::Physical(*size));
    } else {
        let _ = window.set_fullscreen(true);
    }
}

fn setup_overlay_window(window: &tauri::WebviewWindow) {
    install_overlay_hwnd_retry_thread(window);
    let _ = window.set_content_protected(false);
    apply_overlay_no_activate(window);
    install_overlay_mouse_activate_no_activate(window);
    let _ = window.set_decorations(false);
    let _ = window.set_title("");
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_always_on_top(true);
    let _ = window.set_resizable(false);
    let _ = window.set_shadow(false);
    apply_overlay_window_bounds(window);

    if let Err(e) = window.show() {
        println!("Failed to show window: {}", e);
    }
    apply_overlay_no_activate(window);
    install_overlay_mouse_activate_no_activate(window);
    install_overlay_topmost_maintenance_thread(window);
}

fn stage_uiaccess_overlay_startup(window: &tauri::WebviewWindow, click_through: bool) {
    UIACCESS_PENDING_OVERLAY_CLICK_THROUGH.store(click_through, Ordering::SeqCst);
    UIACCESS_OVERLAY_STARTUP_STAGED.store(true, Ordering::SeqCst);
    install_overlay_hwnd_retry_thread(window);
    let _ = window.set_content_protected(false);
    let _ = window.set_decorations(false);
    let _ = window.set_title("");
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_resizable(false);
    let _ = window.set_shadow(false);
    let _ = window.set_ignore_cursor_events(false);
    OVERLAY_CLICK_THROUGH_ACTIVE.store(false, Ordering::SeqCst);
    apply_overlay_window_bounds(window);
    append_runtime_log_line("uiaccess_overlay_startup_staged");
}

#[derive(Clone)]
struct SharedCaptureInputState {
    active: Arc<std::sync::Mutex<bool>>,
}

impl SharedCaptureInputState {
    fn new() -> Self {
        Self {
            active: Arc::new(std::sync::Mutex::new(false)),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LongCaptureWheelEvent {
    delta_x: i64,
    delta_y: i64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LongCaptureSessionRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Clone, Debug)]
struct LongCaptureSessionState {
    rect: LongCaptureSessionRect,
    axis: Option<long_capture::LongCaptureAxis>,
    direction: Option<long_capture::LongCaptureDirection>,
    frames: Vec<image::RgbImage>,
    last_frame_fingerprint: Option<Arc<LongCaptureFrameFingerprint>>,
    pair_analyses: Vec<long_capture::LongCaptureOverlapAnalysis>,
    incremental_stitcher: Option<long_capture::LongCaptureIncrementalStitcher>,
    stitch_worker_active: bool,
    stitch_error: Option<String>,
    duplicate_count: usize,
    max_scan: u32,
    min_overlap_px: u32,
    created_at: Instant,
}

#[derive(Clone)]
struct SharedLongCaptureSessions {
    sessions: Arc<std::sync::Mutex<HashMap<String, LongCaptureSessionState>>>,
}

impl SharedLongCaptureSessions {
    fn new() -> Self {
        Self {
            sessions: Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum LongCaptureSessionSampleStatus {
    Recorded,
    Duplicate,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LongCaptureSessionSampleResponse {
    status: LongCaptureSessionSampleStatus,
    frame_count: usize,
    duplicate_count: usize,
    recorded: bool,
    axis: Option<long_capture::LongCaptureAxis>,
    direction: Option<long_capture::LongCaptureDirection>,
}

#[derive(Clone)]
struct LongCaptureSessionSampleWork {
    rect: LongCaptureSessionRect,
    previous_fingerprint: Option<Arc<LongCaptureFrameFingerprint>>,
    expected_frame_count: usize,
    axis: Option<long_capture::LongCaptureAxis>,
    max_scan: u32,
    min_overlap_px: u32,
}

struct LongCaptureSessionSampleResult {
    frame: image::RgbImage,
    fingerprint: LongCaptureFrameFingerprint,
    status: LongCaptureSessionSampleStatus,
    analysis: Option<long_capture::LongCaptureOverlapAnalysis>,
    expected_frame_count: usize,
}

struct LongCaptureRecordingClassification {
    status: LongCaptureSessionSampleStatus,
    analysis: Option<long_capture::LongCaptureOverlapAnalysis>,
}

#[derive(Clone, Debug)]
struct LongCaptureFrameFingerprint {
    width: u32,
    height: u32,
    byte_len: usize,
    hash: u64,
    sampled_pixels: Vec<[u8; 3]>,
    motion: long_capture::LongCaptureMotionFingerprint,
}

impl PartialEq for LongCaptureFrameFingerprint {
    fn eq(&self, other: &Self) -> bool {
        self.width == other.width
            && self.height == other.height
            && self.byte_len == other.byte_len
            && self.hash == other.hash
            && self.sampled_pixels == other.sampled_pixels
    }
}

fn long_capture_frame_fingerprint(frame: &image::RgbImage) -> LongCaptureFrameFingerprint {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for &byte in frame.as_raw() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    LongCaptureFrameFingerprint {
        width: frame.width(),
        height: frame.height(),
        byte_len: frame.as_raw().len(),
        hash,
        sampled_pixels: long_capture_frame_fingerprint_samples(frame),
        motion: long_capture::long_capture_motion_fingerprint(frame),
    }
}

fn long_capture_sample_axis_offsets(len: u32) -> Vec<u32> {
    if len == 0 {
        return Vec::new();
    }
    let sample_count = len.min(32);
    (0..sample_count)
        .map(|index| (((index as u64 * 2 + 1) * len as u64) / (sample_count as u64 * 2)) as u32)
        .map(|index| index.min(len.saturating_sub(1)))
        .collect()
}

fn long_capture_frame_fingerprint_samples(frame: &image::RgbImage) -> Vec<[u8; 3]> {
    let x_offsets = long_capture_sample_axis_offsets(frame.width());
    let y_offsets = long_capture_sample_axis_offsets(frame.height());
    let mut sampled_pixels = Vec::with_capacity(x_offsets.len() * y_offsets.len());
    for y in y_offsets {
        for &x in &x_offsets {
            sampled_pixels.push(frame.get_pixel(x, y).0);
        }
    }
    sampled_pixels
}

fn long_capture_fingerprints_are_near_duplicate(
    previous: &LongCaptureFrameFingerprint,
    current: &LongCaptureFrameFingerprint,
) -> bool {
    if previous.width != current.width
        || previous.height != current.height
        || previous.byte_len != current.byte_len
        || previous.sampled_pixels.len() != current.sampled_pixels.len()
        || previous.sampled_pixels.is_empty()
    {
        return false;
    }

    let mut changed = 0usize;
    let mut diff_total = 0u64;
    for (previous, current) in previous
        .sampled_pixels
        .iter()
        .zip(current.sampled_pixels.iter())
    {
        let diff = previous[0].abs_diff(current[0]) as u32
            + previous[1].abs_diff(current[1]) as u32
            + previous[2].abs_diff(current[2]) as u32;
        if diff >= 48 {
            changed += 1;
        }
        diff_total += diff as u64;
    }

    let total = previous.sampled_pixels.len();
    let changed_ratio = changed as f64 / total as f64;
    let mean_diff = diff_total as f64 / total as f64;
    changed_ratio <= 0.015 && mean_diff <= 8.0
}

fn classify_long_capture_recording_fingerprint(
    previous: Option<&LongCaptureFrameFingerprint>,
    current: &LongCaptureFrameFingerprint,
    axis: Option<long_capture::LongCaptureAxis>,
    max_scan: u32,
    min_overlap_px: u32,
) -> LongCaptureRecordingClassification {
    match previous {
        Some(previous)
            if previous == current
                || long_capture_fingerprints_are_near_duplicate(previous, current) =>
        {
            LongCaptureRecordingClassification {
                status: LongCaptureSessionSampleStatus::Duplicate,
                analysis: None,
            }
        }
        Some(previous) => {
            let motion_analysis = long_capture::analyze_long_capture_motion_fingerprints(
                &previous.motion,
                &current.motion,
                long_capture::LongCaptureAnalyzeOptions {
                    axis,
                    direction: None,
                    max_scan: Some(max_scan),
                    min_overlap_px: Some(min_overlap_px),
                    min_new_content_px: Some(1),
                },
            );
            if motion_analysis.is_some() {
                LongCaptureRecordingClassification {
                    status: LongCaptureSessionSampleStatus::Recorded,
                    analysis: None,
                }
            } else {
                LongCaptureRecordingClassification {
                    status: LongCaptureSessionSampleStatus::Duplicate,
                    analysis: None,
                }
            }
        }
        None => LongCaptureRecordingClassification {
            status: LongCaptureSessionSampleStatus::Recorded,
            analysis: None,
        },
    }
}

#[cfg(test)]
fn classify_long_capture_recording_frame(
    previous: Option<&image::RgbImage>,
    current: &image::RgbImage,
    _axis: Option<long_capture::LongCaptureAxis>,
    _max_scan: u32,
    _min_overlap_px: u32,
    _min_new_content_px: u32,
) -> LongCaptureRecordingClassification {
    let previous_fingerprint = previous.map(long_capture_frame_fingerprint);
    let current_fingerprint = long_capture_frame_fingerprint(current);
    classify_long_capture_recording_fingerprint(
        previous_fingerprint.as_ref(),
        &current_fingerprint,
        _axis,
        _max_scan,
        _min_overlap_px,
    )
}

fn is_long_capture_guide_blue(pixel: [u8; 3]) -> bool {
    let r_delta = (pixel[0] as i16 - 170).abs();
    let g_delta = (pixel[1] as i16 - 196).abs();
    let b_delta = (pixel[2] as i16 - 255).abs();
    r_delta <= 60 && g_delta <= 70 && b_delta <= 45 && pixel[2] >= pixel[0].saturating_add(28)
}

fn edge_line_has_long_capture_guide_color(
    image: &image::RgbImage,
    horizontal: bool,
    index: u32,
) -> bool {
    let len = if horizontal {
        image.width()
    } else {
        image.height()
    };
    if len == 0 {
        return false;
    }

    let mut guide_count = 0u32;
    let mut run = 0u32;
    let mut longest_run = 0u32;
    for offset in 0..len {
        let pixel = if horizontal {
            image.get_pixel(offset, index).0
        } else {
            image.get_pixel(index, offset).0
        };
        if is_long_capture_guide_blue(pixel) {
            guide_count += 1;
            run += 1;
            longest_run = longest_run.max(run);
        } else {
            run = 0;
        }
    }

    guide_count * 100 >= len * 45 || longest_run * 100 >= len * 35
}

fn copy_row(image: &mut image::RgbImage, from_y: u32, to_y: u32) {
    if from_y == to_y {
        return;
    }
    for x in 0..image.width() {
        let pixel = *image.get_pixel(x, from_y);
        image.put_pixel(x, to_y, pixel);
    }
}

fn copy_column(image: &mut image::RgbImage, from_x: u32, to_x: u32) {
    if from_x == to_x {
        return;
    }
    for y in 0..image.height() {
        let pixel = *image.get_pixel(from_x, y);
        image.put_pixel(to_x, y, pixel);
    }
}

fn nearest_non_guide_row(image: &image::RgbImage, from_y: u32, direction: i32) -> Option<u32> {
    let mut y = from_y as i32 + direction;
    while y >= 0 && y < image.height() as i32 {
        let row = y as u32;
        if !edge_line_has_long_capture_guide_color(image, true, row) {
            return Some(row);
        }
        y += direction;
    }
    None
}

fn nearest_non_guide_column(image: &image::RgbImage, from_x: u32, direction: i32) -> Option<u32> {
    let mut x = from_x as i32 + direction;
    while x >= 0 && x < image.width() as i32 {
        let column = x as u32;
        if !edge_line_has_long_capture_guide_color(image, false, column) {
            return Some(column);
        }
        x += direction;
    }
    None
}

fn remove_long_capture_overlay_guide_edges(frame: &mut image::RgbImage) {
    let width = frame.width();
    let height = frame.height();
    if width < 3 || height < 3 {
        return;
    }

    let edge_band = 4u32.min(width / 2).min(height / 2).max(1);
    for y in 0..edge_band {
        if edge_line_has_long_capture_guide_color(frame, true, y) {
            if let Some(source_y) = nearest_non_guide_row(frame, y, 1) {
                copy_row(frame, source_y, y);
            }
        }
    }
    for y in height.saturating_sub(edge_band)..height {
        if edge_line_has_long_capture_guide_color(frame, true, y) {
            if let Some(source_y) = nearest_non_guide_row(frame, y, -1) {
                copy_row(frame, source_y, y);
            }
        }
    }
    for x in 0..edge_band {
        if edge_line_has_long_capture_guide_color(frame, false, x) {
            if let Some(source_x) = nearest_non_guide_column(frame, x, 1) {
                copy_column(frame, source_x, x);
            }
        }
    }
    for x in width.saturating_sub(edge_band)..width {
        if edge_line_has_long_capture_guide_color(frame, false, x) {
            if let Some(source_x) = nearest_non_guide_column(frame, x, -1) {
                copy_column(frame, source_x, x);
            }
        }
    }
}

fn capture_and_classify_long_capture_sample(
    work: LongCaptureSessionSampleWork,
) -> Result<LongCaptureSessionSampleResult, String> {
    let (x, y, w, h) = logical_rect_to_capture_bounds(work.rect)?;
    let mut frame = screenshot::capture_area_with_profile(
        x,
        y,
        w,
        h,
        screenshot::CaptureWorkloadProfile::LongCapture,
    )
    .map_err(|error| error.to_string())?;
    remove_long_capture_overlay_guide_edges(&mut frame);
    let fingerprint = long_capture_frame_fingerprint(&frame);
    let classification = classify_long_capture_recording_fingerprint(
        work.previous_fingerprint.as_deref(),
        &fingerprint,
        work.axis,
        work.max_scan,
        work.min_overlap_px,
    );

    Ok(LongCaptureSessionSampleResult {
        frame,
        fingerprint,
        status: classification.status,
        analysis: classification.analysis,
        expected_frame_count: work.expected_frame_count,
    })
}

fn long_capture_stitch_worker_needed(session: &LongCaptureSessionState) -> bool {
    session.stitch_error.is_none()
        && !session.stitch_worker_active
        && session
            .incremental_stitcher
            .as_ref()
            .map(|stitcher| stitcher.frame_count() < session.frames.len())
            .unwrap_or(false)
}

fn record_long_capture_session_sample_result(
    session: &mut LongCaptureSessionState,
    result: LongCaptureSessionSampleResult,
) -> Result<(LongCaptureSessionSampleResponse, bool), String> {
    let status = result.status;
    let mut recorded = false;
    let mut should_spawn_worker = false;

    if matches!(status, LongCaptureSessionSampleStatus::Recorded) {
        if let Some(analysis) = result.analysis {
            session.axis = analysis.axis.or(session.axis);
            session.direction = analysis.direction;
            session.pair_analyses.push(analysis);
        }
        if session.incremental_stitcher.is_none() {
            let stitch_options = long_capture::LongCaptureStitchOptions {
                axis: session.axis,
                direction: None,
                max_scan: Some(session.max_scan),
                min_overlap_px: Some(session.min_overlap_px),
            };
            session.incremental_stitcher = Some(long_capture::LongCaptureIncrementalStitcher::new(
                result.frame.clone(),
                stitch_options,
            ));
        }
        session.frames.push(result.frame);
        session.last_frame_fingerprint = Some(Arc::new(result.fingerprint));
        recorded = true;

        if long_capture_stitch_worker_needed(session) {
            session.stitch_worker_active = true;
            should_spawn_worker = true;
        }
    } else {
        session.last_frame_fingerprint = Some(Arc::new(result.fingerprint));
        session.duplicate_count += 1;
    }

    let response = LongCaptureSessionSampleResponse {
        status,
        frame_count: session.frames.len(),
        duplicate_count: session.duplicate_count,
        recorded,
        axis: session
            .incremental_stitcher
            .as_ref()
            .and_then(|stitcher| stitcher.axis())
            .or(session.axis),
        direction: session.direction,
    };

    Ok((response, should_spawn_worker))
}

const LONG_CAPTURE_SAMPLE_LOG_EVERY_EVENTS: usize = 20;
const LONG_CAPTURE_SAMPLE_SLOW_MS: u128 = 40;
const LONG_CAPTURE_STITCH_WORKER_IDLE_YIELD_MS: u64 = 1;
const LONG_CAPTURE_STITCH_WORKER_BURST_FRAME_LIMIT: usize = 8;
const LONG_CAPTURE_STITCH_WORKER_LOG_EVERY_FRAMES: usize = 20;
const LONG_CAPTURE_STITCH_WORKER_SLOW_FRAME_MS: u128 = 40;
const LONG_CAPTURE_FINISH_WAIT_SLEEP_MS: u64 = 5;

fn should_log_long_capture_sample(
    response: &LongCaptureSessionSampleResponse,
    elapsed_ms: u128,
) -> bool {
    elapsed_ms >= LONG_CAPTURE_SAMPLE_SLOW_MS
        || if response.recorded {
            response.frame_count <= 2
                || response.frame_count % LONG_CAPTURE_SAMPLE_LOG_EVERY_EVENTS == 0
        } else {
            response.duplicate_count <= 2
                || response.duplicate_count % LONG_CAPTURE_SAMPLE_LOG_EVERY_EVENTS == 0
        }
}

fn should_rest_long_capture_stitch_worker(
    remaining_frames: usize,
    frames_since_rest: usize,
    elapsed_ms: u128,
) -> bool {
    remaining_frames == 0
        || frames_since_rest >= LONG_CAPTURE_STITCH_WORKER_BURST_FRAME_LIMIT
        || elapsed_ms >= LONG_CAPTURE_STITCH_WORKER_SLOW_FRAME_MS
}

fn lower_long_capture_worker_thread_priority() {
    #[cfg(target_os = "windows")]
    unsafe {
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

fn prepare_long_capture_stitch_worker(
    shared: &SharedLongCaptureSessions,
    session_id: &str,
) -> Result<bool, String> {
    let mut guard = shared
        .sessions
        .lock()
        .map_err(|_| "long capture session lock poisoned".to_string())?;
    let session = guard
        .get_mut(session_id)
        .ok_or_else(|| format!("Long capture session not found: {session_id}"))?;
    if let Some(error) = &session.stitch_error {
        return Err(error.clone());
    }
    if long_capture_stitch_worker_needed(session) {
        session.stitch_worker_active = true;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn spawn_long_capture_stitch_worker(shared: SharedLongCaptureSessions, session_id: String) {
    tokio::spawn(async move {
        let shared_for_worker = shared.clone();
        let session_id_for_worker = session_id.clone();
        if let Err(error) = tokio::task::spawn_blocking(move || {
            run_long_capture_stitch_worker(shared_for_worker, session_id_for_worker)
        })
        .await
        {
            append_runtime_log_line(&format!(
                "long_capture stitch_worker_join_failed :: id={} error={}",
                session_id, error
            ));
            if let Ok(mut guard) = shared.sessions.lock() {
                if let Some(session) = guard.get_mut(&session_id) {
                    session.stitch_worker_active = false;
                    session.stitch_error = Some(error.to_string());
                }
            }
        }
    });
}

fn run_long_capture_stitch_worker(shared: SharedLongCaptureSessions, session_id: String) {
    lower_long_capture_worker_thread_priority();
    let mut frames_since_rest = 0usize;

    loop {
        let (mut stitcher, frame, frame_index) = {
            let mut guard = match shared.sessions.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            let Some(session) = guard.get_mut(&session_id) else {
                return;
            };
            if session.stitch_error.is_some() {
                session.stitch_worker_active = false;
                return;
            }
            let Some(stitcher) = session.incremental_stitcher.take() else {
                session.stitch_worker_active = false;
                return;
            };
            let next_index = stitcher.frame_count();
            if next_index >= session.frames.len() {
                session.incremental_stitcher = Some(stitcher);
                session.stitch_worker_active = false;
                return;
            }
            let frame =
                std::mem::replace(&mut session.frames[next_index], image::RgbImage::new(0, 0));
            if frame.width() == 0 || frame.height() == 0 {
                session.incremental_stitcher = Some(stitcher);
                session.stitch_worker_active = false;
                append_runtime_log_line(&format!(
                    "long_capture stitch_worker_empty_frame :: id={} frame_index={}",
                    session_id, next_index
                ));
                return;
            }
            (stitcher, frame, next_index)
        };

        let started_at = Instant::now();
        let push_result = stitcher
            .push_frame_owned(frame)
            .map_err(|error| error.to_string());
        let elapsed_ms = started_at.elapsed().as_millis();

        let mut guard = match shared.sessions.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(session) = guard.get_mut(&session_id) else {
            return;
        };
        let remaining_frames;
        match push_result {
            Ok(merged) => {
                session.axis = stitcher.axis().or(session.axis);
                remaining_frames = session.frames.len().saturating_sub(stitcher.frame_count());
                let fast_path_merges = stitcher.adjacent_fast_path_merges();
                let aggregate_searches = stitcher.aggregate_signature_searches();
                let aggregate_segments = stitcher.aggregate_segment_count();
                let expensive_adjacent_pair_analyses = stitcher.expensive_adjacent_pair_analyses();
                let should_log_frame = frame_index <= 2
                    || frame_index % LONG_CAPTURE_STITCH_WORKER_LOG_EVERY_FRAMES == 0
                    || elapsed_ms >= LONG_CAPTURE_STITCH_WORKER_SLOW_FRAME_MS
                    || remaining_frames == 0;
                session.incremental_stitcher = Some(stitcher);
                if should_log_frame {
                    append_runtime_log_line(&format!(
                        "long_capture stitch_worker_frame :: id={} frame_index={} merged={} remaining={} elapsed_ms={} fast_path={} aggregate_searches={} expensive_pair_analyses={} segments={}",
                        session_id,
                        frame_index,
                        merged,
                        remaining_frames,
                        elapsed_ms,
                        fast_path_merges,
                        aggregate_searches,
                        expensive_adjacent_pair_analyses,
                        aggregate_segments
                    ));
                }
            }
            Err(error) => {
                session.incremental_stitcher = Some(stitcher);
                session.stitch_error = Some(error.clone());
                session.stitch_worker_active = false;
                append_runtime_log_line(&format!(
                    "long_capture stitch_worker_failed :: id={} frame_index={} error={}",
                    session_id, frame_index, error
                ));
                return;
            }
        }
        drop(guard);

        frames_since_rest += 1;
        std::thread::yield_now();
        if should_rest_long_capture_stitch_worker(remaining_frames, frames_since_rest, elapsed_ms) {
            frames_since_rest = 0;
            std::thread::sleep(Duration::from_millis(
                LONG_CAPTURE_STITCH_WORKER_IDLE_YIELD_MS,
            ));
        }
    }
}

async fn wait_for_long_capture_stitch_worker(
    shared: SharedLongCaptureSessions,
    session_id: &str,
) -> Result<(), String> {
    loop {
        let should_spawn = prepare_long_capture_stitch_worker(&shared, session_id)?;
        if should_spawn {
            spawn_long_capture_stitch_worker(shared.clone(), session_id.to_string());
        }

        let is_active = {
            let guard = shared
                .sessions
                .lock()
                .map_err(|_| "long capture session lock poisoned".to_string())?;
            let session = guard
                .get(session_id)
                .ok_or_else(|| format!("Long capture session not found: {session_id}"))?;
            if let Some(error) = &session.stitch_error {
                return Err(error.clone());
            }
            session.stitch_worker_active
        };
        if !is_active {
            return Ok(());
        }

        tokio::time::sleep(Duration::from_millis(LONG_CAPTURE_FINISH_WAIT_SLEEP_MS)).await;
    }
}

#[tauri::command]
fn set_capture_input_active(
    app: tauri::AppHandle,
    state: tauri::State<SharedCaptureInputState>,
    hit_map: tauri::State<SharedHitMap>,
    active: bool,
) {
    if let Ok(mut guard) = state.active.lock() {
        *guard = active;
        append_runtime_log_line(&format!("set_capture_input_active :: {}", active));
        set_capture_input_runtime_active(active);
    }

    if let Some(window) = app.get_webview_window("main") {
        let rects = hit_map
            .rectangles
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default();
        let overlay_active = hit_map.active.lock().map(|guard| *guard).unwrap_or(false);
        sync_overlay_input_shield_region(&window, &rects, overlay_active);
    }
}

#[tauri::command]
fn set_desktop_color_picker_active(active: bool) {
    DESKTOP_COLOR_PICKER_ACTIVE.store(active, Ordering::SeqCst);
    append_runtime_log_line(&format!("set_desktop_color_picker_active :: {}", active));
}

fn show_canvas_window_impl(window: &tauri::WebviewWindow) {
    let _ = window.set_content_protected(false);
    clear_overlay_no_activate(window);
    let _ = window.set_ignore_cursor_events(false);
    set_overlay_transparent_style(window, false);
    OVERLAY_CLICK_THROUGH_ACTIVE.store(false, Ordering::SeqCst);
    let _ = window.set_title("Hook");
    let _ = window.set_skip_taskbar(false);
    let _ = window.set_always_on_top(false);
    let _ = window.set_decorations(true);
    let _ = window.set_resizable(true);
    let _ = window.set_shadow(true);
    let _ = window.set_fullscreen(false);
    let _ = window.unmaximize();
    let _ = window.set_size(Size::Logical(LogicalSize::new(1280.0, 820.0)));
    let _ = window.center();

    if let Err(e) = window.show() {
        println!("Failed to show canvas window: {}", e);
    }

    if let Err(e) = window.set_focus() {
        println!("Failed to focus canvas window: {}", e);
    }
}

fn show_overlay_host_impl(window: &tauri::WebviewWindow, click_through: bool) {
    if uiaccess_build_enabled() && !UIACCESS_FRONTEND_MOUNTED.load(Ordering::SeqCst) {
        stage_uiaccess_overlay_startup(window, click_through);
        return;
    }

    setup_overlay_window(window);
    let _ = window.set_ignore_cursor_events(click_through);
    set_overlay_transparent_style(window, click_through);
    OVERLAY_CLICK_THROUGH_ACTIVE.store(click_through, Ordering::SeqCst);
    UIACCESS_PENDING_OVERLAY_CLICK_THROUGH.store(click_through, Ordering::SeqCst);
    UIACCESS_OVERLAY_STARTUP_STAGED.store(false, Ordering::SeqCst);
}

fn set_overlay_click_through_impl(window: &tauri::WebviewWindow, click_through: bool) {
    #[cfg(target_os = "windows")]
    let click_through =
        click_through || should_suppress_overlay_interaction_for_current_occlusion();
    let _ = window.set_ignore_cursor_events(click_through);
    set_overlay_transparent_style(window, click_through);
    OVERLAY_CLICK_THROUGH_ACTIVE.store(click_through, Ordering::SeqCst);
    apply_overlay_no_activate(window);
}

fn set_overlay_capture_exclusion_impl(window: &tauri::WebviewWindow, enabled: bool) {
    if let Err(error) = window.set_content_protected(enabled) {
        append_runtime_log_line(&format!(
            "set_overlay_capture_exclusion_failed :: enabled={} error={}",
            enabled, error
        ));
    }
}

fn hide_to_tray_impl(window: &tauri::WebviewWindow) {
    let _ = window.set_ignore_cursor_events(false);
    set_overlay_transparent_style(window, false);
    OVERLAY_CLICK_THROUGH_ACTIVE.store(false, Ordering::SeqCst);
    if let Err(e) = window.hide() {
        println!("Failed to hide window to tray: {}", e);
    }
}

fn enter_capture_mode(window: &tauri::WebviewWindow) {
    append_runtime_log_line("enter_capture_mode");
    if !try_begin_capture_input_runtime() {
        append_runtime_log_line("enter_capture_mode_ignored_active");
        return;
    }
    show_overlay_host_impl(window, true);

    println!("Overlay setup done. Emitting trigger-capture...");
    if let Err(e) = window.emit("trigger-capture", ()) {
        println!("Failed to emit trigger-capture: {}", e);
        append_runtime_log_line(&format!("enter_capture_mode emit_failed :: {}", e));
        set_capture_input_runtime_active(false);
    } else {
        append_runtime_log_line("enter_capture_mode emitted_trigger_capture");
    }
}

fn enter_long_capture_mode(window: &tauri::WebviewWindow) {
    append_runtime_log_line("enter_long_capture_mode");
    if !try_begin_capture_input_runtime() {
        append_runtime_log_line("enter_long_capture_mode_ignored_active");
        return;
    }
    show_overlay_host_impl(window, true);

    if let Err(e) = window.emit("trigger-long-capture", ()) {
        println!("Failed to emit trigger-long-capture: {}", e);
        append_runtime_log_line(&format!("enter_long_capture_mode emit_failed :: {}", e));
        set_capture_input_runtime_active(false);
    } else {
        append_runtime_log_line("enter_long_capture_mode emitted_trigger_long_capture");
    }
}

#[cfg(test)]
fn encode_rgb_image_as_capture_response(
    rgb_image: image::RgbImage,
) -> Result<CaptureResponse, String> {
    let started_at = Instant::now();
    let width = rgb_image.width();
    let height = rgb_image.height();
    let mut bytes = Vec::new();
    let encode_started_at = Instant::now();
    {
        use image::codecs::png::{CompressionType, FilterType, PngEncoder};
        use image::{ColorType, ImageEncoder};

        let encoder =
            PngEncoder::new_with_quality(&mut bytes, CompressionType::Fast, FilterType::NoFilter);
        encoder
            .write_image(rgb_image.as_raw(), width, height, ColorType::Rgb8.into())
            .map_err(|error| error.to_string())?;
    }
    let png_encode_ms = encode_started_at.elapsed().as_millis();

    let base64_started_at = Instant::now();
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let base64_encode_ms = base64_started_at.elapsed().as_millis();
    append_runtime_log_line(&format!(
        "encode_rgb_image_as_capture_response :: width={} height={} png_bytes={} encoded_chars={} png_encode_ms={} base64_encode_ms={} total_ms={}",
        width,
        height,
        bytes.len(),
        encoded.len(),
        png_encode_ms,
        base64_encode_ms,
        started_at.elapsed().as_millis()
    ));

    Ok(CaptureResponse {
        base64: format!("data:image/png;base64,{}", encoded),
        width,
        height,
        file_path: None,
        file_url: None,
        metadata: CaptureMetadata::sdr("test-encoder", false),
    })
}

fn file_url_from_path(path: &Path) -> String {
    let raw_path = path.to_string_lossy().replace('\\', "/");
    let mut url = String::from("file:///");
    const HEX: &[u8; 16] = b"0123456789ABCDEF";

    for &byte in raw_path.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' | b':' => {
                url.push(byte as char)
            }
            _ => {
                url.push('%');
                url.push(HEX[(byte >> 4) as usize] as char);
                url.push(HEX[(byte & 0x0f) as usize] as char);
            }
        }
    }

    url
}

pub(crate) fn encode_rgb_image_as_file_capture_response(
    rgb_image: image::RgbImage,
) -> Result<CaptureResponse, String> {
    encode_rgb_image_as_file_capture_response_with_metadata(
        rgb_image,
        CaptureMetadata::sdr("long-capture-stitch", false),
    )
}

pub(crate) fn encode_rgb_image_as_file_capture_response_with_metadata(
    rgb_image: image::RgbImage,
    metadata: CaptureMetadata,
) -> Result<CaptureResponse, String> {
    let started_at = Instant::now();
    let width = rgb_image.width();
    let height = rgb_image.height();
    let cache_dir = ensure_clipboard_cache_dir()?;
    let (file, file_path) =
        create_internal_capture_file(&cache_dir, "Hook_long_capture", &file_timestamp_component())?;

    let file_write_started_at = Instant::now();
    let write_result = (|| -> Result<(), String> {
        use image::codecs::png::{CompressionType, FilterType, PngEncoder};
        use image::{ColorType, ImageEncoder};

        let mut writer = BufWriter::new(file);
        let encoder =
            PngEncoder::new_with_quality(&mut writer, CompressionType::Fast, FilterType::NoFilter);
        encoder
            .write_image(rgb_image.as_raw(), width, height, ColorType::Rgb8.into())
            .map_err(|error| error.to_string())?;
        writer
            .flush()
            .map_err(|error| format!("Failed to flush PNG: {error}"))?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&file_path);
        return Err(error);
    }
    let file_write_ms = file_write_started_at.elapsed().as_millis();
    let png_bytes = fs::metadata(&file_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let file_url = file_url_from_path(&file_path);
    let file_path_string = file_path.to_string_lossy().to_string();
    append_runtime_log_line(&format!(
        "encode_rgb_image_as_file_capture_response :: width={} height={} png_bytes={} file_write_ms={} total_ms={} path={}",
        width,
        height,
        png_bytes,
        file_write_ms,
        started_at.elapsed().as_millis(),
        cache_file_name_for_log(&file_path)
    ));

    Ok(CaptureResponse {
        base64: String::new(),
        width,
        height,
        file_path: Some(file_path_string),
        file_url: Some(file_url),
        metadata,
    })
}

fn scaled_png_luminance(nits: f32) -> u32 {
    if !nits.is_finite() {
        return 0;
    }
    (nits.clamp(0.0, 10_000.0) * 10_000.0)
        .round()
        .clamp(0.0, u32::MAX as f32) as u32
}

fn write_hdr_png(writer: impl Write, image: &screenshot::HdrPqImage) -> Result<(), String> {
    let mut info = png::Info::with_size(image.width, image.height);
    info.color_type = png::ColorType::Rgb;
    info.bit_depth = png::BitDepth::Sixteen;
    info.source_chromaticities = Some(png::SourceChromaticities::new(
        (0.3127, 0.3290),
        (0.7080, 0.2920),
        (0.1700, 0.7970),
        (0.1310, 0.0460),
    ));
    let mut encoder = png::Encoder::with_info(writer, info).map_err(|error| error.to_string())?;
    encoder.set_compression(png::Compression::Fast);
    encoder.set_filter(png::Filter::NoFilter);
    let mut png_writer = encoder.write_header().map_err(|error| error.to_string())?;

    png_writer
        .write_chunk(png::chunk::cICP, &[9, 16, 0, 1])
        .map_err(|error| error.to_string())?;

    let chromaticity = |value: f32| (value * 50_000.0).round().clamp(0.0, u16::MAX as f32) as u16;
    let mut mastering_display = Vec::with_capacity(24);
    for value in [
        0.7080, 0.2920, // BT.2020 red
        0.1700, 0.7970, // BT.2020 green
        0.1310, 0.0460, // BT.2020 blue
        0.3127, 0.3290, // D65 white point
    ] {
        mastering_display.extend_from_slice(&chromaticity(value).to_be_bytes());
    }
    mastering_display
        .extend_from_slice(&scaled_png_luminance(image.mastering_max_luminance_nits).to_be_bytes());
    mastering_display
        .extend_from_slice(&scaled_png_luminance(image.mastering_min_luminance_nits).to_be_bytes());
    png_writer
        .write_chunk(png::chunk::mDCV, &mastering_display)
        .map_err(|error| error.to_string())?;

    let mut content_light = Vec::with_capacity(8);
    content_light
        .extend_from_slice(&scaled_png_luminance(image.max_content_light_level_nits).to_be_bytes());
    content_light.extend_from_slice(
        &scaled_png_luminance(image.max_frame_average_light_level_nits).to_be_bytes(),
    );
    png_writer
        .write_chunk(png::chunk::cLLI, &content_light)
        .map_err(|error| error.to_string())?;

    png_writer
        .write_image_data(&image.rgb16_be)
        .map_err(|error| error.to_string())?;
    png_writer.finish().map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn encode_hdr_image_as_file_capture_response(
    hdr_image: screenshot::HdrPqImage,
    metadata: CaptureMetadata,
) -> Result<CaptureResponse, String> {
    let started_at = Instant::now();
    let cache_dir = ensure_clipboard_cache_dir()?;
    let (file, file_path) =
        create_internal_capture_file(&cache_dir, "Hook_hdr_capture", &file_timestamp_component())?;
    let write_result = (|| -> Result<(), String> {
        let mut writer = BufWriter::new(file);
        write_hdr_png(&mut writer, &hdr_image)?;
        writer
            .flush()
            .map_err(|error| format!("Failed to flush HDR PNG: {error}"))?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&file_path);
        return Err(error);
    }

    let file_url = file_url_from_path(&file_path);
    let file_path_string = file_path.to_string_lossy().to_string();
    append_runtime_log_line(&format!(
        "encode_hdr_image_as_file_capture_response :: width={} height={} png_bytes={} max_cll_nits={} total_ms={} path={}",
        hdr_image.width,
        hdr_image.height,
        fs::metadata(&file_path).map(|metadata| metadata.len()).unwrap_or(0),
        hdr_image.max_content_light_level_nits,
        started_at.elapsed().as_millis(),
        cache_file_name_for_log(&file_path),
    ));

    Ok(CaptureResponse {
        base64: String::new(),
        width: hdr_image.width,
        height: hdr_image.height,
        file_path: Some(file_path_string),
        file_url: Some(file_url),
        metadata,
    })
}

fn logical_rect_to_capture_bounds(
    rect: LongCaptureSessionRect,
) -> Result<(i32, i32, u32, u32), String> {
    let width = rect.w.round();
    let height = rect.h.round();
    if width < 1.0 || height < 1.0 {
        return Err("Long capture session rectangle must be at least 1x1".to_string());
    }

    Ok((
        rect.x.round() as i32,
        rect.y.round() as i32,
        width as u32,
        height as u32,
    ))
}

#[tauri::command]
fn start_long_capture_session(
    sessions: tauri::State<SharedLongCaptureSessions>,
    rect: LongCaptureSessionRect,
    axis: Option<long_capture::LongCaptureAxis>,
) -> Result<String, String> {
    let (_, _, width, height) = logical_rect_to_capture_bounds(rect)?;
    let max_dimension = width.max(height);
    let max_scan = max_dimension.saturating_sub(1).max(32);
    let min_overlap_px = ((max_dimension as f64) * 0.03).round().max(16.0) as u32;
    let session_id = uuid::Uuid::new_v4().to_string();
    let session = LongCaptureSessionState {
        rect,
        axis,
        direction: None,
        frames: Vec::new(),
        last_frame_fingerprint: None,
        pair_analyses: Vec::new(),
        incremental_stitcher: None,
        stitch_worker_active: false,
        stitch_error: None,
        duplicate_count: 0,
        max_scan,
        min_overlap_px,
        created_at: Instant::now(),
    };

    let mut guard = sessions
        .sessions
        .lock()
        .map_err(|_| "long capture session lock poisoned".to_string())?;
    guard.insert(session_id.clone(), session);
    append_runtime_log_line(&format!(
        "start_long_capture_session :: id={} x={} y={} w={} h={} axis={:?}",
        session_id, rect.x, rect.y, rect.w, rect.h, axis
    ));
    Ok(session_id)
}

#[tauri::command]
async fn sample_long_capture_session(
    sessions: tauri::State<'_, SharedLongCaptureSessions>,
    session_id: String,
) -> Result<LongCaptureSessionSampleResponse, String> {
    let started_at = Instant::now();
    let work = {
        let guard = sessions
            .sessions
            .lock()
            .map_err(|_| "long capture session lock poisoned".to_string())?;
        let session = guard
            .get(&session_id)
            .ok_or_else(|| format!("Long capture session not found: {session_id}"))?;
        LongCaptureSessionSampleWork {
            rect: session.rect,
            previous_fingerprint: session.last_frame_fingerprint.clone(),
            expected_frame_count: session.frames.len(),
            axis: session
                .incremental_stitcher
                .as_ref()
                .and_then(|stitcher| stitcher.axis())
                .or(session.axis),
            max_scan: session.max_scan,
            min_overlap_px: session.min_overlap_px,
        }
    };

    let result =
        tokio::task::spawn_blocking(move || capture_and_classify_long_capture_sample(work))
            .await
            .map_err(|error| error.to_string())??;

    let mut guard = sessions
        .sessions
        .lock()
        .map_err(|_| "long capture session lock poisoned".to_string())?;
    let session = guard
        .get_mut(&session_id)
        .ok_or_else(|| format!("Long capture session not found: {session_id}"))?;

    if session.frames.len() != result.expected_frame_count {
        return Err(format!(
            "Long capture session changed while sample was in flight: expected {} frames, found {}",
            result.expected_frame_count,
            session.frames.len()
        ));
    }

    let (response, should_spawn_worker) =
        record_long_capture_session_sample_result(session, result)?;
    drop(guard);

    if should_spawn_worker {
        spawn_long_capture_stitch_worker(sessions.inner().clone(), session_id.clone());
    }

    let elapsed_ms = started_at.elapsed().as_millis();
    if should_log_long_capture_sample(&response, elapsed_ms) {
        append_runtime_log_line(&format!(
            "sample_long_capture_session :: id={} frame_count={} duplicate_count={} recorded={} status={:?} elapsed_ms={}",
            session_id,
            response.frame_count,
            response.duplicate_count,
            response.recorded,
            response.status,
            elapsed_ms
        ));
    }
    Ok(response)
}

#[tauri::command]
async fn finish_long_capture_session(
    sessions: tauri::State<'_, SharedLongCaptureSessions>,
    session_id: String,
) -> Result<CaptureResponse, String> {
    let finish_started_at = Instant::now();
    let wait_started_at = Instant::now();
    wait_for_long_capture_stitch_worker(sessions.inner().clone(), &session_id).await?;
    let wait_ms = wait_started_at.elapsed().as_millis();

    let session = {
        let remove_started_at = Instant::now();
        let mut guard = sessions
            .sessions
            .lock()
            .map_err(|_| "long capture session lock poisoned".to_string())?;
        let session = guard
            .remove(&session_id)
            .ok_or_else(|| format!("Long capture session not found: {session_id}"))?;
        append_runtime_log_line(&format!(
            "finish_long_capture_session_remove :: id={} elapsed_ms={}",
            session_id,
            remove_started_at.elapsed().as_millis()
        ));
        session
    };

    append_runtime_log_line(&format!(
        "finish_long_capture_session :: id={} frame_count={} wait_ms={} elapsed_ms={}",
        session_id,
        session.frames.len(),
        wait_ms,
        session.created_at.elapsed().as_millis()
    ));

    if session.frames.is_empty() {
        return Err("Long capture session has no frames".to_string());
    }

    let blocking_session_id = session_id.clone();
    let response = tokio::task::spawn_blocking(move || -> Result<CaptureResponse, String> {
        let blocking_started_at = Instant::now();
        let LongCaptureSessionState {
            frames,
            pair_analyses,
            incremental_stitcher,
            axis,
            max_scan,
            min_overlap_px,
            ..
        } = session;
        let stitch_started_at = Instant::now();
        let stitched = if let Some(stitcher) = incremental_stitcher {
            let flatten_started_at = Instant::now();
            let frame_count = stitcher.frame_count();
            let merged_frames = stitcher.merged_frames();
            let skipped_frames = stitcher.skipped_frames();
            let stitcher_axis = stitcher.axis();
            let adjacent_fast_path_merges = stitcher.adjacent_fast_path_merges();
            let aggregate_signature_searches = stitcher.aggregate_signature_searches();
            let expensive_adjacent_pair_analyses = stitcher.expensive_adjacent_pair_analyses();
            let aggregate_segment_count = stitcher.aggregate_segment_count();
            let image = stitcher.into_image();
            append_runtime_log_line(&format!(
                "finish_long_capture_session_incremental :: frame_count={} merged_frames={} skipped_frames={} axis={:?} fast_path={} aggregate_searches={} expensive_pair_analyses={} segments={} flatten_ms={} width={} height={}",
                frame_count,
                merged_frames,
                skipped_frames,
                stitcher_axis,
                adjacent_fast_path_merges,
                aggregate_signature_searches,
                expensive_adjacent_pair_analyses,
                aggregate_segment_count,
                flatten_started_at.elapsed().as_millis(),
                image.width(),
                image.height()
            ));
            image
        } else if frames.len() == 1 {
            frames[0].clone()
        } else if pair_analyses.len() + 1 == frames.len() {
            long_capture::stitch_long_capture_frames_with_analyses(
                &frames,
                &pair_analyses,
            )
            .map_err(|error| error.to_string())?
        } else {
            long_capture::stitch_long_capture_frames(
                &frames,
                long_capture::LongCaptureStitchOptions {
                    axis,
                    direction: None,
                    max_scan: Some(max_scan),
                    min_overlap_px: Some(min_overlap_px),
                },
            )
            .map_err(|error| error.to_string())?
        };

        let stitch_ms = stitch_started_at.elapsed().as_millis();
        let encode_started_at = Instant::now();
        let response = encode_rgb_image_as_file_capture_response(stitched)?;
        append_runtime_log_line(&format!(
            "finish_long_capture_session_blocking :: id={} stitch_ms={} encode_ms={} total_ms={}",
            blocking_session_id,
            stitch_ms,
            encode_started_at.elapsed().as_millis(),
            blocking_started_at.elapsed().as_millis()
        ));
        Ok(response)
    })
    .await
    .map_err(|error| error.to_string())??;
    append_runtime_log_line(&format!(
        "finish_long_capture_session_total :: id={} wait_ms={} total_ms={}",
        session_id,
        wait_ms,
        finish_started_at.elapsed().as_millis()
    ));
    Ok(response)
}

#[tauri::command]
fn cancel_long_capture_session(
    sessions: tauri::State<SharedLongCaptureSessions>,
    session_id: String,
) -> Result<(), String> {
    let mut guard = sessions
        .sessions
        .lock()
        .map_err(|_| "long capture session lock poisoned".to_string())?;
    let removed = guard.remove(&session_id);
    append_runtime_log_line(&format!(
        "cancel_long_capture_session :: id={} existed={}",
        session_id,
        removed.is_some()
    ));
    Ok(())
}

fn trigger_toggle_sticker_toolbar(window: &tauri::WebviewWindow) {
    append_runtime_log_line("trigger_toggle_sticker_toolbar");

    if let Err(e) = window.set_focus() {
        println!("Failed to set focus: {}", e);
        append_runtime_log_line(&format!(
            "trigger_toggle_sticker_toolbar focus_failed :: {}",
            e
        ));
    }

    if let Err(e) = window.emit("trigger-toggle-sticker-toolbar", ()) {
        println!("Failed to emit trigger-toggle-sticker-toolbar: {}", e);
        append_runtime_log_line(&format!(
            "trigger_toggle_sticker_toolbar emit_failed :: {}",
            e
        ));
    } else {
        append_runtime_log_line("trigger_toggle_sticker_toolbar emitted");
    }
}

#[tauri::command]
fn initialize_overlay(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        println!("Initializing overlay window state...");
        setup_overlay_window(&window);
    }
}

#[tauri::command]
fn get_boot_profile() -> BootProfile {
    boot_profile_from_env()
}

#[tauri::command]
fn show_canvas_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        show_canvas_window_impl(&window);
        return Ok(());
    }

    Err("Window not found".to_string())
}

#[tauri::command]
fn show_overlay_host(app: tauri::AppHandle, click_through: Option<bool>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        show_overlay_host_impl(&window, click_through.unwrap_or(true));
        return Ok(());
    }

    Err("Window not found".to_string())
}

#[tauri::command]
fn set_overlay_click_through(app: tauri::AppHandle, click_through: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        set_overlay_click_through_impl(&window, click_through);
        append_runtime_log_line(&format!(
            "set_overlay_click_through :: click_through={}",
            click_through
        ));
        return Ok(());
    }

    Err("Window not found".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_native_drag_preflight_active(active: bool) -> Result<(), String> {
    OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.store(active, Ordering::SeqCst);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_native_drag_preflight_active(_active: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn set_overlay_keyboard_capture_active(_app: tauri::AppHandle, active: bool) -> Result<(), String> {
    OVERLAY_KEYBOARD_CAPTURE_ACTIVE.store(active, Ordering::SeqCst);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn set_overlay_keyboard_capture_active(
    _app: tauri::AppHandle,
    _active: bool,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
fn focus_overlay_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        clear_overlay_no_activate(&window);
        if let Err(error) = window.set_focus() {
            apply_overlay_no_activate(&window);
            return Err(format!("Failed to focus overlay window: {}", error));
        }
        apply_overlay_no_activate(&window);
        append_runtime_log_line("focus_overlay_window");
        return Ok(());
    }

    Err("Window not found".to_string())
}

#[tauri::command]
fn set_overlay_capture_exclusion(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        set_overlay_capture_exclusion_impl(&window, enabled);
        append_runtime_log_line(&format!(
            "set_overlay_capture_exclusion :: enabled={}",
            enabled
        ));
        return Ok(());
    }

    Err("Window not found".to_string())
}

#[tauri::command]
fn hide_to_tray(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        hide_to_tray_impl(&window);
        return Ok(());
    }

    Err("Window not found".to_string())
}

#[tauri::command]
fn trigger_capture_mode(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        enter_capture_mode(&window);
        return Ok(());
    }

    Err("Window not found".to_string())
}

#[tauri::command]
fn trigger_long_capture_mode(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        enter_long_capture_mode(&window);
        return Ok(());
    }

    Err("Window not found".to_string())
}

#[tauri::command]
fn append_runtime_log(app: tauri::AppHandle, event: String, detail: Option<String>) {
    let suffix = detail
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" :: {}", value))
        .unwrap_or_default();
    append_runtime_log_line(&format!("{}{}", event, suffix));

    if uiaccess_build_enabled() && event == "frontend-mounted" {
        UIACCESS_FRONTEND_MOUNTED.store(true, Ordering::SeqCst);
        if UIACCESS_OVERLAY_STARTUP_STAGED.swap(false, Ordering::SeqCst) {
            let pending_click_through =
                UIACCESS_PENDING_OVERLAY_CLICK_THROUGH.load(Ordering::SeqCst);
            append_runtime_log_line("uiaccess_overlay_startup_finalize_requested");
            if let Some(window) = app.get_webview_window("main") {
                show_overlay_host_impl(&window, pending_click_through);
            } else {
                append_runtime_log_line("uiaccess_overlay_startup_finalize_window_missing");
            }
        }
    }
}

fn should_accept_tauri_shortcut_trigger(
    last_trigger: &Arc<std::sync::Mutex<std::time::Instant>>,
    duplicate_log_event: &str,
) -> bool {
    let mut guard = match last_trigger.lock() {
        Ok(guard) => guard,
        Err(_) => return false,
    };

    if guard.elapsed() <= std::time::Duration::from_millis(500) {
        append_runtime_log_line(duplicate_log_event);
        return false;
    }

    *guard = std::time::Instant::now();
    true
}

fn default_voice_config() -> voice::core::VoiceConfig {
    let voice_root = runtime_log_dir().join("voice");
    voice::core::VoiceConfig {
        trigger: voice::core::TriggerConfig {
            mode: voice::core::TriggerMode::Toggle,
            toggle_shortcut: "Ctrl+Alt+Space".to_string(),
        },
        audio: voice::core::AudioConfig {
            backend: voice::core::AudioBackendMode::Silent,
            max_recording_seconds: 60,
            sample_rate_hz: 16000,
            channels: 1,
            temp_dir: voice_root.join("audio"),
        },
        provider: voice::core::ProviderConfig {
            kind: voice::core::ProviderKind::Mock,
            mock_transcript: Some("hello from hook voice".to_string()),
            endpoint: None,
        },
        output: voice::core::OutputConfig {
            mode: voice::core::OutputMode::DryRun,
            restore_clipboard: true,
            clipboard_backend: voice::core::ClipboardBackendMode::Fallback,
        },
        logging: voice::core::LoggingConfig {
            dir: voice_root.join("logs"),
        },
        voice_mode: voice::core::VoiceMode::Dictate,
    }
}

async fn effective_voice_config() -> voice::core::VoiceConfig {
    let Some(base_url) = std::env::var("HOOK_LOOM_BASE_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return default_voice_config();
    };
    let token = std::env::var("HOOK_LOOM_AUTH_TOKEN").ok();
    match loom_config::read_hook_voice_config(&base_url, token.as_deref()).await {
        Ok(Some(config)) => config,
        Ok(None) => default_voice_config(),
        Err(error) => {
            append_runtime_log_line(&format!("loom_hook_voice_config_read_failed :: {error}"));
            default_voice_config()
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceSettingsSummary {
    shortcut: String,
    trigger_mode: String,
    audio_backend: String,
    provider_kind: String,
    output_mode: String,
    clipboard_backend: String,
    voice_mode: String,
}

impl VoiceSettingsSummary {
    fn from_config(config: &voice::core::VoiceConfig) -> Self {
        Self {
            shortcut: config.trigger.toggle_shortcut.clone(),
            trigger_mode: voice_trigger_mode_name(config.trigger.mode).to_string(),
            audio_backend: voice_audio_backend_name(config.audio.backend).to_string(),
            provider_kind: voice_provider_kind_name(config.provider.kind).to_string(),
            output_mode: voice_output_mode_name(config.output.mode).to_string(),
            clipboard_backend: voice_clipboard_backend_name(config.output.clipboard_backend)
                .to_string(),
            voice_mode: voice_mode_name(config.voice_mode).to_string(),
        }
    }
}

fn voice_trigger_mode_name(mode: voice::core::TriggerMode) -> &'static str {
    match mode {
        voice::core::TriggerMode::Toggle => "toggle",
        voice::core::TriggerMode::PushToTalk => "push_to_talk",
    }
}

fn voice_audio_backend_name(backend: voice::core::AudioBackendMode) -> &'static str {
    match backend {
        voice::core::AudioBackendMode::Silent => "silent",
        voice::core::AudioBackendMode::NativeWindows => "native_windows",
    }
}

fn voice_provider_kind_name(kind: voice::core::ProviderKind) -> &'static str {
    match kind {
        voice::core::ProviderKind::Mock => "mock",
        voice::core::ProviderKind::Http => "http",
    }
}

fn voice_output_mode_name(mode: voice::core::OutputMode) -> &'static str {
    match mode {
        voice::core::OutputMode::ClipboardPaste => "clipboard_paste",
        voice::core::OutputMode::DryRun => "dry_run",
    }
}

fn voice_clipboard_backend_name(backend: voice::core::ClipboardBackendMode) -> &'static str {
    match backend {
        voice::core::ClipboardBackendMode::Fallback => "fallback",
        voice::core::ClipboardBackendMode::NativeWindows => "native_windows",
    }
}

fn voice_mode_name(mode: voice::core::VoiceMode) -> &'static str {
    match mode {
        voice::core::VoiceMode::Dictate => "dictate",
        voice::core::VoiceMode::Polish => "polish",
        voice::core::VoiceMode::Translate => "translate",
        voice::core::VoiceMode::Command => "command",
    }
}

#[tauri::command]
async fn get_voice_settings_summary() -> VoiceSettingsSummary {
    let config = effective_voice_config().await;
    VoiceSettingsSummary::from_config(&config)
}

#[tauri::command]
async fn talk_capture_voice_once(
    request: Option<talk_connector::TalkVoiceCaptureRequest>,
) -> Result<talk_connector::TalkVoiceCaptureResult, String> {
    talk_connector::capture_voice_once(request.unwrap_or_default())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn loom_brain_plan(
    request: loom_connector::LoomBrainPlanRequest,
) -> Result<loom_connector::LoomBrainPlanResult, String> {
    loom_connector::invoke_brain_plan(request)
        .await
        .map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceSessionEventPayload {
    id: String,
    status: String,
    transcript: Option<String>,
    output_text: Option<String>,
    error: Option<String>,
    session_log_path: Option<String>,
}

fn voice_session_status_name(status: voice::core::SessionStatus) -> &'static str {
    match status {
        voice::core::SessionStatus::Idle => "idle",
        voice::core::SessionStatus::Recording => "recording",
        voice::core::SessionStatus::Transcribing => "transcribing",
        voice::core::SessionStatus::Processing => "processing",
        voice::core::SessionStatus::Inserting => "inserting",
        voice::core::SessionStatus::Completed => "completed",
        voice::core::SessionStatus::Failed => "failed",
        voice::core::SessionStatus::Cancelled => "cancelled",
    }
}

fn voice_session_completed_payload(
    report: voice::session::VoiceRunReport,
) -> VoiceSessionEventPayload {
    VoiceSessionEventPayload {
        id: report.session.id().to_string(),
        status: voice_session_status_name(report.session.status()).to_string(),
        transcript: report.session.transcript().map(str::to_string),
        output_text: report.session.output_text().map(str::to_string),
        error: report.session.error().map(str::to_string),
        session_log_path: Some(report.session_log_path.to_string_lossy().to_string()),
    }
}

fn voice_session_failed_payload(error: &voice::core::VoiceError) -> VoiceSessionEventPayload {
    VoiceSessionEventPayload {
        id: "unknown".to_string(),
        status: "failed".to_string(),
        transcript: None,
        output_text: None,
        error: Some(error.to_string()),
        session_log_path: None,
    }
}

fn spawn_voice_session_for_window(window: tauri::WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        let voice_config = effective_voice_config().await;
        let options = voice::session::VoiceRunOptions::default();
        match voice::session::run_voice_once(&voice_config, options).await {
            Ok(report) => {
                append_runtime_log_line("voice_session_completed");
                let payload = voice_session_completed_payload(report);
                if let Err(error) = window.emit("voice-session-event", payload) {
                    append_runtime_log_line(&format!("voice_session_emit_failed :: {}", error));
                }
            }
            Err(error) => {
                append_runtime_log_line(&format!("voice_session_failed :: {}", error));
                let payload = voice_session_failed_payload(&error);
                if let Err(emit_error) = window.emit("voice-session-event", payload) {
                    append_runtime_log_line(&format!(
                        "voice_session_emit_failed :: {}",
                        emit_error
                    ));
                }
            }
        }
    });
}

#[cfg(target_os = "windows")]
fn configure_webview2_video_safe_composition() {
    const ENV_NAME: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    const VIDEO_SAFE_ARGS: &[&str] = &[
        "--disable-gpu",
        "--disable-gpu-compositing",
        "--disable-gpu-rasterization",
        "--disable-zero-copy",
        "--disable-features=UseSkiaRenderer,CanvasOopRasterization",
    ];

    let existing_args = std::env::var(ENV_NAME).unwrap_or_default();
    let mut combined_args = existing_args.clone();
    for arg in VIDEO_SAFE_ARGS {
        if existing_args.contains(arg) || combined_args.contains(arg) {
            continue;
        }
        if !combined_args.trim().is_empty() {
            combined_args.push(' ');
        }
        combined_args.push_str(arg);
    }

    std::env::set_var(ENV_NAME, combined_args);
    append_runtime_log_line("webview2_video_safe_composition_args_applied");
}

#[cfg(not(target_os = "windows"))]
fn configure_webview2_video_safe_composition() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
    configure_webview2_video_safe_composition();

    let tauri_ctrl_1_last_trigger = Arc::new(std::sync::Mutex::new(
        std::time::Instant::now() - std::time::Duration::from_secs(2),
    ));
    let tauri_ctrl_3_last_trigger = Arc::new(std::sync::Mutex::new(
        std::time::Instant::now() - std::time::Duration::from_secs(2),
    ));
    let voice_hotkeys = Arc::new(std::sync::Mutex::new(
        voice::hotkey::HotkeyStateMachine::new_toggle("Ctrl+Alt+Space"),
    ));

    let run_result = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new().with_handler({
                let tauri_ctrl_1_last_trigger = tauri_ctrl_1_last_trigger.clone();
                let tauri_ctrl_3_last_trigger = tauri_ctrl_3_last_trigger.clone();
                let voice_hotkeys = voice_hotkeys.clone();
                move |app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        if shortcut.matches(Modifiers::CONTROL, Code::Digit1) {
                            if !should_accept_tauri_shortcut_trigger(
                                &tauri_ctrl_1_last_trigger,
                                "tauri_ctrl1_duplicate_ignored",
                            ) {
                                return;
                            }
                            println!("Global Shortcut Ctrl+1 Triggered");
                            if let Some(window) = app.get_webview_window("main") {
                                println!("Window found. Processing shortcut...");
                                enter_capture_mode(&window);
                            }
                        } else if shortcut.matches(Modifiers::CONTROL, Code::Digit3) {
                            if !should_accept_tauri_shortcut_trigger(
                                &tauri_ctrl_3_last_trigger,
                                "tauri_ctrl3_duplicate_ignored",
                            ) {
                                return;
                            }
                            println!("Global Shortcut Ctrl+3 Triggered");
                            if let Some(window) = app.get_webview_window("main") {
                                println!("Window found. Processing long screenshot shortcut...");
                                enter_long_capture_mode(&window);
                            }
                        } else if shortcut.matches(Modifiers::CONTROL, Code::Digit2) {
                            println!("Global Shortcut Ctrl+2 Triggered (OCR)");
                            if let Some(window) = app.get_webview_window("main") {
                                if let Err(e) = window.emit("trigger-ocr", ()) {
                                    println!("Failed to emit trigger-ocr: {}", e);
                                }
                            }
                        } else if shortcut.matches(Modifiers::CONTROL, Code::KeyE) {
                            println!("Global Shortcut Ctrl+E Triggered");
                            if let Some(window) = app.get_webview_window("main") {
                                println!("Window found. Processing sticker toolbar shortcut...");
                                trigger_toggle_sticker_toolbar(&window);
                            }
                        } else if shortcut
                            .matches(Modifiers::CONTROL | Modifiers::ALT, Code::Space)
                        {
                            let voice_event = match voice_hotkeys.lock() {
                                Ok(mut hotkeys) => {
                                    voice::hotkey::handle_voice_toggle_hotkey(&mut hotkeys)
                                }
                                Err(error) => {
                                    append_runtime_log_line(&format!(
                                        "voice_hotkey_lock_failed :: {}",
                                        error
                                    ));
                                    None
                                }
                            };

                            if let Some(voice_event) = voice_event {
                                let should_run_voice_session = matches!(
                                    voice_event.kind,
                                    voice::core::VoiceEventKind::TriggerStop
                                );
                                append_runtime_log_line(&format!(
                                    "voice_hotkey_event :: {:?}",
                                    voice_event.kind
                                ));
                                if let Some(window) = app.get_webview_window("main") {
                                    if let Err(error) =
                                        window.emit("voice-hotkey-event", voice_event)
                                    {
                                        append_runtime_log_line(&format!(
                                            "voice_hotkey_emit_failed :: {}",
                                            error
                                        ));
                                    }
                                    if should_run_voice_session {
                                        spawn_voice_session_for_window(window);
                                    }
                                } else {
                                    append_runtime_log_line("voice_hotkey_main_window_missing");
                                }
                            }
                        }
                    }
                }
            })
            .build(),
        )
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
             capture::capture_region,
             list_capture_window_targets,
             get_capture_cursor_position,
             update_pin_rects,
             set_mouse_monitor_active,
             begin_sticker_native_file_drag,
             begin_sticker_native_file_drag_from_path,
             save_sticker_image,
             save_sticker_image_as,
             save_sticker_drag_export,
             save_sticker_drag_export_from_path,
             get_cursor_position,
            copy_to_clipboard,
            copy_node_image_to_clipboard,
            copy_sticker_image_to_smart_clipboard,
            set_capture_input_active,
            set_desktop_color_picker_active,
            save_session,
            load_session,
            save_history,
            load_history,
            save_tool_settings,
            load_tool_settings,
            save_app_settings,
            load_app_settings,
            get_installed_fonts,
            initialize_overlay,
            get_boot_profile,
            get_voice_settings_summary,
            talk_capture_voice_once,
            loom_brain_plan,
            show_canvas_window,
            show_overlay_host,
            set_overlay_click_through,
            set_native_drag_preflight_active,
            set_overlay_keyboard_capture_active,
            focus_overlay_window,
            set_overlay_capture_exclusion,
            hide_to_tray,
            trigger_capture_mode,
            trigger_long_capture_mode,
            append_runtime_log,
            get_precise_selection,
            pick_screen_color_at,
            pick_screen_color_at_cursor,
            capture_vertical_long_region,
            stitch_vertical_long_capture_frames,
            analyze_long_capture_pair,
            stitch_long_capture_frames,
            start_long_capture_session,
            sample_long_capture_session,
            finish_long_capture_session,
            cancel_long_capture_session,
            trigger_ocr_event,
            tea_client::create_tea_ticket,
            mock_artloom::artloom_handshake,
            mock_artloom::artloom_dispatch_action,
            mock_artloom::prefetch_shader,
            read_shared_memory,
            read_image_from_path,
            cache_remote_image_asset,
            open_image_for_edit,
            read_clipboard_image
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            let _ = MAIN_UI_THREAD_ID.set(std::thread::current().id());
            let single_instance_guard =
                match try_acquire_single_instance(&single_instance_name()) {
                    Ok(Some(guard)) => guard,
                    Ok(None) => {
                        append_runtime_log_line("single_instance_already_running");
                        std::process::exit(0);
                    }
                    Err(error) => {
                        append_runtime_log_line(&format!(
                            "single_instance_acquire_failed :: {}",
                            error
                        ));
                        return Err(error.into());
                    }
                };
            // Intentionally leak the guard so the OS mutex stays held for the
            // entire process lifetime; it is released when the process exits.
            std::mem::forget(single_instance_guard);
            // A force-killed prior Hook cannot run its cleanup path. Once this
            // process owns the single-instance mutex, reload the user's cursor
            // scheme before Hook can enter capture mode again.
            restore_system_cursors_unconditionally();
            match emergency_watchdog::spawn_for_current_process() {
                Ok(watchdog_pid) => append_runtime_log_line(&format!(
                    "emergency_watchdog_spawned :: watchdog_pid={}",
                    watchdog_pid
                )),
                Err(error) => append_runtime_log_line(&format!(
                    "emergency_watchdog_spawn_failed :: {}",
                    error
                )),
            }

            // Initialize Shared State
            let hit_map = SharedHitMap::new();
            app.manage(hit_map.clone());
            let capture_input_state = SharedCaptureInputState::new();
            app.manage(capture_input_state.clone());
            let long_capture_sessions = SharedLongCaptureSessions::new();
            app.manage(long_capture_sessions.clone());
            let app_settings_dir = effective_app_data_dir(app.handle()).map_err(|error| {
                append_runtime_log_line(&format!("app_settings_dir_failed :: {error}"));
                error
            })?;
            let initial_app_settings =
                app_settings::load_app_settings(&app_settings_dir).map_err(|error| {
                    append_runtime_log_line(&format!("app_settings_load_failed :: {error}"));
                    error
                })?;
            app.manage(AppSettingsState::new(initial_app_settings));

            // Initialize Mock ArtLoom
            app.manage(MockArtLoom::new());
            if let Err(error) = cleanup_clipboard_cache() {
                append_runtime_log_line(&format!("clipboard_cache_cleanup_failed :: {}", error));
            }

            #[cfg(desktop)]
            {
                // Register Ctrl+1, Ctrl+2, Ctrl+3, Ctrl+E, and voice toggle Ctrl+Alt+Space.
                let ctrl_1 = Shortcut::new(Some(Modifiers::CONTROL), Code::Digit1);
                let ctrl_2 = Shortcut::new(Some(Modifiers::CONTROL), Code::Digit2);
                let ctrl_3 = Shortcut::new(Some(Modifiers::CONTROL), Code::Digit3);
                let ctrl_e = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyE);
                let ctrl_alt_space =
                    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
                let ctrl_1_global_registered = Arc::new(AtomicBool::new(false));
                let ctrl_3_global_registered = Arc::new(AtomicBool::new(false));

                if let Err(e) = app.global_shortcut().register(ctrl_1) {
                    println!("Warning: Failed to register Ctrl+1: {}", e);
                    append_runtime_log_line(&format!("register_ctrl1_failed :: {}", e));
                } else {
                    append_runtime_log_line("register_ctrl1_success");
                    ctrl_1_global_registered.store(true, Ordering::Relaxed);
                }
                if let Err(e) = app.global_shortcut().register(ctrl_2) {
                     println!("Warning: Failed to register Ctrl+2: {}", e);
                     append_runtime_log_line(&format!("register_ctrl2_failed :: {}", e));
                } else {
                     append_runtime_log_line("register_ctrl2_success");
                }
                if let Err(e) = app.global_shortcut().register(ctrl_3) {
                     println!("Warning: Failed to register Ctrl+3: {}", e);
                     append_runtime_log_line(&format!("register_ctrl3_failed :: {}", e));
                } else {
                     append_runtime_log_line("register_ctrl3_success");
                     ctrl_3_global_registered.store(true, Ordering::Relaxed);
                }
                if let Err(e) = app.global_shortcut().register(ctrl_e) {
                     println!("Warning: Failed to register Ctrl+E: {}", e);
                     append_runtime_log_line(&format!("register_ctrle_failed :: {}", e));
                } else {
                      append_runtime_log_line("register_ctrle_success");
                }
                if let Err(e) = app.global_shortcut().register(ctrl_alt_space) {
                    println!("Warning: Failed to register Ctrl+Alt+Space: {}", e);
                    append_runtime_log_line(&format!("register_voice_hotkey_failed :: {}", e));
                } else {
                    append_runtime_log_line("register_voice_hotkey_success");
                }

                let capture_item = MenuItem::with_id(app, "capture", "截图 (Ctrl+1)", true, None::<&str>)?;
                let long_capture_item = MenuItem::with_id(app, "long_capture", "长截图 (Ctrl+3)", true, None::<&str>)?;
                let open_image_item =
                    MenuItem::with_id(app, "open_image", "编辑已有图片… (Ctrl+O)", true, None::<&str>)?;
                let settings_item =
                    MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let tray_menu = Menu::with_items(
                    app,
                    &[
                        &capture_item,
                        &long_capture_item,
                        &open_image_item,
                        &settings_item,
                        &quit_item,
                    ],
                )?;

                let mut tray_builder = TrayIconBuilder::with_id("hook")
                    .menu(&tray_menu)
                    .tooltip("Hook")
                    .show_menu_on_left_click(true)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "capture" => {
                            if let Some(window) = app.get_webview_window("main") {
                                enter_capture_mode(&window);
                            }
                        }
                        "long_capture" => {
                            if let Some(window) = app.get_webview_window("main") {
                                enter_long_capture_mode(&window);
                            }
                        }
                        "open_image" => {
                            if let Some(window) = app.get_webview_window("main") {
                                show_overlay_host_impl(&window, false);
                                if let Err(e) = window.emit("trigger-open-image", ()) {
                                    append_runtime_log_line(&format!(
                                        "tray_open_image emit_failed :: {}",
                                        e
                                    ));
                                }
                            }
                        }
                        "settings" => {
                            if let Some(window) = app.get_webview_window("main") {
                                show_canvas_window_impl(&window);
                                if let Err(e) = window.emit("trigger-open-app-settings", ()) {
                                    append_runtime_log_line(&format!(
                                        "tray_settings emit_failed :: {}",
                                        e
                                    ));
                                }
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    });

                if let Some(icon) = app.default_window_icon().cloned() {
                    tray_builder = tray_builder.icon(icon);
                }

                let tray = tray_builder.build(app)?;
                app.manage(tray);

                let Some(window) = app.get_webview_window("main") else {
                    append_runtime_log_line("app_setup_main_window_missing");
                    return Err("main window missing during setup".into());
                };
                let boot_profile = boot_profile_from_env();
                append_runtime_log_line(&format!(
                    "app_setup :: startup_mode={} initial_ui_mode={} auto_start_capture={} art_loom_enabled={} art_loom_ws_url={}",
                    boot_profile.startup_mode,
                    boot_profile.initial_ui_mode,
                    boot_profile.auto_start_capture,
                    boot_profile.art_loom_enabled,
                    boot_profile.art_loom_ws_url
                ));
                install_capture_mouse_hook_thread(window.clone());
                install_overlay_keyboard_hook_thread(window.clone());
                if boot_profile.initial_ui_mode == "tray" {
                    hide_to_tray_impl(&window);
                } else if boot_profile.initial_ui_mode == "canvas" {
                    show_canvas_window_impl(&window);
                } else {
                    show_overlay_host_impl(&window, true);
                }
                let hit_map_clone = hit_map.clone();
                let capture_input_state_clone = capture_input_state.clone();
                let long_capture_sessions_clone = long_capture_sessions.clone();
                let ctrl_1_global_registered_for_rdev = ctrl_1_global_registered.clone();
                let ctrl_3_global_registered_for_rdev = ctrl_3_global_registered.clone();

                // Start Global Event Listener (Inputs)
                std::thread::spawn(move || {
                    struct RdevInputRuntimeState {
                        is_ignoring_events: bool,
                        ctrl_pressed: bool,
                        last_capture_trigger: std::time::Instant,
                    }

                    let input_runtime_state = std::sync::Mutex::new(RdevInputRuntimeState {
                        is_ignoring_events: false,
                        ctrl_pressed: false,
                        last_capture_trigger: std::time::Instant::now()
                            - std::time::Duration::from_secs(2),
                    });

                    if let Err(error) = rdev::listen(move |event| {
                        let mut input_state = match input_runtime_state.lock() {
                            Ok(guard) => guard,
                            Err(_) => return,
                        };

                        match &event.event_type {
                            rdev::EventType::KeyPress(rdev::Key::Escape) => {
                                handle_rdev_emergency_escape_transition(true);
                            }
                            rdev::EventType::KeyRelease(rdev::Key::Escape) => {
                                handle_rdev_emergency_escape_transition(false);
                                return;
                            }
                            _ => {}
                        }

                        if NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst) {
                            input_state.is_ignoring_events = true;
                            input_state.ctrl_pressed = false;
                            return;
                        }

                        match &event.event_type {
                            rdev::EventType::KeyPress(rdev::Key::ControlLeft)
                            | rdev::EventType::KeyPress(rdev::Key::ControlRight) => {
                                input_state.ctrl_pressed = true;
                            }
                            rdev::EventType::KeyRelease(rdev::Key::ControlLeft)
                            | rdev::EventType::KeyRelease(rdev::Key::ControlRight) => {
                                input_state.ctrl_pressed = false;
                            }
                            rdev::EventType::KeyPress(rdev::Key::Num1) => {
                                if input_state.ctrl_pressed
                                    && !ctrl_1_global_registered_for_rdev.load(Ordering::Relaxed)
                                    && input_state.last_capture_trigger.elapsed()
                                        > std::time::Duration::from_millis(500)
                                {
                                    input_state.last_capture_trigger = std::time::Instant::now();
                                    append_runtime_log_line("rdev_ctrl1_triggered");
                                    enter_capture_mode(&window);
                                }
                            }
                            rdev::EventType::KeyPress(rdev::Key::Num3) => {
                                if input_state.ctrl_pressed
                                    && !ctrl_3_global_registered_for_rdev.load(Ordering::Relaxed)
                                    && input_state.last_capture_trigger.elapsed()
                                        > std::time::Duration::from_millis(500)
                                {
                                    input_state.last_capture_trigger = std::time::Instant::now();
                                    append_runtime_log_line("rdev_ctrl3_triggered");
                                    enter_long_capture_mode(&window);
                                }
                            }
                            rdev::EventType::KeyPress(rdev::Key::Escape) => {
                                if overlay_keyboard_capture_should_handle_current_cursor() {
                                    append_runtime_log_line(
                                        "rdev_escape_skipped_overlay_keyboard_capture",
                                    );
                                    return;
                                }
                                let capture_active = capture_input_state_clone
                                    .active
                                    .lock()
                                    .map(|guard| *guard)
                                    .unwrap_or(false)
                                    || CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst);
                                let app_has_focus = overlay_webview_has_foreground_focus();
                                if !rdev_should_dispatch_app_scoped_shortcut(
                                    RdevAppScopedShortcut::Escape,
                                    app_has_focus,
                                    capture_active,
                                ) {
                                    append_runtime_log_line(
                                        "rdev_escape_skipped_unfocused_app_scope",
                                    );
                                    return;
                                }
                                append_runtime_log_line("rdev_escape_triggered");
                                set_capture_input_runtime_active(false);
                                let _ = window.emit("trigger-escape", ());
                            }
                            rdev::EventType::KeyPress(rdev::Key::Delete)
                            | rdev::EventType::KeyPress(rdev::Key::Backspace) => {
                                if overlay_keyboard_capture_should_handle_current_cursor() {
                                    append_runtime_log_line(
                                        "rdev_delete_skipped_overlay_keyboard_capture",
                                    );
                                    return;
                                }
                                let app_has_focus = overlay_webview_has_foreground_focus();
                                if !rdev_should_dispatch_app_scoped_shortcut(
                                    RdevAppScopedShortcut::Delete,
                                    app_has_focus,
                                    false,
                                ) {
                                    append_runtime_log_line(
                                        "rdev_delete_skipped_unfocused_app_scope",
                                    );
                                    return;
                                }
                                append_runtime_log_line("rdev_delete_triggered");
                                let _ = window.emit("trigger-delete", ());
                            }
                            rdev::EventType::KeyPress(rdev::Key::Return) => {
                                append_runtime_log_line("rdev_enter_triggered");
                                let _ = window.emit("trigger-long-capture-finish", ());
                            }
                            rdev::EventType::Wheel { delta_x, delta_y } => {
                                let capture_active = capture_input_state_clone
                                    .active
                                    .lock()
                                    .map(|guard| *guard)
                                    .unwrap_or(false);
                                if capture_active {
                                    return;
                                }

                                let has_long_capture_sessions = long_capture_sessions_clone
                                    .sessions
                                    .lock()
                                    .ok()
                                    .map(|sessions| !sessions.is_empty())
                                    .unwrap_or(false);
                                if has_long_capture_sessions {
                                    append_runtime_log_line(&format!(
                                        "rdev_long_capture_wheel :: delta_x={} delta_y={}",
                                        delta_x, delta_y
                                    ));
                                    let _ = window.emit("trigger-long-capture-wheel", LongCaptureWheelEvent {
                                        delta_x: *delta_x,
                                        delta_y: *delta_y,
                                    });
                                }
                            }
                            rdev::EventType::MouseMove { x, y } => {
                                let _ = (x, y);
                                if NATIVE_FILE_DRAG_ACTIVE.load(Ordering::SeqCst)
                                    || NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst)
                                {
                                    input_state.is_ignoring_events = true;
                                    return;
                                }
                                let capture_active = capture_input_state_clone
                                    .active
                                    .lock()
                                    .map(|guard| *guard)
                                    .unwrap_or(false);
                                if capture_active {
                                    return;
                                }
                                if should_suppress_overlay_interaction_for_current_occlusion() {
                                    if !input_state.is_ignoring_events {
                                        let _ = window.set_ignore_cursor_events(true);
                                        set_overlay_transparent_style(&window, true);
                                        OVERLAY_CLICK_THROUGH_ACTIVE.store(true, Ordering::SeqCst);
                                        apply_overlay_no_activate(&window);
                                        input_state.is_ignoring_events = true;
                                    }
                                    return;
                                }

                                // Hit Testing Logic
                                let active = hit_map_clone
                                    .active
                                    .lock()
                                    .map(|guard| *guard)
                                    .unwrap_or(false);
                                if active {
                                    let should_ignore = hit_map_clone
                                        .rectangles
                                        .lock()
                                        .map(|rects| {
                                            should_overlay_window_ignore_cursor_events(
                                                &rects,
                                                *x,
                                                *y,
                                            )
                                        })
                                        .unwrap_or(true);
                                    if should_ignore != input_state.is_ignoring_events {
                                        let _ = window.set_ignore_cursor_events(should_ignore);
                                        set_overlay_transparent_style(&window, should_ignore);
                                        OVERLAY_CLICK_THROUGH_ACTIVE
                                            .store(should_ignore, Ordering::SeqCst);
                                        apply_overlay_no_activate(&window);
                                        input_state.is_ignoring_events = should_ignore;
                                    }
                                } else {
                                    input_state.is_ignoring_events = false;
                                }
                            }
                            _ => {}
                        }
                    }) {
                        println!("Error: {:?}", error);
                        append_runtime_log_line(&format!("rdev_listen_failed :: {:?}", error));
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!());
    prepare_for_hook_process_exit("tauri_run_returned");
    run_result.expect("error while running tauri application");
}

#[cfg(test)]
mod app_cli_tests {
    use super::*;
    use image::Rgb;

    fn solid_rows(width: u32, rows: &[[u8; 3]]) -> image::RgbImage {
        let mut image = image::RgbImage::new(width, rows.len() as u32);
        for (y, color) in rows.iter().enumerate() {
            for x in 0..width {
                image.put_pixel(x, y as u32, Rgb(*color));
            }
        }
        image
    }

    fn unique_line_color_for_test(value: u32) -> [u8; 3] {
        [
            (value & 0xff) as u8,
            ((value >> 8) & 0xff) as u8,
            ((value * 37 + 19) % 251) as u8,
        ]
    }

    fn unique_rows_for_test(start: u32, count: u32) -> Vec<[u8; 3]> {
        (start..start + count)
            .map(unique_line_color_for_test)
            .collect()
    }

    fn patterned_columns(height: u32, start: u32, count: u32) -> image::RgbImage {
        let mut image = image::RgbImage::new(count, height);
        for x in 0..count {
            let doc_x = start + x;
            for y in 0..height {
                image.put_pixel(
                    x,
                    y,
                    Rgb([
                        ((doc_x * 11 + y * 3) % 251) as u8,
                        ((doc_x * 13 + y * 5 + 17) % 251) as u8,
                        ((doc_x * 17 + y * 7 + 29) % 251) as u8,
                    ]),
                );
            }
        }
        image
    }

    fn tiny_png_data_url_for_test(color: [u8; 3]) -> String {
        let image = image::RgbImage::from_pixel(1, 1, Rgb(color));
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("encode tiny png");
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    }

    fn set_file_modified_time_for_test(path: &Path, time: SystemTime) -> std::io::Result<()> {
        let file_time = filetime::FileTime::from_system_time(time);
        filetime::set_file_mtime(path, file_time)
    }

    fn clipboard_cache_env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .expect("clipboard cache env lock should not be poisoned")
    }

    #[test]
    fn long_capture_recording_classifies_first_frame_as_recorded() {
        let frame = image::RgbImage::from_pixel(16, 16, Rgb([255, 255, 255]));

        let classification = classify_long_capture_recording_frame(None, &frame, None, 32, 1, 1);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
    }

    #[test]
    fn long_capture_recording_ignores_duplicate_frame() {
        let previous = image::RgbImage::from_pixel(16, 16, Rgb([255, 255, 255]));
        let current = previous.clone();

        let classification =
            classify_long_capture_recording_frame(Some(&previous), &current, None, 32, 1, 1);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Duplicate
        ));
    }

    #[test]
    fn long_capture_recording_ignores_sparse_stationary_pixel_noise() {
        let previous = image::RgbImage::from_pixel(640, 160, Rgb([255, 255, 255]));
        let mut current = previous.clone();
        current.put_pixel(123, 77, Rgb([20, 20, 20]));

        let classification =
            classify_long_capture_recording_frame(Some(&previous), &current, None, 159, 16, 2);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Duplicate
        ));
        assert!(classification.analysis.is_none());
    }

    #[test]
    fn long_capture_recording_ignores_stationary_animation_without_scroll_motion() {
        let previous = image::RgbImage::from_pixel(320, 160, Rgb([255, 255, 255]));
        let mut current = previous.clone();
        for y in 48..112 {
            for x in 120..200 {
                current.put_pixel(x, y, Rgb([16, 96, 220]));
            }
        }

        let classification =
            classify_long_capture_recording_frame(Some(&previous), &current, None, 159, 16, 1);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Duplicate
        ));
        assert!(classification.analysis.is_none());
    }

    #[test]
    fn long_capture_recording_keeps_tiny_vertical_scroll_motion() {
        let previous = solid_rows(32, &unique_rows_for_test(0, 80));
        let current = solid_rows(32, &unique_rows_for_test(1, 80));

        let classification = classify_long_capture_recording_frame(
            Some(&previous),
            &current,
            Some(long_capture::LongCaptureAxis::Vertical),
            79,
            16,
            2,
        );

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
        assert!(classification.analysis.is_none());
    }

    #[test]
    fn long_capture_recording_keeps_meaningfully_changed_frame() {
        let previous = solid_rows(
            8,
            &[
                [10, 0, 0],
                [20, 0, 0],
                [30, 0, 0],
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
            ],
        );
        let current = solid_rows(
            8,
            &[
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
                [70, 0, 0],
                [80, 0, 0],
                [90, 0, 0],
            ],
        );

        let classification = classify_long_capture_recording_frame(
            Some(&previous),
            &current,
            Some(long_capture::LongCaptureAxis::Vertical),
            5,
            1,
            1,
        );

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
    }

    #[test]
    fn long_capture_recording_ignores_non_duplicate_jump_without_scroll_overlap() {
        let previous = solid_rows(
            4,
            &[
                [10, 0, 0],
                [20, 0, 0],
                [30, 0, 0],
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
            ],
        );
        let current = solid_rows(
            4,
            &[
                [130, 0, 0],
                [140, 0, 0],
                [150, 0, 0],
                [160, 0, 0],
                [170, 0, 0],
                [180, 0, 0],
            ],
        );

        let classification = classify_long_capture_recording_frame(
            Some(&previous),
            &current,
            Some(long_capture::LongCaptureAxis::Vertical),
            5,
            1,
            1,
        );

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Duplicate
        ));
        assert!(classification.analysis.is_none());
    }

    #[test]
    fn long_capture_recording_queues_incremental_stitching_off_the_sample_path() {
        let rect = LongCaptureSessionRect {
            x: 0.0,
            y: 0.0,
            w: 8.0,
            h: 80.0,
        };
        let mut session = LongCaptureSessionState {
            rect,
            axis: Some(long_capture::LongCaptureAxis::Vertical),
            direction: None,
            frames: Vec::new(),
            last_frame_fingerprint: None,
            pair_analyses: Vec::new(),
            incremental_stitcher: None,
            stitch_worker_active: false,
            stitch_error: None,
            duplicate_count: 0,
            max_scan: 79,
            min_overlap_px: 12,
            created_at: Instant::now(),
        };
        let first = solid_rows(8, &[[10, 0, 0]; 80]);
        let second = solid_rows(8, &[[20, 0, 0]; 80]);
        let first_fingerprint = long_capture_frame_fingerprint(&first);
        let second_fingerprint = long_capture_frame_fingerprint(&second);

        let first_result = LongCaptureSessionSampleResult {
            frame: first,
            fingerprint: first_fingerprint,
            status: LongCaptureSessionSampleStatus::Recorded,
            analysis: None,
            expected_frame_count: 0,
        };
        let (_, first_should_spawn) =
            record_long_capture_session_sample_result(&mut session, first_result)
                .expect("first frame should initialize stitcher");
        assert!(!first_should_spawn);
        assert_eq!(
            session
                .incremental_stitcher
                .as_ref()
                .expect("stitcher should exist after first frame")
                .frame_count(),
            1
        );

        let second_result = LongCaptureSessionSampleResult {
            frame: second,
            fingerprint: second_fingerprint,
            status: LongCaptureSessionSampleStatus::Recorded,
            analysis: None,
            expected_frame_count: 1,
        };
        let (_, second_should_spawn) =
            record_long_capture_session_sample_result(&mut session, second_result)
                .expect("second frame should be queued for background stitching");

        assert!(second_should_spawn);
        assert!(session.stitch_worker_active);
        assert_eq!(session.frames.len(), 2);
        assert_eq!(
            session
                .incremental_stitcher
                .as_ref()
                .expect("stitcher should stay on first frame until worker drains queue")
                .frame_count(),
            1
        );
    }

    #[test]
    fn long_capture_frame_fingerprint_detects_duplicate_samples_without_previous_frame_clone() {
        let first = solid_rows(8, &unique_rows_for_test(0, 12));
        let same = first.clone();
        let scrolled = solid_rows(8, &unique_rows_for_test(1, 12));

        let first_fingerprint = long_capture_frame_fingerprint(&first);
        assert_eq!(first_fingerprint, long_capture_frame_fingerprint(&same));
        assert_ne!(first_fingerprint, long_capture_frame_fingerprint(&scrolled));

        let same_fingerprint = long_capture_frame_fingerprint(&same);
        let duplicate = classify_long_capture_recording_fingerprint(
            Some(&first_fingerprint),
            &same_fingerprint,
            Some(long_capture::LongCaptureAxis::Vertical),
            11,
            1,
        );
        assert!(matches!(
            duplicate.status,
            LongCaptureSessionSampleStatus::Duplicate
        ));

        let changed_fingerprint = long_capture_frame_fingerprint(&scrolled);
        let recorded = classify_long_capture_recording_fingerprint(
            Some(&first_fingerprint),
            &changed_fingerprint,
            Some(long_capture::LongCaptureAxis::Vertical),
            11,
            1,
        );
        assert!(matches!(
            recorded.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
    }

    #[test]
    fn fast_png_capture_response_roundtrips_rgb_image() {
        let image = solid_rows(4, &[[10, 20, 30], [40, 50, 60]]);
        let response =
            encode_rgb_image_as_capture_response(image.clone()).expect("fast png encode succeeds");
        let image_bytes =
            decode_base64_image_data(&response.base64).expect("fast png response decodes");
        let decoded = image::load_from_memory(&image_bytes)
            .expect("fast png bytes load")
            .to_rgb8();

        assert_eq!(response.width, image.width());
        assert_eq!(response.height, image.height());
        assert_eq!(decoded, image);
    }

    #[test]
    fn hdr_png_encoder_writes_16_bit_bt2020_pq_metadata() {
        let image = screenshot::HdrPqImage {
            width: 1,
            height: 1,
            rgb16_be: vec![0x80, 0x00, 0x40, 0x00, 0x20, 0x00],
            max_content_light_level_nits: 1_000.0,
            max_frame_average_light_level_nits: 250.0,
            mastering_min_luminance_nits: 0.001,
            mastering_max_luminance_nits: 1_000.0,
        };
        let mut bytes = Vec::new();
        write_hdr_png(&mut bytes, &image).expect("HDR PNG encode succeeds");

        let decoder = png::Decoder::new(std::io::BufReader::new(std::io::Cursor::new(bytes)));
        let reader = decoder.read_info().expect("HDR PNG metadata decodes");
        let info = reader.info();
        assert_eq!(info.bit_depth, png::BitDepth::Sixteen);
        assert_eq!(info.color_type, png::ColorType::Rgb);
        let cicp = info
            .coding_independent_code_points
            .expect("HDR PNG must contain cICP");
        assert_eq!(cicp.color_primaries, 9);
        assert_eq!(cicp.transfer_function, 16);
        assert_eq!(cicp.matrix_coefficients, 0);
        assert!(cicp.is_video_full_range_image);
        assert_eq!(
            info.content_light_level
                .expect("HDR PNG must contain cLLI")
                .max_content_light_level,
            10_000_000,
        );
    }

    #[test]
    fn file_url_from_path_escapes_windows_path_for_webview_images() {
        let path = PathBuf::from(r"C:\Users\Public\Hook Cache\long#1%.png");

        assert_eq!(
            file_url_from_path(&path),
            "file:///C:/Users/Public/Hook%20Cache/long%231%25.png"
        );
    }

    #[test]
    fn remote_image_cache_extension_prefers_actual_image_bytes() {
        let image =
            image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(1, 1, Rgb([1, 2, 3])));
        let mut bytes = Vec::new();
        image
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("encode png bytes");

        assert_eq!(
            remote_image_cache_extension(
                "https://example.com/photo.jpg?format=jpeg",
                &bytes,
                Some("image/jpeg"),
            ),
            "png"
        );
    }

    #[test]
    fn find_cached_remote_image_path_matches_url_hash_prefix() {
        let root = std::env::temp_dir().join(format!(
            "hook-remote-image-cache-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create cache test dir");
        let url = "https://example.com/images/cat.png?size=small";
        let expected = root.join(format!("remote_{}.webp", remote_image_cache_key(url)));
        std::fs::write(&expected, [1u8, 2, 3]).expect("write cached remote file");

        let found =
            find_cached_remote_image_path(&root, url).expect("remote cache lookup succeeds");

        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(found, Some(expected));
    }

    #[test]
    fn file_capture_response_writes_png_cache_without_base64_payload() {
        let _env_guard = clipboard_cache_env_lock();
        let env_name = "HOOK_CLIPBOARD_CACHE_DIR";
        let cache_dir = std::env::temp_dir().join(format!(
            "hook-file-capture-response-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::env::set_var(env_name, &cache_dir);

        let image = solid_rows(4, &[[10, 20, 30], [40, 50, 60]]);
        let response = encode_rgb_image_as_file_capture_response(image.clone())
            .expect("file-backed png response succeeds");

        std::env::remove_var(env_name);

        assert!(response.base64.is_empty());
        assert_eq!(response.width, image.width());
        assert_eq!(response.height, image.height());
        let file_path = response.file_path.expect("file path is returned");
        let file_url = response.file_url.expect("file URL is returned");
        assert_eq!(file_url, file_url_from_path(Path::new(&file_path)));

        let decoded = image::open(&file_path)
            .expect("written png loads")
            .to_rgb8();
        let _ = std::fs::remove_dir_all(&cache_dir);
        assert_eq!(decoded, image);
    }

    #[test]
    fn internal_capture_file_allocation_is_atomic_for_identical_timestamps() {
        let root = std::env::temp_dir().join(format!(
            "hook-internal-capture-allocation-test-{}-{}",
            std::process::id(),
            file_timestamp_component(),
        ));
        std::fs::create_dir_all(&root).expect("create capture allocation test dir");

        let (mut first, first_path) =
            create_internal_capture_file(&root, "Hook_long_capture", "1234").unwrap();
        first.write_all(b"first").unwrap();
        drop(first);
        let (mut second, second_path) =
            create_internal_capture_file(&root, "Hook_long_capture", "1234").unwrap();
        second.write_all(b"second").unwrap();
        drop(second);

        assert_ne!(first_path, second_path);
        assert_eq!(std::fs::read(&first_path).unwrap(), b"first");
        assert_eq!(std::fs::read(&second_path).unwrap(), b"second");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn failed_internal_hdr_capture_removes_partial_file() {
        let _env_guard = clipboard_cache_env_lock();
        let env_name = "HOOK_CLIPBOARD_CACHE_DIR";
        let cache_dir = std::env::temp_dir().join(format!(
            "hook-failed-hdr-capture-test-{}-{}",
            std::process::id(),
            file_timestamp_component(),
        ));
        std::env::set_var(env_name, &cache_dir);
        let invalid_image = screenshot::HdrPqImage {
            width: 1,
            height: 1,
            rgb16_be: Vec::new(),
            max_content_light_level_nits: 1_000.0,
            max_frame_average_light_level_nits: 250.0,
            mastering_min_luminance_nits: 0.001,
            mastering_max_luminance_nits: 1_000.0,
        };

        let result = encode_hdr_image_as_file_capture_response(
            invalid_image,
            CaptureMetadata::hdr("test-invalid-hdr"),
        );

        std::env::remove_var(env_name);
        assert!(result.is_err());
        assert!(
            !cache_dir.exists()
                || std::fs::read_dir(&cache_dir).unwrap().all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".png")),
            "failed HDR encoding must not leave a partial PNG"
        );
        let _ = std::fs::remove_dir_all(cache_dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn stage_drag_out_file_copy_creates_disposable_copy_without_moving_original() {
        let _env_guard = clipboard_cache_env_lock();
        let env_name = "HOOK_CLIPBOARD_CACHE_DIR";
        let root = std::env::temp_dir().join(format!(
            "hook-stage-drag-file-copy-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        let cache_dir = root.join("cache");
        let source_dir = root.join("source");
        std::fs::create_dir_all(&cache_dir).expect("create cache dir");
        std::fs::create_dir_all(&source_dir).expect("create source dir");
        std::env::set_var(env_name, &cache_dir);

        let source_path = source_dir.join("original sticker.png");
        let source_bytes = vec![1u8, 2, 3, 4, 5, 6];
        std::fs::write(&source_path, &source_bytes).expect("write source file");

        let staged_path =
            stage_drag_out_file_copy(&source_path, Some("导出贴图")).expect("stage drag file copy");

        std::env::remove_var(env_name);

        assert!(
            source_path.exists(),
            "original sticker file should remain in place"
        );
        assert!(staged_path.exists(), "staged drag file should exist");
        assert_ne!(
            staged_path, source_path,
            "staged path should differ from source path"
        );
        assert_eq!(
            std::fs::read(&staged_path).expect("read staged file"),
            source_bytes
        );
        assert_eq!(staged_path.file_name().unwrap(), "导出贴图.png");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn long_capture_sample_logging_is_throttled_to_first_periodic_and_slow_samples() {
        let response = LongCaptureSessionSampleResponse {
            status: LongCaptureSessionSampleStatus::Recorded,
            frame_count: 3,
            duplicate_count: 0,
            recorded: true,
            axis: Some(long_capture::LongCaptureAxis::Vertical),
            direction: None,
        };
        assert!(!should_log_long_capture_sample(&response, 5));

        let first_response = LongCaptureSessionSampleResponse {
            frame_count: 1,
            ..response.clone()
        };
        assert!(should_log_long_capture_sample(&first_response, 5));

        let periodic_response = LongCaptureSessionSampleResponse {
            frame_count: 20,
            ..response.clone()
        };
        assert!(should_log_long_capture_sample(&periodic_response, 5));

        assert!(should_log_long_capture_sample(&response, 45));
    }

    #[test]
    fn long_capture_worker_rest_policy_yields_when_idle_slow_or_after_a_burst() {
        assert!(should_rest_long_capture_stitch_worker(0, 1, 1));
        assert!(should_rest_long_capture_stitch_worker(5, 1, 45));
        assert!(should_rest_long_capture_stitch_worker(5, 8, 1));
        assert!(!should_rest_long_capture_stitch_worker(5, 3, 1));
    }

    #[test]
    fn long_capture_sample_removes_captured_guide_blue_edge_lines() {
        let mut frame = image::RgbImage::from_pixel(12, 8, Rgb([245, 245, 245]));
        for x in 0..frame.width() {
            frame.put_pixel(x, 0, Rgb([170, 196, 255]));
            frame.put_pixel(x, 1, Rgb([170, 196, 255]));
        }
        for y in 0..frame.height() {
            frame.put_pixel(0, y, Rgb([170, 196, 255]));
            frame.put_pixel(frame.width() - 1, y, Rgb([170, 196, 255]));
        }
        frame.put_pixel(6, 4, Rgb([20, 30, 40]));

        remove_long_capture_overlay_guide_edges(&mut frame);

        assert_ne!(frame.get_pixel(6, 0).0, [170, 196, 255]);
        assert_ne!(frame.get_pixel(0, 4).0, [170, 196, 255]);
        assert_eq!(frame.get_pixel(6, 4).0, [20, 30, 40]);
    }

    #[test]
    fn long_capture_recording_defers_vertical_axis_detection_to_finish_time() {
        let previous = solid_rows(
            8,
            &[
                [10, 0, 0],
                [20, 0, 0],
                [30, 0, 0],
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
            ],
        );
        let current = solid_rows(
            8,
            &[
                [30, 0, 0],
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
                [70, 0, 0],
                [80, 0, 0],
            ],
        );

        let classification =
            classify_long_capture_recording_frame(Some(&previous), &current, None, 5, 1, 1);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
        assert!(classification.analysis.is_none());
    }

    #[test]
    fn long_capture_recording_defers_horizontal_axis_detection_to_finish_time() {
        let previous = patterned_columns(8, 0, 8);
        let current = patterned_columns(8, 2, 8);

        let classification =
            classify_long_capture_recording_frame(Some(&previous), &current, None, 7, 1, 1);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
        assert!(classification.analysis.is_none());
    }

    #[test]
    fn image_data_decoder_rejects_oversized_payload_before_decoding() {
        let oversized = format!(
            "data:image/png;base64,{}",
            "A".repeat(MAX_BASE64_IMAGE_ENCODED_BYTES + 1)
        );

        let error = decode_base64_image_data(&oversized).expect_err("oversized input is rejected");

        assert!(error.contains("Image payload too large"));
        assert!(error.contains("67108864"));
    }

    #[test]
    fn image_data_decoder_validates_decoded_image_dimensions() {
        let not_an_image = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(b"not an image")
        );

        let error =
            decode_base64_image_data(&not_an_image).expect_err("non-image input is rejected");

        assert!(error.contains("Image load failed"));
    }

    #[test]
    fn clipboard_cache_dir_prefers_explicit_env_override_for_tests_and_portable_builds() {
        let _env_guard = clipboard_cache_env_lock();
        let env_name = "HOOK_CLIPBOARD_CACHE_DIR";
        let cache_dir =
            std::env::temp_dir().join(format!("hook-cache-dir-test-{}", std::process::id()));
        std::env::set_var(env_name, &cache_dir);

        let resolved = clipboard_cache_dir();

        std::env::remove_var(env_name);
        assert_eq!(resolved, cache_dir);
    }

    #[test]
    fn clipboard_cache_cleanup_removes_old_files_and_trims_total_size() {
        let root = std::env::temp_dir().join(format!(
            "hook-cache-cleanup-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create cache test dir");
        let old_file = root.join("old.png");
        let new_file = root.join("new.png");
        let extra_file = root.join("extra.png");
        std::fs::write(&old_file, vec![1u8; 80]).expect("write old file");
        std::fs::write(&new_file, vec![2u8; 80]).expect("write new file");
        std::fs::write(&extra_file, vec![3u8; 80]).expect("write extra file");

        let now = SystemTime::now();
        let old_time = now - std::time::Duration::from_secs(CLIPBOARD_CACHE_MAX_AGE_SECS + 60);
        set_file_modified_time_for_test(&old_file, old_time).expect("set old file mtime");

        cleanup_clipboard_cache_dir(&root, now, 160, 100).expect("cleanup succeeds");

        assert!(!old_file.exists(), "old cache file should be removed");
        let remaining_size: u64 = std::fs::read_dir(&root)
            .expect("read cache test dir")
            .filter_map(Result::ok)
            .filter_map(|entry| entry.metadata().ok())
            .map(|metadata| metadata.len())
            .sum();
        let _ = std::fs::remove_dir_all(&root);
        assert!(
            remaining_size <= 100,
            "cache should be trimmed to target size"
        );
    }

    #[test]
    fn effective_app_data_dir_prefers_legacy_state_when_current_identifier_dir_is_empty() {
        let root = std::env::temp_dir().join(format!(
            "hook-app-data-legacy-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        let current_dir = root.join("com.yamiyu.hook");
        let legacy_dir = root.join("io.github.aiaimimi0920.hook");
        std::fs::create_dir_all(&current_dir).expect("create current dir");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy dir");
        std::fs::write(legacy_dir.join("session.json"), "{}").expect("write legacy session");

        let resolved = resolve_effective_app_data_dir(&current_dir);

        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(resolved, legacy_dir);
    }

    #[test]
    fn app_settings_state_serves_cached_values_and_preserves_them_after_failed_save() {
        let root = std::env::temp_dir().join(format!(
            "hook-app-settings-state-test-{}-{}",
            std::process::id(),
            file_timestamp_component(),
        ));
        let state = AppSettingsState::new(app_settings::AppSettings::default());
        let mut settings = app_settings::AppSettings::default();
        settings.file_naming.drag_export_pattern = "cached_{unitId}".to_string();

        let saved = state.save(&root, settings.clone()).unwrap();
        assert_eq!(state.snapshot().unwrap(), saved);
        std::fs::write(root.join("app-settings.json"), b"{ externally corrupted").unwrap();
        assert_eq!(state.snapshot().unwrap(), saved);

        let mut invalid = settings;
        invalid.file_naming.drag_export_pattern = "{unsupported}".to_string();
        assert!(state.save(&root, invalid).is_err());
        assert_eq!(state.snapshot().unwrap(), saved);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn effective_app_data_dir_prefers_current_state_once_current_identifier_dir_is_populated() {
        let root = std::env::temp_dir().join(format!(
            "hook-app-data-current-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        let current_dir = root.join("com.yamiyu.hook");
        let legacy_dir = root.join("io.github.aiaimimi0920.hook");
        std::fs::create_dir_all(&current_dir).expect("create current dir");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy dir");
        std::fs::write(current_dir.join("history.json"), "{}").expect("write current history");
        std::fs::write(legacy_dir.join("session.json"), "{}").expect("write legacy session");

        let resolved = resolve_effective_app_data_dir(&current_dir);

        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(resolved, current_dir);
    }

    #[test]
    fn effective_app_data_dir_honors_explicit_override_before_current_state() {
        let root = std::env::temp_dir().join(format!(
            "hook-app-data-override-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        let current_dir = root.join("com.yamiyu.hook");
        let override_dir = root.join("manual-override");
        std::fs::create_dir_all(&current_dir).expect("create current dir");
        std::fs::create_dir_all(&override_dir).expect("create override dir");
        std::fs::write(current_dir.join("history.json"), "{}").expect("write current history");
        std::fs::write(override_dir.join("session.json"), "{}").expect("write override session");

        let resolved = resolve_effective_app_data_dir_from(&current_dir, Some(&override_dir));

        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(resolved, override_dir);
    }

    #[test]
    fn effective_app_data_dir_uses_older_legacy_dir_if_newer_legacy_dir_has_no_user_state() {
        let root = std::env::temp_dir().join(format!(
            "hook-app-data-older-legacy-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        let current_dir = root.join("com.yamiyu.hook");
        let newer_legacy_dir = root.join("io.github.aiaimimi0920.hook");
        let older_legacy_dir = root.join("com.vmjcv.hook");
        std::fs::create_dir_all(&current_dir).expect("create current dir");
        std::fs::create_dir_all(&newer_legacy_dir).expect("create newer legacy dir");
        std::fs::create_dir_all(&older_legacy_dir).expect("create older legacy dir");
        std::fs::write(older_legacy_dir.join("tool-settings.json"), "{}")
            .expect("write older legacy state");

        let resolved = resolve_effective_app_data_dir(&current_dir);

        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(resolved, older_legacy_dir);
    }

    #[test]
    fn restore_loaded_session_stickers_keeps_file_backed_srcs_in_path_form() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-restore-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create temp restore dir");
        let image_path = root.join("capture.png");
        std::fs::write(&image_path, [1u8, 2, 3, 4]).expect("write temp image");
        let raw_path = image_path.to_string_lossy().to_string();

        let mut stickers = vec![StickerData {
            id: "restore-1".to_string(),
            src: raw_path.clone(),
            x: 0.0,
            y: 0.0,
            w: 100.0,
            h: 100.0,
            minified: None,
            saved_rect: None,
            crop_offset: None,
            opacity_normal: None,
            opacity_mini: None,
            node_type: None,
            art_id: None,
            params: None,
            file_path: None,
            preview_src: None,
            origin_workflow_id: None,
            origin_node_id: None,
            execution_config: None,
            annotation_state: None,
            image_edit_state: None,
            sticker_edit_propagation: None,
            group_id: None,
            capture_meta: None,
        }];

        restore_loaded_session_stickers(&mut stickers);

        assert_eq!(stickers[0].src, raw_path);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_asset_persistence_reuses_the_same_file_for_unchanged_content() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-asset-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session asset test dir");
        let data_url = tiny_png_data_url_for_test([10, 20, 30]);

        let first = persist_session_image_asset(&root, "sticker-1", "preview", &data_url)
            .expect("first persist should succeed");
        let second = persist_session_image_asset(&root, "sticker-1", "preview", &data_url)
            .expect("second persist should succeed");

        let file_count = std::fs::read_dir(&root)
            .expect("read session asset dir")
            .filter_map(Result::ok)
            .count();
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(first, second);
        assert_eq!(file_count, 1);
    }

    #[test]
    fn session_asset_persistence_uses_a_new_file_when_content_changes() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-asset-change-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session asset change test dir");
        let first_data_url = tiny_png_data_url_for_test([10, 20, 30]);
        let second_data_url = tiny_png_data_url_for_test([40, 50, 60]);

        let first = persist_session_image_asset(&root, "sticker-1", "preview", &first_data_url)
            .expect("first persist should succeed");
        let second = persist_session_image_asset(&root, "sticker-1", "preview", &second_data_url)
            .expect("second persist should succeed");

        let _ = std::fs::remove_dir_all(&root);

        assert_ne!(first, second);
    }

    #[test]
    fn session_asset_cleanup_keeps_current_session_references_and_prunes_old_orphans() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-asset-cleanup-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session asset cleanup test dir");
        let retained_src = persist_session_image_asset(
            &root,
            "sticker-1",
            "source",
            &tiny_png_data_url_for_test([10, 20, 30]),
        )
        .expect("persist retained source");
        let retained_preview = persist_session_image_asset(
            &root,
            "sticker-1",
            "preview",
            &tiny_png_data_url_for_test([40, 50, 60]),
        )
        .expect("persist retained preview");
        let stale_orphan = persist_session_image_asset(
            &root,
            "sticker-2",
            "preview",
            &tiny_png_data_url_for_test([70, 80, 90]),
        )
        .expect("persist stale orphan");
        let fresh_orphan = persist_session_image_asset(
            &root,
            "sticker-3",
            "preview",
            &tiny_png_data_url_for_test([15, 25, 35]),
        )
        .expect("persist fresh orphan");

        let old_time = SystemTime::now()
            - std::time::Duration::from_secs(SESSION_IMAGE_ASSET_RETENTION_SECS + 60);
        set_file_modified_time_for_test(Path::new(&stale_orphan), old_time)
            .expect("age stale orphan");

        let session_data = SessionData {
            stickers: vec![StickerData {
                id: "sticker-1".to_string(),
                src: retained_src.clone(),
                x: 0.0,
                y: 0.0,
                w: 100.0,
                h: 100.0,
                minified: None,
                saved_rect: None,
                crop_offset: None,
                opacity_normal: None,
                opacity_mini: None,
                node_type: None,
                art_id: None,
                params: None,
                file_path: None,
                preview_src: Some(retained_preview.clone()),
                origin_workflow_id: None,
                origin_node_id: None,
                execution_config: None,
                annotation_state: None,
                image_edit_state: None,
                sticker_edit_propagation: None,
                group_id: None,
                capture_meta: None,
            }],
            links: Vec::new(),
            groups: Vec::new(),
            recycle_bin: vec![FrozenStickerEntry {
                entry_id: "entry-1".to_string(),
                source_sticker_id: "sticker-1".to_string(),
                created_at: "2026-07-25T00:00:00Z".to_string(),
                snapshot: serde_json::json!({
                    "src": retained_src,
                    "previewSrc": retained_preview,
                }),
            }],
            reference_library: Vec::new(),
            workflow_asset_archive_index: WorkflowAssetArchiveIndex::default(),
        };

        cleanup_unreferenced_session_image_assets(&root, &session_data, SystemTime::now())
            .expect("cleanup session assets");
        assert!(
            Path::new(&retained_src).exists(),
            "retained source should be kept"
        );
        assert!(
            Path::new(&retained_preview).exists(),
            "retained preview should be kept"
        );
        assert!(
            !Path::new(&stale_orphan).exists(),
            "stale orphan should be removed"
        );
        assert!(
            Path::new(&fresh_orphan).exists(),
            "fresh orphan should be retained"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_asset_cleanup_keeps_assets_referenced_only_by_workflow_archive_index() {
        let root = std::env::temp_dir().join(format!(
            "hook-session-asset-archive-cleanup-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create session asset archive cleanup test dir");
        let archived_preview = persist_session_image_asset(
            &root,
            "sticker-9",
            "preview",
            &tiny_png_data_url_for_test([90, 100, 110]),
        )
        .expect("persist archived preview");
        let stale_orphan = persist_session_image_asset(
            &root,
            "sticker-10",
            "preview",
            &tiny_png_data_url_for_test([120, 130, 140]),
        )
        .expect("persist stale orphan");

        let old_time = SystemTime::now()
            - std::time::Duration::from_secs(SESSION_IMAGE_ASSET_RETENTION_SECS + 60);
        set_file_modified_time_for_test(Path::new(&archived_preview), old_time)
            .expect("age archived preview");
        set_file_modified_time_for_test(Path::new(&stale_orphan), old_time)
            .expect("age stale orphan");

        let session_data = SessionData {
            stickers: Vec::new(),
            links: Vec::new(),
            groups: Vec::new(),
            recycle_bin: Vec::new(),
            reference_library: Vec::new(),
            workflow_asset_archive_index: WorkflowAssetArchiveIndex {
                version: 1,
                workflows: std::collections::BTreeMap::from([(
                    "wf-1".to_string(),
                    WorkflowAssetArchiveWorkflowIndex {
                        updated_at: "123".to_string(),
                        nodes: std::collections::BTreeMap::from([(
                            "node-1".to_string(),
                            WorkflowAssetArchiveNodeIndex {
                                sticker_id: "sticker-9".to_string(),
                                updated_at: "123".to_string(),
                                src: None,
                                preview_src: Some(archived_preview.clone()),
                            },
                        )]),
                    },
                )]),
            },
        };

        cleanup_unreferenced_session_image_assets(&root, &session_data, SystemTime::now())
            .expect("cleanup session assets");

        assert!(
            Path::new(&archived_preview).exists(),
            "workflow archive reference should keep asset alive"
        );
        assert!(
            !Path::new(&stale_orphan).exists(),
            "stale orphan should be removed"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn workflow_asset_archive_merge_replaces_prior_workflow_snapshot_instead_of_appending() {
        let existing = WorkflowAssetArchiveIndex {
            version: 1,
            workflows: std::collections::BTreeMap::from([
                (
                    "wf-1".to_string(),
                    WorkflowAssetArchiveWorkflowIndex {
                        updated_at: "old-1".to_string(),
                        nodes: std::collections::BTreeMap::from([(
                            "old-node".to_string(),
                            WorkflowAssetArchiveNodeIndex {
                                sticker_id: "sticker-old".to_string(),
                                updated_at: "old-1".to_string(),
                                src: Some("C:\\archive\\old-source.png".to_string()),
                                preview_src: Some("C:\\archive\\old-preview.png".to_string()),
                            },
                        )]),
                    },
                ),
                (
                    "wf-2".to_string(),
                    WorkflowAssetArchiveWorkflowIndex {
                        updated_at: "keep-1".to_string(),
                        nodes: std::collections::BTreeMap::from([(
                            "keep-node".to_string(),
                            WorkflowAssetArchiveNodeIndex {
                                sticker_id: "sticker-keep".to_string(),
                                updated_at: "keep-1".to_string(),
                                src: Some("C:\\archive\\keep-source.png".to_string()),
                                preview_src: Some("C:\\archive\\keep-preview.png".to_string()),
                            },
                        )]),
                    },
                ),
            ]),
        };
        let hints = WorkflowAssetArchiveHints {
            workflows: std::collections::BTreeMap::from([(
                "wf-1".to_string(),
                WorkflowAssetArchiveWorkflowHint {
                    nodes: std::collections::BTreeMap::from([(
                        "new-node".to_string(),
                        WorkflowAssetArchiveNodeHint {
                            sticker_id: "sticker-new".to_string(),
                        },
                    )]),
                },
            )]),
        };
        let processed_stickers = vec![StickerData {
            id: "sticker-new".to_string(),
            src: "C:\\archive\\new-source.png".to_string(),
            x: 0.0,
            y: 0.0,
            w: 100.0,
            h: 100.0,
            minified: None,
            saved_rect: None,
            crop_offset: None,
            opacity_normal: None,
            opacity_mini: None,
            node_type: None,
            art_id: None,
            params: None,
            file_path: None,
            preview_src: Some("C:\\archive\\new-preview.png".to_string()),
            origin_workflow_id: None,
            origin_node_id: None,
            execution_config: None,
            annotation_state: None,
            image_edit_state: None,
            sticker_edit_propagation: None,
            group_id: None,
            capture_meta: None,
        }];

        let merged = merge_workflow_asset_archive_index(&existing, &hints, &processed_stickers);

        let merged_wf_1 = merged
            .workflows
            .get("wf-1")
            .expect("updated workflow should be present");
        assert_eq!(
            merged_wf_1.nodes.len(),
            1,
            "resynced workflow should replace its archived node set instead of appending"
        );
        assert!(
            !merged_wf_1.nodes.contains_key("old-node"),
            "superseded archived nodes must be dropped so their baked assets can age out"
        );
        let new_node = merged_wf_1
            .nodes
            .get("new-node")
            .expect("new archived node should be present");
        assert_eq!(new_node.sticker_id, "sticker-new");
        assert_eq!(new_node.src.as_deref(), Some("C:\\archive\\new-source.png"));
        assert_eq!(
            new_node.preview_src.as_deref(),
            Some("C:\\archive\\new-preview.png")
        );

        let untouched_wf_2 = merged
            .workflows
            .get("wf-2")
            .expect("unrelated workflow should be preserved");
        assert!(
            untouched_wf_2.nodes.contains_key("keep-node"),
            "workflows that were not part of this sync must keep their prior archive index"
        );
    }

    #[test]
    fn self_check_report_is_stable_json_for_release_smoke() {
        let report = self_check_report_json().expect("self-check json");
        let value: serde_json::Value = serde_json::from_str(&report).expect("valid json");

        assert_eq!(value["app"], "Hook");
        assert_eq!(value["binary"], "hook.exe");
        assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(value["status"], "ok");
        assert_eq!(value["capabilities"]["desktop"], true);
        assert_eq!(value["capabilities"]["loomConnector"], true);
        assert_eq!(value["capabilities"]["talkConnector"], true);
        assert_eq!(value["capabilities"]["teaConnector"], true);
    }

    #[test]
    fn help_and_version_text_support_no_gui_release_smoke() {
        assert!(hook_help_text().contains("Usage: hook"));
        assert!(hook_help_text().contains("--self-check"));
        assert!(hook_help_text().contains("--loom-brain-plan-smoke"));
        assert!(hook_help_text().contains("HOOK_LOOM_BRAIN_PLAN_OUTPUT"));
        assert!(hook_help_text().contains("--talk-voice-capture-smoke"));
        assert!(hook_help_text().contains("HOOK_TALK_VOICE_CAPTURE_OUTPUT"));
        assert_eq!(
            hook_version_text(),
            format!("hook {}", env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn loom_brain_plan_smoke_request_is_stable_for_release_smoke() {
        let request = loom_brain_plan_smoke_request();

        assert_eq!(request.request_id.as_deref(), Some("hook-loom-smoke-1"));
        assert_eq!(request.goal, "Hook Loom release smoke");
        assert_eq!(request.constraints, vec!["no-ui".to_string()]);
        assert_eq!(request.timeout_ms, Some(5_000));
    }

    #[test]
    fn talk_capture_smoke_request_is_stable_for_release_smoke() {
        let request = talk_capture_smoke_request();

        assert_eq!(request.request_id.as_deref(), Some("hook-talk-smoke-1"));
        assert_eq!(request.mode.as_deref(), Some("dictation"));
        assert_eq!(request.timeout_ms, Some(5_000));
        let context = request.context.expect("smoke context");
        assert_eq!(context["source"], "hook-cli-smoke");
    }

    #[test]
    fn voice_settings_summary_from_config_preserves_command_contract() {
        let config = default_voice_config();
        let summary = VoiceSettingsSummary::from_config(&config);

        assert_eq!(summary.shortcut, "Ctrl+Alt+Space");
        assert_eq!(summary.provider_kind, "mock");
        assert_eq!(summary.voice_mode, "dictate");
    }

    #[test]
    fn optional_cli_output_writes_to_env_path_for_windowed_release_binary_smoke() {
        let env_name = format!("HOOK_TEST_CLI_OUTPUT_{}", std::process::id());
        let output_path = std::env::temp_dir().join(format!(
            "hook-cli-output-{}-{}.txt",
            std::process::id(),
            "windowed-release"
        ));
        let _ = std::fs::remove_file(&output_path);

        std::env::set_var(&env_name, &output_path);
        let result = write_optional_cli_output(&env_name, "hook 0.1.4\n");
        std::env::remove_var(&env_name);

        result.expect("write optional cli output");
        let written = std::fs::read_to_string(&output_path).expect("read cli output");
        let _ = std::fs::remove_file(&output_path);
        assert_eq!(written, "hook 0.1.4\n");
    }
}
