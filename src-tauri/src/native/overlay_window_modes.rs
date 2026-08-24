// Applies high-level canvas, overlay, click-through, exclusion, and tray modes.

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
        console_line!("Failed to show canvas window: {}", e);
    }

    if let Err(e) = window.set_focus() {
        console_line!("Failed to focus canvas window: {}", e);
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
        console_line!("Failed to hide window to tray: {}", e);
    }
}
