use std::{ffi::OsString, mem, os::windows::ffi::OsStringExt, path::PathBuf, str::FromStr};
use tracing::error;
use windows::{
    Graphics::Capture::GraphicsCaptureItem,
    Win32::{
        Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT, TRUE, WPARAM},
        Graphics::{
            Dwm::{DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute},
            Gdi::{
                BI_RGB, BITMAP, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleBitmap,
                CreateCompatibleDC, CreateSolidBrush, DEVMODEW, DIB_RGB_COLORS,
                DISPLAY_DEVICE_STATE_FLAGS, DISPLAY_DEVICEW, DeleteDC, DeleteObject,
                ENUM_CURRENT_SETTINGS, EnumDisplayDevicesW, EnumDisplayMonitors,
                EnumDisplaySettingsW, FillRect, GetDC, GetDIBits, GetMonitorInfoW, GetObjectA,
                HBRUSH, HDC, HGDIOBJ, HMONITOR, MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTONULL,
                MONITORINFOEXW, MonitorFromPoint, MonitorFromWindow, ReleaseDC, SelectObject,
            },
        },
        Storage::FileSystem::{
            FILE_FLAGS_AND_ATTRIBUTES, GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW,
        },
        System::{
            Threading::{
                GetCurrentProcessId, OpenProcess, PROCESS_NAME_FORMAT,
                PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
            },
            WinRT::Graphics::Capture::IGraphicsCaptureItemInterop,
        },
        UI::{
            HiDpi::{
                GetDpiForMonitor, GetDpiForWindow, GetProcessDpiAwareness, MDT_EFFECTIVE_DPI,
                PROCESS_PER_MONITOR_DPI_AWARE,
            },
            Shell::{
                ExtractIconExW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGFI_SMALLICON,
                SHGetFileInfoW,
            },
            WindowsAndMessaging::{
                DI_FLAGS, DestroyIcon, DrawIconEx, EnumChildWindows, EnumWindows, GCLP_HICON,
                GW_HWNDNEXT, GWL_EXSTYLE, GWL_STYLE, GetClassLongPtrW, GetClassNameW,
                GetClientRect, GetCursorPos, GetDesktopWindow, GetIconInfo,
                GetLayeredWindowAttributes, GetWindow, GetWindowLongPtrW, GetWindowLongW,
                GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
                HICON, ICONINFO, IsIconic, IsWindowVisible, PrivateExtractIconsW, SendMessageW,
                WM_GETICON, WS_CHILD, WS_EX_LAYERED, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
                WS_EX_TRANSPARENT, WindowFromPoint,
            },
        },
    },
    core::{BOOL, PCWSTR, PWSTR},
};

use crate::bounds::{
    LogicalBounds, LogicalPosition, LogicalSize, PhysicalBounds, PhysicalPosition, PhysicalSize,
};

// All of this assumes PROCESS_PER_MONITOR_DPI_AWARE
//
// On Windows it's nigh impossible to get the logical position of a display
// or window, since there's no simple API that accounts for each monitor having different DPI.

static IGNORED_EXES: &[&str] = &[
    // As it's a system webview it isn't owned by the Cap process.
    "webview2",
    "msedgewebview2",
    // Just make sure, lol
    "cap",
];

// Responsibility-named owners keep the Win32 implementation auditable without widening visibility.
include!("win/display.rs");

fn get_cursor_position() -> Option<PhysicalPosition> {
    let mut point = POINT { x: 0, y: 0 };
    unsafe {
        if GetCursorPos(&mut point).is_ok() {
            Some(PhysicalPosition {
                x: point.x as f64,
                y: point.y as f64,
            })
        } else {
            None
        }
    }
}

#[derive(Clone, Copy)]
pub struct WindowImpl(HWND);

include!("win/window_listing.rs");
include!("win/window_metadata.rs");
include!("win/window_icons.rs");
include!("win/window_geometry.rs");
include!("win/window_selection.rs");
include!("win/ids.rs");
