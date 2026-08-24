// Refreshes overlay interactivity from the current physical cursor position.

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
