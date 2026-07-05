mod capture;
mod capture_coords;
mod cli_engine;
mod long_capture;
mod loom_config;
pub mod loom_connector;
mod mock_artloom; // Integration
mod mouse_monitor;
mod process_utils;
mod screenshot;
mod single_instance;
pub mod talk_connector;
pub mod tea_client;
pub mod voice;

use capture::CaptureResponse;
use capture_coords::{normalize_global_physical_to_local_logical, CaptureWindowMetrics};
use mock_artloom::MockArtLoom;
use single_instance::{single_instance_name, try_acquire_single_instance};

use base64::Engine as _;
use mouse_monitor::{should_ignore_cursor_events, SharedHitMap};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, Size, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
// Windows Imports
#[cfg(target_os = "windows")]
use uiautomation::UIAutomation;

// Import Windows specific modules for shared memory
#[cfg(target_os = "windows")]
use windows::core::{PCWSTR, PWSTR};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_READ, MEMORY_MAPPED_VIEW_ADDRESS,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::{
    GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Controls::Dialogs::{
    CommDlgExtendedError, GetOpenFileNameW, GetSaveFileNameW, CDN_INITDONE, OFN_ENABLEHOOK,
    OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_NOCHANGEDIR, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST,
    OPENFILENAMEW,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetParent, GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER, WM_NOTIFY,
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
        "Environment:\n",
        "  HOOK_SELF_CHECK_OUTPUT          Optional file path for --self-check JSON output\n",
        "  HOOK_LOOM_BRAIN_PLAN_OUTPUT    Optional file path for --loom-brain-plan-smoke JSON output\n",
        "  HOOK_TALK_VOICE_CAPTURE_OUTPUT Optional file path for --talk-voice-capture-smoke JSON output\n",
        "  HOOK_CLI_OUTPUT                 Optional file path for --help/--version text output\n",
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

fn sanitize_drag_filename_hint(hint: Option<&str>) -> String {
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
const CLIPBOARD_CACHE_MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;
const CLIPBOARD_CACHE_MAX_BYTES: u64 = 256 * 1024 * 1024;
const CLIPBOARD_CACHE_TARGET_BYTES: u64 = 128 * 1024 * 1024;

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
            Ok(metadata) if metadata.is_file() => metadata,
            _ => continue,
        };
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
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

#[cfg(target_os = "windows")]
fn stage_drag_out_file_copy(source_path: &Path) -> Result<PathBuf, String> {
    let cache_dir = ensure_clipboard_cache_dir()?;
    let staged_extension = source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .filter(|extension| !extension.trim().is_empty())
        .unwrap_or("png");
    let staged_stem = sanitize_drag_filename_hint(source_path.file_stem().and_then(|stem| stem.to_str()));
    let staged_path = cache_dir.join(format!(
        "dragout_{}_{}.{}",
        staged_stem,
        file_timestamp_component(),
        staged_extension
    ));

    fs::copy(source_path, &staged_path)
        .map_err(|e| format!("Failed to stage drag file copy: {}", e))?;
    append_runtime_log_line(&format!(
        "native_drag_stage_created :: source={} staged={}",
        cache_file_name_for_log(source_path),
        cache_file_name_for_log(&staged_path)
    ));
    Ok(staged_path)
}

fn cache_file_name_for_log(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "<unknown>".to_string())
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
) -> Result<Option<PathBuf>, String> {
    let (owner, placement) = resolve_save_dialog_placement(app, dialog_center_x, dialog_center_y)?;

    let default_filename = format!("Hook_{}.png", file_timestamp_component());
    let default_filename_wide = wide_null(&default_filename);
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

fn emit_capture_mouse_event(
    window: &tauri::WebviewWindow,
    event_name: &str,
    global_x: f64,
    global_y: f64,
) {
    let sample =
        sample_screen_color_physical(global_x.round() as i32, global_y.round() as i32).ok();
    if let Some(metrics) = capture_window_metrics(window) {
        let local = normalize_global_physical_to_local_logical(global_x, global_y, metrics);
        let payload = match sample {
            Some(sample) => serde_json::json!({
                "x": local.x,
                "y": local.y,
                "globalX": global_x,
                "globalY": global_y,
                "scaleFactor": metrics.scale_factor,
                "physicalOriginX": metrics.physical_origin_x,
                "physicalOriginY": metrics.physical_origin_y,
                "hex": sample.hex,
                "rgb": sample.rgb,
            }),
            None => serde_json::json!({
                "x": local.x,
                "y": local.y,
                "globalX": global_x,
                "globalY": global_y,
                "scaleFactor": metrics.scale_factor,
                "physicalOriginX": metrics.physical_origin_x,
                "physicalOriginY": metrics.physical_origin_y,
            }),
        };
        let _ = window.emit(event_name, payload);
    } else {
        let payload = match sample {
            Some(sample) => serde_json::json!({
                "x": global_x,
                "y": global_y,
                "globalX": global_x,
                "globalY": global_y,
                "hex": sample.hex,
                "rgb": sample.rgb,
            }),
            None => serde_json::json!({
                "x": global_x,
                "y": global_y,
                "globalX": global_x,
                "globalY": global_y,
            }),
        };
        let _ = window.emit(event_name, payload);
    }
}

fn refresh_overlay_interactivity_for_current_cursor(
    window: &tauri::WebviewWindow,
    hit_map: &SharedHitMap,
) {
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

    let should_ignore = match hit_map.rectangles.lock() {
        Ok(rects) => should_ignore_cursor_events(&rects, cursor_x, cursor_y),
        Err(_) => return,
    };

    let _ = window.set_ignore_cursor_events(should_ignore);
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
fn save_sticker_image(app: tauri::AppHandle, base64_image: String) -> Result<String, String> {
    let image_data = decode_base64_image_data(&base64_image)?;

    // 1. Resolve a user-writable destination. Writing next to the executable
    //    fails when Hook is installed under Program Files (read-only) and is
    //    poor practice; persist user data under the app data dir instead.
    let app_dir = effective_app_data_dir(&app)?;
    let saved_dir = app_dir.join("saved");
    fs::create_dir_all(&saved_dir).map_err(|e| format!("Failed to create save dir: {}", e))?;

    // 2. Generate Filename
    let timestamp = file_timestamp_component();
    let filename = format!("{}.png", timestamp);
    let file_path = saved_dir.join(&filename);

    // 3. Write File
    let mut file = File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&image_data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

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
) -> Result<Option<String>, String> {
    let image_data = decode_base64_image_data(&base64_image)?;
    let Some(file_path) = select_sticker_save_path(&app, dialog_center_x, dialog_center_y)? else {
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
) -> Result<Option<String>, String> {
    save_sticker_image(app, base64_image).map(Some)
}

#[cfg(target_os = "windows")]
fn start_native_file_drag(
    window: tauri::WebviewWindow,
    file_path: PathBuf,
    hit_map: &SharedHitMap,
) -> Result<String, String> {
    let path_string = file_path.to_string_lossy().to_string();
    set_overlay_click_through_impl(&window, true);
    append_runtime_log_line("native_drag_overlay_clickthrough :: true");
    append_runtime_log_line(&format!(
        "native_drag_start :: path={}",
        cache_file_name_for_log(Path::new(&path_string))
    ));
    let drag_result = drag::start_drag(
        &window,
        drag::DragItem::Files(vec![file_path.clone()]),
        drag::Image::File(file_path),
        |result, cursor_position| {
            append_runtime_log_line(&format!(
                "native_drag_result :: result={:?} cursor_x={} cursor_y={}",
                result, cursor_position.x, cursor_position.y
            ));
        },
        drag::Options {
            mode: drag::DragMode::Move,
            ..Default::default()
        },
    )
    .map_err(|error| format!("Failed to start native drag: {}", error));
    refresh_overlay_interactivity_for_current_cursor(&window, hit_map);
    append_runtime_log_line("native_drag_overlay_restored");
    drag_result?;

    Ok(path_string)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn begin_sticker_native_file_drag(
    window: tauri::WebviewWindow,
    hit_map: tauri::State<'_, SharedHitMap>,
    base64_image: String,
    filename_hint: Option<String>,
) -> Result<String, String> {
    let image_data = decode_base64_image_data(&base64_image)?;
    let cache_dir = ensure_clipboard_cache_dir()?;
    let filename = format!(
        "{}_{}.png",
        sanitize_drag_filename_hint(filename_hint.as_deref()),
        file_timestamp_component()
    );
    let file_path = cache_dir.join(filename);

    let mut file =
        File::create(&file_path).map_err(|e| format!("Failed to create drag file: {}", e))?;
    file.write_all(&image_data)
        .map_err(|e| format!("Failed to write drag file: {}", e))?;
    drop(file);

    let staged_drag_file = stage_drag_out_file_copy(&file_path)?;
    start_native_file_drag(window, staged_drag_file, hit_map.inner())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn begin_sticker_native_file_drag_from_path(
    window: tauri::WebviewWindow,
    hit_map: tauri::State<'_, SharedHitMap>,
    path: String,
) -> Result<String, String> {
    let file_path = PathBuf::from(path);
    let metadata =
        fs::metadata(&file_path).map_err(|e| format!("Failed to stat drag source file: {}", e))?;
    if !metadata.is_file() {
        return Err("Drag source path is not a regular file".to_string());
    }
    let staged_drag_file = stage_drag_out_file_copy(&file_path)?;
    start_native_file_drag(window, staged_drag_file, hit_map.inner())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn begin_sticker_native_file_drag(
    _window: tauri::WebviewWindow,
    _hit_map: tauri::State<'_, SharedHitMap>,
    _base64_image: String,
    _filename_hint: Option<String>,
) -> Result<String, String> {
    Err("Native sticker file drag is only supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn begin_sticker_native_file_drag_from_path(
    _window: tauri::WebviewWindow,
    _hit_map: tauri::State<'_, SharedHitMap>,
    _path: String,
) -> Result<String, String> {
    Err("Native sticker file drag from path is only supported on Windows".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn copy_node_image_to_clipboard(base64_image: String) -> Result<String, String> {
    use clipboard_win::{formats, Clipboard, Setter};

    let image_data = decode_base64_image_data(&base64_image)?;
    let cache_dir = ensure_clipboard_cache_dir()?;

    // Use a fixed name or timestamp?
    // If we use fixed, it overwrites (good for cache size, bad if pasting old ref).
    // Use timestamp to be safe for now.
    let timestamp = file_timestamp_component();
    let filename = format!("ArtNode_{}.png", timestamp);
    let file_path = cache_dir.join(&filename);

    // 4. Write File
    let mut file = File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&image_data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

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
fn copy_node_image_to_clipboard(_base64_image: String) -> Result<String, String> {
    Err("File Copy not supported on non-Windows OS".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn copy_sticker_image_to_smart_clipboard(base64_image: String) -> Result<String, String> {
    // Publish both clipboard representations from one command:
    // browsers/rich editors read the image formats, Explorer reads CF_HDROP.
    let image_data = decode_base64_image_data(&base64_image)?;

    let img =
        image::load_from_memory(&image_data).map_err(|e| format!("Image load failed: {}", e))?;

    let cache_dir = ensure_clipboard_cache_dir()?;

    let timestamp = file_timestamp_component();
    let file_path = cache_dir.join(format!("Hook_{}.png", timestamp));
    let mut file = File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&image_data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

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
fn copy_sticker_image_to_smart_clipboard(base64_image: String) -> Result<String, String> {
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
    if let Ok(mut rectangles) = state.rectangles.lock() {
        *rectangles = rects;
    } else {
        append_runtime_log_line("update_pin_rects_lock_failed");
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
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

    // If disabling monitor, ensure window is interactive (Selection Mode / Normal Mode)
    if let Some(window) = app.get_webview_window("main") {
        if !active {
            let _ = window.set_ignore_cursor_events(false);
        } else {
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

// function moved to cli_engine.rs

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
    })
}

#[tauri::command]
async fn stitch_vertical_long_capture_frames(
    frames: Vec<String>,
    overlap_scan: Option<u32>,
) -> Result<CaptureResponse, String> {
    let started_at = std::time::Instant::now();
    let input_frame_count = frames.len();
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
        if sticker.src.starts_with("data:image") {
            let base64_data = sticker.src.split(",").last().unwrap_or(&sticker.src);
            let image_data = base64::engine::general_purpose::STANDARD
                .decode(base64_data)
                .map_err(|e| format!("Base64 decode failed for {}: {}", sticker.id, e))?;

            let filename = format!("{}.png", sticker.id);
            let file_path = images_dir.join(&filename);

            let mut file = File::create(&file_path).map_err(|e| e.to_string())?;
            file.write_all(&image_data).map_err(|e| e.to_string())?;

            sticker.src = file_path.to_string_lossy().to_string();
        }

        // Save Preview Image
        if let Some(ref mut p_src) = sticker.preview_src {
            if p_src.starts_with("data:image") {
                let base64_data = p_src.split(",").last().unwrap_or(p_src);
                // Safe decode?
                if let Ok(image_data) =
                    base64::engine::general_purpose::STANDARD.decode(base64_data)
                {
                    let filename = format!("{}_preview.png", sticker.id);
                    let file_path = images_dir.join(&filename);

                    if let Ok(mut file) = File::create(&file_path) {
                        let _ = file.write_all(&image_data);
                        *p_src = file_path.to_string_lossy().to_string();
                    }
                }
            }
        }
    }

    // Save as SessionData with both stickers and links
    let session_data = SessionData {
        stickers: processed_stickers,
        links: links,
        groups: groups.unwrap_or_default(),
        recycle_bin: recycle_bin.unwrap_or_default(),
        reference_library: reference_library.unwrap_or_default(),
    };

    let session_file = app_dir.join("session.json");
    let json = serde_json::to_string_pretty(&session_data).map_err(|e| e.to_string())?;

    let mut file = File::create(session_file).map_err(|e| e.to_string())?;
    file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;

    println!(
        "Session saved with {} stickers and {} links.",
        session_data.stickers.len(),
        session_data.links.len()
    );
    Ok(())
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
            }
        }
    };

    for sticker in &mut session_data.stickers {
        if !sticker.src.starts_with("data:image") {
            let path = std::path::Path::new(&sticker.src);
            if path.exists() {
                let bytes = fs::read(path).map_err(|e| e.to_string())?;
                let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
                sticker.src = format!("data:image/png;base64,{}", b64);
            } else {
                println!(
                    "Warning: Image file not found for sticker {}: {}",
                    sticker.id, sticker.src
                );
            }
        }
    }

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

fn setup_overlay_window(window: &tauri::WebviewWindow) {
    let _ = window.set_content_protected(false);
    let _ = window.set_decorations(false);
    let _ = window.set_title("");
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_always_on_top(true);
    let _ = window.set_resizable(false);
    let _ = window.set_shadow(false);

    if let Ok(Some(monitor)) = window.current_monitor() {
        let size = monitor.size();
        let position = monitor.position();

        let _ = window.set_decorations(false);
        let _ = window.set_position(tauri::Position::Physical(*position));
        let _ = window.set_size(tauri::Size::Physical(*size));
    } else {
        let _ = window.set_fullscreen(true);
    }

    if let Err(e) = window.show() {
        println!("Failed to show window: {}", e);
    }
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
    let mut frame = screenshot::capture_area(x, y, w, h).map_err(|error| error.to_string())?;
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
fn set_capture_input_active(state: tauri::State<SharedCaptureInputState>, active: bool) {
    if let Ok(mut guard) = state.active.lock() {
        *guard = active;
        append_runtime_log_line(&format!("set_capture_input_active :: {}", active));
    }
}

fn show_canvas_window_impl(window: &tauri::WebviewWindow) {
    let _ = window.set_content_protected(false);
    let _ = window.set_ignore_cursor_events(false);
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
    setup_overlay_window(window);
    let _ = window.set_ignore_cursor_events(click_through);
}

fn set_overlay_click_through_impl(window: &tauri::WebviewWindow, click_through: bool) {
    let _ = window.set_ignore_cursor_events(click_through);
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
    if let Err(e) = window.hide() {
        println!("Failed to hide window to tray: {}", e);
    }
}

fn enter_capture_mode(window: &tauri::WebviewWindow) {
    append_runtime_log_line("enter_capture_mode");
    show_overlay_host_impl(window, true);

    println!("Overlay setup done. Emitting trigger-capture...");
    if let Err(e) = window.emit("trigger-capture", ()) {
        println!("Failed to emit trigger-capture: {}", e);
        append_runtime_log_line(&format!("enter_capture_mode emit_failed :: {}", e));
    } else {
        append_runtime_log_line("enter_capture_mode emitted_trigger_capture");
    }
}

fn enter_long_capture_mode(window: &tauri::WebviewWindow) {
    append_runtime_log_line("enter_long_capture_mode");
    show_overlay_host_impl(window, true);

    if let Err(e) = window.emit("trigger-long-capture", ()) {
        println!("Failed to emit trigger-long-capture: {}", e);
        append_runtime_log_line(&format!("enter_long_capture_mode emit_failed :: {}", e));
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
    let started_at = Instant::now();
    let width = rgb_image.width();
    let height = rgb_image.height();
    let cache_dir = ensure_clipboard_cache_dir()?;
    let file_path = cache_dir.join(format!(
        "Hook_long_capture_{}.png",
        file_timestamp_component()
    ));

    let file_write_started_at = Instant::now();
    {
        use image::codecs::png::{CompressionType, FilterType, PngEncoder};
        use image::{ColorType, ImageEncoder};

        let file =
            File::create(&file_path).map_err(|error| format!("Failed to create PNG: {error}"))?;
        let mut writer = BufWriter::new(file);
        let encoder =
            PngEncoder::new_with_quality(&mut writer, CompressionType::Fast, FilterType::NoFilter);
        encoder
            .write_image(rgb_image.as_raw(), width, height, ColorType::Rgb8.into())
            .map_err(|error| error.to_string())?;
        writer
            .flush()
            .map_err(|error| format!("Failed to flush PNG: {error}"))?;
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
fn append_runtime_log(event: String, detail: Option<String>) {
    let suffix = detail
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!(" :: {}", value))
        .unwrap_or_default();
    append_runtime_log_line(&format!("{}{}", event, suffix));
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let tauri_ctrl_1_last_trigger = Arc::new(std::sync::Mutex::new(
        std::time::Instant::now() - std::time::Duration::from_secs(2),
    ));
    let tauri_ctrl_3_last_trigger = Arc::new(std::sync::Mutex::new(
        std::time::Instant::now() - std::time::Duration::from_secs(2),
    ));
    let voice_hotkeys = Arc::new(std::sync::Mutex::new(
        voice::hotkey::HotkeyStateMachine::new_toggle("Ctrl+Alt+Space"),
    ));

    tauri::Builder::default()
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
             update_pin_rects,
             set_mouse_monitor_active,
             begin_sticker_native_file_drag,
             begin_sticker_native_file_drag_from_path,
             save_sticker_image,
             save_sticker_image_as,
             get_cursor_position,
            copy_to_clipboard,
            copy_node_image_to_clipboard,
            copy_sticker_image_to_smart_clipboard,
            set_capture_input_active,
            save_session,
            load_session,
            save_history,
            load_history,
            save_tool_settings,
            load_tool_settings,
            get_installed_fonts,
            initialize_overlay,
            get_boot_profile,
            get_voice_settings_summary,
            talk_capture_voice_once,
            loom_brain_plan,
            show_canvas_window,
            show_overlay_host,
            set_overlay_click_through,
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
            open_image_for_edit,
            read_clipboard_image,
            cli_engine::native_cli_execute
        ])
        .setup(|app| {
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

            // Initialize Shared State
            let hit_map = SharedHitMap::new();
            app.manage(hit_map.clone());
            let capture_input_state = SharedCaptureInputState::new();
            app.manage(capture_input_state.clone());
            let long_capture_sessions = SharedLongCaptureSessions::new();
            app.manage(long_capture_sessions.clone());

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
                let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let tray_menu = Menu::with_items(
                    app,
                    &[&capture_item, &long_capture_item, &open_image_item, &quit_item],
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
                    let mut last_esc = std::time::Instant::now() - std::time::Duration::from_secs(1);
                    let mut is_ignoring_events = false;
                    let mut last_mouse_x = 0.0f64;
                    let mut last_mouse_y = 0.0f64;
                    let mut ctrl_pressed = false;
                    let mut last_capture_trigger =
                        std::time::Instant::now() - std::time::Duration::from_secs(2);

                    if let Err(error) = rdev::listen(move |event| {
                        match event.event_type {
                            rdev::EventType::KeyPress(rdev::Key::ControlLeft)
                            | rdev::EventType::KeyPress(rdev::Key::ControlRight) => {
                                ctrl_pressed = true;
                            }
                            rdev::EventType::KeyRelease(rdev::Key::ControlLeft)
                            | rdev::EventType::KeyRelease(rdev::Key::ControlRight) => {
                                ctrl_pressed = false;
                            }
                            rdev::EventType::KeyPress(rdev::Key::Num1) => {
                                if ctrl_pressed
                                    && !ctrl_1_global_registered_for_rdev.load(Ordering::Relaxed)
                                    && last_capture_trigger.elapsed()
                                        > std::time::Duration::from_millis(500)
                                {
                                    last_capture_trigger = std::time::Instant::now();
                                    append_runtime_log_line("rdev_ctrl1_triggered");
                                    enter_capture_mode(&window);
                                }
                            }
                            rdev::EventType::KeyPress(rdev::Key::Num3) => {
                                if ctrl_pressed
                                    && !ctrl_3_global_registered_for_rdev.load(Ordering::Relaxed)
                                    && last_capture_trigger.elapsed()
                                        > std::time::Duration::from_millis(500)
                                {
                                    last_capture_trigger = std::time::Instant::now();
                                    append_runtime_log_line("rdev_ctrl3_triggered");
                                    enter_long_capture_mode(&window);
                                }
                            }
                            rdev::EventType::KeyPress(rdev::Key::Escape) => {
                                if last_esc.elapsed() < std::time::Duration::from_millis(400) {
                                    println!("Double ESC detected - Emergency Exit.");
                                    std::process::exit(0);
                                }
                                last_esc = std::time::Instant::now();
                                append_runtime_log_line("rdev_escape_triggered");
                                let _ = window.emit("trigger-escape", ());
                            }
                            rdev::EventType::KeyPress(rdev::Key::Return) => {
                                append_runtime_log_line("rdev_enter_triggered");
                                let _ = window.emit("trigger-long-capture-finish", ());
                            }
                            rdev::EventType::Wheel { delta_x, delta_y } => {
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
                                        delta_x,
                                        delta_y,
                                    });
                                }
                            }
                            rdev::EventType::MouseMove { x, y } => {
                                last_mouse_x = x;
                                last_mouse_y = y;
                                let capture_active = capture_input_state_clone
                                    .active
                                    .lock()
                                    .map(|guard| *guard)
                                    .unwrap_or(false);
                                if capture_active {
                                    emit_capture_mouse_event(&window, "capture/global_mouse_move", x, y);
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
                                        .map(|rects| should_ignore_cursor_events(&rects, x, y))
                                        .unwrap_or(false);

                                    if should_ignore != is_ignoring_events {
                                        // println!("State Change: Ignore Events = {} (Mouse: {},{})", should_ignore, x, y);
                                        let _ = window.set_ignore_cursor_events(should_ignore);
                                        is_ignoring_events = should_ignore;
                                    }
                                } else {
                                    is_ignoring_events = false;
                                }
                            }
                            rdev::EventType::ButtonPress(rdev::Button::Left) => {
                                let capture_active = capture_input_state_clone
                                    .active
                                    .lock()
                                    .map(|guard| *guard)
                                    .unwrap_or(false);
                                if capture_active {
                                    let (global_x, global_y) =
                                        current_cursor_position_physical().unwrap_or((last_mouse_x, last_mouse_y));
                                    emit_capture_mouse_event(
                                        &window,
                                        "capture/global_mouse_down",
                                        global_x,
                                        global_y,
                                    );
                                }
                            }
                            rdev::EventType::ButtonRelease(rdev::Button::Left) => {
                                let capture_active = capture_input_state_clone
                                    .active
                                    .lock()
                                    .map(|guard| *guard)
                                    .unwrap_or(false);
                                if capture_active {
                                    let (global_x, global_y) =
                                        current_cursor_position_physical().unwrap_or((last_mouse_x, last_mouse_y));
                                    emit_capture_mouse_event(
                                        &window,
                                        "capture/global_mouse_up",
                                        global_x,
                                        global_y,
                                    );
                                }
                            }
                            _ => {}
                        }
                    }) {
                        println!("Error: {:?}", error);
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
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
    fn file_url_from_path_escapes_windows_path_for_webview_images() {
        let path = PathBuf::from(r"C:\Users\Public\Hook Cache\long#1%.png");

        assert_eq!(
            file_url_from_path(&path),
            "file:///C:/Users/Public/Hook%20Cache/long%231%25.png"
        );
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

        let staged_path = stage_drag_out_file_copy(&source_path).expect("stage drag file copy");

        std::env::remove_var(env_name);

        assert!(source_path.exists(), "original sticker file should remain in place");
        assert!(staged_path.exists(), "staged drag file should exist");
        assert_ne!(staged_path, source_path, "staged path should differ from source path");
        assert_eq!(
            std::fs::read(&staged_path).expect("read staged file"),
            source_bytes
        );

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
        let result = write_optional_cli_output(&env_name, "hook 0.1.0\n");
        std::env::remove_var(&env_name);

        result.expect("write optional cli output");
        let written = std::fs::read_to_string(&output_path).expect("read cli output");
        let _ = std::fs::remove_file(&output_path);
        assert_eq!(written, "hook 0.1.0\n");
    }
}
