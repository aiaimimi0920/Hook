// Owns the reversible, same-session source-window lifecycle used by live capture.

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug)]
struct LiveSourceWindowSnapshot {
    rect: windows::Win32::Foundation::RECT,
    placement: windows::Win32::UI::WindowsAndMessaging::WINDOWPLACEMENT,
    was_iconic: bool,
    ex_style: isize,
    layered_attributes: Option<LiveSourceLayeredAttributes>,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug)]
struct LiveSourceLayeredAttributes {
    color_key: windows::Win32::Foundation::COLORREF,
    alpha: u8,
    flags: windows::Win32::UI::WindowsAndMessaging::LAYERED_WINDOW_ATTRIBUTES_FLAGS,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct LiveSourceWindowLifecycle {
    hwnd_value: isize,
    process_id: u32,
    thread_id: u32,
    input_capability: String,
    visibility: Arc<Mutex<LiveSourceVisibility>>,
    visibility_attached: bool,
    interaction_enabled: bool,
    last_input_sequence: u64,
    pressed_mouse_buttons: u8,
    pressed_virtual_keys: std::collections::BTreeMap<u16, isize>,
    mouse_target_hwnd: Option<isize>,
    keyboard_target_hwnd: Option<isize>,
    last_client_x: i32,
    last_client_y: i32,
    capture_region: Option<LiveCapturePhysicalRegion>,
}

#[cfg(target_os = "windows")]
impl LiveSourceWindowLifecycle {
    fn new_with_region(
        window_id: &str,
        capture_region: Option<LiveCapturePhysicalRegion>,
    ) -> Result<Self, String> {
        let hwnd = parse_live_source_hwnd(window_id)?;
        let (thread_id, process_id) = live_source_window_identity(hwnd)?;
        let input_capability = match live_source_input_preflight(process_id) {
            Ok(()) => "window_message".to_string(),
            Err(code) => code,
        };
        Ok(Self {
            hwnd_value: hwnd.0 as isize,
            process_id,
            thread_id,
            input_capability,
            visibility: acquire_live_source_visibility(hwnd.0 as isize, process_id, thread_id)?,
            visibility_attached: true,
            interaction_enabled: false,
            last_input_sequence: 0,
            pressed_mouse_buttons: 0,
            pressed_virtual_keys: std::collections::BTreeMap::new(),
            mouse_target_hwnd: None,
            keyboard_target_hwnd: None,
            last_client_x: 0,
            last_client_y: 0,
            capture_region,
        })
    }

    fn hwnd(&self) -> windows::Win32::Foundation::HWND {
        windows::Win32::Foundation::HWND(self.hwnd_value as *mut std::ffi::c_void)
    }

    fn validate_identity(&self) -> Result<windows::Win32::Foundation::HWND, String> {
        let hwnd = self.hwnd();
        let (thread_id, process_id) = live_source_window_identity(hwnd)?;
        if process_id != self.process_id || thread_id != self.thread_id {
            return Err("source_identity_changed".to_string());
        }
        Ok(hwnd)
    }

    fn source_window_state(&self) -> &'static str {
        if self.visibility.lock().is_ok_and(|visibility| visibility.logically_hidden) {
            "logically_hidden"
        } else {
            "visible"
        }
    }

    fn logical_hide_reason(&self) -> Option<String> {
        self.visibility.lock().ok().and_then(|visibility| visibility.logical_hide_reason.clone())
    }

    fn set_logically_hidden(&mut self, hidden: bool, reason: &str) -> Result<(), String> {
        if hidden {
            self.hide(reason)
        } else {
            self.release_pressed_inputs();
            self.interaction_enabled = false;
            let mut visibility = self.visibility.lock()
                .map_err(|_| "live source visibility poisoned".to_string())?;
            self.restore_visibility(&mut visibility)
        }
    }

    fn intercept_native_minimize(&mut self) -> Result<bool, String> {
        let hwnd = self.validate_identity()?;
        if self.source_window_state() == "logically_hidden"
            || !unsafe { windows::Win32::UI::WindowsAndMessaging::IsIconic(hwnd) }.as_bool()
        {
            return Ok(false);
        }
        self.hide("native_minimize")?;
        Ok(true)
    }

    fn hide(&mut self, reason: &str) -> Result<(), String> {
        let mut visibility = self.visibility.lock()
            .map_err(|_| "live source visibility poisoned".to_string())?;
        if visibility.logically_hidden {
            return Ok(());
        }
        let hwnd = self.validate_identity()?;
        let mut rect = windows::Win32::Foundation::RECT::default();
        unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut rect) }
            .map_err(|error| format!("source_bounds_unavailable:{error}"))?;
        let mut placement = windows::Win32::UI::WindowsAndMessaging::WINDOWPLACEMENT {
            length: std::mem::size_of::<windows::Win32::UI::WindowsAndMessaging::WINDOWPLACEMENT>()
                as u32,
            ..Default::default()
        };
        unsafe {
            windows::Win32::UI::WindowsAndMessaging::GetWindowPlacement(hwnd, &mut placement)
        }
        .map_err(|error| format!("source_placement_unavailable:{error}"))?;
        let was_iconic =
            unsafe { windows::Win32::UI::WindowsAndMessaging::IsIconic(hwnd) }.as_bool();
        let ex_style = unsafe {
            windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(
                hwnd,
                windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
            )
        };
        let layered_attributes = live_source_layered_attributes(hwnd, ex_style)?;
        if was_iconic {
            rect = placement.rcNormalPosition;
            unsafe {
                let _ = windows::Win32::UI::WindowsAndMessaging::ShowWindowAsync(
                    hwnd,
                    windows::Win32::UI::WindowsAndMessaging::SW_SHOWNOACTIVATE,
                );
            };
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let snapshot = LiveSourceWindowSnapshot {
            rect,
            placement,
            was_iconic,
            ex_style,
            layered_attributes,
        };
        register_live_source_recovery(self.recovery_record(snapshot))?;
        visibility.snapshot = Some(snapshot);
        let hide_result = apply_live_source_transparency(hwnd, ex_style);
        if let Err(error) = hide_result {
            let rollback = self.restore_visibility(&mut visibility);
            return Err(match rollback {
                Ok(()) => format!("logical_hide_unsupported:{error}"),
                Err(restore) => format!("logical_hide_unsupported:{error}; {restore}"),
            });
        }
        visibility.logically_hidden = true;
        visibility.logical_hide_reason = Some(reason.to_string());
        Ok(())
    }

    fn restore(&mut self) -> Result<(), String> {
        self.release_pressed_inputs();
        self.interaction_enabled = false;
        let mut visibility = self.visibility.lock()
            .map_err(|_| "live source visibility poisoned".to_string())?;
        if self.visibility_attached {
            self.visibility_attached = false;
            visibility.sessions = visibility.sessions.saturating_sub(1);
        }
        if visibility.sessions > 0 {
            return Ok(());
        }
        self.restore_visibility(&mut visibility)
    }

    fn restore_visibility(&self, visibility: &mut LiveSourceVisibility) -> Result<(), String> {
        let Some(snapshot) = visibility.snapshot else {
            visibility.logically_hidden = false;
            visibility.logical_hide_reason = None;
            return Ok(());
        };
        let hwnd = self.validate_identity()?;
        let width = (snapshot.rect.right - snapshot.rect.left).max(1);
        let height = (snapshot.rect.bottom - snapshot.rect.top).max(1);
        unsafe {
            windows::Win32::UI::WindowsAndMessaging::SetWindowLongPtrW(
                hwnd,
                windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
                snapshot.ex_style,
            );
        }
        if let Some(attributes) = snapshot.layered_attributes {
            unsafe {
                windows::Win32::UI::WindowsAndMessaging::SetLayeredWindowAttributes(
                    hwnd,
                    attributes.color_key,
                    attributes.alpha,
                    attributes.flags,
                )
            }
            .map_err(|error| format!("source_layered_restore_failed:{error}"))?;
        }
        let insert_after = if snapshot.ex_style
            & windows::Win32::UI::WindowsAndMessaging::WS_EX_TOPMOST.0 as isize
            != 0
        {
            windows::Win32::UI::WindowsAndMessaging::HWND_TOPMOST
        } else {
            windows::Win32::UI::WindowsAndMessaging::HWND_NOTOPMOST
        };
        unsafe {
            windows::Win32::UI::WindowsAndMessaging::SetWindowPos(
                hwnd,
                Some(insert_after),
                snapshot.rect.left,
                snapshot.rect.top,
                width,
                height,
                windows::Win32::UI::WindowsAndMessaging::SWP_NOACTIVATE
                    | windows::Win32::UI::WindowsAndMessaging::SWP_FRAMECHANGED,
            )
        }
        .map_err(|error| format!("source_restore_failed:{error}"))?;
        let mut placement = snapshot.placement;
        if snapshot.was_iconic {
            placement.showCmd = windows::Win32::UI::WindowsAndMessaging::SW_RESTORE.0 as u32;
        }
        unsafe { windows::Win32::UI::WindowsAndMessaging::SetWindowPlacement(hwnd, &placement) }
            .map_err(|error| format!("source_placement_restore_failed:{error}"))?;
        visibility.snapshot = None;
        visibility.logically_hidden = false;
        visibility.logical_hide_reason = None;
        unregister_live_source_recovery(self.hwnd_value as u64)
    }

    fn recovery_record(&self, snapshot: LiveSourceWindowSnapshot) -> LiveSourceRecoveryRecord {
        LiveSourceRecoveryRecord {
            hwnd: self.hwnd_value as u64,
            source_process_id: self.process_id,
            source_thread_id: self.thread_id,
            rect: [
                snapshot.rect.left,
                snapshot.rect.top,
                snapshot.rect.right,
                snapshot.rect.bottom,
            ],
            placement_flags: snapshot.placement.flags.0,
            placement_show_command: snapshot.placement.showCmd,
            placement_min_position: [
                snapshot.placement.ptMinPosition.x,
                snapshot.placement.ptMinPosition.y,
            ],
            placement_max_position: [
                snapshot.placement.ptMaxPosition.x,
                snapshot.placement.ptMaxPosition.y,
            ],
            placement_normal_position: [
                snapshot.placement.rcNormalPosition.left,
                snapshot.placement.rcNormalPosition.top,
                snapshot.placement.rcNormalPosition.right,
                snapshot.placement.rcNormalPosition.bottom,
            ],
            ex_style: snapshot.ex_style,
            layered_color_key: snapshot
                .layered_attributes
                .map(|attributes| attributes.color_key.0),
            layered_alpha: snapshot
                .layered_attributes
                .map(|attributes| attributes.alpha),
            layered_flags: snapshot
                .layered_attributes
                .map(|attributes| attributes.flags.0),
            was_iconic: snapshot.was_iconic,
        }
    }
}

#[cfg(target_os = "windows")]
fn live_source_layered_attributes(
    hwnd: windows::Win32::Foundation::HWND,
    ex_style: isize,
) -> Result<Option<LiveSourceLayeredAttributes>, String> {
    if ex_style & windows::Win32::UI::WindowsAndMessaging::WS_EX_LAYERED.0 as isize == 0 {
        return Ok(None);
    }
    let mut color_key = windows::Win32::Foundation::COLORREF::default();
    let mut alpha = 0u8;
    let mut flags = windows::Win32::UI::WindowsAndMessaging::LAYERED_WINDOW_ATTRIBUTES_FLAGS(0);
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetLayeredWindowAttributes(
            hwnd,
            Some(&mut color_key),
            Some(&mut alpha),
            Some(&mut flags),
        )
    }
    .map_err(|error| format!("source_layered_state_unavailable:{error}"))?;
    Ok(Some(LiveSourceLayeredAttributes {
        color_key,
        alpha,
        flags,
    }))
}

#[cfg(target_os = "windows")]
fn apply_live_source_transparency(
    hwnd: windows::Win32::Foundation::HWND,
    ex_style: isize,
) -> windows::core::Result<()> {
    let hidden_style = (ex_style
        | windows::Win32::UI::WindowsAndMessaging::WS_EX_LAYERED.0 as isize
        | windows::Win32::UI::WindowsAndMessaging::WS_EX_TRANSPARENT.0 as isize
        | windows::Win32::UI::WindowsAndMessaging::WS_EX_TOOLWINDOW.0 as isize
        | windows::Win32::UI::WindowsAndMessaging::WS_EX_NOACTIVATE.0 as isize)
        & !(windows::Win32::UI::WindowsAndMessaging::WS_EX_APPWINDOW.0 as isize);
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::SetWindowLongPtrW(
            hwnd,
            windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
            hidden_style,
        );
        let applied_style = windows::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(
            hwnd,
            windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
        );
        if applied_style & hidden_style != hidden_style {
            return Err(windows::core::Error::from_win32());
        }
        windows::Win32::UI::WindowsAndMessaging::SetLayeredWindowAttributes(
            hwnd,
            windows::Win32::Foundation::COLORREF(0),
            1,
            windows::Win32::UI::WindowsAndMessaging::LWA_ALPHA,
        )?;
        windows::Win32::UI::WindowsAndMessaging::SetWindowPos(
            hwnd,
            Some(windows::Win32::UI::WindowsAndMessaging::HWND_BOTTOM),
            0,
            0,
            0,
            0,
            windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
                | windows::Win32::UI::WindowsAndMessaging::SWP_NOSIZE
                | windows::Win32::UI::WindowsAndMessaging::SWP_NOACTIVATE
                | windows::Win32::UI::WindowsAndMessaging::SWP_FRAMECHANGED,
        )
    }
}

#[cfg(target_os = "windows")]
fn parse_live_source_hwnd(window_id: &str) -> Result<windows::Win32::Foundation::HWND, String> {
    let raw = u64::from_str_radix(window_id.trim_start_matches("0x"), 16)
        .ok()
        .filter(|value| *value != 0)
        .ok_or_else(|| "source_window_invalid".to_string())?;
    Ok(windows::Win32::Foundation::HWND(
        raw as *mut std::ffi::c_void,
    ))
}

#[cfg(target_os = "windows")]
fn live_source_window_identity(
    hwnd: windows::Win32::Foundation::HWND,
) -> Result<(u32, u32), String> {
    if !unsafe { windows::Win32::UI::WindowsAndMessaging::IsWindow(Some(hwnd)) }.as_bool() {
        return Err("source_window_closed".to_string());
    }
    let mut process_id = 0u32;
    let thread_id = unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
            hwnd,
            Some(&mut process_id),
        )
    };
    if process_id == 0 || thread_id == 0 {
        return Err("source_identity_unavailable".to_string());
    }
    Ok((thread_id, process_id))
}

#[cfg(not(target_os = "windows"))]
#[derive(Debug)]
struct LiveSourceWindowLifecycle {
    input_capability: String,
    interaction_enabled: bool,
    logical_hide_reason: Option<String>,
}

#[cfg(not(target_os = "windows"))]
impl LiveSourceWindowLifecycle {
    fn source_window_state(&self) -> &'static str {
        "unsupported"
    }

    fn logical_hide_reason(&self) -> Option<String> {
        self.logical_hide_reason.clone()
    }

    fn restore(&mut self) -> Result<(), String> {
        self.interaction_enabled = false;
        Err("live source window control requires Windows 11".to_string())
    }

    fn set_logically_hidden(&mut self, _hidden: bool, _reason: &str) -> Result<(), String> {
        Err("live source window control requires Windows 11".to_string())
    }

    fn set_interaction_enabled(&mut self, _enabled: bool) -> Result<(), String> {
        Err("live source input requires Windows 11".to_string())
    }

    fn send_input(&mut self, _request: &LiveCaptureInputRequest) -> Result<(), String> {
        Err("live source input requires Windows 11".to_string())
    }
}
