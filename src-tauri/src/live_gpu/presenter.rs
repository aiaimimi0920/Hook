//! Thread-affine DirectComposition resources. No DOM, input, CPU map, or JPEG work.

use std::collections::HashMap;
use windows::core::Interface;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;
use windows::Win32::Graphics::DirectComposition::{
    DCompositionCreateDevice, IDCompositionDevice, IDCompositionScaleTransform,
    IDCompositionTarget, IDCompositionVisual,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_ALPHA_MODE_IGNORE, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC,
};
use windows::Win32::Graphics::Dxgi::{
    IDXGIDevice, IDXGIFactory2, IDXGISwapChain1, DXGI_ERROR_WAS_STILL_DRAWING,
    DXGI_PRESENT_DO_NOT_WAIT, DXGI_SCALING_STRETCH, DXGI_SWAP_CHAIN_DESC1,
    DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL, DXGI_USAGE_RENDER_TARGET_OUTPUT,
};

use super::{frame::GpuFrame, Layout};

struct Surface {
    pending_copy: PendingCopy,
    swapchain: IDXGISwapChain1,
    visual: IDCompositionVisual,
    scale: IDCompositionScaleTransform,
    clip: windows::Win32::Graphics::DirectComposition::IDCompositionRectangleClip,
    width: u32,
    height: u32,
    layout: Layout,
}

#[derive(Default)]
struct PendingCopy(Option<u64>);

impl PendingCopy {
    fn needs_copy(&self, copy_id: u64) -> bool {
        self.0 != Some(copy_id)
    }

    fn copied(&mut self, copy_id: u64) {
        self.0 = Some(copy_id);
    }

    fn presented(&mut self) {
        self.0 = None;
    }
}

pub(super) struct Presenter {
    composition: IDCompositionDevice,
    _target: IDCompositionTarget,
    root: IDCompositionVisual,
    surfaces: HashMap<String, Surface>,
}

impl Presenter {
    pub fn new(hwnd: usize, frame: &GpuFrame) -> windows::core::Result<Self> {
        unsafe {
            let device: IDXGIDevice = frame.device.cast()?;
            let composition: IDCompositionDevice = DCompositionCreateDevice(&device)?;
            // The experimental plane is above WebView child HWNDs. The frontend
            // must suspend it for edits, overlap, and any unsupported decoration.
            let target = composition.CreateTargetForHwnd(HWND(hwnd as *mut _), true)?;
            let root = composition.CreateVisual()?;
            target.SetRoot(&root)?;
            composition.Commit()?;
            Ok(Self {
                composition,
                _target: target,
                root,
                surfaces: HashMap::new(),
            })
        }
    }

    pub fn present(
        &mut self,
        id: &str,
        layout: Layout,
        frame: &GpuFrame,
    ) -> windows::core::Result<bool> {
        if self
            .surfaces
            .get(id)
            .is_some_and(|s| (s.width, s.height) != (frame.width, frame.height))
        {
            self.remove(id)?;
        }
        if !self.surfaces.contains_key(id) {
            let surface = self.create_surface(layout, frame)?;
            self.surfaces.insert(id.to_string(), surface);
        }
        let surface = self.surfaces.get_mut(id).expect("inserted GPU surface");
        unsafe {
            if surface.layout != layout {
                Self::set_layout(surface, layout)?;
                self.composition.Commit()?;
            }
            if surface.pending_copy.needs_copy(frame.copy_id) {
                let backbuffer: ID3D11Texture2D = surface.swapchain.GetBuffer(0)?;
                frame.context.CopyResource(&backbuffer, &frame.texture);
                surface.pending_copy.copied(frame.copy_id);
            }
            // Do not block a producer behind display vsync or accumulate a FIFO.
            let result = surface.swapchain.Present(0, DXGI_PRESENT_DO_NOT_WAIT);
            if result == DXGI_ERROR_WAS_STILL_DRAWING {
                return Ok(false);
            }
            result.ok()?;
            // A successful flip changes the backbuffer; busy retries do not.
            surface.pending_copy.presented();
        }
        Ok(true)
    }

    fn create_surface(&self, layout: Layout, frame: &GpuFrame) -> windows::core::Result<Surface> {
        unsafe {
            let device: IDXGIDevice = frame.device.cast()?;
            let factory: IDXGIFactory2 = device.GetAdapter()?.GetParent()?;
            let desc = DXGI_SWAP_CHAIN_DESC1 {
                Width: frame.width,
                Height: frame.height,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
                BufferCount: 2,
                Scaling: DXGI_SCALING_STRETCH,
                SwapEffect: DXGI_SWAP_EFFECT_FLIP_SEQUENTIAL,
                AlphaMode: DXGI_ALPHA_MODE_IGNORE,
                ..Default::default()
            };
            let swapchain = factory.CreateSwapChainForComposition(&frame.device, &desc, None)?;
            let visual = self.composition.CreateVisual()?;
            let scale = self.composition.CreateScaleTransform()?;
            let clip = self.composition.CreateRectangleClip()?;
            visual.SetContent(&swapchain)?;
            visual.SetTransform(&scale)?;
            visual.SetClip(&clip)?;
            let mut surface = Surface {
                pending_copy: PendingCopy::default(),
                swapchain,
                visual,
                scale,
                clip,
                width: frame.width,
                height: frame.height,
                layout,
            };
            Self::set_layout(&mut surface, layout)?;
            self.root.AddVisual(&surface.visual, true, None)?;
            self.composition.Commit()?;
            Ok(surface)
        }
    }

    unsafe fn set_layout(surface: &mut Surface, layout: Layout) -> windows::core::Result<()> {
        unsafe {
            surface
                .scale
                .SetScaleX2(layout.width / surface.width as f32)?;
            surface
                .scale
                .SetScaleY2(layout.height / surface.height as f32)?;
            surface.visual.SetOffsetX2(layout.x)?;
            surface.visual.SetOffsetY2(layout.y)?;
            let inset_x = layout.inset * surface.width as f32 / layout.width;
            let inset_y = layout.inset * surface.height as f32 / layout.height;
            surface.clip.SetLeft2(inset_x)?;
            surface.clip.SetTop2(inset_y)?;
            surface.clip.SetRight2(surface.width as f32 - inset_x)?;
            surface.clip.SetBottom2(surface.height as f32 - inset_y)?;
        }
        surface.layout = layout;
        Ok(())
    }

    pub fn retain(&mut self, active: &[String]) -> windows::core::Result<()> {
        let removed: Vec<_> = self
            .surfaces
            .keys()
            .filter(|id| !active.contains(id))
            .cloned()
            .collect();
        for id in removed {
            self.remove(&id)?;
        }
        Ok(())
    }

    fn remove(&mut self, id: &str) -> windows::core::Result<()> {
        if let Some(surface) = self.surfaces.remove(id) {
            unsafe {
                self.root.RemoveVisual(&surface.visual)?;
                self.composition.Commit()?;
            }
        }
        Ok(())
    }
}

impl Drop for Presenter {
    fn drop(&mut self) {
        unsafe {
            let _ = self.root.RemoveAllVisuals();
            let _ = self.composition.Commit();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::PendingCopy;

    #[test]
    fn busy_retry_skips_copy_but_new_content_and_successful_flip_require_it() {
        let mut pending = PendingCopy::default();
        assert!(pending.needs_copy(1));
        pending.copied(1);
        for _ in 0..10 {
            assert!(!pending.needs_copy(1));
        }
        assert!(pending.needs_copy(2));
        pending.copied(2);
        assert!(!pending.needs_copy(2));
        assert!(pending.needs_copy(1));
        pending.presented();
        assert!(pending.needs_copy(2));
    }
}
