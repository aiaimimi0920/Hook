//! Bounded, on-demand GPU readback. Never map or encode on the compositor thread.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use windows::Win32::Graphics::Direct3D11::{
    ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ, D3D11_MAPPED_SUBRESOURCE,
    D3D11_MAP_FLAG_DO_NOT_WAIT, D3D11_MAP_READ, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::DXGI_ERROR_WAS_STILL_DRAWING;

use super::frame::GpuFrame;

static PENDING: AtomicUsize = AtomicUsize::new(0);
pub(super) struct Permit;
impl Permit {
    pub fn acquire() -> Result<Self, String> {
        PENDING
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < 4).then_some(count + 1)
            })
            .map(|_| Self)
            .map_err(|_| "GPU snapshot requests are busy".to_string())
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        PENDING.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(crate) struct Readback {
    texture: ID3D11Texture2D,
    context: ID3D11DeviceContext,
    width: u32,
    height: u32,
    captured_at_ms: u64,
}

impl Readback {
    // Copy while the slot is locked, before capture can reuse its source texture.
    // The independent staging resource, not a COM clone of the source, crosses threads.
    pub fn copy(frame: &GpuFrame) -> Result<Self, String> {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { frame.texture.GetDesc(&mut desc) };
        desc.Usage = D3D11_USAGE_STAGING;
        desc.BindFlags = 0;
        desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
        desc.MiscFlags = 0;
        let mut texture = None;
        unsafe {
            frame
                .device
                .CreateTexture2D(&desc, None, Some(&mut texture))
        }
        .map_err(|error| error.to_string())?;
        let texture = texture.ok_or("GPU snapshot staging texture missing")?;
        unsafe { frame.context.CopyResource(&texture, &frame.texture) };
        Ok(Self {
            texture,
            context: frame.context.clone(),
            width: frame.width,
            height: frame.height,
            captured_at_ms: frame.captured_at_ms,
        })
    }

    pub fn encode(self) -> Result<Vec<u8>, String> {
        let image = self.read_rgb()?;
        // A timestamp header orders explicit snapshots against in-flight JPEG delivery.
        let mut output = std::io::Cursor::new(self.captured_at_ms.to_le_bytes().to_vec());
        output.set_position(8);
        image::DynamicImage::ImageRgb8(image)
            .write_to(&mut output, image::ImageFormat::Png)
            .map_err(|error| error.to_string())?;
        let bytes = output.into_inner();
        if bytes.len() > 64 * 1024 * 1024 {
            return Err("GPU snapshot payload too large".to_string());
        }
        Ok(bytes)
    }

    pub fn into_rgb(self) -> Result<(image::RgbImage, u64), String> {
        Ok((self.read_rgb()?, self.captured_at_ms))
    }

    fn read_rgb(&self) -> Result<image::RgbImage, String> {
        let deadline = Instant::now() + Duration::from_millis(1500);
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        loop {
            match unsafe {
                self.context.Map(
                    &self.texture,
                    0,
                    D3D11_MAP_READ,
                    D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32,
                    Some(&mut mapped),
                )
            } {
                Ok(()) => break,
                Err(error)
                    if error.code() == DXGI_ERROR_WAS_STILL_DRAWING
                        && Instant::now() < deadline =>
                {
                    std::thread::sleep(Duration::from_millis(2));
                }
                Err(error) => return Err(format!("GPU snapshot map failed: {error}")),
            }
        }
        struct Mapping<'a>(&'a Readback);
        impl Drop for Mapping<'_> {
            fn drop(&mut self) {
                unsafe { self.0.context.Unmap(&self.0.texture, 0) };
            }
        }
        let _mapping = Mapping(self);
        let length = mapped_length(
            self.width,
            self.height,
            mapped.RowPitch,
            !mapped.pData.is_null(),
        )?;
        let bytes = unsafe { std::slice::from_raw_parts(mapped.pData.cast::<u8>(), length) };
        let mut rgb = Vec::with_capacity(self.width as usize * self.height as usize * 3);
        for row in 0..self.height as usize {
            let offset = row * mapped.RowPitch as usize;
            for bgra in bytes[offset..offset + self.width as usize * 4].chunks_exact(4) {
                rgb.extend_from_slice(&[bgra[2], bgra[1], bgra[0]]);
            }
        }
        image::RgbImage::from_raw(self.width, self.height, rgb)
            .ok_or("GPU snapshot RGB size mismatch".to_string())
    }
}

fn mapped_length(width: u32, height: u32, pitch: u32, non_null: bool) -> Result<usize, String> {
    let row = u64::from(width) * 4;
    let length = (u64::from(pitch) * u64::from(height.saturating_sub(1)))
        .checked_add(row)
        .ok_or("GPU snapshot mapped size overflow")?;
    if !non_null
        || width == 0
        || height == 0
        || row > u64::from(pitch)
        || u64::from(width) * u64::from(height) > 128 * 1024 * 1024
        || length > 512 * 1024 * 1024
    {
        return Err("GPU snapshot mapped bounds invalid".to_string());
    }
    Ok(length as usize)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_admission_is_bounded_and_releases_after_drop() {
        let mut held = (0..4)
            .map(|_| Permit::acquire().unwrap())
            .collect::<Vec<_>>();
        assert!(Permit::acquire().is_err());
        drop(held.pop());
        let replacement = Permit::acquire().unwrap();
        assert!(Permit::acquire().is_err());
        drop(replacement);
        drop(held);
        assert!(Permit::acquire().is_ok());
    }

    #[test]
    fn mapped_rows_validate_padding_null_and_overflow() {
        assert_eq!(mapped_length(3, 2, 16, true).unwrap(), 28);
        assert_eq!(
            mapped_length(7680, 4320, 7680 * 4, true).unwrap(),
            132_710_400
        );
        assert!(mapped_length(16384, 8193, 16384 * 4, true).is_err());
        for (w, h, stride, valid) in [
            (0, 2, 16, true),
            (4, 0, 16, true),
            (5, 2, 16, true),
            (4, 2, 16, false),
            (u32::MAX, u32::MAX, u32::MAX, true),
        ] {
            assert!(mapped_length(w, h, stride, valid).is_err());
        }
    }
}
