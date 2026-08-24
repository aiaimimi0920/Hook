// Exposes overlay lifecycle, focus, drag, capture, and runtime-log Tauri commands.

fn trigger_toggle_sticker_toolbar(window: &tauri::WebviewWindow) {
    append_runtime_log_line("trigger_toggle_sticker_toolbar");

    if let Err(e) = window.set_focus() {
        console_line!("Failed to set focus: {}", e);
        append_runtime_log_line(&format!(
            "trigger_toggle_sticker_toolbar focus_failed :: {}",
            e
        ));
    }

    if let Err(e) = window.emit("trigger-toggle-sticker-toolbar", ()) {
        console_line!("Failed to emit trigger-toggle-sticker-toolbar: {}", e);
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
        console_line!("Initializing overlay window state...");
        setup_overlay_window(&window);
    }
}

#[tauri::command]
fn get_boot_profile() -> BootProfile {
    boot_profile_from_env()
}

#[tauri::command]
fn request_native_acceptance_exit(app: tauri::AppHandle, marker: String) -> Result<(), String> {
    if !native_acceptance_enabled() {
        return Err(format!(
            "native acceptance exit is disabled; set {NATIVE_ACCEPTANCE_ENV}=1 before process start"
        ));
    }
    if !native_acceptance_marker_is_valid(&marker) {
        return Err(
            "native acceptance exit marker must be 1-128 ASCII letters, digits, '-' or '_'"
                .to_string(),
        );
    }

    append_runtime_log_line_sync(&format!(
        "[{}] native_acceptance_exit_requested :: marker={}",
        runtime_log_timestamp(),
        marker
    ));
    app.exit(0);
    Ok(())
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
