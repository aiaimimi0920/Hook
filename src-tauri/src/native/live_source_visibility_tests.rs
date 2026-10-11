// Owned hidden HWNDs test shell styles and shared restoration without taking user focus.
use super::*;
use windows::Win32::UI::WindowsAndMessaging::*;
static WATCHDOG_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[path = "live_browser_input_tests.rs"]
mod live_browser_input_tests;

fn pump_fixture_messages() {
    let mut message = MSG::default();
    unsafe {
        while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

struct Fixture(windows::Win32::Foundation::HWND);
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = unsafe { DestroyWindow(self.0) };
    }
}

#[test]
#[ignore = "briefly shows and activates an owned fixture on the interactive desktop"]
fn native_minimize_then_activation_restores_without_closing_capture() {
    let _lock = WATCHDOG_TEST_LOCK.lock().unwrap();
    let _watchdog = crate::emergency_watchdog::tests::start_interactive_test_watchdog();
    let fixture = Fixture(
        unsafe {
            CreateWindowExW(
                WS_EX_APPWINDOW,
                windows::core::w!("STATIC"),
                windows::core::w!("Hook minimize recovery test"),
                WS_OVERLAPPEDWINDOW,
                0,
                0,
                240,
                120,
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
    unsafe {
        let _ = ShowWindow(fixture.0, SW_SHOWNOACTIVATE);
        let _ = ShowWindow(fixture.0, SW_MINIMIZE);
    }
    assert!(unsafe { IsIconic(fixture.0) }.as_bool());
    source.capture_region = Some(LiveCapturePhysicalRegion {
        left: 20,
        top: 40,
        width: 100,
        height: 40,
    });
    let input: LiveCaptureInputRequest = serde_json::from_value(serde_json::json!({
        "kind": "mouse_move", "sequence": 1, "normalizedX": 0.5, "normalizedY": 0.5
    }))
    .unwrap();
    let transition_input = send_live_input_with_recovery(&mut source, &input);
    println!(
        "Input during native minimize: {transition_input:?}; enabled={}",
        source.interaction_enabled
    );
    assert!(
        source.interaction_enabled,
        "native minimize must not permanently disable input: {transition_input:?}"
    );
    assert!(source.intercept_native_minimize().unwrap());
    // The fixture owns this thread; a real source runs its own message pump.
    pump_fixture_messages();
    assert!(!unsafe { IsIconic(fixture.0) }.as_bool());
    assert_eq!(source.source_window_state(), "logically_hidden");
    let mut input = input.clone();
    input.sequence = 2;
    send_live_input_with_recovery(&mut source, &input)
        .expect("region input after minimized source recovers");
    // Focus-stealing prevention may reject a background test runner; exercise the
    // observed-activation branch without synthesizing global input on the user's desktop.
    let _ = unsafe { SetForegroundWindow(fixture.0) };
    assert!(source.sync_native_visibility(fixture.0).unwrap());
    assert_eq!(source.source_window_state(), "visible");
    input.sequence = 3;
    send_live_input_with_recovery(&mut source, &input)
        .expect("region input after source is reclaimed");
    assert!(source.interaction_enabled);
    assert!(unsafe { IsWindowVisible(fixture.0) }.as_bool());
    assert_eq!(
        unsafe { GetWindowLongPtrW(fixture.0, GWL_EXSTYLE) } & WS_EX_LAYERED.0 as isize,
        0
    );
    source.restore().unwrap();
}

#[test]
fn logical_minimize_preserves_shell_entry_and_activation_restores_shared_source() {
    let _lock = WATCHDOG_TEST_LOCK.lock().unwrap();
    let _watchdog = crate::emergency_watchdog::tests::start_interactive_test_watchdog();
    for style in [
        WS_EX_APPWINDOW,
        WINDOW_EX_STYLE(0),
        WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
    ] {
        let fixture = Fixture(
            unsafe {
                CreateWindowExW(
                    style,
                    windows::core::w!("STATIC"),
                    windows::core::w!("Hook owned visibility fixture"),
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
        let id = format!("{:x}", fixture.0 .0 as usize);
        let mut source = LiveSourceWindowLifecycle::new_with_region(&id, None).unwrap();
        let mut peer = LiveSourceWindowLifecycle::new_with_region(&id, None).unwrap();
        source.set_interaction_enabled(true).unwrap();
        peer.set_interaction_enabled(true).unwrap();
        let original = unsafe { GetWindowLongPtrW(fixture.0, GWL_EXSTYLE) };
        source.hide("native_minimize").unwrap();
        let hidden = unsafe { GetWindowLongPtrW(fixture.0, GWL_EXSTYLE) };
        let shell_mask = (WS_EX_APPWINDOW | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE).0 as isize;
        assert_eq!(hidden & shell_mask, original & shell_mask);
        assert_ne!(hidden & WS_EX_LAYERED.0 as isize, 0);
        assert_ne!(hidden & WS_EX_TRANSPARENT.0 as isize, 0);
        assert_eq!(peer.source_window_state(), "logically_hidden");
        assert!(!source
            .sync_native_visibility(windows::Win32::Foundation::HWND::default())
            .unwrap());
        assert!(peer.sync_native_visibility(fixture.0).unwrap());
        assert_eq!(source.source_window_state(), "visible");
        assert_eq!(peer.source_window_state(), "visible");
        assert!(source.interaction_enabled && peer.interaction_enabled);
        assert_eq!(
            unsafe { GetWindowLongPtrW(fixture.0, GWL_EXSTYLE) },
            original
        );
        assert_eq!(source.visibility.lock().unwrap().sessions, 2);
        source.restore().unwrap();
        assert_eq!(peer.visibility.lock().unwrap().sessions, 1);
        assert!(peer.interaction_enabled);
        peer.restore().unwrap();
    }
}
