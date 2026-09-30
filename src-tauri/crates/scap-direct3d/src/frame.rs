//! Captured frame access and safe lifetime management for mapped CPU buffers.

use std::sync::Arc;

use windows::{
    Graphics::Capture::Direct3D11CaptureFrame,
    Win32::{
        Foundation::{E_INVALIDARG, E_POINTER},
        Graphics::Direct3D11::{
            D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE, ID3D11Device, ID3D11DeviceContext,
            ID3D11Texture2D,
        },
    },
    core::Error,
};

use crate::{
    PixelFormat,
    staging_pool::{StagingTextureLease, StagingTexturePool},
};

const MAX_MAPPED_FRAME_BUFFER_BYTES: usize = 512 * 1024 * 1024;

pub struct Frame {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) pixel_format: PixelFormat,
    pub(crate) inner: Direct3D11CaptureFrame,
    pub(crate) texture: ID3D11Texture2D,
    pub(crate) d3d_device: ID3D11Device,
    pub(crate) d3d_context: ID3D11DeviceContext,
    pub(crate) staging_pool: Arc<StagingTexturePool>,
}

impl std::fmt::Debug for Frame {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Frame")
            .field("width", &self.width)
            .field("height", &self.height)
            .finish()
    }
}

impl Frame {
    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn pixel_format(&self) -> PixelFormat {
        self.pixel_format
    }

    pub fn inner(&self) -> &Direct3D11CaptureFrame {
        &self.inner
    }

    pub fn texture(&self) -> &ID3D11Texture2D {
        &self.texture
    }

    pub fn d3d_device(&self) -> &ID3D11Device {
        &self.d3d_device
    }

    pub fn d3d_context(&self) -> &ID3D11DeviceContext {
        &self.d3d_context
    }

    pub fn as_buffer(&self) -> windows::core::Result<FrameBuffer<'_>> {
        let staging_texture = self.staging_pool.acquire(self.width, self.height)?;
        unsafe {
            self.d3d_context
                .CopyResource(staging_texture.texture(), &self.texture);
        }

        let mut mapped_resource = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe {
            self.d3d_context.Map(
                staging_texture.texture(),
                0,
                D3D11_MAP_READ,
                0,
                Some(&mut mapped_resource),
            )?;
        }
        let data_len = match mapped_buffer_len(
            self.width,
            self.height,
            mapped_resource.RowPitch,
            self.pixel_format,
            !mapped_resource.pData.is_null(),
        ) {
            Ok(length) => length,
            Err(error) => {
                unsafe {
                    self.d3d_context.Unmap(staging_texture.texture(), 0);
                }
                return Err(error);
            }
        };
        let data = unsafe { std::slice::from_raw_parts(mapped_resource.pData.cast(), data_len) };

        Ok(FrameBuffer {
            data,
            width: self.width,
            height: self.height,
            stride: mapped_resource.RowPitch,
            pixel_format: self.pixel_format,
            staging_texture,
            d3d_context: self.d3d_context.clone(),
        })
    }
}

fn mapped_buffer_len(
    width: u32,
    height: u32,
    row_pitch: u32,
    pixel_format: PixelFormat,
    has_data: bool,
) -> windows::core::Result<usize> {
    if !has_data {
        return Err(Error::new(E_POINTER, "D3D11 mapped a null frame buffer"));
    }
    let minimum_row_pitch = width
        .checked_mul(pixel_format.bytes_per_pixel())
        .ok_or_else(|| Error::new(E_INVALIDARG, "frame row size overflow"))?;
    if row_pitch < minimum_row_pitch {
        return Err(Error::new(
            E_INVALIDARG,
            "D3D11 mapped row pitch is smaller than the frame width",
        ));
    }
    let length = (height as usize)
        .checked_mul(row_pitch as usize)
        .ok_or_else(|| Error::new(E_INVALIDARG, "mapped frame buffer length overflow"))?;
    if length > MAX_MAPPED_FRAME_BUFFER_BYTES {
        return Err(Error::new(
            E_INVALIDARG,
            "mapped frame buffer exceeds the 512 MiB safety limit",
        ));
    }
    Ok(length)
}

pub struct FrameBuffer<'a> {
    data: &'a [u8],
    width: u32,
    height: u32,
    stride: u32,
    pixel_format: PixelFormat,
    staging_texture: StagingTextureLease,
    d3d_context: ID3D11DeviceContext,
}

impl Drop for FrameBuffer<'_> {
    fn drop(&mut self) {
        unsafe {
            self.d3d_context.Unmap(self.staging_texture.texture(), 0);
        }
    }
}

impl FrameBuffer<'_> {
    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn stride(&self) -> u32 {
        self.stride
    }

    pub fn data(&self) -> &[u8] {
        self.data
    }

    pub fn pixel_format(&self) -> PixelFormat {
        self.pixel_format
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mapped_buffer_layout_rejects_null_short_and_overflowing_rows() {
        assert!(mapped_buffer_len(1, 1, 4, PixelFormat::R8G8B8A8Unorm, false).is_err());
        assert!(mapped_buffer_len(2, 1, 4, PixelFormat::R8G8B8A8Unorm, true).is_err());
        assert!(
            mapped_buffer_len(u32::MAX, 1, u32::MAX, PixelFormat::R16G16B16A16Float, true).is_err()
        );
        assert!(
            mapped_buffer_len(
                1,
                (MAX_MAPPED_FRAME_BUFFER_BYTES as u32 / 4) + 1,
                4,
                PixelFormat::R8G8B8A8Unorm,
                true,
            )
            .is_err()
        );
        assert_eq!(
            mapped_buffer_len(2, 3, 16, PixelFormat::R16G16B16A16Float, true).unwrap(),
            48
        );
    }
}
