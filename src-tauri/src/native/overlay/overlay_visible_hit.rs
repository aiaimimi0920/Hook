// Visual ownership is independent of dialog class and of prior overlay claims.
// Live hit testing is restricted to button/wheel edges, never the mouse-move stream.
#[cfg(target_os = "windows")]
mod overlay_visible_hit {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{WindowFromPoint, WM_MOUSEHWHEEL};

    fn foreign_root(hwnd: HWND, own_pid: u32) -> Option<HWND> {
        if hwnd.0.is_null() {
            return None;
        }
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        let root = if root.0.is_null() { hwnd } else { root };
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(root, Some(&mut pid)) };
        (pid != 0 && pid != own_pid && unsafe { IsWindowVisible(root) }.as_bool()).then_some(root)
    }

    pub(super) fn foreground_above(main: HWND) -> Option<HWND> {
        let foreground = foreign_root(unsafe { GetForegroundWindow() }, std::process::id())?;
        window_is_above_overlay_in_z_order(foreground, main).then_some(foreground)
    }

    fn covers_point_above(candidate: HWND, main: HWND, point: POINT) -> bool {
        let mut rect = RECT::default();
        unsafe { GetWindowRect(candidate, &mut rect) }.is_ok()
            && point.x >= rect.left
            && point.x < rect.right
            && point.y >= rect.top
            && point.y < rect.bottom
            && window_is_above_overlay_in_z_order(candidate, main)
    }

    pub(super) fn blocks_edge(x: f64, y: f64) -> bool {
        let Some(&main) = OVERLAY_MAIN_HWND.get() else {
            return false;
        };
        let main = HWND(main as *mut core::ffi::c_void);
        let point = POINT {
            x: x as i32,
            y: y as i32,
        };
        blocks_point_for_host(main, point, std::process::id())
    }

    fn blocks_point_for_host(main: HWND, point: POINT, own_pid: u32) -> bool {
        let hit = foreign_root(unsafe { WindowFromPoint(point) }, own_pid);
        if hit.is_some_and(|hwnd| covers_point_above(hwnd, main, point)) {
            return true;
        }
        // The transparent shield can be the native hit target even though the
        // foreign foreground window is visibly above the actual sticker host.
        foreground_above(main).is_some_and(|hwnd| covers_point_above(hwnd, main, point))
    }

    pub(super) fn needs_visible_hit_check(message: u32) -> bool {
        matches!(
            message,
            WM_LBUTTONDOWN
                | WM_RBUTTONDOWN
                | WM_RBUTTONUP
                | WM_MBUTTONDOWN
                | WM_MBUTTONUP
                | WM_XBUTTONDOWN
                | WM_XBUTTONUP
                | WM_MOUSEWHEEL
                | WM_MOUSEHWHEEL
        )
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        include!("../tests/overlay_visible_hit_tests.rs");
    }
}
