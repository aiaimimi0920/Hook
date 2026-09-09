//! Desktop samples are restricted to the center of an owned fixture window.
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmEnableBlurBehindWindow, DWM_BB_BLURREGION, DWM_BB_ENABLE, DWM_BLURBEHIND,
};
use windows::Win32::Graphics::Gdi::{
    CreateRectRgn, DeleteObject, GetMonitorInfoW, MonitorFromRect, MONITORINFO,
    MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

static AGES: std::sync::Mutex<Vec<f64>> = std::sync::Mutex::new(Vec::new());

#[link(name = "kernel32")]
unsafe extern "system" {
    fn QueryPerformanceCounter(value: *mut i64) -> windows::core::BOOL;
    fn QueryPerformanceFrequency(value: *mut i64) -> windows::core::BOOL;
}

pub(crate) fn record_capture_age(id: &str, frame: &scap_direct3d::Frame) {
    if id != "browser-video" {
        return;
    }
    let Ok(timestamp) = frame.inner().SystemRelativeTime() else {
        return;
    };
    let (mut now, mut frequency) = (0, 0);
    if !unsafe { QueryPerformanceCounter(&mut now) }.as_bool()
        || !unsafe { QueryPerformanceFrequency(&mut frequency) }.as_bool()
        || frequency <= 0
    {
        return;
    }
    let age_ms = now as f64 * 1000.0 / frequency as f64 - timestamp.Duration as f64 / 10_000.0;
    if let Ok(mut ages) = AGES.try_lock() {
        if ages.len() < 2048 {
            ages.push(age_ms);
        }
    }
}

pub(super) fn take_capture_ages() -> serde_json::Value {
    let mut ages = std::mem::take(&mut *AGES.lock().unwrap());
    ages.sort_by(f64::total_cmp);
    let percentile = |p: usize| ages.get(ages.len().saturating_sub(1) * p / 100).copied();
    serde_json::json!({ "samples": ages.len(), "p50Ms": percentile(50), "p95Ms": percentile(95), "maxMs": ages.last() })
}

pub(super) fn make_transparent(hwnd: HWND) {
    // Exercise tao's DWM transparency flags; this standalone host has no WebView.
    unsafe {
        let region = CreateRectRgn(0, 0, -1, -1);
        assert!(!region.is_invalid());
        let result = DwmEnableBlurBehindWindow(
            hwnd,
            &DWM_BLURBEHIND {
                dwFlags: DWM_BB_ENABLE | DWM_BB_BLURREGION,
                fEnable: true.into(),
                hRgnBlur: region,
                fTransitionOnMaximized: false.into(),
            },
        );
        let _ = DeleteObject(region.into());
        result.unwrap();
    }
}

pub(super) fn desktop_samples(hwnd: HWND) -> (image::RgbImage, crate::screenshot::CaptureBackend) {
    let mut bounds = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut bounds) }.unwrap();
    let width = (bounds.right - bounds.left) / 3;
    let height = (bounds.bottom - bounds.top) / 3;
    assert!(width > 0 && height > 0);
    let region = RECT {
        left: bounds.left + width,
        top: bounds.top + height,
        right: bounds.left + width * 2,
        bottom: bounds.top + height * 2,
    };
    let monitor = unsafe { MonitorFromRect(&region, MONITOR_DEFAULTTONEAREST) };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    assert!(unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool());
    let screen = info.rcMonitor;
    assert!(
        region.left >= screen.left
            && region.top >= screen.top
            && region.right <= screen.right
            && region.bottom <= screen.bottom,
        "owned desktop oracle must be entirely visible on one monitor"
    );
    let scale = f64::from(unsafe { GetDpiForWindow(hwnd) }) / 96.0;
    assert!(scale > 0.0);
    let metrics = crate::CaptureWindowMetrics {
        physical_origin_x: f64::from(screen.left),
        physical_origin_y: f64::from(screen.top),
        scale_factor: scale,
        logical_width: f64::from(screen.right - screen.left) / scale,
        logical_height: f64::from(screen.bottom - screen.top) / scale,
    };
    // Use the ordinary display-capture path: GDI alone may omit composition planes.
    let result = crate::screenshot::capture_region_with_dynamic_range(
        (f64::from(region.left - screen.left) / scale).round() as i32,
        (f64::from(region.top - screen.top) / scale).round() as i32,
        (f64::from(width) / scale).round() as u32,
        (f64::from(height) / scale).round() as u32,
        Some(metrics),
        1.0,
    )
    .unwrap();
    let crate::screenshot::DynamicCapturePixels::Sdr(image) = result.pixels else {
        panic!("this desktop video oracle requires an SDR fixture monitor");
    };
    (image, result.backend)
}
