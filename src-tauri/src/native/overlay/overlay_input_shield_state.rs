// Owns input-shield Alt passthrough, hiding, and fullscreen promotion.

#[cfg(target_os = "windows")]
fn set_overlay_input_shield_alt_passthrough(active: bool) {
    if OVERLAY_INPUT_SHIELD_ALT_PASSTHROUGH.swap(active, Ordering::SeqCst) == active {
        return;
    }

    let Some(hwnd) = overlay_input_shield_hwnd() else {
        return;
    };
    let current_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    let transparent_flag = WS_EX_TRANSPARENT.0 as isize;
    if (current_style & transparent_flag != 0) == active {
        return;
    }
    let next_style = if active {
        current_style | transparent_flag
    } else {
        current_style & !transparent_flag
    };
    let _ = unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style) };
    let _ = unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
    };
    append_runtime_log_line(if active {
        "overlay_input_shield_alt_passthrough_enabled"
    } else {
        "overlay_input_shield_alt_passthrough_disabled"
    });
}

#[cfg(not(target_os = "windows"))]
fn set_overlay_input_shield_alt_passthrough(_active: bool) {}

#[cfg(target_os = "windows")]
struct OverlayMainWindowSearchState {
    target_pid: u32,
    hwnd: Option<HWND>,
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn find_overlay_main_window_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut OverlayMainWindowSearchState);
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == state.target_pid && unsafe { IsWindowVisible(hwnd) }.as_bool() {
        state.hwnd = Some(hwnd);
        return BOOL(0);
    }

    BOOL(1)
}

#[cfg(target_os = "windows")]
fn resolve_overlay_main_hwnd(window: &tauri::WebviewWindow) -> Option<HWND> {
    if let Ok(hwnd) = window.hwnd() {
        return Some(HWND(hwnd.0));
    }

    let mut state = OverlayMainWindowSearchState {
        target_pid: std::process::id(),
        hwnd: None,
    };
    let state_ptr = &mut state as *mut OverlayMainWindowSearchState;
    let _ = unsafe {
        EnumWindows(
            Some(find_overlay_main_window_proc),
            LPARAM(state_ptr as isize),
        )
    };
    state.hwnd
}

#[cfg(target_os = "windows")]
fn hide_overlay_input_shield_window() {
    let Some(hwnd) = overlay_input_shield_hwnd() else {
        return;
    };

    let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
    append_runtime_log_line("overlay_input_shield_native_drag_hidden");
}

#[cfg(not(target_os = "windows"))]
fn hide_overlay_input_shield_window() {}

#[cfg(target_os = "windows")]
fn promote_overlay_input_shield_to_fullscreen() {
    let Some(hwnd) = overlay_input_shield_hwnd() else {
        return;
    };

    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        append_runtime_log_line("overlay_input_shield_drag_rect_failed");
        return;
    }

    let width = (rect.right - rect.left).max(1);
    let height = (rect.bottom - rect.top).max(1);
    let full_region = unsafe { CreateRectRgn(0, 0, width, height) };
    let _ = unsafe { SetWindowRgn(hwnd, Some(full_region), true) };
    let _ = unsafe { ShowWindow(hwnd, SW_SHOWNA) };
    append_runtime_log_line("overlay_input_shield_drag_fullscreen");
}

#[cfg(not(target_os = "windows"))]
fn promote_overlay_input_shield_to_fullscreen() {}
