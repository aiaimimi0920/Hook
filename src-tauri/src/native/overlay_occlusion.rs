// Detects foreign fullscreen occlusion and transitions overlay passthrough.

#[cfg(target_os = "windows")]
fn rect_covers_rect_with_tolerance(cover: RECT, target: RECT, tolerance: i32) -> bool {
    cover.left <= target.left.saturating_add(tolerance)
        && cover.top <= target.top.saturating_add(tolerance)
        && cover.right >= target.right.saturating_sub(tolerance)
        && cover.bottom >= target.bottom.saturating_sub(tolerance)
}

#[cfg(target_os = "windows")]
fn overlay_window_class_name(hwnd: HWND) -> Option<String> {
    let mut buffer = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
    if len <= 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..len as usize]))
}

#[cfg(target_os = "windows")]
fn is_desktop_shell_window_class(class_name: &str) -> bool {
    matches!(class_name, "Progman" | "WorkerW" | "Shell_TrayWnd")
}

#[cfg(target_os = "windows")]
fn window_is_above_overlay_in_z_order(candidate: HWND, overlay: HWND) -> bool {
    let mut current = unsafe { GetWindow(overlay, GW_HWNDPREV) }.ok();
    let mut remaining = 4096usize;
    while let Some(current_hwnd) = current {
        if remaining == 0 {
            break;
        }
        if current_hwnd == candidate {
            return true;
        }
        current = unsafe { GetWindow(current_hwnd, GW_HWNDPREV) }.ok();
        remaining -= 1;
    }
    false
}

#[cfg(target_os = "windows")]
fn foreign_fullscreen_foreground_covers_overlay(main_hwnd: HWND) -> bool {
    if !unsafe { IsWindowVisible(main_hwnd) }.as_bool() {
        return false;
    }

    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0.is_null() {
        return false;
    }
    let foreground_root = unsafe { GetAncestor(foreground, GA_ROOT) };
    let foreground_root = if foreground_root.0.is_null() {
        foreground
    } else {
        foreground_root
    };
    if foreground_root == main_hwnd || !unsafe { IsWindowVisible(foreground_root) }.as_bool() {
        return false;
    }

    let mut foreground_pid = 0;
    unsafe { GetWindowThreadProcessId(foreground_root, Some(&mut foreground_pid)) };
    if foreground_pid == 0 || foreground_pid == std::process::id() {
        return false;
    }
    if overlay_window_class_name(foreground_root)
        .as_deref()
        .is_some_and(is_desktop_shell_window_class)
    {
        return false;
    }

    let mut overlay_rect = RECT::default();
    let mut foreground_rect = RECT::default();
    if unsafe { GetWindowRect(main_hwnd, &mut overlay_rect) }.is_err()
        || unsafe { GetWindowRect(foreground_root, &mut foreground_rect) }.is_err()
    {
        return false;
    }
    rect_covers_rect_with_tolerance(
        foreground_rect,
        overlay_rect,
        OVERLAY_FULLSCREEN_COVERAGE_TOLERANCE_PX,
    ) && window_is_above_overlay_in_z_order(foreground_root, main_hwnd)
}

#[cfg(target_os = "windows")]
fn enter_overlay_fullscreen_occlusion_passthrough(window: &tauri::WebviewWindow, main_hwnd: HWND) {
    OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(false, Ordering::SeqCst);
    hide_overlay_input_shield_window();
    set_overlay_click_through_impl(window, true);
    let _ = unsafe {
        SetWindowPos(
            main_hwnd,
            Some(HWND_NOTOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    };
    append_runtime_log_line("overlay_fullscreen_occlusion_passthrough_entered");
}

#[cfg(target_os = "windows")]
fn leave_overlay_fullscreen_occlusion_passthrough(window: &tauri::WebviewWindow, main_hwnd: HWND) {
    if !unsafe { IsWindowVisible(main_hwnd) }.as_bool() {
        hide_overlay_input_shield_window();
        append_runtime_log_line("overlay_fullscreen_occlusion_passthrough_left_hidden");
        return;
    }

    reassert_overlay_topmost_window(main_hwnd);
    if CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst) {
        set_overlay_click_through_impl(window, true);
    } else {
        refresh_overlay_interactivity_from_runtime_state(
            window,
            OVERLAY_FULLSCREEN_OCCLUSION_PREVIOUS_CLICK_THROUGH.load(Ordering::SeqCst),
        );
    }
    sync_overlay_input_shield_from_runtime_state(window);
    append_runtime_log_line("overlay_fullscreen_occlusion_passthrough_left");
}

#[cfg(target_os = "windows")]
fn reassert_overlay_topmost_window(hwnd: HWND) {
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return;
    }

    let _ = unsafe {
        SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    };
}
