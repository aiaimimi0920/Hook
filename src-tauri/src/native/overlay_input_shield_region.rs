// Synchronizes the native input-shield region with the current hit map.

#[cfg(target_os = "windows")]
fn sync_overlay_input_shield_region(
    window: &tauri::WebviewWindow,
    rects: &[mouse_monitor::Rect],
    active: bool,
) {
    if NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst) {
        hide_overlay_input_shield_window();
        return;
    }
    if should_suppress_overlay_interaction_for_current_occlusion() {
        hide_overlay_input_shield_window();
        append_runtime_log_line("overlay_input_shield_fullscreen_occlusion_hidden");
        return;
    }

    let Some(hwnd) = ensure_overlay_input_shield_window(window) else {
        return;
    };
    let Some(main_hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_input_shield_main_hwnd_failed");
        return;
    };
    let mut main_rect = RECT::default();
    if unsafe { GetWindowRect(main_hwnd, &mut main_rect) }.is_err() {
        append_runtime_log_line("overlay_input_shield_main_rect_failed");
        return;
    }

    let width = (main_rect.right - main_rect.left).max(1);
    let height = (main_rect.bottom - main_rect.top).max(1);
    let capture_active = CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst);
    let overlay_drag_active = OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.load(Ordering::SeqCst);
    let _ = unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            main_rect.left,
            main_rect.top,
            width,
            height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    };

    if capture_active || overlay_drag_active {
        let full_region = unsafe { CreateRectRgn(0, 0, width, height) };
        let _ = unsafe { SetWindowRgn(hwnd, Some(full_region), true) };
        let _ = unsafe { ShowWindow(hwnd, SW_SHOWNA) };
        append_runtime_log_line(if capture_active {
            "overlay_input_shield_capture_fullscreen"
        } else {
            "overlay_input_shield_drag_fullscreen_synced"
        });
        return;
    }

    let shield_rects: Vec<&mouse_monitor::Rect> = if active {
        rects
            .iter()
            .filter(|rect| rect.width > 0 && rect.height > 0 && is_synthetic_overlay_rect(rect))
            .collect()
    } else {
        Vec::new()
    };
    let empty_region = unsafe { CreateRectRgn(0, 0, 0, 0) };
    if shield_rects.is_empty() {
        let _ = unsafe { SetWindowRgn(hwnd, Some(empty_region), true) };
        let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
        append_runtime_log_line("overlay_input_shield_hidden");
        return;
    }

    let union_region = empty_region;
    for rect in shield_rects {
        let local_left = rect.x.saturating_sub(main_rect.left);
        let local_top = rect.y.saturating_sub(main_rect.top);
        let next_region = unsafe {
            CreateRectRgn(
                local_left,
                local_top,
                local_left.saturating_add(rect.width),
                local_top.saturating_add(rect.height),
            )
        };
        let _ = unsafe {
            CombineRgn(
                Some(union_region),
                Some(union_region),
                Some(next_region),
                RGN_OR,
            )
        };
        let _ = unsafe { DeleteObject(next_region.into()) };
    }
    let _ = unsafe { SetWindowRgn(hwnd, Some(union_region), true) };
    let _ = unsafe { ShowWindow(hwnd, SW_SHOWNA) };
    append_runtime_log_line("overlay_input_shield_region_synced");
}

#[cfg(not(target_os = "windows"))]
fn sync_overlay_input_shield_region(
    _window: &tauri::WebviewWindow,
    _rects: &[mouse_monitor::Rect],
    _active: bool,
) {
}

#[cfg(target_os = "windows")]
fn sync_overlay_input_shield_from_runtime_state(window: &tauri::WebviewWindow) {
    let rects = overlay_mouse_hit_map()
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let active = OVERLAY_MOUSE_HIT_MAP_ACTIVE.load(Ordering::SeqCst);
    sync_overlay_input_shield_region(window, &rects, active);
}

#[cfg(not(target_os = "windows"))]
fn sync_overlay_input_shield_from_runtime_state(_window: &tauri::WebviewWindow) {}
