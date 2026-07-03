use anyhow::anyhow;
use image::RgbImage;
use std::sync::OnceLock;

// Scap Imports
use scap_targets::Display;

// Windows Imports
#[cfg(target_os = "windows")]
use scap_direct3d::{Capturer, Frame, PixelFormat, Settings};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HMODULE;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, D3D11_BOX, D3D11_SDK_VERSION,
};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, CAPTUREBLT, DIB_RGB_COLORS, HDC, SRCCOPY,
};
#[cfg(target_os = "windows")]
// use windows::Win32::Storage::Xps::{PRINT_WINDOW_FLAGS, PrintWindow};
#[cfg(target_os = "windows")]
const WINDOWS_CAPTURE_UNSUPPORTED: &str =
    "Screen capture not supported on this device/driver. Update graphics drivers or OS.";

#[cfg(target_os = "windows")]
fn unsupported_error() -> anyhow::Error {
    anyhow!(WINDOWS_CAPTURE_UNSUPPORTED)
}

#[derive(Clone, Copy)]
enum ChannelOrder {
    Rgba,
    Bgra,
}

fn rgb_from_rgba(
    data: &[u8],
    width: usize,
    height: usize,
    bytes_per_row: usize,
    order: ChannelOrder,
) -> Option<RgbImage> {
    let row_bytes = width.checked_mul(4)?;
    if bytes_per_row < row_bytes {
        return None;
    }

    let required_len = height.checked_mul(bytes_per_row)?;
    if data.len() < required_len {
        return None;
    }

    let width_stride = width.checked_mul(3)?;
    let rgb_len = height.checked_mul(width_stride)?;
    let mut rgb = vec![0u8; rgb_len];

    for y in 0..height {
        let src_start = y.checked_mul(bytes_per_row)?;
        let src_end = src_start.checked_add(row_bytes)?;
        let dst_start = y.checked_mul(width_stride)?;
        let dst_end = dst_start.checked_add(width_stride)?;

        let src_row = data.get(src_start..src_end)?;
        let dst_row = rgb.get_mut(dst_start..dst_end)?;

        for (src, dst) in src_row.chunks_exact(4).zip(dst_row.chunks_exact_mut(3)) {
            let (r, b) = match order {
                ChannelOrder::Rgba => (src[0], src[2]),
                ChannelOrder::Bgra => (src[2], src[0]),
            };

            dst[0] = r;
            dst[1] = src[1];
            dst[2] = b;
        }
    }

    RgbImage::from_raw(width as u32, height as u32, rgb)
}

#[cfg(target_os = "windows")]
fn shared_d3d_device() -> anyhow::Result<&'static ID3D11Device> {
    static DEVICE: OnceLock<Option<ID3D11Device>> = OnceLock::new();

    let device = DEVICE.get_or_init(|| {
        let mut device = None;
        let result = unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                Default::default(),
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

#[cfg(target_os = "windows")]
fn windows_fast_path_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();

    *AVAILABLE.get_or_init(|| match scap_direct3d::is_supported() {
        Ok(true) => shared_d3d_device().is_ok(),
        _ => false,
    })
}

#[cfg(target_os = "windows")]
fn frame_to_rgb(frame: &Frame) -> anyhow::Result<RgbImage> {
    let buffer = frame
        .as_buffer()
        .map_err(|e| anyhow!("Failed to get buffer: {e:?}"))?;

    let order = match buffer.pixel_format() {
        PixelFormat::R8G8B8A8Unorm => ChannelOrder::Rgba,
        PixelFormat::B8G8R8A8Unorm => ChannelOrder::Bgra,
    };

    rgb_from_rgba(
        buffer.data(),
        buffer.width() as usize,
        buffer.height() as usize,
        buffer.stride() as usize,
        order,
    )
    .ok_or_else(|| anyhow!("Failed to create RgbImage"))
}

// Simplified capture settings just for Full Screen or Area
#[cfg(target_os = "windows")]
fn windows_capture_settings(rect: Option<D3D11_BOX>) -> Settings {
    let mut settings = Settings {
        is_cursor_capture_enabled: Some(false),
        pixel_format: PixelFormat::B8G8R8A8Unorm,
        ..Default::default()
    };

    if let Ok(true) = Settings::can_is_border_required() {
        settings.is_border_required = Some(false);
    }

    // Explicit Crop
    settings.crop = rect;

    settings
}

#[cfg(target_os = "windows")]
fn capture_bitmap_with(
    base_dc: HDC,
    width: i32,
    height: i32,
    mut fill: impl FnMut(HDC) -> anyhow::Result<()>,
) -> anyhow::Result<Vec<u8>> {
    if width <= 0 || height <= 0 {
        return Err(unsupported_error());
    }

    if base_dc.is_invalid() {
        return Err(unsupported_error());
    }

    let mem_dc = unsafe { CreateCompatibleDC(Some(base_dc)) };
    if mem_dc.is_invalid() {
        return Err(unsupported_error());
    }

    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [Default::default(); 1],
    };

    let mut data = std::ptr::null_mut();
    let bitmap =
        unsafe { CreateDIBSection(Some(mem_dc), &info, DIB_RGB_COLORS, &mut data, None, 0) };

    // Check if bitmap creation succeeded (bitmap != Err and handle != 0 and data != null)
    let bitmap = match bitmap {
        Ok(b) if !b.is_invalid() && !data.is_null() => b,
        _ => {
            unsafe {
                let _ = DeleteDC(mem_dc);
            }
            return Err(unsupported_error());
        }
    };

    let old_obj = unsafe { SelectObject(mem_dc, bitmap.into()) };

    let result = (|| {
        fill(mem_dc)?;

        let width = usize::try_from(width).map_err(|_| unsupported_error())?;
        let height = usize::try_from(height).map_err(|_| unsupported_error())?;
        let row_bytes = width.checked_mul(4).ok_or_else(unsupported_error)?;
        let len = height
            .checked_mul(row_bytes)
            .ok_or_else(unsupported_error)?;
        let slice = unsafe { std::slice::from_raw_parts(data as *const u8, len) };

        let mut buffer = vec![0u8; len];
        buffer.copy_from_slice(slice);
        Ok(buffer)
    })();

    unsafe {
        SelectObject(mem_dc, old_obj);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem_dc);
    }

    result
}

#[cfg(target_os = "windows")]
fn bgra_to_rgb(buffer: Vec<u8>, width: usize, height: usize) -> anyhow::Result<RgbImage> {
    let stride = width.checked_mul(4).ok_or_else(unsupported_error)?;
    rgb_from_rgba(&buffer, width, height, stride, ChannelOrder::Bgra).ok_or_else(unsupported_error)
}

#[cfg(target_os = "windows")]
fn capture_area_gdi(src_x: i32, src_y: i32, width: i32, height: i32) -> anyhow::Result<RgbImage> {
    let screen_dc = unsafe { GetDC(None) };
    let result = capture_bitmap_with(screen_dc, width, height, |mem_dc| {
        unsafe {
            BitBlt(
                mem_dc,
                0,
                0,
                width,
                height,
                Some(screen_dc),
                src_x,
                src_y,
                SRCCOPY | CAPTUREBLT,
            )
        }
        .map_err(|_| unsupported_error())
    });
    unsafe {
        ReleaseDC(None, screen_dc);
    }

    let buffer = result?;
    let width = usize::try_from(width).map_err(|_| unsupported_error())?;
    let height = usize::try_from(height).map_err(|_| unsupported_error())?;
    bgra_to_rgb(buffer, width, height)
}

#[cfg(target_os = "windows")]
fn capture_backend_mode() -> String {
    std::env::var("HOOK_CAPTURE_BACKEND")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "gdi".to_string())
}

fn capture_area_verbose_logging_enabled_for(value: Option<&str>) -> bool {
    matches!(
        value.map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if matches!(value.as_str(), "1" | "true" | "yes" | "on")
    )
}

fn capture_area_verbose_logging_enabled() -> bool {
    capture_area_verbose_logging_enabled_for(
        std::env::var("HOOK_CAPTURE_AREA_VERBOSE_LOG")
            .ok()
            .as_deref(),
    )
}

#[cfg(target_os = "windows")]
fn try_fast_capture(
    display_id: scap_targets::DisplayId,
    crop_rect: Option<D3D11_BOX>,
) -> Option<RgbImage> {
    use std::sync::mpsc::sync_channel;
    use std::time::Duration;

    if !windows_fast_path_available() {
        return None;
    }

    let start = std::time::Instant::now();

    // Get Capture Item from Display
    let display = scap_targets::Display::from_id(&display_id)?;
    let item = display.raw_handle().try_as_capture_item().ok()?;

    let settings = windows_capture_settings(crop_rect);
    let device = shared_d3d_device().ok().cloned();

    let (tx, rx) = sync_channel(1);

    let mut capturer = Capturer::new(
        item,
        settings,
        {
            move |frame| {
                let res = frame_to_rgb(&frame);
                let _ = tx.try_send(res); // Only need first frame
                Ok(())
            }
        },
        || Ok(()),
        device,
    )
    .ok()?;

    capturer.start().ok()?;

    let res = rx.recv_timeout(Duration::from_millis(500));
    let _ = capturer.stop();

    let image = res.ok()?.ok()?;
    if capture_area_verbose_logging_enabled() {
        crate::append_runtime_log_line(&format!(
            "capture_area fast_elapsed :: elapsed_ms={}",
            start.elapsed().as_millis()
        ));
    }
    Some(image)
}

// --- Public API ---

pub fn capture_area(x: i32, y: i32, w: u32, h: u32) -> anyhow::Result<RgbImage> {
    #[cfg(target_os = "windows")]
    {
        let verbose_log = capture_area_verbose_logging_enabled();
        if verbose_log {
            crate::append_runtime_log_line(&format!(
                "capture_area enter :: x={} y={} w={} h={}",
                x, y, w, h
            ));
        }
        // 1. Find Primary Display & Scale Info
        let display = Display::primary();
        let display_id = display.id();

        let physical = display
            .physical_size()
            .ok_or_else(|| anyhow!("No physical size"))?;
        let logical = display
            .logical_size()
            .ok_or_else(|| anyhow!("No logical size"))?;

        if logical.width() <= 0.0 || physical.width() <= 0.0 {
            return Err(anyhow!("Invalid display dimensions"));
        }

        // 2. Calculate Scale Factor (Physical / Logical)
        // Cap uses: logical.width() / physical.width().
        // Wait, if logical is 1920 (at 150%) and physical is 2880...
        // A point at 100 logical is 150 physical.
        // So scale = physical / logical = 1.5.
        // Cap's screenshot.rs:
        // let logical = display.logical_size()?;
        // let physical = display.physical_size()?;
        // let scale = physical.width() / logical.width();

        // However, Cap's "logical_size" might return the *Points* size on macOS, but on Windows:
        // scap-targets implementation uses monitor info.

        let scale = physical.width() / logical.width();
        if verbose_log {
            crate::append_runtime_log_line(&format!(
                "capture_area display :: logical={}x{} physical={}x{} scale={}",
                logical.width(),
                logical.height(),
                physical.width(),
                physical.height(),
                scale
            ));
        }

        // 3. Scale the input rect (assumed logical) to physical pixels
        let left = (x as f64 * scale).floor();
        let top = (y as f64 * scale).floor();
        let right = (left + w as f64 * scale).ceil();
        let bottom = (top + h as f64 * scale).ceil();

        let clamped_right = right.min(physical.width()).max(left);
        let clamped_bottom = bottom.min(physical.height()).max(top);

        let d3d_box = D3D11_BOX {
            left: left.max(0.0) as u32,
            top: top.max(0.0) as u32,
            right: clamped_right as u32,
            bottom: clamped_bottom as u32,
            front: 0,
            back: 1,
        };
        if verbose_log {
            crate::append_runtime_log_line(&format!(
                "capture_area crop :: left={} top={} right={} bottom={}",
                d3d_box.left, d3d_box.top, d3d_box.right, d3d_box.bottom
            ));
        }

        let crop_x = d3d_box.left;
        let crop_y = d3d_box.top;
        let crop_w = d3d_box.right - d3d_box.left;
        let crop_h = d3d_box.bottom - d3d_box.top;

        let backend_mode = capture_backend_mode();
        if backend_mode == "auto" {
            if let Some(image) = try_fast_capture(display_id.clone(), Some(d3d_box)) {
                if verbose_log {
                    crate::append_runtime_log_line(&format!(
                        "capture_area fast_success :: width={} height={}",
                        image.width(),
                        image.height()
                    ));
                }
                return Ok(image);
            }
            if verbose_log {
                crate::append_runtime_log_line("capture_area fast_path_none");
            }
        } else {
            if verbose_log {
                crate::append_runtime_log_line(&format!(
                    "capture_area fast_path_skipped :: mode={}",
                    backend_mode
                ));
            }
        }

        let gdi_image =
            capture_area_gdi(crop_x as i32, crop_y as i32, crop_w as i32, crop_h as i32)?;
        if verbose_log {
            crate::append_runtime_log_line(&format!(
                "capture_area gdi_capture_success :: width={} height={}",
                gdi_image.width(),
                gdi_image.height()
            ));
        }
        return Ok(gdi_image);
    }

    #[cfg(not(target_os = "windows"))]
    Err(anyhow!("Only Windows is supported"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_area_verbose_logging_is_opt_in() {
        assert!(!capture_area_verbose_logging_enabled_for(None));
        assert!(!capture_area_verbose_logging_enabled_for(Some("")));
        assert!(!capture_area_verbose_logging_enabled_for(Some("0")));
        assert!(!capture_area_verbose_logging_enabled_for(Some("false")));
        assert!(capture_area_verbose_logging_enabled_for(Some("1")));
        assert!(capture_area_verbose_logging_enabled_for(Some("true")));
        assert!(capture_area_verbose_logging_enabled_for(Some("yes")));
    }
}
