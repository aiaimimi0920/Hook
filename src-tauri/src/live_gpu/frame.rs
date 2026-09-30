//! A bounded GPU-owned copy; never retain WGC's recycled crop/frame-pool texture.

use std::sync::atomic::{AtomicU64, Ordering};
use windows::core::Interface;
use windows::Win32::Graphics::Direct3D11::{
    ID3D11Device, ID3D11DeviceContext, ID3D11Multithread, ID3D11Texture2D,
    D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_BOX, D3D11_TEXTURE2D_DESC,
    D3D11_USAGE_DEFAULT,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;

const MAX_TEXTURE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_READBACK_BYTES: u64 = 512 * 1024 * 1024;
static NEXT_COPY: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub(crate) struct GpuFrame {
    pub copy_id: u64,
    pub texture: ID3D11Texture2D,
    pub device: ID3D11Device,
    pub context: ID3D11DeviceContext,
    pub width: u32,
    pub height: u32,
    pub captured_at_ms: u64,
}

impl GpuFrame {
    pub fn copy(
        frame: &scap_direct3d::Frame,
        crop: Option<D3D11_BOX>,
        reusable: Option<Self>,
    ) -> Result<Self, String> {
        Self::copy_bounded(frame, crop, reusable, MAX_TEXTURE_BYTES)
    }

    // Preserve the CPU capture path's existing 512 MiB mapped-buffer limit.
    // A large source rejected by the presentation budget must still support JPEG.
    pub fn copy_for_readback(
        frame: &scap_direct3d::Frame,
        crop: Option<D3D11_BOX>,
        reusable: Option<Self>,
    ) -> Result<Self, String> {
        Self::copy_bounded(frame, crop, reusable, MAX_READBACK_BYTES)
    }

    fn copy_bounded(
        frame: &scap_direct3d::Frame,
        crop: Option<D3D11_BOX>,
        reusable: Option<Self>,
        limit: u64,
    ) -> Result<Self, String> {
        let mut desc = D3D11_TEXTURE2D_DESC::default();
        unsafe { frame.texture().GetDesc(&mut desc) };
        let region = texture_region(&desc, frame.width(), frame.height(), crop)?;
        desc.Width = region.right - region.left;
        desc.Height = region.bottom - region.top;
        validate_texture(&desc, limit)?;
        let mut output = match reusable {
            Some(previous)
                if previous.width == desc.Width
                    && previous.height == desc.Height
                    && previous.device == *frame.d3d_device()
                    && previous.context == *frame.d3d_context() =>
            {
                previous
            }
            _ => {
                // Protection persists on this context; retained copies prove it was
                // enabled already. A new context must establish it before publishing.
                let guard: ID3D11Multithread =
                    frame.d3d_context().cast().map_err(|e| e.to_string())?;
                let _ = unsafe { guard.SetMultithreadProtected(true) };
                desc.Usage = D3D11_USAGE_DEFAULT;
                desc.BindFlags = (D3D11_BIND_RENDER_TARGET.0 | D3D11_BIND_SHADER_RESOURCE.0) as u32;
                desc.CPUAccessFlags = 0;
                desc.MiscFlags = 0;
                let mut texture = None;
                unsafe {
                    frame
                        .d3d_device()
                        .CreateTexture2D(&desc, None, Some(&mut texture))
                }
                .map_err(|e| e.to_string())?;
                Self {
                    copy_id: 0,
                    texture: texture.ok_or("GPU copy texture missing")?,
                    device: frame.d3d_device().clone(),
                    context: frame.d3d_context().clone(),
                    width: desc.Width,
                    height: desc.Height,
                    captured_at_ms: 0,
                }
            }
        };
        unsafe {
            frame.d3d_context().CopySubresourceRegion(
                &output.texture,
                0,
                0,
                0,
                0,
                frame.texture(),
                0,
                Some(&region),
            )
        };
        output.captured_at_ms = crate::live_capture_now_ms();
        // Texture reuse and millisecond timestamps cannot identify immutable content.
        output.copy_id = NEXT_COPY.fetch_add(1, Ordering::Relaxed);
        Ok(output)
    }
}

pub(super) fn region_dimensions(
    frame: &scap_direct3d::Frame,
    crop: Option<D3D11_BOX>,
) -> Result<(u32, u32), String> {
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { frame.texture().GetDesc(&mut desc) };
    let region = texture_region(&desc, frame.width(), frame.height(), crop)?;
    Ok((region.right - region.left, region.bottom - region.top))
}

fn texture_region(
    desc: &D3D11_TEXTURE2D_DESC,
    width: u32,
    height: u32,
    crop: Option<D3D11_BOX>,
) -> Result<D3D11_BOX, String> {
    let region = crop.unwrap_or(D3D11_BOX {
        left: 0,
        top: 0,
        front: 0,
        right: width,
        bottom: height,
        back: 1,
    });
    if region.left >= region.right
        || region.top >= region.bottom
        || region.front != 0
        || region.back != 1
        || region.right > width.min(desc.Width)
        || region.bottom > height.min(desc.Height)
    {
        return Err("GPU capture region exceeds current source texture".to_string());
    }
    Ok(region)
}

fn validate_texture(desc: &D3D11_TEXTURE2D_DESC, limit: u64) -> Result<(), String> {
    if desc.Width == 0
        || desc.Height == 0
        || u64::from(desc.Width) * u64::from(desc.Height) > limit / 4
        || desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM
        || desc.SampleDesc.Count != 1
        || desc.ArraySize != 1
        || desc.MipLevels != 1
    {
        return Err("GPU preview requires a bounded single-sample BGRA8 texture".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC;

    #[test]
    fn texture_budget_and_format_fail_closed() {
        let mut desc = D3D11_TEXTURE2D_DESC {
            Width: 1920,
            Height: 1080,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            ..Default::default()
        };
        assert!(validate_texture(&desc, MAX_TEXTURE_BYTES).is_ok());
        desc.Width = 7680;
        desc.Height = 4320;
        assert!(validate_texture(&desc, MAX_TEXTURE_BYTES).is_err());
        assert!(validate_texture(&desc, MAX_READBACK_BYTES).is_ok());
        desc.Width = u32::MAX;
        desc.Height = u32::MAX;
        assert!(validate_texture(&desc, MAX_READBACK_BYTES).is_err());
        desc.Width = 100;
        desc.Height = 100;
        desc.SampleDesc.Count = 4;
        assert!(validate_texture(&desc, MAX_TEXTURE_BYTES).is_err());
    }

    #[test]
    fn shared_source_crop_is_bounded_by_both_texture_and_content() {
        let mut desc = D3D11_TEXTURE2D_DESC {
            Width: 1000,
            Height: 800,
            ..Default::default()
        };
        let region = D3D11_BOX {
            left: 10,
            top: 20,
            front: 0,
            right: 60,
            bottom: 70,
            back: 1,
        };
        assert!(texture_region(&desc, 1000, 800, Some(region)).is_ok());
        assert!(texture_region(&desc, 50, 800, Some(region)).is_err());
        desc.Width = 50;
        assert!(texture_region(&desc, 1000, 800, Some(region)).is_err());
        assert!(texture_region(&desc, 0, 0, None).is_err());
        let invalid = D3D11_BOX { back: 2, ..region };
        assert!(texture_region(&desc, 1000, 800, Some(invalid)).is_err());
    }
}
