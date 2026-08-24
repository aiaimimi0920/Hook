// Emits normalized capture and overlay pointer events with platform modifier state.

#[derive(Debug, Clone, Copy)]
struct ModifierSnapshot {
    ctrl_pressed: bool,
    alt_pressed: bool,
    shift_pressed: bool,
    meta_pressed: bool,
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
            "metaKey": modifiers.meta_pressed,
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
            "metaKey": modifiers.meta_pressed,
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
        meta_pressed: unsafe { GetAsyncKeyState(VK_LWIN.0 as i32) } < 0
            || unsafe { GetAsyncKeyState(VK_RWIN.0 as i32) } < 0,
    }
}

#[cfg(not(target_os = "windows"))]
fn current_modifier_snapshot() -> ModifierSnapshot {
    ModifierSnapshot {
        ctrl_pressed: false,
        alt_pressed: false,
        shift_pressed: false,
        meta_pressed: false,
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
            "metaKey": modifiers.meta_pressed,
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
            "metaKey": modifiers.meta_pressed,
            "deltaY": -delta_y,
        });
        let _ = window.emit(event_name, payload);
    }
}
