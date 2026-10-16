// WinForms rejects mouse-up Click when WindowFromPoint sees an overlay/hidden source.
// Complete only an explicit, un-dragged, still-occluded push-button gesture through BN_CLICKED.
#[cfg(target_os = "windows")]
#[derive(Debug)]
struct LiveButtonGesture {
    target: isize,
    x: i32,
    y: i32,
    threshold_x: u32,
    threshold_y: u32,
    dragged: bool,
}

#[cfg(target_os = "windows")]
impl LiveButtonGesture {
    fn observe(&mut self, target: isize, x: i32, y: i32) {
        self.dragged |= self.target != target
            || self.x.abs_diff(x) > self.threshold_x
            || self.y.abs_diff(y) > self.threshold_y;
    }
}

#[cfg(target_os = "windows")]
impl LiveSourceWindowLifecycle {
    fn track_button_gesture(
        &mut self,
        target: windows::Win32::Foundation::HWND,
        request: &LiveCaptureInputRequest,
        point: windows::Win32::Foundation::POINT,
    ) -> bool {
        if request.kind == "mouse_button_down" {
            self.button_gesture = None;
            if request.button.as_deref() == Some("left")
                && self.pressed_mouse_buttons == 0
                && live_is_winforms_push_button(target)
                && live_button_point_occluded(target, point)
            {
                use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
                use windows::Win32::UI::WindowsAndMessaging::{SM_CXDRAG, SM_CYDRAG};
                let dpi = unsafe { GetDpiForWindow(target) }.max(96);
                self.button_gesture = Some(LiveButtonGesture {
                    target: target.0 as isize,
                    x: point.x,
                    y: point.y,
                    threshold_x: (unsafe { GetSystemMetricsForDpi(SM_CXDRAG, dpi) }.max(2) / 2)
                        as u32,
                    threshold_y: (unsafe { GetSystemMetricsForDpi(SM_CYDRAG, dpi) }.max(2) / 2)
                        as u32,
                    dragged: false,
                });
            }
        } else if let Some(gesture) = &mut self.button_gesture {
            gesture.observe(target.0 as isize, point.x, point.y);
            if request.kind == "mouse_button_up" {
                let gesture = self.button_gesture.take().expect("checked gesture");
                return request.button.as_deref() == Some("left")
                    && !gesture.dragged
                    && live_button_point_occluded(target, point);
            }
        }
        false
    }

    fn complete_occluded_button(
        &self,
        root: windows::Win32::Foundation::HWND,
        target: windows::Win32::Foundation::HWND,
        point: windows::Win32::Foundation::POINT,
    ) -> Result<(), String> {
        use windows::Win32::UI::WindowsAndMessaging::{GetDlgCtrlID, GetParent, WM_COMMAND};
        if !self.valid_input_target(root, target)
            || !live_is_winforms_push_button(target)
            || !live_button_point_occluded(target, point)
        {
            return Ok(());
        }
        let parent =
            unsafe { GetParent(target) }.map_err(|_| "source_button_parent_unavailable")?;
        if !self.valid_input_target(root, parent) {
            return Err("source_button_parent_invalid".into());
        }
        // BN_CLICKED is zero in HIWORD. Use the validated child's identifier and HWND,
        // not BM_CLICK, which would synthesize a second mouse-down/up pair.
        let id = unsafe { GetDlgCtrlID(target) } as u16;
        live_deliver_message_with_timeout(
            parent,
            WM_COMMAND,
            windows::Win32::Foundation::WPARAM(usize::from(id)),
            windows::Win32::Foundation::LPARAM(target.0 as isize),
            250,
        )
    }
}

#[cfg(target_os = "windows")]
fn live_is_winforms_push_button(target: windows::Win32::Foundation::HWND) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::IsWindowEnabled;
    use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetWindowLongPtrW, GWL_STYLE};
    if !unsafe { IsWindowEnabled(target) }.as_bool() {
        return false;
    }
    let mut name = [0u16; 256];
    let length = unsafe { GetClassNameW(target, &mut name) };
    let style = unsafe { GetWindowLongPtrW(target, GWL_STYLE) } & 0x0f;
    // Do not turn checkbox/radio/custom controls into push-button notifications.
    length > 0
        && String::from_utf16_lossy(&name[..length as usize])
            .to_ascii_uppercase()
            .starts_with("WINDOWSFORMS10.BUTTON.")
        && matches!(style, 0 | 1 | 11)
}

#[cfg(target_os = "windows")]
fn live_button_point_occluded(
    target: windows::Win32::Foundation::HWND,
    mut point: windows::Win32::Foundation::POINT,
) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, WindowFromPoint};
    let mut bounds = windows::Win32::Foundation::RECT::default();
    if unsafe { GetClientRect(target, &mut bounds) }.is_err()
        || point.x < 0
        || point.y < 0
        || point.x >= bounds.right
        || point.y >= bounds.bottom
        || !unsafe { windows::Win32::Graphics::Gdi::ClientToScreen(target, &mut point) }.as_bool()
    {
        return false;
    }
    (unsafe { WindowFromPoint(point) }) != target
}

#[cfg(all(test, target_os = "windows"))]
mod live_button_gesture_tests {
    use super::*;
    fn gesture() -> LiveButtonGesture {
        LiveButtonGesture {
            target: 1,
            x: 10,
            y: 20,
            threshold_x: 3,
            threshold_y: 3,
            dragged: false,
        }
    }
    #[test]
    fn leaving_and_returning_to_press_point_does_not_become_a_click() {
        let mut value = gesture();
        value.observe(1, 14, 20);
        value.observe(1, 10, 20);
        assert!(value.dragged);
    }
    #[test]
    fn pointer_jitter_stays_valid_but_changed_target_cancels() {
        let mut value = gesture();
        value.observe(1, 11, 22);
        assert!(!value.dragged);
        value.observe(2, 11, 22);
        assert!(value.dragged);
    }
}
