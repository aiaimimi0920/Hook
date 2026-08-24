#[cfg(target_os = "windows")]
fn rect_contains_point(rect: &RECT, x: i32, y: i32) -> bool {
    x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn enum_windows_for_point(window: HWND, lparam: LPARAM) -> BOOL {
    let state = &mut *(lparam.0 as *mut WindowSearchState);
    if state.found.is_some() {
        return false.into();
    }

    if !IsWindowVisible(window).as_bool() {
        return true.into();
    }

    let mut pid = 0u32;
    GetWindowThreadProcessId(window, Some(&mut pid));
    if pid == state.own_pid {
        return true.into();
    }

    let mut rect = RECT::default();
    if !GetWindowRect(window, &mut rect).is_ok() {
        return true.into();
    }

    if rect_contains_point(&rect, state.x, state.y) {
        state.found = Some(window);
        return false.into();
    }

    true.into()
}

#[cfg(target_os = "windows")]
struct WindowSearchState {
    x: i32,
    y: i32,
    own_pid: u32,
    found: Option<HWND>,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
struct WindowTarget {
    direct: HWND,
    root: HWND,
}

#[cfg(target_os = "windows")]
fn window_class_name(window: HWND) -> String {
    let mut buffer = [0u16; 256];
    let len = unsafe { GetClassNameW(window, &mut buffer) };
    if len <= 0 {
        return "<unknown>".to_string();
    }
    String::from_utf16_lossy(&buffer[..len as usize])
}

#[cfg(target_os = "windows")]
fn resolve_window_at_point(x: i32, y: i32) -> Option<WindowTarget> {
    let own_pid = std::process::id();
    let direct = unsafe { WindowFromPoint(POINT { x, y }) };
    if !direct.is_invalid() {
        let mut direct_pid = 0u32;
        unsafe {
            GetWindowThreadProcessId(direct, Some(&mut direct_pid));
        }
        if direct_pid != own_pid {
            let root = unsafe { GetAncestor(direct, GA_ROOT) };
            let focus_target = if !root.is_invalid() { root } else { direct };
            return Some(WindowTarget {
                direct,
                root: focus_target,
            });
        }
    }

    let mut state = WindowSearchState {
        x,
        y,
        own_pid,
        found: None,
    };
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_for_point),
            LPARAM((&mut state as *mut WindowSearchState) as isize),
        );
        if let Some(window) = state.found {
            let root = GetAncestor(window, GA_ROOT);
            let focus_target = if !root.is_invalid() { root } else { window };
            return Some(WindowTarget {
                direct: window,
                root: focus_target,
            });
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn focus_window_at_point(x: i32, y: i32) -> Option<WindowTarget> {
    let target = resolve_window_at_point(x, y);
    match target {
        Some(target) => {
            crate::append_runtime_log_line(&format!(
                "long_capture focus_target :: x={} y={} direct={:?} direct_class={} root={:?} root_class={}",
                x,
                y,
                target.direct,
                window_class_name(target.direct),
                target.root,
                window_class_name(target.root)
            ));
            unsafe {
                let _ = SetForegroundWindow(target.root);
            }
            Some(target)
        }
        None => {
            crate::append_runtime_log_line(&format!(
                "long_capture focus_target_missing :: x={} y={}",
                x, y
            ));
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn mouse_wheel_wparam(delta: i32) -> WPARAM {
    let delta_word = (delta as i16 as u16 as usize) << 16;
    WPARAM(delta_word)
}

#[cfg(target_os = "windows")]
fn mouse_wheel_lparam(x: i32, y: i32) -> LPARAM {
    let packed = ((y as u16 as u32) << 16) | (x as u16 as u32);
    LPARAM(packed as isize)
}

#[cfg(target_os = "windows")]
fn send_message_scroll_fallback(target: WindowTarget, x: i32, y: i32, delta: i32) -> bool {
    let wheel_wparam = mouse_wheel_wparam(delta);
    let wheel_lparam = mouse_wheel_lparam(x, y);
    let mut current = target.direct;
    let mut attempt = 0usize;
    let mut sent_any = false;

    loop {
        if current.is_invalid() {
            break;
        }

        crate::append_runtime_log_line(&format!(
            "long_capture message_scroll_attempt :: hwnd={:?} class={} attempt={} delta={}",
            current,
            window_class_name(current),
            attempt,
            delta
        ));
        unsafe {
            let _ = SendMessageW(
                current,
                WM_MOUSEWHEEL,
                Some(wheel_wparam),
                Some(wheel_lparam),
            );
            let _ = SendMessageW(
                current,
                WM_VSCROLL,
                Some(WPARAM(SB_PAGEDOWN.0 as usize)),
                Some(LPARAM(0)),
            );
        }
        sent_any = true;

        if current == target.root {
            break;
        }

        let parent = match unsafe { GetParent(current) } {
            Ok(parent) => parent,
            Err(_) => break,
        };
        if parent.is_invalid() || parent == current {
            break;
        }
        current = parent;
        attempt += 1;
        if attempt > 8 {
            break;
        }
    }

    sent_any
}

fn logical_to_primary_physical(x: i32, y: i32) -> (i32, i32) {
    let display = Display::primary();
    let physical = display.physical_size();
    let logical = display.logical_size();
    if let (Some(physical), Some(logical)) = (physical, logical) {
        if logical.width() > 0.0 && logical.height() > 0.0 {
            let scale_x = physical.width() / logical.width();
            let scale_y = physical.height() / logical.height();
            return (
                (x as f64 * scale_x).round() as i32,
                (y as f64 * scale_y).round() as i32,
            );
        }
    }
    (x, y)
}

#[cfg(target_os = "windows")]
fn current_cursor_position() -> Option<(i32, i32)> {
    let mut point = POINT::default();
    if unsafe { GetCursorPos(&mut point) }.is_ok() {
        Some((point.x, point.y))
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn scroll_vertical_at_point(x: i32, y: i32, delta: i32) {
    let previous = current_cursor_position();
    let _ = unsafe { SetCursorPos(x, y) };
    let used_messages = focus_window_at_point(x, y)
        .map(|target| send_message_scroll_fallback(target, x, y, delta))
        .unwrap_or(false);
    crate::append_runtime_log_line(&format!(
        "long_capture wheel_scroll :: x={} y={} delta={} used_messages={}",
        x, y, delta, used_messages
    ));
    unsafe {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0);
    }
    if let Some((previous_x, previous_y)) = previous {
        let _ = unsafe { SetCursorPos(previous_x, previous_y) };
    }
}

#[cfg(target_os = "windows")]
fn page_down_at_point(x: i32, y: i32) {
    let previous = current_cursor_position();
    let _ = unsafe { SetCursorPos(x, y) };
    let target = focus_window_at_point(x, y);
    let used_messages = target
        .map(|target| send_message_scroll_fallback(target, x, y, -120))
        .unwrap_or(false);
    unsafe {
        keybd_event(VK_NEXT.0 as u8, 0, Default::default(), 0);
        keybd_event(VK_NEXT.0 as u8, 0, KEYEVENTF_KEYUP, 0);
    }
    crate::append_runtime_log_line(&format!(
        "long_capture page_down_fallback :: x={} y={} used_messages={}",
        x, y, used_messages
    ));
    if let Some((previous_x, previous_y)) = previous {
        let _ = unsafe { SetCursorPos(previous_x, previous_y) };
    }
}
