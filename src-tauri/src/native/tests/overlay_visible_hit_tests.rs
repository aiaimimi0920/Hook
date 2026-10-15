// Private, offscreen HWNDs exercise actual Z-order without clicking or activating
// user windows. Candidate predicates deliberately do not depend on window class.
use windows::core::w;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassW, WNDCLASSW, WS_EX_NOACTIVATE,
    WS_POPUP,
};

struct Fixture(HWND);
unsafe extern "system" fn fixture_wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}
impl Fixture {
    fn new() -> Self {
        static CLASS: OnceLock<u16> = OnceLock::new();
        CLASS.get_or_init(|| unsafe {
            RegisterClassW(&WNDCLASSW {
                lpfnWndProc: Some(fixture_wndproc),
                lpszClassName: w!("OtterVisibleHitRegression"),
                ..Default::default()
            })
        });
        Self(
            unsafe {
                CreateWindowExW(
                    WS_EX_NOACTIVATE,
                    w!("OtterVisibleHitRegression"),
                    w!("Otter visible hit test"),
                    WS_POPUP,
                    -32000,
                    -32000,
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
    fn position_after(&self, anchor: HWND) {
        unsafe {
            SetWindowPos(
                self.0,
                Some(anchor),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
            )
        }
        .unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = unsafe { DestroyWindow(self.0) };
    }
}

#[test]
fn visible_hit_non_dialog_window_above_sticker_wins_but_underlying_app_does_not() {
    let overlay = Fixture::new();
    let popup = Fixture::new();
    overlay.position_after(HWND_TOPMOST);
    popup.position_after(HWND_TOPMOST);
    assert_eq!(
        overlay_window_class_name(popup.0).as_deref(),
        Some("OtterVisibleHitRegression")
    );
    let point = POINT {
        x: -31950,
        y: -31950,
    };
    assert!(covers_point_above(popup.0, overlay.0, point));
    assert_eq!(unsafe { WindowFromPoint(point) }, popup.0);
    // Simulate an external PID while using the production point query and Z-order predicate.
    assert!(blocks_point_for_host(overlay.0, point, 0));
    assert!(!blocks_point_for_host(overlay.0, point, std::process::id()));
    assert!(!covers_point_above(
        popup.0,
        overlay.0,
        POINT {
            x: -31800,
            y: -31950
        }
    ));
    // A click-through sticker can make WindowFromPoint return the underlying app:
    // physical hit alone is insufficient; actual relative Z-order is required.
    popup.position_after(overlay.0);
    assert!(!covers_point_above(popup.0, overlay.0, point));
    assert!(!blocks_point_for_host(overlay.0, point, 0));
}

#[test]
fn visible_hit_checks_complete_nonleft_clicks_but_preserves_owned_left_release() {
    for message in [
        WM_LBUTTONDOWN,
        WM_RBUTTONDOWN,
        WM_RBUTTONUP,
        WM_MBUTTONDOWN,
        WM_MBUTTONUP,
        WM_XBUTTONDOWN,
        WM_XBUTTONUP,
        WM_MOUSEWHEEL,
        WM_MOUSEHWHEEL,
    ] {
        assert!(needs_visible_hit_check(message));
    }
    for message in [WM_MOUSEMOVE, WM_LBUTTONUP] {
        assert!(!needs_visible_hit_check(message));
    }
}

// Read-only witness against an already-open shell dialog. Never creates security
// prompts, moves user windows, sends input, or changes firewall permissions.
#[test]
#[ignore = "requires explicit live overlay/dialog HWNDs and a physical point"]
fn visible_hit_live_shell_dialog_witness() {
    let number = |name: &str| -> isize { std::env::var(name).expect(name).parse().expect(name) };
    let main = HWND(number("OTTER_WITNESS_MAIN") as *mut core::ffi::c_void);
    let dialog = HWND(number("OTTER_WITNESS_DIALOG") as *mut core::ffi::c_void);
    let point = POINT {
        x: number("OTTER_WITNESS_X") as i32,
        y: number("OTTER_WITNESS_Y") as i32,
    };
    use windows::Win32::UI::HiDpi::{
        SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    struct DpiScope(windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT);
    impl Drop for DpiScope {
        fn drop(&mut self) {
            unsafe { SetThreadDpiAwarenessContext(self.0) };
        }
    }
    let _dpi = DpiScope(unsafe {
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
    });
    assert_eq!(
        overlay_window_class_name(main).as_deref(),
        Some("Tauri Window")
    );
    assert_eq!(
        overlay_window_class_name(dialog).as_deref(),
        Some("Shell_SystemDialog")
    );
    assert_eq!(
        unsafe { WindowFromPoint(point) },
        dialog,
        "live witness no longer at point"
    );
    assert!(
        window_is_above_overlay_in_z_order(dialog, main),
        "shell hit is visible but omitted from the overlay's upward chain"
    );
    let mut own_pid = 0;
    unsafe { GetWindowThreadProcessId(main, Some(&mut own_pid)) };
    assert_ne!(own_pid, 0);
    assert!(blocks_point_for_host(main, point, own_pid));
}
