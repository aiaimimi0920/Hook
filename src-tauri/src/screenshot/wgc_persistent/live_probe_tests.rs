use super::{try_fast_capture, PERSISTENT_CAPTURER};
use crate::screenshot::capture_pixels::frame_to_rgb;
use crate::screenshot::display_selection::capture_display_geometry;
use crate::screenshot::wgc_session::{shared_d3d_device, windows_capture_settings};
use crate::screenshot::{hdr_display::hdr_display_info_for, CaptureWorkloadProfile};
use image::RgbImage;
use scap_direct3d::Capturer;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::time::{Duration, Instant};
use uiautomation::patterns::{
    UIInvokePattern, UIRangeValuePattern, UITogglePattern, UIValuePattern,
};
use uiautomation::types::{ControlType, Handle};
use uiautomation::{UIAutomation, UIElement};
use windows::core::factory;
use windows::Graphics::Capture::GraphicsCaptureItem;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Direct3D11::D3D11_BOX;
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    mouse_event, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetCursorPos, GetWindowRect, SetCursorPos, SetForegroundWindow, SetWindowPos,
    SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ControlProbe {
    automation_id: String,
    control_type: String,
    name: String,
    invoke: bool,
    range_value: bool,
    toggle: bool,
    value: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PhaseZeroProbe {
    schema_version: u32,
    fixture_kind: String,
    captures_requested: usize,
    captures_succeeded: usize,
    distinct_frame_digests: usize,
    frame_width: Option<u32>,
    frame_height: Option<u32>,
    sample_elapsed_ms: Vec<u128>,
    persistent_session_active: bool,
    hdr_enabled: Option<bool>,
    uia_controls: Vec<ControlProbe>,
    raw_click_succeeded: bool,
    logical_hide_strategy: String,
    logical_hide_captures: usize,
    logical_hide_distinct_frames: usize,
    logical_hide_supported: bool,
    logical_hide_error: Option<String>,
    errors: Vec<String>,
}

fn required_env(name: &str) -> Result<String, String> {
    std::env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("{name} is required"))
}

fn parse_values<T: std::str::FromStr>(name: &str, expected: usize) -> Result<Vec<T>, String> {
    let values = required_env(name)?
        .split(',')
        .map(|value| {
            value
                .trim()
                .parse::<T>()
                .map_err(|_| format!("{name} is invalid"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    (values.len() == expected)
        .then_some(values)
        .ok_or_else(|| format!("{name} requires {expected} comma-separated values"))
}

fn capture_target() -> Result<(scap_targets::DisplayId, D3D11_BOX), String> {
    let bounds = parse_values::<i32>("HOOK_LIVE_PROBE_BOUNDS", 4)?;
    let center = ((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2);
    for display in scap_targets::Display::list() {
        let Some(geometry) = capture_display_geometry(&display) else {
            continue;
        };
        let right = geometry.physical_origin_x + geometry.physical_width as i32;
        let bottom = geometry.physical_origin_y + geometry.physical_height as i32;
        if center.0 < geometry.physical_origin_x
            || center.0 >= right
            || center.1 < geometry.physical_origin_y
            || center.1 >= bottom
        {
            continue;
        }
        let crop = D3D11_BOX {
            left: (bounds[0] - geometry.physical_origin_x).max(0) as u32,
            top: (bounds[1] - geometry.physical_origin_y).max(0) as u32,
            right: (bounds[2] - geometry.physical_origin_x).min(geometry.physical_width as i32)
                as u32,
            bottom: (bounds[3] - geometry.physical_origin_y).min(geometry.physical_height as i32)
                as u32,
            front: 0,
            back: 1,
        };
        if crop.right > crop.left && crop.bottom > crop.top {
            return Ok((display.id(), crop));
        }
    }
    Err("fixture bounds do not intersect an available display".to_string())
}

fn digest(image: &RgbImage) -> String {
    format!("{:x}", Sha256::digest(image.as_raw()))
}

fn walk_controls(automation: &UIAutomation, root: &UIElement) -> Vec<UIElement> {
    let Ok(walker) = automation.get_control_view_walker() else {
        return vec![root.clone()];
    };
    let mut pending = vec![root.clone()];
    let mut controls = Vec::new();
    while let Some(element) = pending.pop() {
        if controls.len() >= 256 {
            break;
        }
        if let Some(children) = walker.get_children(&element) {
            pending.extend(children);
        }
        controls.push(element);
    }
    controls
}

fn control_report(element: &UIElement) -> ControlProbe {
    ControlProbe {
        automation_id: element.get_automation_id().unwrap_or_default(),
        control_type: element
            .get_control_type()
            .map(|value| format!("{value:?}"))
            .unwrap_or_else(|_| "Unknown".to_string()),
        name: element.get_name().unwrap_or_default(),
        invoke: element.get_pattern::<UIInvokePattern>().is_ok(),
        range_value: element.get_pattern::<UIRangeValuePattern>().is_ok(),
        toggle: element.get_pattern::<UITogglePattern>().is_ok(),
        value: element.get_pattern::<UIValuePattern>().is_ok(),
    }
}

fn fixture_uia_probe(hwnd: HWND) -> Result<(Vec<ControlProbe>, bool), String> {
    let automation = UIAutomation::new().map_err(|error| error.to_string())?;
    let root = automation
        .element_from_handle(Handle::from(hwnd.0 as isize))
        .map_err(|error| error.to_string())?;
    let controls = walk_controls(&automation, &root);
    let button = controls
        .iter()
        .find(|element| {
            element.get_control_type().ok() == Some(ControlType::Button)
                && (element.get_automation_id().ok().as_deref() == Some("actionButton")
                    || element.get_name().ok().as_deref() == Some("Apply action"))
        })
        .cloned()
        .ok_or_else(|| "fixture action button was not exposed through UIA".to_string())?;
    let is_status = |element: &&UIElement| {
        element.get_automation_id().ok().as_deref() == Some("statusLabel")
            || element
                .get_name()
                .ok()
                .is_some_and(|name| name.starts_with("Clicks: "))
    };
    let before = controls
        .iter()
        .find(is_status)
        .and_then(|element| element.get_name().ok())
        .unwrap_or_default();
    let rect = button
        .get_bounding_rectangle()
        .map_err(|error| error.to_string())?;
    let mut previous = POINT::default();
    let _ = unsafe { GetCursorPos(&mut previous) };
    let _ = unsafe { BringWindowToTop(hwnd) };
    let _ = unsafe { SetForegroundWindow(hwnd) };
    std::thread::sleep(Duration::from_millis(100));
    let _ = unsafe {
        SetCursorPos(
            (rect.get_left() + rect.get_right()) / 2,
            (rect.get_top() + rect.get_bottom()) / 2,
        )
    };
    unsafe {
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    }
    std::thread::sleep(Duration::from_millis(150));
    let _ = unsafe { SetCursorPos(previous.x, previous.y) };
    let refreshed = automation
        .element_from_handle(Handle::from(hwnd.0 as isize))
        .map_err(|error| error.to_string())?;
    let after = walk_controls(&automation, &refreshed)
        .into_iter()
        .find(|element| {
            element.get_automation_id().ok().as_deref() == Some("statusLabel")
                || element
                    .get_name()
                    .ok()
                    .is_some_and(|name| name.starts_with("Clicks: "))
        })
        .and_then(|element| element.get_name().ok())
        .unwrap_or_default();
    Ok((
        controls.iter().map(control_report).collect(),
        before != after,
    ))
}

fn logical_hide_probe(hwnd: HWND, interval_ms: u64) -> Result<(usize, usize), String> {
    let mut original = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut original) }.map_err(|error| error.to_string())?;
    let interop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
        .map_err(|error| error.to_string())?;
    let item: GraphicsCaptureItem =
        unsafe { interop.CreateForWindow(hwnd) }.map_err(|error| error.to_string())?;
    let latest: std::sync::Arc<std::sync::Mutex<Option<RgbImage>>> =
        std::sync::Arc::new(std::sync::Mutex::new(None));
    let frame_seq = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let callback_latest = latest.clone();
    let callback_seq = frame_seq.clone();
    let mut capturer = Capturer::new(
        item,
        windows_capture_settings(None),
        move |frame| {
            if let Ok(image) = frame_to_rgb(&frame) {
                if let Ok(mut slot) = callback_latest.lock() {
                    *slot = Some(image);
                    callback_seq.fetch_add(1, std::sync::atomic::Ordering::Release);
                }
            }
            Ok(())
        },
        || Ok(()),
        shared_d3d_device().ok().cloned(),
    )
    .map_err(|error| error.to_string())?;
    capturer.start().map_err(|error| error.to_string())?;
    let initial_deadline = Instant::now() + Duration::from_secs(2);
    while frame_seq.load(std::sync::atomic::Ordering::Acquire) == 0
        && Instant::now() < initial_deadline
    {
        std::thread::sleep(Duration::from_millis(10));
    }

    let moved_left = -32_000;
    let moved_top = -32_000;
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            moved_left,
            moved_top,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
    }
    .map_err(|error| error.to_string())?;
    std::thread::sleep(Duration::from_millis(200));
    let mut captures = 0;
    let mut digests = BTreeSet::new();
    let mut seen = frame_seq.load(std::sync::atomic::Ordering::Acquire);
    for _ in 0..4 {
        let deadline = Instant::now() + Duration::from_secs(2);
        while frame_seq.load(std::sync::atomic::Ordering::Acquire) == seen
            && Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        let current = frame_seq.load(std::sync::atomic::Ordering::Acquire);
        if current != seen {
            seen = current;
            if let Ok(slot) = latest.lock() {
                if let Some(image) = slot.as_ref() {
                    captures += 1;
                    digests.insert(digest(image));
                }
            }
        }
        std::thread::sleep(Duration::from_millis(interval_ms));
    }
    let _ = capturer.stop();
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            original.left,
            original.top,
            0,
            0,
            SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
    }
    .map_err(|error| format!("failed to restore fixture window: {error}"))?;
    Ok((captures, digests.len()))
}

#[test]
#[ignore = "requires the interactive Phase 0 WinForms fixture"]
fn phase_zero_fixture_reports_persistent_frames_uia_and_raw_input() {
    let samples = required_env("HOOK_LIVE_PROBE_SAMPLES")
        .and_then(|value| {
            value
                .parse::<usize>()
                .map_err(|_| "invalid sample count".to_string())
        })
        .unwrap_or(24)
        .clamp(2, 120);
    let interval_ms = required_env("HOOK_LIVE_PROBE_INTERVAL_MS")
        .and_then(|value| {
            value
                .parse::<u64>()
                .map_err(|_| "invalid interval".to_string())
        })
        .unwrap_or(100)
        .clamp(16, 2_000);
    std::env::set_var("HOOK_WGC_FAST_PATH_MODE", "persistent");
    let mut report = PhaseZeroProbe {
        schema_version: 1,
        fixture_kind: required_env("HOOK_LIVE_PROBE_FIXTURE_KIND")
            .unwrap_or_else(|_| "WinForms".to_string()),
        captures_requested: samples,
        captures_succeeded: 0,
        distinct_frame_digests: 0,
        frame_width: None,
        frame_height: None,
        sample_elapsed_ms: Vec::with_capacity(samples),
        persistent_session_active: false,
        hdr_enabled: None,
        uia_controls: Vec::new(),
        raw_click_succeeded: false,
        logical_hide_strategy: "visible-offscreen-window".to_string(),
        logical_hide_captures: 0,
        logical_hide_distinct_frames: 0,
        logical_hide_supported: false,
        logical_hide_error: None,
        errors: Vec::new(),
    };
    let mut digests = BTreeSet::new();
    match capture_target() {
        Ok((display_id, crop)) => {
            report.hdr_enabled = scap_targets::Display::list()
                .into_iter()
                .find(|display| display.id() == display_id)
                .and_then(|display| hdr_display_info_for(&display))
                .map(|info| info.enabled);
            for _ in 0..samples {
                let started = Instant::now();
                match try_fast_capture(
                    display_id.clone(),
                    Some(crop),
                    CaptureWorkloadProfile::StandardRegion,
                ) {
                    Some(image) => {
                        report.frame_width = Some(image.width());
                        report.frame_height = Some(image.height());
                        report.captures_succeeded += 1;
                        digests.insert(digest(&image));
                    }
                    None => report
                        .errors
                        .push("WGC returned no usable frame".to_string()),
                }
                report.sample_elapsed_ms.push(started.elapsed().as_millis());
                std::thread::sleep(Duration::from_millis(interval_ms));
            }
            report.persistent_session_active =
                PERSISTENT_CAPTURER.with(|cell| cell.borrow().is_some());
        }
        Err(error) => report.errors.push(error),
    }
    report.distinct_frame_digests = digests.len();
    match required_env("HOOK_LIVE_PROBE_HWND")
        .and_then(|value| {
            isize::from_str_radix(value.trim_start_matches("0x"), 16)
                .map_err(|_| "invalid HWND".to_string())
        })
        .and_then(|value| fixture_uia_probe(HWND(value as *mut std::ffi::c_void)))
    {
        Ok((controls, clicked)) => {
            report.uia_controls = controls;
            report.raw_click_succeeded = clicked;
        }
        Err(error) => report
            .errors
            .push(format!("UIA/input probe failed: {error}")),
    }
    match required_env("HOOK_LIVE_PROBE_HWND")
        .and_then(|value| {
            isize::from_str_radix(value.trim_start_matches("0x"), 16)
                .map_err(|_| "invalid HWND".to_string())
        })
        .and_then(|value| logical_hide_probe(HWND(value as *mut std::ffi::c_void), interval_ms))
    {
        Ok((captures, distinct)) => {
            report.logical_hide_captures = captures;
            report.logical_hide_distinct_frames = distinct;
            report.logical_hide_supported = captures == 4 && distinct >= 2;
        }
        Err(error) => report.logical_hide_error = Some(error),
    }
    if report.captures_succeeded != samples {
        report
            .errors
            .push("not every requested capture produced a frame".to_string());
    }
    if report.distinct_frame_digests < 2 {
        report
            .errors
            .push("fixture did not produce changing captured frames".to_string());
    }
    if !report.persistent_session_active {
        report
            .errors
            .push("capture fell back instead of retaining a persistent WGC session".to_string());
    }
    if !report.raw_click_succeeded {
        report
            .errors
            .push("same-integrity raw click did not update the fixture".to_string());
    }
    let output = required_env("HOOK_LIVE_PROBE_OUTPUT").expect("probe output path is required");
    std::fs::write(
        &output,
        serde_json::to_vec_pretty(&report).expect("serialize probe report"),
    )
    .expect("write probe report");
    assert!(report.errors.is_empty(), "{}", report.errors.join("; "));
}
