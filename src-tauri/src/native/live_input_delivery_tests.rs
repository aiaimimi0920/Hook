// A deterministic ambiguous-delivery fault, with only an owned hidden HWND.
use super::*;
thread_local! { static MESSAGES: std::cell::RefCell<Option<Vec<u32>>> = const { std::cell::RefCell::new(None) }; }
thread_local! { static FAIL_DELIVERY: std::cell::Cell<bool> = const { std::cell::Cell::new(true) }; }

pub(super) fn intercept(message: u32) -> Option<Result<(), String>> {
    MESSAGES.with(|messages| {
        let mut messages = messages.borrow_mut();
        let messages = messages.as_mut()?;
        messages.push(message);
        Some(
            if FAIL_DELIVERY.get() && matches!(message, 0x0201 | 0x0100 | 0x0200) {
                Err("input_delivery_timeout".to_string())
            } else {
                Ok(())
            },
        )
    })
}

struct Fixture(windows::Win32::Foundation::HWND);
impl Drop for Fixture {
    fn drop(&mut self) {
        MESSAGES.with(|messages| *messages.borrow_mut() = None);
        FAIL_DELIVERY.set(true);
        let _ = unsafe { windows::Win32::UI::WindowsAndMessaging::DestroyWindow(self.0) };
    }
}

fn fixture() -> Fixture {
    use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, WS_EX_NOACTIVATE, WS_POPUP};
    Fixture(
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
    )
}

#[test]
fn timed_out_mouse_and_key_down_are_still_released_during_disable() {
    let fixture = fixture();
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

#[test]
fn transient_timeout_releases_edges_and_accepts_next_input_without_recreating_capture() {
    let fixture = fixture();
    let mut source =
        LiveSourceWindowLifecycle::new_with_region(&format!("{:x}", fixture.0 .0 as usize), None)
            .unwrap();
    source.set_interaction_enabled(true).unwrap();
    for (index, kind) in ["mouse_move", "mouse_button_down", "key_down"]
        .iter()
        .enumerate()
    {
        MESSAGES.with(|messages| *messages.borrow_mut() = Some(Vec::new()));
        FAIL_DELIVERY.set(true);
        let mut request: LiveCaptureInputRequest = serde_json::from_value(serde_json::json!({
            "kind": kind, "sequence": index * 2 + 1, "button": "left",
            "normalizedX": 0.5, "normalizedY": 0.5, "virtualKey": 65
        }))
        .unwrap();
        assert_eq!(
            send_live_input_with_recovery(&mut source, &request).unwrap_err(),
            "input_delivery_timeout"
        );
        assert!(source.interaction_enabled);
        assert_eq!(source.pressed_mouse_buttons, 0);
        assert!(source.pressed_virtual_keys.is_empty());
        assert_eq!(source.last_input_sequence, request.sequence);
        let expected = match *kind {
            "mouse_move" => vec![0x0200],
            "mouse_button_down" => vec![0x0201, 0x0202],
            _ => vec![0x0100, 0x0101],
        };
        assert_eq!(
            MESSAGES.with(|messages| messages.borrow().clone().unwrap()),
            expected
        );
        FAIL_DELIVERY.set(false);
        request.sequence += 1;
        request.kind = "mouse_move".to_string();
        send_live_input_with_recovery(&mut source, &request).unwrap();
    }
    let duplicate: LiveCaptureInputRequest = serde_json::from_value(serde_json::json!({
        "kind": "mouse_move", "sequence": 6, "normalizedX": 0.5, "normalizedY": 0.5
    }))
    .unwrap();
    assert_eq!(
        send_live_input_with_recovery(&mut source, &duplicate).unwrap_err(),
        "input_sequence_rejected"
    );
    assert!(!source.interaction_enabled);
}
