use crate::capture_coords::CaptureWindowMetrics;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaptureWindowTarget {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub title: Option<String>,
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{CaptureWindowMetrics, CaptureWindowTarget};
    use std::ffi::c_void;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    };
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowLongPtrW, GetWindowRect, GetWindowTextLengthW,
        GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    struct EnumContext {
        current_process_id: u32,
        metrics: CaptureWindowMetrics,
        targets: Vec<CaptureWindowTarget>,
    }

    fn window_class_name(hwnd: HWND) -> Option<String> {
        let mut buffer = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
        (len > 0).then(|| String::from_utf16_lossy(&buffer[..len as usize]))
    }

    fn window_title(hwnd: HWND) -> Option<String> {
        let length = unsafe { GetWindowTextLengthW(hwnd) };
        if length <= 0 {
            return None;
        }
        let mut buffer = vec![0u16; length as usize + 1];
        let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
        if copied <= 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..copied as usize]))
    }

    fn is_ignored_shell_class(class_name: &str) -> bool {
        matches!(
            class_name,
            "Progman"
                | "WorkerW"
                | "SHELLDLL_DefView"
                | "SysListView32"
                | "Shell_TrayWnd"
                | "Shell_SecondaryTrayWnd"
                | "DV2ControlHost"
                | "Tooltip"
                | "ToolTips_Class32"
        )
    }

    fn is_window_cloaked(hwnd: HWND) -> bool {
        let mut cloaked = 0u32;
        let result = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                (&raw mut cloaked).cast::<c_void>(),
                std::mem::size_of::<u32>() as u32,
            )
        };
        result.is_ok() && cloaked != 0
    }

    fn extended_window_rect(hwnd: HWND) -> Option<RECT> {
        let mut rect = RECT::default();
        let dwm_result = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                (&raw mut rect).cast::<c_void>(),
                std::mem::size_of::<RECT>() as u32,
            )
        };
        if dwm_result.is_err() && unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
            return None;
        }
        Some(rect)
    }

    fn normalize_window_rect(
        rect: RECT,
        metrics: CaptureWindowMetrics,
    ) -> Option<(f64, f64, f64, f64)> {
        let scale = if metrics.scale_factor.is_finite() && metrics.scale_factor > 0.0 {
            metrics.scale_factor
        } else {
            1.0
        };
        let capture_right = metrics.physical_origin_x + metrics.logical_width * scale;
        let capture_bottom = metrics.physical_origin_y + metrics.logical_height * scale;
        let left = (rect.left as f64).max(metrics.physical_origin_x);
        let top = (rect.top as f64).max(metrics.physical_origin_y);
        let right = (rect.right as f64).min(capture_right);
        let bottom = (rect.bottom as f64).min(capture_bottom);
        if right - left < 2.0 || bottom - top < 2.0 {
            return None;
        }

        Some((
            (left - metrics.physical_origin_x) / scale,
            (top - metrics.physical_origin_y) / scale,
            (right - left) / scale,
            (bottom - top) / scale,
        ))
    }

    fn is_window_candidate(hwnd: HWND, current_process_id: u32) -> bool {
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { IsIconic(hwnd) }.as_bool() {
            return false;
        }

        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
        if process_id == 0 || process_id == current_process_id {
            return false;
        }
        if is_window_cloaked(hwnd) {
            return false;
        }

        if let Some(class_name) = window_class_name(hwnd) {
            if is_ignored_shell_class(&class_name) {
                return false;
            }
        }

        let ex_style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
        let tool_no_activate =
            ex_style & WS_EX_TOOLWINDOW.0 != 0 && ex_style & WS_EX_NOACTIVATE.0 != 0;
        !tool_no_activate
    }

    unsafe extern "system" fn enum_capture_windows(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let context = unsafe { &mut *(lparam.0 as *mut EnumContext) };
        if !is_window_candidate(hwnd, context.current_process_id) {
            return BOOL(1);
        }
        let Some(rect) = extended_window_rect(hwnd) else {
            return BOOL(1);
        };
        let Some((x, y, w, h)) = normalize_window_rect(rect, context.metrics) else {
            return BOOL(1);
        };

        context.targets.push(CaptureWindowTarget {
            id: format!("{:x}", hwnd.0 as usize),
            x,
            y,
            w,
            h,
            title: window_title(hwnd),
        });
        BOOL(1)
    }

    pub(super) fn list_capture_window_targets(
        metrics: CaptureWindowMetrics,
    ) -> Vec<CaptureWindowTarget> {
        let mut context = EnumContext {
            current_process_id: unsafe { GetCurrentProcessId() },
            metrics,
            targets: Vec::new(),
        };
        let _ = unsafe {
            EnumWindows(
                Some(enum_capture_windows),
                LPARAM((&raw mut context).cast::<c_void>() as isize),
            )
        };
        context.targets
    }

    #[cfg(test)]
    mod tests {
        use super::{is_ignored_shell_class, normalize_window_rect};
        use crate::capture_coords::CaptureWindowMetrics;
        use windows::Win32::Foundation::RECT;

        #[test]
        fn excludes_desktop_and_taskbar_window_classes() {
            assert!(is_ignored_shell_class("Progman"));
            assert!(is_ignored_shell_class("WorkerW"));
            assert!(is_ignored_shell_class("Shell_TrayWnd"));
            assert!(!is_ignored_shell_class("Chrome_WidgetWin_1"));
        }

        #[test]
        fn clips_and_normalizes_window_bounds_to_the_capture_monitor() {
            let metrics = CaptureWindowMetrics {
                physical_origin_x: 1920.0,
                physical_origin_y: 0.0,
                scale_factor: 1.25,
                logical_width: 1536.0,
                logical_height: 864.0,
            };
            assert_eq!(
                normalize_window_rect(
                    RECT {
                        left: 1800,
                        top: 125,
                        right: 2420,
                        bottom: 625,
                    },
                    metrics,
                ),
                Some((0.0, 100.0, 400.0, 400.0)),
            );
            assert_eq!(
                normalize_window_rect(
                    RECT {
                        left: 0,
                        top: 0,
                        right: 100,
                        bottom: 100,
                    },
                    metrics,
                ),
                None,
            );
        }

        #[test]
        fn normalizes_windows_on_a_negative_origin_mixed_dpi_monitor() {
            let metrics = CaptureWindowMetrics {
                physical_origin_x: -1920.0,
                physical_origin_y: -200.0,
                scale_factor: 1.5,
                logical_width: 1280.0,
                logical_height: 720.0,
            };

            assert_eq!(
                normalize_window_rect(
                    RECT {
                        left: -2000,
                        top: -260,
                        right: -1320,
                        bottom: 400,
                    },
                    metrics,
                ),
                Some((0.0, 0.0, 400.0, 400.0)),
            );
        }

        #[test]
        fn clips_cross_monitor_windows_using_the_target_monitor_scale() {
            let metrics = CaptureWindowMetrics {
                physical_origin_x: 1920.0,
                physical_origin_y: 0.0,
                scale_factor: 1.25,
                logical_width: 1536.0,
                logical_height: 864.0,
            };

            assert_eq!(
                normalize_window_rect(
                    RECT {
                        left: 3000,
                        top: 100,
                        right: 4000,
                        bottom: 1200,
                    },
                    metrics,
                ),
                Some((864.0, 80.0, 672.0, 784.0)),
            );
            assert_eq!(
                normalize_window_rect(
                    RECT {
                        left: 1919,
                        top: 10,
                        right: 1921,
                        bottom: 500,
                    },
                    metrics,
                ),
                None,
            );
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn list_capture_window_targets(
    metrics: CaptureWindowMetrics,
) -> Vec<CaptureWindowTarget> {
    platform::list_capture_window_targets(metrics)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn list_capture_window_targets(
    _metrics: CaptureWindowMetrics,
) -> Vec<CaptureWindowTarget> {
    Vec::new()
}
