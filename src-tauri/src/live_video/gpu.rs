//! 复用捕获设备，不跨 adapter；BGRA 到 NV12 转换结果归独立 MF sample 所有。
use super::Format;
use anyhow::{ensure, Context, Result};
use std::mem::ManuallyDrop;
use windows::{
    core::Interface,
    Win32::{
        Graphics::{
            Direct3D11::*,
            Dxgi::{Common::*, *},
        },
        Media::MediaFoundation::*,
    },
};

pub(super) struct Gpu {
    pub device: ID3D11Device,
    pub manager: IMFDXGIDeviceManager,
    pub enumeration: IMFAttributes,
    context: ID3D11DeviceContext,
    video: ID3D11VideoDevice,
    video_context: ID3D11VideoContext1,
    enumerator: ID3D11VideoProcessorEnumerator,
    processor: ID3D11VideoProcessor,
    format: Format,
}

impl Gpu {
    pub fn new(device: ID3D11Device, format: Format) -> Result<Self> {
        unsafe {
            let context = device.GetImmediateContext()?;
            let guard: ID3D11Multithread = context.cast()?;
            let _ = guard.SetMultithreadProtected(true);
            ensure!(
                guard.GetMultithreadProtected().as_bool(),
                "D3D11 thread protection missing"
            );
            let dxgi: IDXGIDevice = device.cast()?;
            let adapter: IDXGIAdapter1 = dxgi.GetAdapter()?.cast()?;
            let desc = adapter.GetDesc1()?;
            ensure!(
                desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 == 0,
                "software adapter rejected"
            );
            let mut manager = None;
            let mut token = 0;
            MFCreateDXGIDeviceManager(&mut token, &mut manager)?;
            let manager = manager.context("DXGI manager missing")?;
            manager.ResetDevice(&device, token)?;
            let mut enumeration = None;
            MFCreateAttributes(&mut enumeration, 1)?;
            let enumeration = enumeration.context("MFT enumeration attributes missing")?;
            let luid = desc.AdapterLuid;
            enumeration.SetUINT64(
                &MFT_ENUM_ADAPTER_LUID,
                (u64::from(luid.HighPart as u32) << 32) | u64::from(luid.LowPart),
            )?;
            let video: ID3D11VideoDevice = device.cast()?;
            let video_context: ID3D11VideoContext1 = context.cast()?;
            let rate = DXGI_RATIONAL {
                Numerator: format.fps,
                Denominator: 1,
            };
            let enumerator =
                video.CreateVideoProcessorEnumerator(&D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
                    InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
                    InputFrameRate: rate,
                    OutputFrameRate: rate,
                    InputWidth: format.width,
                    InputHeight: format.height,
                    OutputWidth: format.width,
                    OutputHeight: format.height,
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
                "GPU color conversion unsupported"
            );
            let processor = video.CreateVideoProcessor(&enumerator, 0)?;
            video_context.VideoProcessorSetStreamFrameFormat(
                &processor,
                0,
                D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            );
            video_context.VideoProcessorSetStreamAutoProcessingMode(&processor, 0, false);
            video_context.VideoProcessorSetStreamColorSpace1(
                &processor,
                0,
                DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709,
            );
            video_context.VideoProcessorSetOutputColorSpace1(
                &processor,
                DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709,
            );
            Ok(Self {
                device,
                manager,
                enumeration,
                context,
                video,
                video_context,
                enumerator,
                processor,
                format,
            })
        }
    }

    pub fn sample(&self, bgra: &ID3D11Texture2D, timestamp: i64) -> Result<IMFSample> {
        unsafe {
            let mut desc = D3D11_TEXTURE2D_DESC::default();
            bgra.GetDesc(&mut desc);
            ensure!(
                bgra.GetDevice()? == self.device
                    && desc.Width == self.format.width
                    && desc.Height == self.format.height
                    && desc.Format == DXGI_FORMAT_B8G8R8A8_UNORM
                    && desc.ArraySize == 1
                    && desc.MipLevels == 1
                    && desc.SampleDesc.Count == 1,
                "capture texture format or device changed"
            );
            let mut nv12 = None;
            desc.Format = DXGI_FORMAT_NV12;
            desc.Usage = D3D11_USAGE_DEFAULT;
            desc.BindFlags = D3D11_BIND_RENDER_TARGET.0 as u32;
            desc.CPUAccessFlags = 0;
            desc.MiscFlags = 0;
            self.device.CreateTexture2D(&desc, None, Some(&mut nv12))?;
            let nv12 = nv12.context("NV12 texture missing")?;
            let mut input = None;
            self.video.CreateVideoProcessorInputView(
                bgra,
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
            let result = self.video_context.VideoProcessorBlt(
                &self.processor,
                &output,
                0,
                std::slice::from_ref(&stream),
            );
            drop(ManuallyDrop::take(&mut stream.pInputSurface));
            result?;
            self.context.Flush();
            let sample = MFCreateSample()?;
            sample.AddBuffer(&MFCreateDXGISurfaceBuffer(
                &ID3D11Texture2D::IID,
                &nv12,
                0,
                false,
            )?)?;
            sample.SetSampleTime(timestamp)?;
            sample.SetSampleDuration(self.format.duration())?;
            Ok(sample)
        }
    }
}
