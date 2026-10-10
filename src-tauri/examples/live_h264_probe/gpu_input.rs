//! GPU 清屏生成 BGRA，再由 video processor 转 NV12；每帧独立纹理，绝不提前复用。
use super::{gpu_device::GpuDevice, samples};
use anyhow::{ensure, Context, Result};
use std::mem::ManuallyDrop;
use windows::{
    core::Interface,
    Win32::{
        Graphics::{Direct3D11::*, Dxgi::Common::*},
        Media::MediaFoundation::*,
    },
};

pub struct GpuInput {
    pub gpu: GpuDevice,
    video: ID3D11VideoDevice,
    context: ID3D11VideoContext1,
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
}

impl GpuInput {
    pub fn create() -> Result<Self> {
        let gpu = GpuDevice::create()?;
        unsafe {
            let video: ID3D11VideoDevice = gpu.device.cast()?;
            let context: ID3D11VideoContext1 = gpu.context.cast()?;
            let rate = DXGI_RATIONAL {
                Numerator: samples::FPS,
                Denominator: 1,
            };
            let enumerator =
                video.CreateVideoProcessorEnumerator(&D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                    InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                    InputFrameRate: rate,
                    OutputFrameRate: rate,
                    InputWidth: samples::WIDTH,
                    InputHeight: samples::HEIGHT,
                    OutputWidth: samples::WIDTH,
                    OutputHeight: samples::HEIGHT,
                    Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
                })?;
            let conversion: ID3D11VideoProcessorEnumerator1 = enumerator.cast()?;
            ensure!(
                conversion
                    .CheckVideoProcessorFormatConversion(
                        DXGI_FORMAT_B8G8R8A8_UNORM,
                        DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
                        DXGI_FORMAT_NV12,
                        DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709
                    )?
                    .as_bool(),
                "BGRA full-range to NV12 BT709 limited-range conversion unsupported"
            );
            let processor = video.CreateVideoProcessor(&enumerator, 0)?;
            context.VideoProcessorSetStreamFrameFormat(
                &processor,
                0,
                D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            );
            context.VideoProcessorSetStreamAutoProcessingMode(&processor, 0, false);
            context.VideoProcessorSetStreamColorSpace1(
                &processor,
                0,
                DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
            );
            context.VideoProcessorSetOutputColorSpace1(
                &processor,
                DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
            );
            Ok(Self {
                gpu,
                video,
                context,
                enumerator,
                processor,
            })
        }
    }

    fn texture(&self, format: DXGI_FORMAT) -> Result<ID3D11Texture2D> {
        let mut texture = None;
        unsafe {
            self.gpu.device.CreateTexture2D(
                &D3D11_TEXTURE2D_DESC {
                    Width: samples::WIDTH,
                    Height: samples::HEIGHT,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: format,
                    SampleDesc: DXGI_SAMPLE_DESC {
                        Count: 1,
                        Quality: 0,
                    },
                    Usage: D3D11_USAGE_DEFAULT,
                    BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
                    ..Default::default()
                },
                None,
                Some(&mut texture),
            )?;
        }
        texture.context("GPU input texture missing")
    }

    pub fn sample(&self, index: usize) -> Result<IMFSample> {
        ensure!(
            index < samples::FRAME_COUNT,
            "GPU fixture index out of bounds"
        );
        unsafe {
            let bgra = self.texture(DXGI_FORMAT_B8G8R8A8_UNORM)?;
            let nv12 = self.texture(DXGI_FORMAT_NV12)?;
            let mut render = None;
            self.gpu
                .device
                .CreateRenderTargetView(&bgra, None, Some(&mut render))?;
            let level = (32 + index * 4) as f32 / 255.0;
            self.gpu.context.ClearRenderTargetView(
                &render.context("BGRA render view missing")?,
                &[level, level, level, 1.0],
            );
            let mut input = None;
            self.video.CreateVideoProcessorInputView(
                &bgra,
                &self.enumerator,
                &D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
                    ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D,
                    ..Default::default()
                },
                Some(&mut input),
            )?;
            let mut output = None;
            self.video.CreateVideoProcessorOutputView(
                &nv12,
                &self.enumerator,
                &D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
                    ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2D,
                    ..Default::default()
                },
                Some(&mut output),
            )?;
            let output = output.context("video output view missing")?;
            let mut stream = D3D11_VIDEO_PROCESSOR_STREAM {
                Enable: true.into(),
                pInputSurface: ManuallyDrop::new(Some(input.context("video input view missing")?)),
                ..Default::default()
            };
            // ManuallyDrop ABI 字段必须在 Blt 成功与失败时都释放。
            let result = self.context.VideoProcessorBlt(
                &self.processor,
                &output,
                0,
                std::slice::from_ref(&stream),
            );
            drop(ManuallyDrop::take(&mut stream.pInputSurface));
            result?;
            self.gpu.context.Flush();
            let buffer = MFCreateDXGISurfaceBuffer(&ID3D11Texture2D::IID, &nv12, 0, false)?;
            let sample = MFCreateSample()?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(index as i64 * samples::DURATION)?;
            sample.SetSampleDuration(samples::DURATION)?;
            // MF buffer 保有 NV12 COM 引用。即便异步 MFT 延迟释放，也不会覆盖同一纹理。
            Ok(sample)
        }
    }
}
