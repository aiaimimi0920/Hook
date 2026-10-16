// Converts WebView coordinates and exposes native capture-window targeting commands.

fn capture_window_metrics(window: &tauri::WebviewWindow) -> Option<CaptureWindowMetrics> {
    let position = window.inner_position().ok()?;
    let physical_size = window.inner_size().ok()?;
    let scale_factor = window.scale_factor().ok()?;

    Some(CaptureWindowMetrics {
        physical_origin_x: position.x as f64,
        physical_origin_y: position.y as f64,
        scale_factor,
        logical_width: physical_size.width as f64 / scale_factor,
        logical_height: physical_size.height as f64 / scale_factor,
    })
}

#[tauri::command]
fn list_capture_window_targets(
    window: tauri::WebviewWindow,
) -> Vec<capture_windows::CaptureWindowTarget> {
    capture_window_metrics(&window)
        .map(capture_windows::list_capture_window_targets)
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn get_capture_cursor_position(
    window: tauri::WebviewWindow,
) -> Result<PhysicalPosition<f64>, String> {
    let metrics = capture_window_metrics(&window)
        .ok_or_else(|| "Capture window monitor metrics are unavailable".to_string())?;
    let (global_x, global_y) = current_cursor_position_physical()
        .ok_or_else(|| "System cursor position is unavailable".to_string())?;
    let local = normalize_global_physical_to_local_logical(global_x, global_y, metrics);
    Ok(PhysicalPosition::new(local.x, local.y))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn get_capture_cursor_position(
    window: tauri::WebviewWindow,
) -> Result<PhysicalPosition<f64>, String> {
    window.cursor_position().map_err(|error| error.to_string())
}
