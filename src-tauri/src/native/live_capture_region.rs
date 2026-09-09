// Owns the fixed window-local pixel region shared by live capture and input mapping.

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveCaptureWindowRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LiveCapturePhysicalRegion {
    left: u32,
    top: u32,
    width: u32,
    height: u32,
}

#[cfg(target_os = "windows")]
struct LiveSourceDpiContext {
    previous: windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT,
}

#[cfg(target_os = "windows")]
impl Drop for LiveSourceDpiContext {
    fn drop(&mut self) {
        unsafe { windows::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(self.previous) };
    }
}

#[cfg(target_os = "windows")]
fn enter_live_source_dpi_context(
    hwnd: windows::Win32::Foundation::HWND,
) -> Result<LiveSourceDpiContext, String> {
    let target = unsafe { windows::Win32::UI::HiDpi::GetWindowDpiAwarenessContext(hwnd) };
    if target.0.is_null() {
        return Err("source_dpi_context_unavailable".to_string());
    }
    let previous = unsafe { windows::Win32::UI::HiDpi::SetThreadDpiAwarenessContext(target) };
    if previous.0.is_null() {
        return Err("source_dpi_context_unavailable".to_string());
    }
    Ok(LiveSourceDpiContext { previous })
}

fn validate_live_capture_window_region(region: LiveCaptureWindowRegion) -> Result<(), String> {
    let values = [region.x, region.y, region.width, region.height];
    if !values.into_iter().all(f64::is_finite)
        || region.x < 0.0
        || region.y < 0.0
        || region.width <= 0.0
        || region.height <= 0.0
        || region.x + region.width > 1_000_000.0
        || region.y + region.height > 1_000_000.0
        || region.width > 16_384.0
        || region.height > 16_384.0
    {
        return Err("live capture window region is invalid".to_string());
    }
    Ok(())
}

fn physical_live_capture_window_region(
    region: LiveCaptureWindowRegion,
    scale_factor: f64,
) -> Result<LiveCapturePhysicalRegion, String> {
    validate_live_capture_window_region(region)?;
    let scale = scale_factor
        .is_finite()
        .then_some(scale_factor)
        .filter(|value| *value > 0.0)
        .ok_or_else(|| "live capture display scale is invalid".to_string())?;
    let left = (region.x * scale).floor();
    let top = (region.y * scale).floor();
    let right = ((region.x + region.width) * scale).ceil();
    let bottom = ((region.y + region.height) * scale).ceil();
    if right <= left || bottom <= top || right > u32::MAX as f64 || bottom > u32::MAX as f64 {
        return Err("live capture physical window region is invalid".to_string());
    }
    Ok(LiveCapturePhysicalRegion {
        left: left as u32,
        top: top as u32,
        width: (right - left) as u32,
        height: (bottom - top) as u32,
    })
}

#[cfg(target_os = "windows")]
fn live_capture_surface_crop(
    region: LiveCapturePhysicalRegion,
    surface_width: u32,
    surface_height: u32,
) -> Result<windows::Win32::Graphics::Direct3D11::D3D11_BOX, String> {
    let right = region.left.saturating_add(region.width).min(surface_width);
    let bottom = region.top.saturating_add(region.height).min(surface_height);
    if region.left >= right || region.top >= bottom {
        return Err("live capture window region is outside the source surface".to_string());
    }
    Ok(windows::Win32::Graphics::Direct3D11::D3D11_BOX {
        left: region.left,
        top: region.top,
        right,
        bottom,
        front: 0,
        back: 1,
    })
}

fn live_capture_region_point(
    region: LiveCapturePhysicalRegion,
    normalized_x: f64,
    normalized_y: f64,
) -> (i32, i32) {
    let x = region.left as f64 + region.width.saturating_sub(1) as f64 * normalized_x;
    let y = region.top as f64 + region.height.saturating_sub(1) as f64 * normalized_y;
    (x.round() as i32, y.round() as i32)
}

#[cfg(target_os = "windows")]
fn live_capture_region_client_point(
    hwnd: windows::Win32::Foundation::HWND,
    region: LiveCapturePhysicalRegion,
    normalized_x: f64,
    normalized_y: f64,
) -> Result<windows::Win32::Foundation::POINT, String> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let mut bounds = RECT::default();
    if unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&raw mut bounds).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    }
    .is_err()
    {
        unsafe { GetWindowRect(hwnd, &mut bounds) }
            .map_err(|_| "source_window_bounds_unavailable".to_string())?;
    }
    let (x, y) = live_capture_region_point(region, normalized_x, normalized_y);
    let mut point = windows::Win32::Foundation::POINT {
        x: bounds.left.saturating_add(x),
        y: bounds.top.saturating_add(y),
    };
    if !unsafe {
        windows::Win32::UI::HiDpi::PhysicalToLogicalPointForPerMonitorDPI(Some(hwnd), &mut point)
    }
    .as_bool()
    {
        return Err("source_coordinate_transform_failed".to_string());
    }
    if !unsafe { windows::Win32::Graphics::Gdi::ScreenToClient(hwnd, &mut point) }.as_bool() {
        return Err("source_coordinate_transform_failed".to_string());
    }
    Ok(point)
}

#[cfg(test)]
mod live_capture_region_tests {
    use super::*;

    #[test]
    fn region_rounding_and_input_offsets_stay_fixed_when_the_window_moves() {
        let region = physical_live_capture_window_region(
            LiveCaptureWindowRegion {
                x: 100.0,
                y: 100.0,
                width: 50.0,
                height: 50.0,
            },
            1.5,
        )
        .expect("valid region");
        assert_eq!(
            region,
            LiveCapturePhysicalRegion {
                left: 150,
                top: 150,
                width: 75,
                height: 75
            }
        );
        assert_eq!(live_capture_region_point(region, 0.0, 0.0), (150, 150));
        assert_eq!(live_capture_region_point(region, 1.0, 1.0), (224, 224));
        assert_eq!((300 + region.left, 200 + region.top), (450, 350));
        assert_eq!((800 + region.left, 500 + region.top), (950, 650));
    }

    #[test]
    fn rejects_regions_that_are_empty_negative_or_not_finite() {
        for region in [
            LiveCaptureWindowRegion {
                x: -1.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            LiveCaptureWindowRegion {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 1.0,
            },
            LiveCaptureWindowRegion {
                x: f64::NAN,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
        ] {
            assert!(validate_live_capture_window_region(region).is_err());
        }
    }
}
