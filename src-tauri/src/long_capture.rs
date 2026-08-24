use anyhow::{anyhow, Result};
use base64::Engine as _;
use image::{imageops, ImageReader, Limits, RgbImage};
use scap_targets::Display;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::io::Cursor;

use crate::screenshot;

#[cfg(target_os = "windows")]
use std::{thread, time::Duration};

#[cfg(target_os = "windows")]
use windows::core::BOOL;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT, WPARAM};
#[cfg(target_os = "windows")]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    keybd_event, mouse_event, KEYEVENTF_KEYUP, MOUSEEVENTF_WHEEL, VK_NEXT,
};
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetClassNameW, GetCursorPos, GetParent, GetWindowRect,
    GetWindowThreadProcessId, IsWindowVisible, SendMessageW, SetCursorPos, SetForegroundWindow,
    WindowFromPoint, GA_ROOT, SB_PAGEDOWN, WM_MOUSEWHEEL, WM_VSCROLL,
};

// Responsibility-named lexical owners preserve the private algorithm graph while
// keeping every source file independently below the Phase 79 line limit.
include!("long_capture/target_focus.rs");
include!("long_capture/resource_limits.rs");
include!("long_capture/analysis_foundation.rs");
include!("long_capture/fixed_chrome.rs");
include!("long_capture/pixel_scoring.rs");
include!("long_capture/directional_analysis.rs");
include!("long_capture/pair_api.rs");
include!("long_capture/aggregate_composition.rs");
include!("long_capture/motion_signatures.rs");
include!("long_capture/signature_matching.rs");
include!("long_capture/aggregate_adjacent.rs");
include!("long_capture/aggregate_search.rs");
include!("long_capture/aggregate_merge.rs");
include!("long_capture/batch_stitch.rs");
include!("long_capture/capture_loop.rs");

#[cfg(test)]
mod tests {
    include!("long_capture/tests/support.rs");
    include!("long_capture/tests/batch.rs");
    include!("long_capture/tests/incremental.rs");
    include!("long_capture/tests/bidirectional.rs");
    include!("long_capture/tests/analysis_a.rs");
    include!("long_capture/tests/analysis_b.rs");
    include!("long_capture/tests/resource_limits.rs");
}
