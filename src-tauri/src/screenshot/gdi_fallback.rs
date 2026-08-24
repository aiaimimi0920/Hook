use anyhow::anyhow;
use image::RgbImage;
use windows::Win32::Graphics::Direct3D11::D3D11_BOX;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, CAPTUREBLT, DIB_RGB_COLORS, HDC, SRCCOPY,
};

use super::capture_pixels::{rgb_from_rgba, ChannelOrder};

const WINDOWS_CAPTURE_UNSUPPORTED: &str =
    "Screen capture not supported on this device/driver. Update graphics drivers or OS.";

fn unsupported_error() -> anyhow::Error {
    anyhow!(WINDOWS_CAPTURE_UNSUPPORTED)
}

/// Converts the display-local crop into Win32 coordinates without narrowing or
/// addition overflow before the values cross the GDI FFI boundary.
pub(super) fn checked_gdi_capture_rect(
    physical_origin_x: i32,
    physical_origin_y: i32,
    crop: &D3D11_BOX,
) -> anyhow::Result<(i32, i32, i32, i32)> {
    let left = i32::try_from(crop.left).map_err(|_| unsupported_error())?;
    let top = i32::try_from(crop.top).map_err(|_| unsupported_error())?;
    let width = crop
        .right
        .checked_sub(crop.left)
        .and_then(|value| i32::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or_else(unsupported_error)?;
    let height = crop
        .bottom
        .checked_sub(crop.top)
        .and_then(|value| i32::try_from(value).ok())
        .filter(|value| *value > 0)
        .ok_or_else(unsupported_error)?;
    let src_x = physical_origin_x
        .checked_add(left)
        .ok_or_else(unsupported_error)?;
    let src_y = physical_origin_y
        .checked_add(top)
        .ok_or_else(unsupported_error)?;
    Ok((src_x, src_y, width, height))
}

/// Owns GDI bitmap allocation, handle cleanup, and BGRA-to-RGB conversion.
fn capture_bitmap_with(
    base_dc: HDC,
    width: i32,
    height: i32,
    mut fill: impl FnMut(HDC) -> anyhow::Result<()>,
) -> anyhow::Result<RgbImage> {
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

    let bitmap = match bitmap {
        Ok(bitmap) if !bitmap.is_invalid() && !data.is_null() => bitmap,
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

        rgb_from_rgba(slice, width, height, row_bytes, ChannelOrder::Bgra)
            .ok_or_else(unsupported_error)
    })();

    unsafe {
        SelectObject(mem_dc, old_obj);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem_dc);
    }

    result
}

pub(super) fn capture_area_gdi(
    src_x: i32,
    src_y: i32,
    width: i32,
    height: i32,
) -> anyhow::Result<RgbImage> {
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

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crop(left: u32, top: u32, right: u32, bottom: u32) -> D3D11_BOX {
        D3D11_BOX {
            left,
            top,
            right,
            bottom,
            front: 0,
            back: 1,
        }
    }

    #[test]
    fn converts_negative_display_origins_without_losing_sign() {
        assert_eq!(
            checked_gdi_capture_rect(-2560, -200, &crop(150, 75, 750, 375)).unwrap(),
            (-2410, -125, 600, 300),
        );
    }

    #[test]
    fn rejects_coordinates_and_dimensions_outside_win32_range() {
        assert!(checked_gdi_capture_rect(i32::MAX, 0, &crop(1, 0, 2, 1)).is_err());
        assert!(checked_gdi_capture_rect(0, 0, &crop(0, 0, u32::MAX, 1)).is_err());
        assert!(checked_gdi_capture_rect(0, 0, &crop(2, 0, 1, 1)).is_err());
    }
}
