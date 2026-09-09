// A deterministic ambiguous-delivery fault, with only an owned hidden HWND.
use super::*;
thread_local! { static MESSAGES: std::cell::RefCell<Option<Vec<u32>>> = const { std::cell::RefCell::new(None) }; }

pub(super) fn intercept(message: u32) -> Option<Result<(), String>> {
    MESSAGES.with(|messages| {
        let mut messages = messages.borrow_mut();
        let messages = messages.as_mut()?;
        messages.push(message);
        Some(if matches!(message, 0x0201 | 0x0100) {
            Err("input_delivery_timeout".to_string())
        } else {
            Ok(())
        })
    })
}

struct Fixture(windows::Win32::Foundation::HWND);
impl Drop for Fixture {
    fn drop(&mut self) {
        MESSAGES.with(|messages| *messages.borrow_mut() = None);
        let _ = unsafe { windows::Win32::UI::WindowsAndMessaging::DestroyWindow(self.0) };
    }
}

#[test]
fn timed_out_mouse_and_key_down_are_still_released_during_disable() {
    use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, WS_EX_NOACTIVATE, WS_POPUP};
    let fixture = Fixture(
        unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE,
                windows::core::w!("STATIC"),
                windows::core::w!("Hook owned input fault fixture"),
                WS_POPUP,
                0,
                0,
                100,
                100,
                None,
                None,
                None,
                None,
            )
        }
        .unwrap(),
    );
    let mut source =
        LiveSourceWindowLifecycle::new_with_region(&format!("{:x}", fixture.0 .0 as usize), None)
            .unwrap();
    source.set_interaction_enabled(true).unwrap();
    MESSAGES.with(|messages| *messages.borrow_mut() = Some(Vec::new()));
    let request: LiveCaptureInputRequest = serde_json::from_value(serde_json::json!({
        "kind": "mouse_button_down", "sequence": 1, "button": "left", "normalizedX": 0.5, "normalizedY": 0.5
    })).unwrap();
    assert_eq!(
        source.send_input(&request).unwrap_err(),
        "input_delivery_timeout"
    );
    assert_eq!(source.pressed_mouse_buttons, LIVE_MOUSE_LEFT);
    source.set_interaction_enabled(false).unwrap();
    assert_eq!(source.pressed_mouse_buttons, 0);
    assert_eq!(
        MESSAGES.with(|messages| messages.borrow().clone().unwrap()),
        vec![0x0201, 0x0202]
    );

    source.set_interaction_enabled(true).unwrap();
    MESSAGES.with(|messages| *messages.borrow_mut() = Some(Vec::new()));
    let request: LiveCaptureInputRequest = serde_json::from_value(serde_json::json!({
        "kind": "key_down", "sequence": 2, "virtualKey": 65
    }))
    .unwrap();
    assert_eq!(
        source.send_input(&request).unwrap_err(),
        "input_delivery_timeout"
    );
    assert!(source.pressed_virtual_keys.contains_key(&65));
    source.set_interaction_enabled(false).unwrap();
    assert!(source.pressed_virtual_keys.is_empty());
    assert_eq!(
        MESSAGES.with(|messages| messages.borrow().clone().unwrap()),
        vec![0x0100, 0x0101]
    );
}
