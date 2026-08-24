// Owns shared capture-input state and activation commands.

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
