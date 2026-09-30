// Clears WebView's native hide-while-typing state on synthetic sticker hover.
use std::sync::{atomic::Ordering, Mutex};
use std::time::{Duration, Instant};
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_CONTROL, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON, VK_SHIFT, VK_XBUTTON1,
    VK_XBUTTON2,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetClassNameW, GetCursorInfo, PostMessageW, CURSORINFO, WM_MOUSEMOVE,
};

static LAST_RECOVERY: Mutex<Option<Instant>> = Mutex::new(None);

pub(super) fn restore_hidden_cursor(alt_pressed: bool) {
    restore_cursor(alt_pressed, false);
}

pub(super) fn restore_after_text_input() {
    restore_cursor(super::current_modifier_snapshot().alt_pressed, true);
}

fn restore_cursor(alt_pressed: bool, text_ended: bool) {
    if alt_pressed
        || super::OVERLAY_INPUT_SHIELD_ALT_PASSTHROUGH.load(Ordering::SeqCst)
        || super::CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst)
        || super::NATIVE_FILE_DRAG_ACTIVE.load(Ordering::SeqCst)
        || super::NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst)
        || super::OVERLAY_VISUALLY_OCCLUDED_BY_FULLSCREEN.load(Ordering::SeqCst)
        || (!text_ended
            && super::OVERLAY_POINTER_STATE.load(Ordering::SeqCst)
                != super::OVERLAY_POINTER_STATE_NONE)
        || !super::OVERLAY_MOUSE_HIT_MAP_ACTIVE.load(Ordering::SeqCst)
    {
        return;
    }
    let mut cursor = CURSORINFO {
        cbSize: std::mem::size_of::<CURSORINFO>() as u32,
        ..Default::default()
    };
    if unsafe { GetCursorInfo(&mut cursor) }.is_err()
        || (!text_ended && !cursor.hCursor.0.is_null())
    {
        return;
    }
    let point = cursor.ptScreenPos;
    let over_sticker = super::overlay_mouse_hit_map()
        .lock()
        .map(|rects| {
            rects.iter().any(|rect| {
                super::is_sticker_body_synthetic_rect(rect)
                    && rect.contains(point.x as f64, point.y as f64)
            }) && !rects.iter().any(|rect| {
                super::is_overlay_ui_synthetic_rect(rect)
                    && !(text_ended && rect.name == "TEXT_EDITOR")
                    && rect.contains(point.x as f64, point.y as f64)
            })
        })
        .unwrap_or(false);
    if !over_sticker {
        return;
    }
    let Some(&root) = super::OVERLAY_MAIN_HWND.get() else {
        return;
    };
    // Bound retries if the renderer is busy; never block the low-level hook or
    // synchronously wait on another process's window procedure.
    let Ok(mut last) = LAST_RECOVERY.lock() else {
        return;
    };
    if !text_ended && last.is_some_and(|instant| instant.elapsed() < Duration::from_millis(100)) {
        return;
    }
    *last = Some(Instant::now());
    drop(last);
    if post_recovery_move(HWND(root as *mut _), point, current_mouse_keys()) {
        super::append_runtime_log_line(if text_ended {
            "overlay_webview_text_end_cursor_restore_posted"
        } else {
            "overlay_webview_cursor_recovery_posted"
        });
    }
}

fn current_mouse_keys() -> WPARAM {
    // WM_MOUSEMOVE MK_* masks. Blur can end editing during a held click;
    // preserve that state rather than synthesizing a button release.
    let keys = [
        (VK_LBUTTON, 0x0001),
        (VK_RBUTTON, 0x0002),
        (VK_SHIFT, 0x0004),
        (VK_CONTROL, 0x0008),
        (VK_MBUTTON, 0x0010),
        (VK_XBUTTON1, 0x0020),
        (VK_XBUTTON2, 0x0040),
    ];
    WPARAM(keys.iter().fold(0, |flags, (key, mask)| {
        if unsafe { GetAsyncKeyState(key.0 as i32) } < 0 {
            flags | mask
        } else {
            flags
        }
    }))
}

fn post_recovery_move(root: HWND, mut point: POINT, keys: WPARAM) -> bool {
    if root.0.is_null() {
        return false;
    }
    let mut target: Option<HWND> = None;
    unsafe {
        let _ = EnumChildWindows(
            Some(root),
            Some(find_renderer),
            LPARAM(&mut target as *mut Option<HWND> as isize),
        );
    }
    let Some(target) = target else {
        return false;
    };
    if !unsafe { ScreenToClient(target, &mut point) }.as_bool() {
        return false;
    }
    let (Ok(x), Ok(y)) = (i16::try_from(point.x), i16::try_from(point.y)) else {
        return false;
    };
    let coordinates = LPARAM(((y as u16 as u32) << 16 | x as u16 as u32) as isize);
    // DOM-dispatched mouse events do not clear Chromium's native hidden cursor.
    // Notify only our embedded renderer, without clicks or focus changes.
    // SetCursor on Hook's own HWND cannot clear this WebView state.
    unsafe { PostMessageW(Some(target), WM_MOUSEMOVE, keys, coordinates) }.is_ok()
}

unsafe extern "system" fn find_renderer(hwnd: HWND, parameter: LPARAM) -> BOOL {
    let mut class_name = [0_u16; 64];
    let length = unsafe { GetClassNameW(hwnd, &mut class_name) }.max(0) as usize;
    if class_name[..length]
        .iter()
        .copied()
        .eq("Chrome_RenderWidgetHostHWND".encode_utf16())
    {
        unsafe { *(parameter.0 as *mut Option<HWND>) = Some(hwnd) };
        return BOOL(0);
    }
    BOOL(1)
}

#[cfg(test)]
#[path = "tests/overlay_webview_cursor_tests.rs"]
mod tests;
