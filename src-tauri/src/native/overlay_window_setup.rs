// Applies overlay bounds and stages UIAccess-aware window startup.

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
        console_line!("Failed to show window: {}", e);
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
