fn write_console_line(stream: &mut dyn std::io::Write, arguments: std::fmt::Arguments<'_>) {
    let _ = stream.write_fmt(arguments);
    let _ = stream.write_all(b"\n");
}

macro_rules! console_line {
    ($($arg:tt)*) => {{
        let mut stream = std::io::stdout().lock();
        $crate::write_console_line(&mut stream, format_args!($($arg)*));
    }};
}

macro_rules! console_error_line {
    ($($arg:tt)*) => {{
        let mut stream = std::io::stderr().lock();
        $crate::write_console_line(&mut stream, format_args!($($arg)*));
    }};
}

mod app_settings;
mod capture;
mod capture_coords;
mod capture_protected_target;
mod capture_windows;
mod device_session;
pub mod emergency_watchdog;
mod file_naming;
mod long_capture;
mod loom_config;
pub mod loom_connector;
mod loom_hook;
mod mouse_monitor;
mod network_proxy;
mod screenshot;
mod shortcut_config;
mod single_instance;
pub mod talk_connector;
pub mod tea_client;
pub mod voice;

#[cfg(all(test, target_os = "windows"))]
#[link(name = "hook_test_manifest", kind = "static")]
extern "C" {}

use capture::{CaptureMetadata, CaptureResponse};
use capture_coords::{normalize_global_physical_to_local_logical, CaptureWindowMetrics};
use file_naming::{
    create_unique_file, render_file_stem, FileNamingContext, FileNamingPatternKind,
    FileNamingSettings,
};
use loom_hook::LoomHook;
use single_instance::{single_instance_name, try_acquire_single_instance};

use base64::Engine as _;
use fs2::FileExt;
use mouse_monitor::SharedHitMap;
use serde::{Deserialize, Serialize};
#[cfg(target_os = "windows")]
use std::collections::VecDeque;
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::fs::{File, OpenOptions};
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
    GetAsyncKeyState, VK_CONTROL, VK_ESCAPE, VK_LBUTTON, VK_LMENU, VK_LSHIFT, VK_LWIN, VK_MENU,
    VK_RMENU, VK_RSHIFT, VK_RWIN, VK_SHIFT,
};
#[cfg(all(test, target_os = "windows"))]
use windows::Win32::UI::Input::KeyboardAndMouse::{VK_BACK, VK_DELETE, VK_TAB};
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

include!("native/shared_memory.rs");

include!("native/boot_diagnostics.rs");

include!("native/runtime_logging.rs");

include!("native/app_persistence_state.rs");

static INSTALLED_FONT_FAMILIES: OnceLock<Vec<String>> = OnceLock::new();

include!("native/image_limits.rs");

include!("native/clipboard_cache.rs");

include!("native/remote_image_cache.rs");

include!("native/image_dialog_clipboard.rs");

include!("native/capture_window_commands.rs");

include!("native/input_event_emit.rs");

include!("native/capture_mouse_queue.rs");

include!("native/capture_mouse_receiver.rs");

include!("native/capture_mouse_debounce.rs");

include!("native/capture_mouse_coalescing.rs");

include!("native/capture_input_state.rs");

include!("native/overlay_input_routing.rs");

include!("native/capture_mouse_hook_proc.rs");

include!("native/capture_mouse_worker.rs");

include!("native/keyboard_policy.rs");

include!("native/rdev_key_map.rs");

include!("native/extension_shortcuts.rs");

include!("native/global_shortcuts.rs");

include!("native/overlay_keyboard_routing.rs");

include!("native/tests/overlay_forwardable_shortcut_tests.rs");
include!("native/tests/overlay_semantic_shortcut_focus_tests.rs");
include!("native/tests/rdev_app_scoped_shortcut_tests.rs");
#[cfg(all(test, target_os = "windows"))]
mod input_lifecycle_hardening_tests {
    include!("native/tests/input_lifecycle_early.rs");
    include!("native/tests/input_lifecycle_queue.rs");
}

include!("native/overlay_keyboard_hook.rs");

include!("native/overlay_keyboard_install.rs");

include!("native/cursor_interactivity.rs");

include!("native/cursor_override.rs");

include!("native/input_cleanup.rs");

include!("native/sticker_save_commands.rs");

include!("native/session_assets.rs");

include!("native/drag_export_target.rs");

include!("native/drag_export_commands.rs");

include!("native/native_file_drag.rs");

include!("native/clipboard_commands.rs");

include!("native/clipboard_text.rs");

include!("native/external_url.rs");

include!("native/overlay_state_commands.rs");

include!("native/image_path_commands.rs");

include!("native/session_models.rs");

include!("native/session_persistence.rs");

include!("native/session_ocr_migration.rs");

include!("native/precise_capture_commands.rs");
include!("native/legacy_long_capture_commands.rs");

include!("native/session_commands.rs");

include!("native/history_settings.rs");

include!("native/installed_fonts.rs");

include!("native/overlay_window_styles.rs");

include!("native/overlay_input_shield_state.rs");

include!("native/overlay_input_shield_router.rs");

include!("native/overlay_input_shield_window.rs");

include!("native/overlay_input_shield_region.rs");

include!("native/overlay_occlusion.rs");

include!("native/overlay_topmost_maintenance.rs");

include!("native/overlay_window_setup.rs");

include!("native/capture_input_commands.rs");

include!("native/long_capture_types.rs");

include!("native/long_capture_fingerprints.rs");

include!("native/long_capture_guide.rs");

include!("native/long_capture_sampling.rs");

include!("native/long_capture_worker.rs");

include!("native/long_capture_worker_wait.rs");

include!("native/overlay_window_modes.rs");

include!("native/capture_mode_entry.rs");

include!("native/long_capture_encoding.rs");

include!("native/long_capture_session_commands.rs");

include!("native/overlay_commands.rs");

include!("native/shortcut_trigger_policy.rs");

include!("native/voice_commands.rs");

include!("native/rdev_input_listener.rs");

include!("native/app_setup.rs");

include!("native/app_runtime.rs");

#[cfg(test)]
mod app_cli_tests {
    include!("native/tests/app_cli_prelude.rs");
    include!("native/tests/app_cli_long_capture_recording.rs");
    include!("native/tests/app_cli_capture_encoding.rs");
    include!("native/tests/app_cli_image_cache.rs");
    include!("native/tests/app_cli_session_persistence.rs");
    include!("native/tests/app_cli_ocr_migration.rs");
    include!("native/tests/app_cli_workflow_archive.rs");
    include!("native/tests/app_cli_release_smoke.rs");
}
