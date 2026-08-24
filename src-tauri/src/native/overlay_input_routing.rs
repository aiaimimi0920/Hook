// Applies overlay hit testing, occlusion suppression, and interactivity routing.

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
