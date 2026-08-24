// Owns enumeration/topmost predicates and physical point hit testing.

fn is_window_valid_for_enumeration(hwnd: HWND, current_process_id: u32) -> bool {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return false;
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        if process_id == current_process_id {
            return false;
        }

        if let Ok(exe_path) = pid_to_exe_path(process_id)
            && let Some(exe_name) = exe_path.file_name().and_then(|n| n.to_str())
            && IGNORED_EXES.contains(&&*exe_name.to_lowercase())
        {
            return false;
        }

        true
    }
}

fn is_window_valid_for_topmost_selection(
    hwnd: HWND,
    current_process_id: u32,
    point: POINT,
) -> bool {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
            return false;
        }

        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        if process_id == current_process_id {
            return false;
        }

        if let Ok(exe_path) = pid_to_exe_path(process_id)
            && let Some(exe_name) = exe_path.file_name().and_then(|n| n.to_str())
        {
            let exe_name_lower = exe_name.to_lowercase();
            if exe_name_lower.contains("webview2")
                || exe_name_lower.contains("msedgewebview2")
                || exe_name_lower.contains("cap")
            {
                return false;
            }
        }

        // Check if point is actually in this window
        if !is_point_in_window(hwnd, point) {
            return false;
        }

        // Skip certain window classes that should be ignored
        let mut class_name = [0u16; 256];
        let len = GetClassNameW(hwnd, &mut class_name);
        if len > 0 {
            let class_name_str = String::from_utf16_lossy(&class_name[..len as usize]);
            match class_name_str.as_str() {
                "Shell_TrayWnd" | "Button" | "Tooltip" | "ToolTips_Class32" => return false,
                _ => {}
            }
        }

        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if (ex_style & WS_EX_TRANSPARENT.0) != 0 || (ex_style & WS_EX_LAYERED.0) != 0 {
            if (ex_style & WS_EX_LAYERED.0) != 0 {
                let mut alpha = 0u8;
                let mut color_key = 0u32;
                let mut flags = 0u32;
                if GetLayeredWindowAttributes(
                    hwnd,
                    Some(&mut color_key as *mut u32 as *mut _),
                    Some(&mut alpha),
                    Some(&mut flags as *mut u32 as *mut _),
                )
                .is_ok()
                    && alpha < 50
                {
                    return false;
                }
            } else {
                return false;
            }
        }

        true
    }
}

fn is_point_in_window(hwnd: HWND, point: POINT) -> bool {
    unsafe {
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_ok() {
            point.x >= rect.left
                && point.x < rect.right
                && point.y >= rect.top
                && point.y < rect.bottom
        } else {
            false
        }
    }
}
