// Owns overlay HWND discovery, activation policy, and transparent window styles.

#[cfg(target_os = "windows")]
fn set_overlay_no_activate_flag(window: &tauri::WebviewWindow, enabled: bool) {
    let Some(hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_no_activate_hwnd_failed");
        return;
    };

    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let flag = WS_EX_NOACTIVATE.0 as isize;
        let next_style = if enabled { style | flag } else { style & !flag };
        if next_style != style {
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style);
        }
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

#[cfg(target_os = "windows")]
fn set_overlay_transparent_style(window: &tauri::WebviewWindow, enabled: bool) {
    let Some(hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_transparent_hwnd_failed");
        return;
    };

    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let flag = WS_EX_TRANSPARENT.0 as isize;
        let next_style = if enabled { style | flag } else { style & !flag };
        if next_style != style {
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style);
        }
        let _ = SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn set_overlay_transparent_style(_window: &tauri::WebviewWindow, _enabled: bool) {}

#[cfg(target_os = "windows")]
fn apply_overlay_no_activate(window: &tauri::WebviewWindow) {
    set_overlay_no_activate_flag(window, true);
    append_runtime_log_line("overlay_no_activate_applied");
}

#[cfg(not(target_os = "windows"))]
fn apply_overlay_no_activate(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn clear_overlay_no_activate(window: &tauri::WebviewWindow) {
    set_overlay_no_activate_flag(window, false);
    append_runtime_log_line("overlay_no_activate_cleared");
}

#[cfg(not(target_os = "windows"))]
fn clear_overlay_no_activate(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
unsafe extern "system" fn overlay_mouse_activate_wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if message == WM_MOUSEACTIVATE {
        return LRESULT(MA_NOACTIVATE as isize);
    }

    if let Some(previous) = OVERLAY_MOUSE_ACTIVATE_WNDPROC_PREVIOUS.get().copied() {
        let previous_wndproc: WNDPROC = Some(std::mem::transmute(previous));
        return unsafe { CallWindowProcW(previous_wndproc, hwnd, message, wparam, lparam) };
    }

    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn install_overlay_mouse_activate_no_activate(window: &tauri::WebviewWindow) {
    if OVERLAY_MOUSE_ACTIVATE_WNDPROC_INSTALLED.load(Ordering::SeqCst) {
        return;
    }

    let Some(hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_mouse_activate_install_hwnd_failed");
        return;
    };

    let previous = unsafe {
        SetWindowLongPtrW(
            hwnd,
            GWLP_WNDPROC,
            overlay_mouse_activate_wndproc as *const () as usize as isize,
        )
    };
    if previous == 0 {
        append_runtime_log_line("overlay_mouse_activate_install_failed");
        return;
    }

    let _ = OVERLAY_MOUSE_ACTIVATE_WNDPROC_PREVIOUS.set(previous);
    OVERLAY_MOUSE_ACTIVATE_WNDPROC_INSTALLED.store(true, Ordering::SeqCst);
    append_runtime_log_line("overlay_mouse_activate_install_success");
}

#[cfg(not(target_os = "windows"))]
fn install_overlay_mouse_activate_no_activate(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn overlay_input_shield_hwnd() -> Option<HWND> {
    OVERLAY_INPUT_SHIELD_HWND
        .get()
        .copied()
        .map(|value| HWND(value as *mut core::ffi::c_void))
}
