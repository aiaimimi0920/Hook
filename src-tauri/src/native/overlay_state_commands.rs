// Owns overlay hit-map, mouse monitoring, and cursor commands.

#[tauri::command]
fn update_pin_rects(
    app: tauri::AppHandle,
    state: tauri::State<SharedHitMap>,
    rects: Vec<mouse_monitor::Rect>,
) {
    let window = app.get_webview_window("main");
    let global_rects = window
        .as_ref()
        .and_then(|window| window.inner_position().ok())
        .map(|origin| mouse_monitor::offset_rects(&rects, origin.x, origin.y))
        .unwrap_or(rects);
    let active = state.active.lock().map(|guard| *guard).unwrap_or(false);
    if let Ok(mut rectangles) = state.rectangles.lock() {
        *rectangles = global_rects.clone();
    } else {
        append_runtime_log_line("update_pin_rects_lock_failed");
        return;
    }
    if let Ok(mut overlay_rectangles) = overlay_mouse_hit_map().lock() {
        *overlay_rectangles = global_rects.clone();
    }

    if let Some(window) = window {
        sync_overlay_input_shield_region(&window, &global_rects, active);
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
