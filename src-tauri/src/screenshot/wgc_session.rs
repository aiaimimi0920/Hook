use crate::capture_coords::CaptureWindowMetrics;
use anyhow::anyhow;
use image::RgbImage;
use scap_direct3d::{Capturer, PixelFormat, Settings};
use std::sync::OnceLock;
use windows::Graphics::Capture::GraphicsCaptureItem;
use windows::Win32::Foundation::{HMODULE, HWND, RECT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, D3D11_BOX, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::Dwm::{
    DwmFlush, DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
};
use windows::Win32::Graphics::Gdi::{
    RedrawWindow, UpdateWindow, RDW_ALLCHILDREN, RDW_ERASENOW, RDW_INVALIDATE, RDW_UPDATENOW,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetWindowRect, IsIconic, IsWindowVisible, SetForegroundWindow,
    ShowWindowAsync, SHOW_WINDOW_CMD,
};

use super::capture_pixels::frame_to_rgb;
use super::wgc_frame_policy::{crop_rgb, wgc_frame_wait_timeout};
use super::{capture_area_verbose_logging_enabled, CaptureWorkloadProfile};

pub(super) fn shared_d3d_device() -> anyhow::Result<&'static ID3D11Device> {
    static DEVICE: OnceLock<Option<ID3D11Device>> = OnceLock::new();

    let device = DEVICE.get_or_init(|| {
        let mut device = None;
        let result = unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                None,
            )
        };
        if result.is_err() {
            return None;
        }
        device
    });

    device
        .as_ref()
        .ok_or_else(|| anyhow!("D3D11 device unavailable"))
}

// Disable WGC after repeated failures so session churn cannot exhaust system resources.
static WGC_DISABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static WGC_CONSECUTIVE_FAILURES: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0);
const WGC_MAX_CONSECUTIVE_FAILURES: u32 = 3;

pub(super) fn wgc_note_success() {
    WGC_CONSECUTIVE_FAILURES.store(0, std::sync::atomic::Ordering::Relaxed);
}

pub(super) fn wgc_note_failure() {
    let prior = WGC_CONSECUTIVE_FAILURES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if prior + 1 >= WGC_MAX_CONSECUTIVE_FAILURES {
        WGC_DISABLED.store(true, std::sync::atomic::Ordering::Relaxed);
        crate::append_runtime_log_line(
            "capture_area wgc_disabled :: reason=too_many_consecutive_failures",
        );
    }
}

pub(super) fn windows_fast_path_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();

    if WGC_DISABLED.load(std::sync::atomic::Ordering::Relaxed) {
        return false;
    }

    *AVAILABLE.get_or_init(|| match scap_direct3d::is_supported() {
        Ok(true) => shared_d3d_device().is_ok(),
        _ => false,
    })
}

pub(super) fn windows_capture_settings_for(
    rect: Option<D3D11_BOX>,
    pixel_format: PixelFormat,
) -> Settings {
    let mut settings = Settings {
        is_cursor_capture_enabled: Some(false),
        pixel_format,
        ..Default::default()
    };
    if let Ok(true) = Settings::can_is_border_required() {
        settings.is_border_required = Some(false);
    }
    settings.crop = rect;
    settings
}

pub(super) fn windows_capture_settings(rect: Option<D3D11_BOX>) -> Settings {
    windows_capture_settings_for(rect, PixelFormat::B8G8R8A8Unorm)
}

pub(super) fn window_surface_crop(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: CaptureWindowMetrics,
    bounds: RECT,
    surface_width: u32,
    surface_height: u32,
) -> Option<D3D11_BOX> {
    let scale = display_metrics
        .scale_factor
        .is_finite()
        .then_some(display_metrics.scale_factor)
        .filter(|scale| *scale > 0.0)
        .unwrap_or(1.0);
    let selection_left = display_metrics.physical_origin_x + x as f64 * scale;
    let selection_top = display_metrics.physical_origin_y + y as f64 * scale;
    let selection_right = selection_left + w as f64 * scale;
    let selection_bottom = selection_top + h as f64 * scale;
    // Match display_selection's physical capture contract: the selection
    // origin is floored and its far edge is ceiled. Using round() here shifts
    // protected surfaces by a pixel at fractional DPI scales.
    let crop_left = (selection_left - bounds.left as f64)
        .floor()
        .clamp(0.0, surface_width as f64) as u32;
    let crop_top = (selection_top - bounds.top as f64)
        .floor()
        .clamp(0.0, surface_height as f64) as u32;
    let crop_right = (selection_right - bounds.left as f64)
        .ceil()
        .clamp(0.0, surface_width as f64) as u32;
    let crop_bottom = (selection_bottom - bounds.top as f64)
        .ceil()
        .clamp(0.0, surface_height as f64) as u32;
    (crop_right > crop_left && crop_bottom > crop_top).then_some(D3D11_BOX {
        left: crop_left,
        top: crop_top,
        right: crop_right,
        bottom: crop_bottom,
        front: 0,
        back: 1,
    })
}

/// Captures a window surface directly from its HWND-backed GraphicsCaptureItem.
///
/// Region capture normally samples a crop from the desktop display. That is
/// not sufficient for some hardware-accelerated windows (notably Telegram),
/// whose surface can be omitted from the compositor frame while the window is
/// still visible to the user. A window item asks WGC for that app surface and
/// therefore avoids sampling the application behind it.
pub(super) fn try_fast_capture_window(
    capture_window_id: &str,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: CaptureWindowMetrics,
) -> Option<RgbImage> {
    use std::sync::mpsc::sync_channel;

    let diag = capture_area_verbose_logging_enabled();
    let fail = |reason: &str| {
        // Keep the failure reason in the normal runtime log.  A window capture
        // can otherwise silently fall back to a desktop crop, which is
        // especially misleading for GPU-composited apps such as Telegram.
        crate::append_runtime_log_line(&format!("capture_window fast_fail :: reason={reason}"));
        if diag {
            eprintln!("capture_window fast_fail :: reason={reason}");
        }
        None
    };
    if !scap_direct3d::is_supported().unwrap_or(false) {
        return fail("fast_path_unavailable");
    }

    // capture_windows.rs intentionally exposes the native HWND as hexadecimal.
    // Do not route this value through scap's filtered Window::list(): some
    // valid GPU windows (including Telegram) are rejected by scap's generic
    // ownership/path policy even though CreateForWindow can capture them.
    let Some(raw_handle) = u64::from_str_radix(capture_window_id.trim_start_matches("0x"), 16).ok()
    else {
        return fail("invalid_window_id");
    };
    if raw_handle == 0 {
        return fail("zero_window_id");
    }
    let hwnd = HWND(raw_handle as *mut std::ffi::c_void);
    if unsafe { IsIconic(hwnd) }.as_bool() {
        // Telegram may minimize its Qt top-level surface when Hook's overlay
        // takes focus. Restore it before creating the capture item; otherwise
        // WGC can accept the HWND but never emit a frame.
        let _ = unsafe { ShowWindowAsync(hwnd, SHOW_WINDOW_CMD(9)) };
    }
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { IsIconic(hwnd) }.as_bool() {
        return fail("window_not_visible");
    }
    // A number of GPU clients (including Telegram) suspend their compositor
    // when they are occluded and inactive. Make the target foreground for the
    // short WGC session so the first frame is produced reliably.
    let _ = unsafe { BringWindowToTop(hwnd) };
    let _ = unsafe { SetForegroundWindow(hwnd) };
    // Request a synchronous repaint as well. Telegram may have a stable
    // visible window but no pending compositor update after Hook's overlay
    // released focus; WGC otherwise waits forever for its first frame.
    let _ = unsafe {
        RedrawWindow(
            Some(hwnd),
            None,
            None,
            RDW_INVALIDATE | RDW_UPDATENOW | RDW_ERASENOW | RDW_ALLCHILDREN,
        )
    };
    let _ = unsafe { UpdateWindow(hwnd) };
    // Foreground activation and DWM composition are asynchronous. Wait for
    // the compositor boundary before starting GraphicsCaptureItem; otherwise
    // Telegram can leave the first-frame channel empty and report a timeout.
    let _ = unsafe { DwmFlush() };
    std::thread::sleep(std::time::Duration::from_millis(350));
    let mut cloaked = 0u32;
    let _ = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_CLOAKED,
            (&raw mut cloaked).cast(),
            std::mem::size_of::<u32>() as u32,
        )
    };
    if cloaked != 0 {
        return fail("window_cloaked");
    }
    let mut bounds = RECT::default();
    let dwm_bounds_result = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&raw mut bounds).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    };
    if dwm_bounds_result.is_err() {
        if unsafe { GetWindowRect(hwnd, &mut bounds) }.is_err() {
            return fail("window_bounds_unavailable");
        }
    }
    let Some(interop) =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().ok()
    else {
        return fail("capture_item_factory_unavailable");
    };
    let item: GraphicsCaptureItem = match unsafe { interop.CreateForWindow(hwnd) } {
        Ok(item) => item,
        Err(error) => return fail(&format!("create_for_window_{error:?}")),
    };
    let item_size = match item.Size() {
        Ok(size) => size,
        Err(error) => return fail(&format!("item_size_{error:?}")),
    };
    let Some(item_width) = u32::try_from(item_size.Width).ok() else {
        return fail("item_width_invalid");
    };
    let Some(item_height) = u32::try_from(item_size.Height).ok() else {
        return fail("item_height_invalid");
    };
    let Some(crop) =
        window_surface_crop(x, y, w, h, display_metrics, bounds, item_width, item_height)
    else {
        return fail("empty_window_crop");
    };
    let Some(device) = shared_d3d_device().ok().cloned() else {
        return fail("d3d_device_unavailable");
    };
    // WGC's ContentSize can be smaller than the DWM extended frame bounds
    // (Telegram commonly has a non-client frame/title inset).  Passing the
    // screen-derived crop to the GPU capturer then causes scap-direct3d to
    // discard every frame whose content size is smaller than that crop,
    // resulting in a misleading timeout. Capture the complete window surface
    // first and clamp the crop against the actual returned frame on the CPU.
    let settings = windows_capture_settings(None);
    let (tx, rx) = sync_channel(1);
    let mut capturer = match Capturer::new(
        item,
        settings,
        move |frame| {
            let _ = tx.try_send(frame_to_rgb(&frame));
            Ok(())
        },
        || Ok(()),
        Some(device),
    ) {
        Ok(capturer) => capturer,
        Err(error) => return fail(&format!("capturer_new_{error:?}")),
    };

    if let Err(error) = capturer.start() {
        return fail(&format!("capturer_start_{error:?}"));
    }
    let result = rx.recv_timeout(wgc_frame_wait_timeout(false));
    let _ = capturer.stop();
    let image = match result {
        Ok(Ok(image)) => image,
        Ok(Err(error)) => return fail(&format!("frame_to_rgb_{error:?}")),
        Err(error) => return fail(&format!("frame_timeout_{error:?}")),
    };
    let image = crop_rgb(&image, &crop);
    if image.width() == 0 || image.height() == 0 {
        return fail("empty_frame");
    }
    crate::append_runtime_log_line(&format!(
        "capture_window wgc_success :: target={} width={} height={}",
        capture_window_id,
        image.width(),
        image.height()
    ));
    if diag {
        eprintln!(
            "capture_window wgc_success :: target={} width={} height={}",
            capture_window_id,
            image.width(),
            image.height()
        );
    }
    Some(image)
}

pub(super) fn wgc_fast_path_mode() -> String {
    std::env::var("HOOK_WGC_FAST_PATH_MODE")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| matches!(value.as_str(), "auto" | "persistent" | "transient"))
        .unwrap_or_else(|| "auto".to_string())
}

pub(super) fn should_use_persistent_wgc(profile: CaptureWorkloadProfile) -> bool {
    match wgc_fast_path_mode().as_str() {
        "transient" => false,
        "persistent" => true,
        // Automatic mode remains transient. Blocking-pool threads must not strand
        // multiple full-screen COM capture sessions after long-capture sampling.
        _ => {
            let _ = profile;
            false
        }
    }
}

/// Bounds the opt-in persistent mode to one blocking worker per process. COM
/// capture objects remain thread-affine, while other workers safely use the
/// transient path instead of retaining another full-screen frame pool.
pub(super) fn claim_process_persistent_wgc_thread() -> bool {
    static OWNER: OnceLock<std::sync::Mutex<Option<std::thread::ThreadId>>> = OnceLock::new();
    let current = std::thread::current().id();
    let Ok(mut owner) = OWNER.get_or_init(|| std::sync::Mutex::new(None)).lock() else {
        return false;
    };
    match *owner {
        Some(owner) => owner == current,
        None => {
            *owner = Some(current);
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{claim_process_persistent_wgc_thread, window_surface_crop};
    use crate::capture_coords::CaptureWindowMetrics;
    use windows::Win32::Foundation::RECT;

    #[test]
    fn persistent_wgc_is_bounded_to_one_process_thread() {
        assert!(claim_process_persistent_wgc_thread());
        let other_thread_claim = std::thread::spawn(claim_process_persistent_wgc_thread)
            .join()
            .expect("persistent WGC ownership probe should not panic");
        assert!(!other_thread_claim);
    }

    #[test]
    fn window_surface_crop_matches_fractional_dpi_display_rounding() {
        let crop = window_surface_crop(
            0,
            0,
            3,
            3,
            CaptureWindowMetrics {
                physical_origin_x: 0.0,
                physical_origin_y: 0.0,
                scale_factor: 1.5,
                logical_width: 10.0,
                logical_height: 10.0,
            },
            RECT {
                left: 0,
                top: 0,
                right: 100,
                bottom: 100,
            },
            100,
            100,
        )
        .expect("fractional-DPI crop should be non-empty");

        assert_eq!((crop.left, crop.top, crop.right, crop.bottom), (0, 0, 5, 5));
    }
}

pub(super) use super::wgc_persistent::try_fast_capture;
pub(super) use super::wgc_transient::{try_fast_capture_transient, try_hdr_capture_transient};
