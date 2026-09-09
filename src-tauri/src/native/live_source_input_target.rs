// Resolves and temporarily exposes validated child HWND targets for local live input.

#[cfg(target_os = "windows")]
impl LiveSourceWindowLifecycle {
    fn valid_input_target(
        &self,
        root: windows::Win32::Foundation::HWND,
        target: windows::Win32::Foundation::HWND,
    ) -> bool {
        let Ok((_thread_id, process_id)) = live_source_window_identity(target) else {
            return false;
        };
        let belongs_to_source = target == root
            || unsafe { windows::Win32::UI::WindowsAndMessaging::IsChild(root, target) }.as_bool();
        belongs_to_source
            && (process_id == self.process_id || live_source_input_preflight(process_id).is_ok())
    }

    fn nearest_valid_input_target(
        &self,
        root: windows::Win32::Foundation::HWND,
        mut target: windows::Win32::Foundation::HWND,
    ) -> windows::Win32::Foundation::HWND {
        loop {
            if self.valid_input_target(root, target) {
                return target;
            }
            if target == root {
                return root;
            }
            target = match unsafe { windows::Win32::UI::WindowsAndMessaging::GetParent(target) } {
                Ok(parent) => parent,
                Err(_) => return root,
            };
        }
    }
}

#[cfg(target_os = "windows")]
struct LiveTransparentStyleGuard {
    hwnd: windows::Win32::Foundation::HWND,
    restore_transparent: bool,
}

#[cfg(target_os = "windows")]
impl LiveTransparentStyleGuard {
    fn clear_for_hit_test(
        hwnd: windows::Win32::Foundation::HWND,
        logically_hidden: bool,
    ) -> Result<Self, String> {
        let transparent = windows::Win32::UI::WindowsAndMessaging::WS_EX_TRANSPARENT.0 as isize;
        let style = unsafe {
            windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(
                hwnd,
                windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
            )
        };
        let restore_transparent = logically_hidden && style & transparent != 0;
        if restore_transparent {
            checked_live_set_window_ex_style(hwnd, style & !transparent)?;
        }
        Ok(Self {
            hwnd,
            restore_transparent,
        })
    }

    fn restore(mut self) -> Result<(), String> {
        if self.restore_transparent {
            restore_live_transparent_style(self.hwnd)?;
            self.restore_transparent = false;
        }
        Ok(())
    }
}

#[cfg(target_os = "windows")]
impl Drop for LiveTransparentStyleGuard {
    fn drop(&mut self) {
        if self.restore_transparent {
            let _ = restore_live_transparent_style(self.hwnd);
        }
    }
}

#[cfg(target_os = "windows")]
fn restore_live_transparent_style(hwnd: windows::Win32::Foundation::HWND) -> Result<(), String> {
    let style = unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(
            hwnd,
            windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
        )
    };
    checked_live_set_window_ex_style(
        hwnd,
        style | windows::Win32::UI::WindowsAndMessaging::WS_EX_TRANSPARENT.0 as isize,
    )
}

#[cfg(target_os = "windows")]
fn checked_live_set_window_ex_style(
    hwnd: windows::Win32::Foundation::HWND,
    style: isize,
) -> Result<(), String> {
    unsafe { windows::Win32::Foundation::SetLastError(windows::Win32::Foundation::WIN32_ERROR(0)) };
    let previous = unsafe {
        windows::Win32::UI::WindowsAndMessaging::SetWindowLongPtrW(
            hwnd,
            windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
            style,
        )
    };
    let error = unsafe { windows::Win32::Foundation::GetLastError() };
    if previous == 0 && error.0 != 0 {
        Err(format!("source_style_transition_failed:{}", error.0))
    } else {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn live_child_window_at(
    root: windows::Win32::Foundation::HWND,
    client_x: i32,
    client_y: i32,
) -> Result<windows::Win32::Foundation::HWND, String> {
    let mut screen = windows::Win32::Foundation::POINT {
        x: client_x,
        y: client_y,
    };
    if !unsafe { windows::Win32::Graphics::Gdi::ClientToScreen(root, &mut screen) }.as_bool() {
        return Err("source_coordinate_transform_failed".to_string());
    }
    let mut target = root;
    loop {
        let mut point = screen;
        if !unsafe { windows::Win32::Graphics::Gdi::ScreenToClient(target, &mut point) }.as_bool() {
            break;
        }
        let child = unsafe {
            windows::Win32::UI::WindowsAndMessaging::ChildWindowFromPointEx(
                target,
                point,
                windows::Win32::UI::WindowsAndMessaging::CWP_SKIPDISABLED
                    | windows::Win32::UI::WindowsAndMessaging::CWP_SKIPINVISIBLE
                    | windows::Win32::UI::WindowsAndMessaging::CWP_SKIPTRANSPARENT,
            )
        };
        if child.0.is_null() || child == target {
            break;
        }
        target = child;
    }
    Ok(target)
}

#[cfg(target_os = "windows")]
fn live_keyboard_target(
    root: windows::Win32::Foundation::HWND,
    thread_id: u32,
) -> windows::Win32::Foundation::HWND {
    let mut info = windows::Win32::UI::WindowsAndMessaging::GUITHREADINFO {
        cbSize: std::mem::size_of::<windows::Win32::UI::WindowsAndMessaging::GUITHREADINFO>()
            as u32,
        ..Default::default()
    };
    if unsafe { windows::Win32::UI::WindowsAndMessaging::GetGUIThreadInfo(thread_id, &mut info) }
        .is_ok()
        && !info.hwndFocus.0.is_null()
    {
        info.hwndFocus
    } else {
        root
    }
}
