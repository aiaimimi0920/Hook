use super::post_recovery_move;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::*;

struct Fixture {
    root: HWND,
    child: HWND,
    unrelated: HWND,
}

unsafe extern "system" fn fixture_wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyWindow(self.unrelated);
            let _ = DestroyWindow(self.root);
            let _ = UnregisterClassW(w!("Chrome_RenderWidgetHostHWND"), None);
        }
    }
}

#[test]
fn recovery_notifies_only_embedded_renderer_with_client_coordinates() {
    // Hidden owned HWNDs exercise actual enumeration, coordinate conversion,
    // and asynchronous message delivery without moving the desktop cursor.
    let class = WNDCLASSW {
        lpfnWndProc: Some(fixture_wndproc),
        lpszClassName: w!("Chrome_RenderWidgetHostHWND"),
        ..Default::default()
    };
    assert_ne!(unsafe { RegisterClassW(&class) }, 0);
    let root = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("STATIC"),
            w!("cursor test root"),
            WS_POPUP,
            -200,
            100,
            400,
            300,
            None,
            None,
            None,
            None,
        )
    }
    .unwrap();
    let child = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("Chrome_RenderWidgetHostHWND"),
            w!("owned renderer"),
            WS_CHILD,
            20,
            30,
            200,
            200,
            Some(root),
            None,
            None,
            None,
        )
    }
    .unwrap();
    let unrelated = unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("Chrome_RenderWidgetHostHWND"),
            w!("unrelated renderer"),
            WS_POPUP,
            0,
            0,
            200,
            200,
            None,
            None,
            None,
            None,
        )
    }
    .unwrap();
    let fixture = Fixture {
        root,
        child,
        unrelated,
    };
    assert!(post_recovery_move(
        fixture.root,
        POINT { x: -170, y: 150 },
        WPARAM(0)
    ));
    let mut message = MSG::default();
    assert!(unsafe {
        PeekMessageW(
            &mut message,
            Some(fixture.child),
            WM_MOUSEMOVE,
            WM_MOUSEMOVE,
            PM_REMOVE,
        )
    }
    .as_bool());
    assert_eq!(message.wParam.0, 0);
    assert_eq!(message.lParam.0, (20 << 16) | 10);
    assert!(!unsafe {
        PeekMessageW(
            &mut message,
            Some(fixture.unrelated),
            WM_MOUSEMOVE,
            WM_MOUSEMOVE,
            PM_REMOVE,
        )
    }
    .as_bool());
    // A blur-triggered restore must preserve a held left button and Ctrl.
    assert!(post_recovery_move(
        fixture.root,
        POINT { x: -170, y: 150 },
        WPARAM(0x0009)
    ));
    assert!(unsafe {
        PeekMessageW(
            &mut message,
            Some(fixture.child),
            WM_MOUSEMOVE,
            WM_MOUSEMOVE,
            PM_REMOVE,
        )
    }
    .as_bool());
    assert_eq!(message.wParam.0, 0x0009);
    assert!(!post_recovery_move(
        HWND::default(),
        POINT::default(),
        WPARAM(0)
    ));
    assert!(!post_recovery_move(
        fixture.unrelated,
        POINT::default(),
        WPARAM(0)
    ));
    assert!(!post_recovery_move(
        fixture.root,
        POINT { x: i32::MAX, y: 0 },
        WPARAM(0)
    ));
}
