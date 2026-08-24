// Creates and dispatches the native overlay input-shield window.

#[cfg(target_os = "windows")]
unsafe extern "system" fn overlay_input_shield_wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if let Some(result) = route_overlay_input_shield_mouse_message(message, wparam) {
        return result;
    }

    if let Some(previous) = OVERLAY_INPUT_SHIELD_WNDPROC_PREVIOUS.get().copied() {
        let previous_wndproc: WNDPROC = Some(std::mem::transmute(previous));
        return unsafe { CallWindowProcW(previous_wndproc, hwnd, message, wparam, lparam) };
    }

    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

#[cfg(target_os = "windows")]
fn ensure_overlay_input_shield_window(window: &tauri::WebviewWindow) -> Option<HWND> {
    if let Some(hwnd) = overlay_input_shield_hwnd() {
        return Some(hwnd);
    }

    let Some(main_hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_input_shield_hwnd_failed");
        return None;
    };
    let mut main_rect = RECT::default();
    if unsafe { GetWindowRect(main_hwnd, &mut main_rect) }.is_err() {
        append_runtime_log_line("overlay_input_shield_main_rect_failed");
        return None;
    }

    let class_name: Vec<u16> = "STATIC".encode_utf16().chain(std::iter::once(0)).collect();
    let window_name: Vec<u16> = "HookOverlayInputShield"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let width = (main_rect.right - main_rect.left).max(1);
    let height = (main_rect.bottom - main_rect.top).max(1);

    let hwnd = unsafe {
        CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            PCWSTR(class_name.as_ptr()),
            PCWSTR(window_name.as_ptr()),
            WS_POPUP,
            main_rect.left,
            main_rect.top,
            width,
            height,
            None,
            None,
            None,
            None,
        )
    };
    let Ok(hwnd) = hwnd else {
        append_runtime_log_line("overlay_input_shield_create_failed");
        return None;
    };

    let previous = unsafe {
        SetWindowLongPtrW(
            hwnd,
            GWLP_WNDPROC,
            overlay_input_shield_wndproc as *const () as usize as isize,
        )
    };
    if previous == 0 {
        append_runtime_log_line("overlay_input_shield_wndproc_install_failed");
    } else {
        let _ = OVERLAY_INPUT_SHIELD_WNDPROC_PREVIOUS.set(previous);
        append_runtime_log_line("overlay_input_shield_wndproc_install_success");
    }

    let _ = unsafe { SetLayeredWindowAttributes(hwnd, Default::default(), 1, LWA_ALPHA) };
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
    let _ = unsafe { ShowWindow(hwnd, SW_SHOWNA) };
    let _ = OVERLAY_INPUT_SHIELD_HWND.set(hwnd.0 as isize);
    if OVERLAY_INPUT_SHIELD_ALT_PASSTHROUGH.load(Ordering::SeqCst) {
        OVERLAY_INPUT_SHIELD_ALT_PASSTHROUGH.store(false, Ordering::SeqCst);
        set_overlay_input_shield_alt_passthrough(true);
    }
    append_runtime_log_line("overlay_input_shield_create_success");
    Some(hwnd)
}
