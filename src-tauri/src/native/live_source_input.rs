// Validates and forwards ordered local input to a same-integrity live source window.

const LIVE_INPUT_MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;
const LIVE_MOUSE_LEFT: u8 = 1;
const LIVE_MOUSE_RIGHT: u8 = 2;
const LIVE_MOUSE_MIDDLE: u8 = 4;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveCaptureInputRequest {
    sequence: u64,
    kind: String,
    #[serde(default)]
    normalized_x: Option<f64>,
    #[serde(default)]
    normalized_y: Option<f64>,
    #[serde(default)]
    button: Option<String>,
    #[serde(default)]
    wheel_delta: Option<i32>,
    #[serde(default)]
    wheel_axis: Option<String>,
    #[serde(default)]
    click_count: Option<u8>,
    #[serde(default)]
    virtual_key: Option<u16>,
}

#[cfg(target_os = "windows")]
impl LiveSourceWindowLifecycle {
    fn set_interaction_enabled(&mut self, enabled: bool) -> Result<(), String> {
        if enabled {
            self.validate_identity()?;
            live_source_input_preflight(self.process_id).map_err(|code| {
                self.input_capability = code.clone();
                code
            })?;
            self.input_capability = "window_message".to_string();
            self.interaction_enabled = true;
        } else {
            self.release_pressed_inputs();
            self.interaction_enabled = false;
        }
        Ok(())
    }

    fn send_input(&mut self, request: &LiveCaptureInputRequest) -> Result<(), String> {
        if !self.interaction_enabled {
            return Err("interaction_not_enabled".to_string());
        }
        if self.input_capability != "window_message" {
            return Err(self.input_capability.clone());
        }
        if request.sequence == 0
            || request.sequence > LIVE_INPUT_MAX_SAFE_SEQUENCE
            || request.sequence <= self.last_input_sequence
        {
            return Err("input_sequence_rejected".to_string());
        }
        let hwnd = self.validate_identity()?;
        live_source_input_preflight(self.process_id)?;
        match request.kind.as_str() {
            "mouse_move" | "mouse_button_down" | "mouse_button_up" | "mouse_wheel" => {
                self.send_mouse_input(hwnd, request)?;
            }
            "key_down" | "key_up" => self.send_key_input(hwnd, request)?,
            _ => return Err("input_kind_unsupported".to_string()),
        }
        self.last_input_sequence = request.sequence;
        Ok(())
    }

    fn send_mouse_input(
        &mut self,
        hwnd: windows::Win32::Foundation::HWND,
        request: &LiveCaptureInputRequest,
    ) -> Result<(), String> {
        let x = validate_live_normalized_coordinate(request.normalized_x, "x")?;
        let y = validate_live_normalized_coordinate(request.normalized_y, "y")?;
        let _dpi_context = enter_live_source_dpi_context(hwnd)?;
        let (client_x, client_y) = if let Some(region) = self.capture_region {
            let point = live_capture_region_client_point(hwnd, region, x, y)?;
            (point.x, point.y)
        } else {
            let mut client = windows::Win32::Foundation::RECT::default();
            unsafe { windows::Win32::UI::WindowsAndMessaging::GetClientRect(hwnd, &mut client) }
                .map_err(|_| "source_client_bounds_unavailable".to_string())?;
            let width = (client.right - client.left).max(1);
            let height = (client.bottom - client.top).max(1);
            (
                ((width - 1) as f64 * x).round() as i32,
                ((height - 1) as f64 * y).round() as i32,
            )
        };
        let (message, button_mask, next_pressed) = match request.kind.as_str() {
            "mouse_move" => (0x0200u32, 0u8, self.pressed_mouse_buttons),
            "mouse_button_down" => {
                let (message, mask) = live_mouse_button(
                    request.button.as_deref(),
                    true,
                    request.click_count == Some(2),
                )?;
                (message, mask, self.pressed_mouse_buttons | mask)
            }
            "mouse_button_up" => {
                let (message, mask) = live_mouse_button(request.button.as_deref(), false, false)?;
                (message, mask, self.pressed_mouse_buttons & !mask)
            }
            "mouse_wheel" => (
                match request.wheel_axis.as_deref().unwrap_or("vertical") {
                    "horizontal" => 0x020Eu32,
                    "vertical" => 0x020Au32,
                    _ => return Err("wheel_axis_invalid".to_string()),
                },
                0u8,
                self.pressed_mouse_buttons,
            ),
            _ => return Err("input_kind_unsupported".to_string()),
        };
        let key_state = live_mouse_key_state(next_pressed);
        let target = self.live_mouse_target(hwnd, client_x, client_y, request.kind.as_str())?;
        let mut target_point = windows::Win32::Foundation::POINT {
            x: client_x,
            y: client_y,
        };
        if target != hwnd {
            if !unsafe { windows::Win32::Graphics::Gdi::ClientToScreen(hwnd, &mut target_point) }
                .as_bool()
                || !unsafe {
                    windows::Win32::Graphics::Gdi::ScreenToClient(target, &mut target_point)
                }
                .as_bool()
            {
                return Err("source_coordinate_transform_failed".to_string());
            }
        }
        self.last_client_x = target_point.x;
        self.last_client_y = target_point.y;
        let (wparam, lparam) = if request.kind == "mouse_wheel" {
            let delta = request
                .wheel_delta
                .filter(|value| *value != 0 && value.unsigned_abs() <= 1_200)
                .ok_or_else(|| "wheel_delta_invalid".to_string())?;
            let mut screen_point = windows::Win32::Foundation::POINT {
                x: client_x,
                y: client_y,
            };
            if !unsafe { windows::Win32::Graphics::Gdi::ClientToScreen(hwnd, &mut screen_point) }
                .as_bool()
            {
                return Err("source_coordinate_transform_failed".to_string());
            }
            (
                windows::Win32::Foundation::WPARAM(
                    key_state | ((delta as i16 as u16 as usize) << 16),
                ),
                live_mouse_lparam(screen_point.x, screen_point.y),
            )
        } else {
            (
                windows::Win32::Foundation::WPARAM(key_state),
                live_mouse_lparam(target_point.x, target_point.y),
            )
        };
        // Timeout means completion is unknown, not that the down edge was rejected.
        // Keep possible held buttons until an up is acknowledged or cleanup attempts it.
        if button_mask != 0 {
            self.pressed_mouse_buttons |= next_pressed;
        }
        self.deliver_message(target, message, wparam, lparam)?;
        if button_mask != 0 {
            self.pressed_mouse_buttons = next_pressed;
            if next_pressed == 0 {
                self.mouse_target_hwnd = None;
            }
        }
        Ok(())
    }

    fn live_mouse_target(
        &mut self,
        root: windows::Win32::Foundation::HWND,
        client_x: i32,
        client_y: i32,
        kind: &str,
    ) -> Result<windows::Win32::Foundation::HWND, String> {
        if self.pressed_mouse_buttons != 0 {
            if let Some(raw) = self.mouse_target_hwnd {
                let cached = windows::Win32::Foundation::HWND(raw as *mut std::ffi::c_void);
                if self.valid_input_target(root, cached) {
                    return Ok(cached);
                }
                self.mouse_target_hwnd = None;
            }
        }
        let target = self.resolve_mouse_target(root, client_x, client_y)?;
        if kind == "mouse_button_down" {
            self.mouse_target_hwnd = Some(target.0 as isize);
            self.keyboard_target_hwnd = Some(target.0 as isize);
        }
        Ok(target)
    }

    fn resolve_mouse_target(
        &self,
        root: windows::Win32::Foundation::HWND,
        client_x: i32,
        client_y: i32,
    ) -> Result<windows::Win32::Foundation::HWND, String> {
        // Serialize temporary style changes with hide/restore and other regions' hit tests.
        let visibility = self
            .visibility
            .lock()
            .map_err(|_| "live source visibility poisoned".to_string())?;
        let guard =
            LiveTransparentStyleGuard::clear_for_hit_test(root, visibility.logically_hidden)?;
        let target = live_child_window_at(root, client_x, client_y);
        guard.restore()?;
        Ok(self.nearest_valid_input_target(root, target?))
    }

    fn send_key_input(
        &mut self,
        hwnd: windows::Win32::Foundation::HWND,
        request: &LiveCaptureInputRequest,
    ) -> Result<(), String> {
        let virtual_key = request
            .virtual_key
            .filter(|value| (1..=254).contains(value))
            .ok_or_else(|| "virtual_key_invalid".to_string())?;
        let key_up = request.kind == "key_up";
        if !key_up
            && !self.pressed_virtual_keys.contains_key(&virtual_key)
            && self.pressed_virtual_keys.len() >= 32
        {
            return Err("pressed_key_limit_reached".to_string());
        }
        let scan_code = unsafe {
            windows::Win32::UI::Input::KeyboardAndMouse::MapVirtualKeyW(
                u32::from(virtual_key),
                windows::Win32::UI::Input::KeyboardAndMouse::MAPVK_VK_TO_VSC,
            )
        };
        let mut lparam = 1isize | ((scan_code as isize & 0xff) << 16);
        if key_up {
            lparam |= 0xC000_0000u32 as isize;
        }
        let cached = if key_up {
            self.pressed_virtual_keys.get(&virtual_key).copied()
        } else {
            self.keyboard_target_hwnd
        };
        let target = cached
            .map(|raw| windows::Win32::Foundation::HWND(raw as *mut std::ffi::c_void))
            .filter(|target| self.valid_input_target(hwnd, *target))
            .unwrap_or_else(|| {
                let focused = live_keyboard_target(hwnd, self.thread_id);
                if self.valid_input_target(hwnd, focused) {
                    focused
                } else {
                    hwnd
                }
            });
        self.keyboard_target_hwnd = Some(target.0 as isize);
        if !key_up {
            self.pressed_virtual_keys
                .insert(virtual_key, target.0 as isize);
        }
        self.deliver_message(
            target,
            if key_up { 0x0101 } else { 0x0100 },
            windows::Win32::Foundation::WPARAM(usize::from(virtual_key)),
            windows::Win32::Foundation::LPARAM(lparam),
        )?;
        if key_up {
            self.pressed_virtual_keys.remove(&virtual_key);
        }
        Ok(())
    }

    fn release_pressed_inputs(&mut self) {
        let hwnd = match self.validate_identity() {
            Ok(hwnd) => hwnd,
            Err(_) => {
                self.pressed_mouse_buttons = 0;
                self.pressed_virtual_keys.clear();
                self.mouse_target_hwnd = None;
                self.keyboard_target_hwnd = None;
                return;
            }
        };
        let mouse_target = self
            .mouse_target_hwnd
            .map(|raw| windows::Win32::Foundation::HWND(raw as *mut std::ffi::c_void))
            .filter(|target| self.valid_input_target(hwnd, *target))
            .unwrap_or(hwnd);
        for (mask, message) in [
            (LIVE_MOUSE_LEFT, 0x0202u32),
            (LIVE_MOUSE_RIGHT, 0x0205u32),
            (LIVE_MOUSE_MIDDLE, 0x0208u32),
        ] {
            if self.pressed_mouse_buttons & mask == 0 {
                continue;
            }
            self.pressed_mouse_buttons &= !mask;
            let _ = self.deliver_message(
                mouse_target,
                message,
                windows::Win32::Foundation::WPARAM(live_mouse_key_state(
                    self.pressed_mouse_buttons,
                )),
                live_mouse_lparam(self.last_client_x, self.last_client_y),
            );
        }
        self.mouse_target_hwnd = None;
        for (virtual_key, target) in std::mem::take(&mut self.pressed_virtual_keys) {
            let target = windows::Win32::Foundation::HWND(target as *mut std::ffi::c_void);
            let target = if self.valid_input_target(hwnd, target) {
                target
            } else {
                hwnd
            };
            let _ = self.deliver_message(
                target,
                0x0101,
                windows::Win32::Foundation::WPARAM(usize::from(virtual_key)),
                windows::Win32::Foundation::LPARAM(0xC000_0001isize),
            );
        }
        self.keyboard_target_hwnd = None;
    }

    fn deliver_message(
        &self,
        target: windows::Win32::Foundation::HWND,
        message: u32,
        wparam: windows::Win32::Foundation::WPARAM,
        lparam: windows::Win32::Foundation::LPARAM,
    ) -> Result<(), String> {
        live_deliver_message(target, message, wparam, lparam)
    }
}

#[cfg(target_os = "windows")]
fn live_deliver_message(
    target: windows::Win32::Foundation::HWND,
    message: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> Result<(), String> {
    #[cfg(test)]
    if let Some(result) = live_input_delivery_tests::intercept(message) {
        return result;
    }
    let mut message_result = 0usize;
    let delivered = unsafe {
        windows::Win32::UI::WindowsAndMessaging::SendMessageTimeoutW(
            target,
            message,
            wparam,
            lparam,
            windows::Win32::UI::WindowsAndMessaging::SMTO_ABORTIFHUNG
                | windows::Win32::UI::WindowsAndMessaging::SMTO_BLOCK,
            50,
            Some(&mut message_result),
        )
    };
    // The API return value is the completion flag; message_result may legitimately be zero.
    if delivered.0 == 0 {
        Err("input_delivery_timeout".to_string())
    } else {
        Ok(())
    }
}

#[cfg(all(test, target_os = "windows"))]
mod live_input_delivery_tests {
    include!("live_input_delivery_tests.rs");
}

fn validate_live_normalized_coordinate(value: Option<f64>, axis: &str) -> Result<f64, String> {
    value
        .filter(|value| value.is_finite() && (0.0..=1.0).contains(value))
        .ok_or_else(|| format!("normalized_{axis}_invalid"))
}

fn live_mouse_button(button: Option<&str>, down: bool, double: bool) -> Result<(u32, u8), String> {
    match (button, down, double) {
        (Some("left"), true, true) => Ok((0x0203, LIVE_MOUSE_LEFT)),
        (Some("left"), true, false) => Ok((0x0201, LIVE_MOUSE_LEFT)),
        (Some("left"), false, _) => Ok((0x0202, LIVE_MOUSE_LEFT)),
        (Some("right"), true, true) => Ok((0x0206, LIVE_MOUSE_RIGHT)),
        (Some("right"), true, false) => Ok((0x0204, LIVE_MOUSE_RIGHT)),
        (Some("right"), false, _) => Ok((0x0205, LIVE_MOUSE_RIGHT)),
        (Some("middle"), true, true) => Ok((0x0209, LIVE_MOUSE_MIDDLE)),
        (Some("middle"), true, false) => Ok((0x0207, LIVE_MOUSE_MIDDLE)),
        (Some("middle"), false, _) => Ok((0x0208, LIVE_MOUSE_MIDDLE)),
        _ => Err("mouse_button_invalid".to_string()),
    }
}

fn live_mouse_key_state(pressed: u8) -> usize {
    usize::from(pressed & LIVE_MOUSE_LEFT != 0)
        | (usize::from(pressed & LIVE_MOUSE_RIGHT != 0) << 1)
        | (usize::from(pressed & LIVE_MOUSE_MIDDLE != 0) << 4)
}

fn live_mouse_lparam(x: i32, y: i32) -> windows::Win32::Foundation::LPARAM {
    let packed = u32::from(x as i16 as u16) | (u32::from(y as i16 as u16) << 16);
    windows::Win32::Foundation::LPARAM(packed as isize)
}

#[cfg(test)]
mod live_source_input_tests {
    use super::*;

    #[test]
    fn validates_normalized_coordinates_buttons_and_safe_sequences() {
        assert_eq!(validate_live_normalized_coordinate(Some(0.5), "x"), Ok(0.5));
        assert!(validate_live_normalized_coordinate(Some(f64::NAN), "x").is_err());
        assert!(validate_live_normalized_coordinate(Some(1.1), "x").is_err());
        assert_eq!(
            live_mouse_button(Some("left"), true, false),
            Ok((0x0201, 1))
        );
        assert_eq!(live_mouse_button(Some("left"), true, true), Ok((0x0203, 1)));
        assert!(live_mouse_button(Some("other"), false, false).is_err());
        assert_eq!(LIVE_INPUT_MAX_SAFE_SEQUENCE, 9_007_199_254_740_991);
    }
}

#[cfg(all(test, target_os = "windows"))]
mod live_source_godot_input_tests {
    use super::*;
    include!("tests/live_source_godot_input_tests.rs");
}
