use crate::capture_coords::CaptureWindowMetrics;
use anyhow::{anyhow, Context};
use image::RgbImage;
use std::{ffi::c_void, sync::OnceLock};
use windows::{
    core::{w, BOOL, PCSTR},
    Win32::{
        Foundation::{HANDLE, HWND, RECT},
        Graphics::{
            Direct3D11::{
                ID3D11Texture2D, D3D11_CPU_ACCESS_READ, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ,
                D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
            },
            Dwm::{DwmFlush, DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
            Dxgi::Common::{
                DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB,
                DXGI_FORMAT_B8G8R8X8_UNORM, DXGI_FORMAT_B8G8R8X8_UNORM_SRGB,
                DXGI_FORMAT_R8G8B8A8_UNORM, DXGI_FORMAT_R8G8B8A8_UNORM_SRGB, DXGI_SAMPLE_DESC,
            },
        },
        System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
        UI::WindowsAndMessaging::{GetWindowDisplayAffinity, IsIconic, IsWindowVisible},
    },
};

use super::wgc_session::{shared_d3d_device, window_surface_crop};

const MAX_MAPPED_SURFACE_BYTES: usize = 512 * 1024 * 1024;

/// A protected surface crop plus its physical offset inside the requested
/// screen region. The offset lets the caller compose protected content with
/// pixels captured from the desktop outside the protected window.
pub(super) struct ProtectedSurfaceCapture {
    pub image: RgbImage,
    pub offset_x: u32,
    pub offset_y: u32,
}

// This is an undocumented user32 export. Resolve it dynamically so unsupported
// Windows builds fail closed and continue through Hook's normal capture path.
type DwmGetDxSharedSurface = unsafe extern "system" fn(
    HWND,
    *mut HANDLE,
    *mut c_void,
    *mut c_void,
    *mut c_void,
    *mut c_void,
) -> BOOL;

fn parse_window_id(capture_window_id: &str) -> Option<HWND> {
    let raw = u64::from_str_radix(capture_window_id.trim_start_matches("0x"), 16).ok()?;
    (raw != 0).then_some(HWND(raw as *mut c_void))
}

fn dwm_get_dx_shared_surface() -> Option<DwmGetDxSharedSurface> {
    static PROCEDURE: OnceLock<Option<DwmGetDxSharedSurface>> = OnceLock::new();
    *PROCEDURE.get_or_init(|| unsafe {
        let user32 = GetModuleHandleW(w!("user32.dll")).ok()?;
        let address = GetProcAddress(user32, PCSTR(b"DwmGetDxSharedSurface\0".as_ptr()))?;
        Some(std::mem::transmute::<
            unsafe extern "system" fn() -> isize,
            DwmGetDxSharedSurface,
        >(address))
    })
}

pub fn window_display_affinity(capture_window_id: &str) -> Option<u32> {
    let hwnd = parse_window_id(capture_window_id)?;
    let mut affinity = 0u32;
    unsafe { GetWindowDisplayAffinity(hwnd, &mut affinity) }
        .ok()
        .map(|_| affinity)
}

pub(super) fn try_capture_protected_window(
    capture_window_id: &str,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: CaptureWindowMetrics,
) -> Option<RgbImage> {
    try_capture_protected_window_region(capture_window_id, x, y, w, h, display_metrics)
        .map(|capture| capture.image)
}

pub(super) fn try_capture_protected_window_region(
    capture_window_id: &str,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: CaptureWindowMetrics,
) -> Option<ProtectedSurfaceCapture> {
    let hwnd = parse_window_id(capture_window_id)?;
    let affinity = window_display_affinity(capture_window_id)?;
    if affinity == 0 {
        return None;
    }

    crate::append_runtime_log_line(&format!(
        "capture_window protected_surface_attempt :: target={} affinity=0x{:x}",
        capture_window_id, affinity
    ));
    match capture_protected_surface(hwnd, x, y, w, h, display_metrics) {
        Ok(capture) => {
            crate::append_runtime_log_line(&format!(
                "capture_window dwm_shared_success :: target={} width={} height={}",
                capture_window_id,
                capture.image.width(),
                capture.image.height()
            ));
            Some(capture)
        }
        Err(error) => {
            crate::append_runtime_log_line(&format!(
                "capture_window dwm_shared_fail :: target={} error={:#}",
                capture_window_id, error
            ));
            None
        }
    }
}

fn capture_protected_surface(
    hwnd: HWND,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: CaptureWindowMetrics,
) -> anyhow::Result<ProtectedSurfaceCapture> {
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() || unsafe { IsIconic(hwnd) }.as_bool() {
        return Err(anyhow!("protected window is hidden or minimized"));
    }

    let mut bounds = RECT::default();
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&raw mut bounds).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    }
    .context("DWM window bounds are unavailable")?;

    let procedure = dwm_get_dx_shared_surface()
        .ok_or_else(|| anyhow!("DwmGetDxSharedSurface is unavailable"))?;
    let _ = unsafe { DwmFlush() };
    let mut shared_handle = HANDLE::default();
    let acquired = unsafe {
        procedure(
            hwnd,
            &mut shared_handle,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if !acquired.as_bool() || shared_handle.0.is_null() {
        return Err(anyhow!("DwmGetDxSharedSurface returned no surface"));
    }

    let device = shared_d3d_device()?;
    let mut source_texture = None;
    unsafe { device.OpenSharedResource::<ID3D11Texture2D>(shared_handle, &mut source_texture) }
        .context("D3D11 could not open the DWM shared surface")?;
    let source_texture = source_texture.ok_or_else(|| anyhow!("DWM surface texture is null"))?;

    let mut source_desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { source_texture.GetDesc(&mut source_desc) };
    if source_desc.Width == 0 || source_desc.Height == 0 || source_desc.SampleDesc.Count != 1 {
        return Err(anyhow!(
            "unsupported DWM surface dimensions {}x{} samples={}",
            source_desc.Width,
            source_desc.Height,
            source_desc.SampleDesc.Count
        ));
    }
    pixel_layout(source_desc.Format)?;

    let crop = window_surface_crop(
        x,
        y,
        w,
        h,
        display_metrics,
        bounds,
        source_desc.Width,
        source_desc.Height,
    )
    .ok_or_else(|| anyhow!("selected region does not intersect the protected window surface"))?;
    let scale = display_metrics
        .scale_factor
        .is_finite()
        .then_some(display_metrics.scale_factor)
        .filter(|scale| *scale > 0.0)
        .unwrap_or(1.0);
    // Use the same floor-at-origin rule as display_selection's desktop crop.
    // Rounding the logical origin independently makes a protected surface move
    // by one pixel relative to the desktop at fractional DPI scales.
    let selection_left = display_metrics.physical_origin_x as f64 + (x as f64 * scale).floor();
    let selection_top = display_metrics.physical_origin_y as f64 + (y as f64 * scale).floor();
    let offset_x = (bounds.left as f64 - selection_left)
        .max(0.0)
        .floor()
        .min(w as f64 * scale) as u32;
    let offset_y = (bounds.top as f64 - selection_top)
        .max(0.0)
        .floor()
        .min(h as f64 * scale) as u32;

    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: source_desc.Width,
        Height: source_desc.Height,
        MipLevels: 1,
        ArraySize: 1,
        Format: source_desc.Format,
        SampleDesc: DXGI_SAMPLE_DESC {
            Count: 1,
            Quality: 0,
        },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut staging_texture = None;
    unsafe { device.CreateTexture2D(&staging_desc, None, Some(&mut staging_texture)) }
        .context("D3D11 could not allocate a staging texture")?;
    let staging_texture =
        staging_texture.ok_or_else(|| anyhow!("D3D11 staging texture is null"))?;
    let context = unsafe { device.GetImmediateContext() }
        .context("D3D11 immediate context is unavailable")?;
    unsafe {
        context.CopyResource(&staging_texture, &source_texture);
        context.Flush();
    }

    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { context.Map(&staging_texture, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }
        .context("D3D11 could not map the DWM surface")?;
    let image = mapped_surface_to_rgb(&mapped, source_desc, crop);
    unsafe { context.Unmap(&staging_texture, 0) };
    Ok(ProtectedSurfaceCapture {
        image: image?,
        offset_x,
        offset_y,
    })
}

#[derive(Clone, Copy)]
enum PixelLayout {
    Bgra,
    Rgba,
}

fn pixel_layout(format: DXGI_FORMAT) -> anyhow::Result<PixelLayout> {
    if matches!(
        format,
        DXGI_FORMAT_B8G8R8A8_UNORM
            | DXGI_FORMAT_B8G8R8A8_UNORM_SRGB
            | DXGI_FORMAT_B8G8R8X8_UNORM
            | DXGI_FORMAT_B8G8R8X8_UNORM_SRGB
    ) {
        Ok(PixelLayout::Bgra)
    } else if matches!(
        format,
        DXGI_FORMAT_R8G8B8A8_UNORM | DXGI_FORMAT_R8G8B8A8_UNORM_SRGB
    ) {
        Ok(PixelLayout::Rgba)
    } else {
        Err(anyhow!("unsupported DWM surface format {}", format.0))
    }
}

fn mapped_surface_to_rgb(
    mapped: &D3D11_MAPPED_SUBRESOURCE,
    desc: D3D11_TEXTURE2D_DESC,
    crop: windows::Win32::Graphics::Direct3D11::D3D11_BOX,
) -> anyhow::Result<RgbImage> {
    if mapped.pData.is_null() {
        return Err(anyhow!("D3D11 mapped a null DWM surface"));
    }
    let row_pitch = mapped.RowPitch as usize;
    let minimum_row_pitch = (desc.Width as usize)
        .checked_mul(4)
        .ok_or_else(|| anyhow!("DWM surface row size overflow"))?;
    if row_pitch < minimum_row_pitch {
        return Err(anyhow!("DWM surface row pitch is too small"));
    }
    let mapped_len = row_pitch
        .checked_mul(desc.Height as usize)
        .ok_or_else(|| anyhow!("DWM surface buffer size overflow"))?;
    if mapped_len > MAX_MAPPED_SURFACE_BYTES {
        return Err(anyhow!("DWM surface exceeds the 512 MiB safety limit"));
    }
    let source = unsafe { std::slice::from_raw_parts(mapped.pData.cast::<u8>(), mapped_len) };
    let width = crop.right - crop.left;
    let height = crop.bottom - crop.top;
    let output_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(3))
        .ok_or_else(|| anyhow!("DWM crop size overflow"))?;
    let layout = pixel_layout(desc.Format)?;
    let mut output = Vec::with_capacity(output_len);
    for row in crop.top..crop.bottom {
        let row_start = row as usize * row_pitch + crop.left as usize * 4;
        let row_end = row_start + width as usize * 4;
        for pixel in source[row_start..row_end].chunks_exact(4) {
            match layout {
                PixelLayout::Bgra => output.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]),
                PixelLayout::Rgba => output.extend_from_slice(&[pixel[0], pixel[1], pixel[2]]),
            }
        }
    }
    RgbImage::from_raw(width, height, output)
        .ok_or_else(|| anyhow!("failed to construct the DWM surface image"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_only_supported_four_byte_surface_formats() {
        assert!(matches!(
            pixel_layout(DXGI_FORMAT_B8G8R8A8_UNORM),
            Ok(PixelLayout::Bgra)
        ));
        assert!(matches!(
            pixel_layout(DXGI_FORMAT_R8G8B8A8_UNORM),
            Ok(PixelLayout::Rgba)
        ));
        assert!(pixel_layout(DXGI_FORMAT(10)).is_err());
    }

    #[test]
    #[ignore = "requires a visible protected window HWND in HOOK_PROTECTED_WINDOW_HWND"]
    fn captures_live_protected_window_from_dwm_shared_surface() {
        let capture_window_id = std::env::var("HOOK_PROTECTED_WINDOW_HWND")
            .expect("HOOK_PROTECTED_WINDOW_HWND must be set for the live probe");
        let hwnd = parse_window_id(&capture_window_id).expect("HWND should be hexadecimal");
        let mut bounds = RECT::default();
        unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                (&raw mut bounds).cast(),
                std::mem::size_of::<RECT>() as u32,
            )
        }
        .expect("protected window bounds should be available");
        let width = u32::try_from(bounds.right - bounds.left).expect("width should fit u32");
        let height = u32::try_from(bounds.bottom - bounds.top).expect("height should fit u32");
        let capture = capture_protected_surface(
            hwnd,
            bounds.left,
            bounds.top,
            width,
            height,
            CaptureWindowMetrics {
                physical_origin_x: 0.0,
                physical_origin_y: 0.0,
                scale_factor: 1.0,
                logical_width: width as f64,
                logical_height: height as f64,
            },
        )
        .unwrap_or_else(|error| panic!("DWM shared-surface capture should succeed: {error:#}"));
        let path = std::env::temp_dir().join("hook-protected-window-dwm-probe.png");
        capture
            .image
            .save(&path)
            .expect("probe image should be writable");
        assert!(capture
            .image
            .pixels()
            .any(|pixel| pixel.0.iter().any(|channel| *channel > 8)));
        eprintln!(
            "protected DWM probe: {}x{} -> {}",
            capture.image.width(),
            capture.image.height(),
            path.display()
        );
    }
}
