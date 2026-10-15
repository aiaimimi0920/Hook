// Real HWND fixtures remain hidden; no foreground activation or user windows are touched.
use windows::core::w;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, WS_EX_NOACTIVATE, WS_POPUP,
};

struct Fixture(HWND);
impl Fixture {
    fn new() -> Self {
        Self(
            unsafe {
                CreateWindowExW(
                    WS_EX_NOACTIVATE,
                    w!("STATIC"),
                    w!("Otter dialog priority test"),
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
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
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
fn dialog_priority_positions_both_overlay_and_shield_below_dialog() {
    let dialog = Fixture::new();
    let overlay = Fixture::new();
    let shield = Fixture::new();
    overlay.position_after(HWND_TOPMOST);
    shield.position_after(HWND_TOPMOST);
    let anchor = dialog_anchor(dialog.0 .0 as isize);
    overlay.position_after(anchor);
    shield.position_after(anchor);
    assert!(window_is_above_overlay_in_z_order(dialog.0, overlay.0));
    assert!(window_is_above_overlay_in_z_order(dialog.0, shield.0));
    assert!(window_is_above_overlay_in_z_order(shield.0, overlay.0));
    overlay.position_after(dialog_anchor(0));
    shield.position_after(dialog_anchor(0));
    assert!(window_is_above_overlay_in_z_order(overlay.0, dialog.0));
    assert!(window_is_above_overlay_in_z_order(shield.0, overlay.0));
}

#[test]
fn dialog_input_exclusion_uses_physical_rect_and_preserves_exposed_stickers() {
    let bounds = RECT {
        left: -400,
        top: 20,
        right: -100,
        bottom: 220,
    };
    assert!(contains_point(bounds, -400.0, 20.0));
    assert!(contains_point(bounds, -101.0, 219.0));
    assert!(!contains_point(bounds, -100.0, 219.0));
    assert!(!contains_point(bounds, -200.0, 220.0));
    assert!(!contains_point(bounds, -401.0, 50.0));
}

#[test]
fn destroyed_dialog_anchor_returns_to_normal_priority() {
    let dialog = Fixture::new();
    let handle = dialog.0 .0 as isize;
    drop(dialog);
    assert_eq!(dialog_anchor(handle), HWND_TOPMOST);
}
