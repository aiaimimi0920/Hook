// Resolves Windows Explorer and desktop drop targets for drag export.

#[cfg(target_os = "windows")]
fn variant_i4(value: i32) -> VARIANT {
    VARIANT {
        Anonymous: VARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(VARIANT_0_0 {
                vt: VT_I4,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: VARIANT_0_0_0 { lVal: value },
            }),
        },
    }
}

#[cfg(target_os = "windows")]
fn percent_decode_utf8(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let raw = input.as_bytes();
    let mut index = 0;
    while index < raw.len() {
        if raw[index] == b'%' && index + 2 < raw.len() {
            if let Ok(hex) = u8::from_str_radix(&input[index + 1..index + 3], 16) {
                bytes.push(hex);
                index += 3;
                continue;
            }
        }
        bytes.push(raw[index]);
        index += 1;
    }
    String::from_utf8_lossy(&bytes).to_string()
}

#[cfg(target_os = "windows")]
fn path_from_file_url(url: &str) -> Option<PathBuf> {
    let rest = url.strip_prefix("file://")?;
    let (host, path_part) = if let Some((host, path)) = rest.split_once('/') {
        (host, format!("/{}", path))
    } else {
        ("", String::new())
    };
    let decoded_path = percent_decode_utf8(&path_part);
    let path = if host.is_empty() {
        let without_leading_slash = if decoded_path.len() >= 3
            && decoded_path.as_bytes().first() == Some(&b'/')
            && decoded_path.as_bytes().get(2) == Some(&b':')
        {
            &decoded_path[1..]
        } else {
            decoded_path.as_str()
        };
        without_leading_slash.replace('/', "\\")
    } else {
        format!(
            "\\\\{}{}",
            percent_decode_utf8(host),
            decoded_path.replace('/', "\\")
        )
    };
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

#[cfg(target_os = "windows")]
fn point_in_rect(x: i32, y: i32, rect: &RECT) -> bool {
    x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
}

#[cfg(target_os = "windows")]
fn explorer_folder_candidates_at_point(x: i32, y: i32) -> Vec<(PathBuf, i64, bool)> {
    let mut candidates = Vec::new();
    let point = POINT { x, y };
    let point_root = unsafe {
        let hwnd = WindowFromPoint(point);
        if hwnd.0.is_null() {
            HWND(std::ptr::null_mut())
        } else {
            GetAncestor(hwnd, GA_ROOT)
        }
    };

    let com_initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok() };
    let shell_windows =
        unsafe { CoCreateInstance::<_, IShellWindows>(&ShellWindows, None, CLSCTX_ALL) };
    let Ok(shell_windows) = shell_windows else {
        if com_initialized {
            unsafe { CoUninitialize() };
        }
        return candidates;
    };

    let count = unsafe { shell_windows.Count().unwrap_or(0) };
    for index in 0..count {
        let item_variant = variant_i4(index);
        let Ok(dispatch) = (unsafe { shell_windows.Item(&item_variant) }) else {
            continue;
        };
        let Ok(browser) = dispatch.cast::<IWebBrowser2>() else {
            continue;
        };
        let Ok(shell_hwnd) = (unsafe { browser.HWND() }) else {
            continue;
        };
        let hwnd = HWND(shell_hwnd.0 as *mut _);
        if hwnd.0.is_null() {
            continue;
        }
        let mut rect = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() || !point_in_rect(x, y, &rect) {
            continue;
        }
        let Ok(location_url) = (unsafe { browser.LocationURL() }) else {
            continue;
        };
        let Some(folder_path) = path_from_file_url(&location_url.to_string()) else {
            continue;
        };
        if !folder_path.is_dir() {
            continue;
        }
        let area = i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top);
        candidates.push((
            folder_path,
            area,
            !point_root.0.is_null() && point_root == hwnd,
        ));
    }

    if com_initialized {
        unsafe { CoUninitialize() };
    }
    candidates
}

#[cfg(target_os = "windows")]
fn window_class_name_at_point(x: i32, y: i32) -> Option<String> {
    let hwnd = unsafe { WindowFromPoint(POINT { x, y }) };
    if hwnd.0.is_null() {
        return None;
    }
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    let target = if root.0.is_null() { hwnd } else { root };
    let mut buffer = [0u16; 256];
    let len = unsafe { GetClassNameW(target, &mut buffer) };
    if len <= 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buffer[..len as usize]))
}

#[cfg(target_os = "windows")]
fn desktop_dir_for_drag_export() -> Option<PathBuf> {
    dirs::desktop_dir().filter(|path| path.is_dir())
}

#[cfg(target_os = "windows")]
fn explorer_child_folder_at_point(x: i32, y: i32, parent_dir: &Path) -> Option<PathBuf> {
    let automation = UIAutomation::new().ok()?;
    let element = automation.element_from_point(UiaPoint::new(x, y)).ok()?;
    let name = element.get_name().ok()?;
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.contains('\\') || trimmed.contains('/') {
        return None;
    }
    let candidate = parent_dir.join(trimmed);
    if candidate.is_dir() {
        Some(candidate)
    } else {
        None
    }
}

#[cfg(target_os = "windows")]
fn resolve_drag_export_target_dir(global_x: f64, global_y: f64) -> Result<PathBuf, String> {
    let x = global_x.round() as i32;
    let y = global_y.round() as i32;
    let mut candidates = explorer_folder_candidates_at_point(x, y);
    candidates.sort_by_key(|(_, area, root_match)| (!*root_match, *area));
    if let Some((path, _, root_match)) = candidates.into_iter().next() {
        if let Some(child_folder) = explorer_child_folder_at_point(x, y, &path) {
            append_runtime_log_line(&format!(
                "sticker_drag_export_target_explorer_child :: x={} y={} rootMatch={} parent={} path={}",
                x,
                y,
                root_match,
                path.to_string_lossy(),
                child_folder.to_string_lossy()
            ));
            return Ok(child_folder);
        }
        append_runtime_log_line(&format!(
            "sticker_drag_export_target_explorer :: x={} y={} rootMatch={} path={}",
            x,
            y,
            root_match,
            path.to_string_lossy()
        ));
        return Ok(path);
    }

    let class_name = window_class_name_at_point(x, y).unwrap_or_else(|| "unknown".to_string());
    if matches!(
        class_name.as_str(),
        "Progman" | "WorkerW" | "SHELLDLL_DefView" | "SysListView32"
    ) {
        if let Some(desktop) = desktop_dir_for_drag_export() {
            append_runtime_log_line(&format!(
                "sticker_drag_export_target_desktop :: x={} y={} class={} path={}",
                x,
                y,
                class_name,
                desktop.to_string_lossy()
            ));
            return Ok(desktop);
        }
    }

    append_runtime_log_line(&format!(
        "sticker_drag_export_target_missing :: x={} y={} class={}",
        x, y, class_name
    ));
    Err(format!(
        "No Explorer folder found under release cursor ({}, {})",
        x, y
    ))
}
