// Exercise the shipping cursor handler through real STATIC-window dispatch.
// Fixtures stay hidden and never touch the application's singleton HWND/state.
use super::overlay_input_shield_cursor_message;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::*;

struct ShieldFixture {
    hwnd: HWND,
    previous: isize,
    cursor: HCURSOR,
}

impl ShieldFixture {
    fn new() -> Self {
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE,
                w!("STATIC"),
                w!("Hook cursor regression fixture"),
                WS_POPUP,
                0,
                0,
                400,
                200,
                None,
                None,
                None,
                None,
            )
        }
        .unwrap();
        let previous = unsafe { GetWindowLongPtrW(hwnd, GWLP_WNDPROC) };
        Self {
            hwnd,
            previous,
            cursor: unsafe { GetCursor() },
        }
    }

    fn install(&self) {
        unsafe {
            SetWindowLongPtrW(
                self.hwnd,
                GWLP_WNDPROC,
                fixture_wndproc as *const () as usize as isize,
            );
        }
    }

    fn hit(&self, x: u16) -> LRESULT {
        unsafe {
            SendMessageW(
                self.hwnd,
                WM_NCHITTEST,
                None,
                Some(LPARAM(((50_isize) << 16) | x as isize)),
            )
        }
    }
}

impl Drop for ShieldFixture {
    fn drop(&mut self) {
        unsafe {
            SetWindowLongPtrW(self.hwnd, GWLP_WNDPROC, self.previous);
            let _ = DestroyWindow(self.hwnd);
            SetCursor(Some(self.cursor));
        }
    }
}

unsafe extern "system" fn fixture_wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    let passthrough =
        unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } & WS_EX_TRANSPARENT.0 as isize != 0;
    if let Some(result) = overlay_input_shield_cursor_message(message, passthrough) {
        return result;
    }
    // Preserve the same STATIC fallback as the real subclass without setting
    // OVERLAY_INPUT_SHIELD_WNDPROC_PREVIOUS, which is process-wide OnceLock state.
    let original = unsafe { GetClassLongPtrW(hwnd, GCLP_WNDPROC) };
    unsafe { CallWindowProcW(std::mem::transmute(original), hwnd, message, wparam, lparam) }
}

#[test]
fn static_shield_reclaims_null_cursor_across_sticker_positions() {
    let fixture = ShieldFixture::new();
    assert_eq!(fixture.hit(50).0, HTTRANSPARENT as isize);
    fixture.install();
    let arrow = unsafe { LoadCursorW(None, IDC_ARROW) }.unwrap();

    for sticker_x in [50, 250, 50] {
        unsafe { SetCursor(None) };
        // Windows only asks the hit-test owner for a cursor. A STATIC fallback
        // returns HTTRANSPARENT and bypasses that restoration after text input.
        assert_eq!(fixture.hit(sticker_x).0, HTCLIENT as isize);
        let handled = unsafe {
            SendMessageW(
                fixture.hwnd,
                WM_SETCURSOR,
                Some(WPARAM(fixture.hwnd.0 as usize)),
                Some(LPARAM(((WM_MOUSEMOVE as isize) << 16) | HTCLIENT as isize)),
            )
        };
        assert_eq!(handled.0, 1);
        assert_eq!(unsafe { GetCursor() }, arrow);
    }
}

#[test]
fn alt_passthrough_does_not_claim_hit_testing_or_replace_foreign_cursor() {
    let fixture = ShieldFixture::new();
    fixture.install();
    let crosshair = unsafe { LoadCursorW(None, IDC_CROSS) }.unwrap();
    unsafe {
        let style = GetWindowLongPtrW(fixture.hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(
            fixture.hwnd,
            GWL_EXSTYLE,
            style | WS_EX_TRANSPARENT.0 as isize,
        );
        SetCursor(Some(crosshair));
    }
    assert_eq!(fixture.hit(50).0, HTTRANSPARENT as isize);
    assert!(overlay_input_shield_cursor_message(WM_SETCURSOR, true).is_none());
    assert_eq!(unsafe { GetCursor() }, crosshair);
    assert_ne!(
        unsafe { GetWindowLongPtrW(fixture.hwnd, GWL_EXSTYLE) } & WS_EX_NOACTIVATE.0 as isize,
        0
    );
}
