//! Small lease-aware pool of CPU-readable staging textures.

use std::sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}};

use windows::{
    Win32::{
        Foundation::{E_FAIL, E_POINTER},
        Graphics::{
            Direct3D11::{
                D3D11_CPU_ACCESS_READ, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, ID3D11Device,
                ID3D11Texture2D,
            },
            Dxgi::Common::DXGI_SAMPLE_DESC,
        },
    },
    core::Error,
};

use crate::PixelFormat;

const STAGING_POOL_SIZE: usize = 3;

struct PooledStagingTexture {
    texture: ID3D11Texture2D,
    width: u32,
    height: u32,
    in_use: bool,
}

pub(crate) struct StagingTexturePool {
    textures: Mutex<Vec<PooledStagingTexture>>,
    d3d_device: ID3D11Device,
    pixel_format: PixelFormat,
    next_index: AtomicUsize,
}

pub(crate) struct StagingTextureLease {
    texture: ID3D11Texture2D,
    pool: Arc<StagingTexturePool>,
    index: usize,
}

impl StagingTexturePool {
    pub(crate) fn new(d3d_device: ID3D11Device, pixel_format: PixelFormat) -> Self {
        Self {
            textures: Mutex::new(Vec::with_capacity(STAGING_POOL_SIZE)),
            d3d_device,
            pixel_format,
            next_index: AtomicUsize::new(0),
        }
    }

    pub(crate) fn acquire(
        self: &Arc<Self>,
        width: u32,
        height: u32,
    ) -> windows::core::Result<StagingTextureLease> {
        let mut textures = self
            .textures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let start = self.next_index.fetch_add(1, Ordering::Relaxed) % STAGING_POOL_SIZE;
        let index = (0..textures.len())
            .map(|offset| (start + offset) % textures.len())
            .find(|index| !textures[*index].in_use)
            .or_else(|| (textures.len() < STAGING_POOL_SIZE).then_some(textures.len()))
            .ok_or_else(|| Error::new(E_FAIL, "all staging textures are currently mapped"))?;

        if index == textures.len() {
            textures.push(PooledStagingTexture {
                texture: self.create_texture(width, height)?,
                width,
                height,
                in_use: true,
            });
        } else {
            let pooled = &mut textures[index];
            if pooled.width != width || pooled.height != height {
                pooled.texture = self.create_texture(width, height)?;
                pooled.width = width;
                pooled.height = height;
            }
            pooled.in_use = true;
        }
        Ok(StagingTextureLease {
            texture: textures[index].texture.clone(),
            pool: self.clone(),
            index,
        })
    }

    fn create_texture(
        &self,
        width: u32,
        height: u32,
    ) -> windows::core::Result<ID3D11Texture2D> {
        let texture_desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: self.pixel_format.as_dxgi(),
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };
        let mut texture = None;
        unsafe {
            self.d3d_device
                .CreateTexture2D(&texture_desc, None, Some(&mut texture))?;
        }
        texture.ok_or_else(|| Error::new(E_POINTER, "D3D11 returned no staging texture"))
    }

    fn release(&self, index: usize) {
        let mut textures = self
            .textures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(texture) = textures.get_mut(index) {
            texture.in_use = false;
        }
    }
}

impl StagingTextureLease {
    pub(crate) fn texture(&self) -> &ID3D11Texture2D {
        &self.texture
    }
}

impl Drop for StagingTextureLease {
    fn drop(&mut self) {
        self.pool.release(self.index);
    }
}
