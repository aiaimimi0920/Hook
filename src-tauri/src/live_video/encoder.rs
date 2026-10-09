//! 单线程连续硬件编码 owner；只跳未编码输入，已接受输入必须产出或销毁整条参考链。
use super::{
    annex_b,
    gpu::Gpu,
    media,
    runtime::{Activations, Runtime, Transform},
    Format,
};
use anyhow::{ensure, Context, Result};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use windows::{
    core::Interface,
    Win32::{Graphics::Direct3D11::*, Media::MediaFoundation::*, System::Variant::VARIANT},
};

pub struct Packet {
    pub bytes: Vec<u8>,
    pub keyframe: bool,
    pub timestamp: i64,
}

pub struct Encoder {
    transform: Transform,
    codec: ICodecAPI,
    events: IMFMediaEventGenerator,
    gpu: Gpu,
    format: Format,
    name: String,
    sequence: u64,
    credits: u32,
    failed: bool,
    // COM/MF 必须比所有 MFT、device manager 和纹理晚释放。
    _runtime: Runtime,
}

impl Encoder {
    pub fn new(device: ID3D11Device, format: Format) -> Result<Self> {
        let format = Format::new(format.width, format.height, format.fps)?;
        let runtime = Runtime::start()?;
        let gpu = Gpu::new(device, format)?;
        let mut list = Activations::default();
        unsafe {
            let input = MFT_REGISTER_TYPE_INFO {
                guidMajorType: MFMediaType_Video,
                guidSubtype: MFVideoFormat_NV12,
            };
            let output = MFT_REGISTER_TYPE_INFO {
                guidMajorType: MFMediaType_Video,
                guidSubtype: MFVideoFormat_H264,
            };
            MFTEnum2(
                MFT_CATEGORY_VIDEO_ENCODER,
                MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
                Some(&input),
                Some(&output),
                &gpu.enumeration,
                &mut list.ptr,
                &mut list.count,
            )?;
            ensure!(
                !list.ptr.is_null() && list.count > 0 && list.count <= 64,
                "no bounded hardware encoder inventory"
            );
            let activation = (*list.ptr)
                .as_ref()
                .context("empty hardware activation")?
                .clone();
            activation.GetItemType(&MFT_ENUM_HARDWARE_URL_Attribute)?;
            let length = activation.GetStringLength(&MFT_FRIENDLY_NAME_Attribute)?;
            ensure!(length <= 512, "encoder name too long");
            let mut name = vec![0; length as usize + 1];
            activation.GetString(&MFT_FRIENDLY_NAME_Attribute, &mut name, None)?;
            let name = String::from_utf16_lossy(&name[..length as usize]);
            let transform = Transform {
                transform: activation.ActivateObject()?,
                activation,
            };
            let attrs = transform.transform.GetAttributes()?;
            ensure!(
                attrs.GetUINT32(&MF_TRANSFORM_ASYNC)? == 1
                    && attrs.GetUINT32(&MF_SA_D3D11_AWARE)? == 1,
                "encoder requires asynchronous D3D11 input"
            );
            attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)?;
            attrs.SetUINT32(&MF_LOW_LATENCY, 1)?;
            transform
                .transform
                .ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, gpu.manager.as_raw() as usize)?;
            let codec: ICodecAPI = transform.transform.cast()?;
            codec.SetValue(&CODECAPI_AVLowLatencyMode, &VARIANT::from(true))?;
            codec.SetValue(&CODECAPI_AVEncMPVGOPSize, &VARIANT::from(format.fps * 2))?;
            transform.transform.SetOutputType(
                0,
                &media::media_type(format, &MFVideoFormat_H264)?,
                0,
            )?;
            transform.transform.SetInputType(
                0,
                &media::media_type(format, &MFVideoFormat_NV12)?,
                0,
            )?;
            transform
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            transform
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
            let events = transform.transform.cast()?;
            Ok(Self {
                transform,
                codec,
                events,
                gpu,
                format,
                name,
                sequence: 0,
                credits: 0,
                failed: false,
                _runtime: runtime,
            })
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }
    pub fn format(&self) -> Format {
        self.format
    }

    pub fn encode(
        &mut self,
        bgra: &ID3D11Texture2D,
        force_keyframe: bool,
        stop: &AtomicBool,
    ) -> Result<Packet> {
        ensure!(!self.failed, "encoder reference chain already failed");
        let result = self.encode_inner(bgra, force_keyframe, stop);
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    fn encode_inner(
        &mut self,
        bgra: &ID3D11Texture2D,
        force_keyframe: bool,
        stop: &AtomicBool,
    ) -> Result<Packet> {
        ensure!(!stop.load(Ordering::Acquire), "video encoding cancelled");
        let timestamp = self
            .sequence
            .checked_mul(self.format.duration() as u64)
            .and_then(|value| i64::try_from(value).ok())
            .context("encoder timeline exhausted")?;
        let deadline = Instant::now() + Duration::from_secs(2);
        let sample = self.gpu.sample(bgra, timestamp)?;
        let require_keyframe = force_keyframe || self.sequence == 0;
        let mut submitted = false;
        loop {
            ensure!(!stop.load(Ordering::Acquire), "video encoding cancelled");
            ensure!(
                Instant::now() < deadline,
                "hardware encode deadline exceeded"
            );
            unsafe {
                if !submitted && self.credits > 0 {
                    if require_keyframe {
                        self.codec
                            .SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &VARIANT::from(1_u32))?;
                    }
                    self.transform.transform.ProcessInput(0, &sample, 0)?;
                    self.credits -= 1;
                    submitted = true;
                }
                match self.events.GetEvent(MF_EVENT_FLAG_NO_WAIT) {
                    Ok(event) => {
                        event.GetStatus()?.ok()?;
                        match event.GetType()? {
                            kind if kind == METransformNeedInput.0 as u32 => {
                                self.credits += 1;
                                ensure!(self.credits <= 64, "unbounded encoder input credits");
                            }
                            kind if kind == METransformHaveOutput.0 as u32 => {
                                if let Some(output) = media::receive(&self.transform.transform)? {
                                    ensure!(
                                        submitted && output.GetSampleTime()? == timestamp,
                                        "encoder output reordered"
                                    );
                                    let bytes = media::read(&output)?;
                                    let nal = annex_b::inspect(&bytes)?;
                                    let keyframe = nal.idr && nal.sps && nal.pps;
                                    ensure!(
                                        nal.idr || nal.delta,
                                        "encoder output lacks coded picture"
                                    );
                                    ensure!(
                                        !require_keyframe || keyframe,
                                        "requested IDR lacks SPS/PPS"
                                    );
                                    self.sequence = self
                                        .sequence
                                        .checked_add(1)
                                        .context("encoder sequence exhausted")?;
                                    return Ok(Packet {
                                        bytes,
                                        keyframe,
                                        timestamp,
                                    });
                                }
                            }
                            _ => {}
                        }
                    }
                    Err(error) if error.code() == MF_E_NO_EVENTS_AVAILABLE => {
                        std::thread::sleep(Duration::from_millis(1))
                    }
                    Err(error) => return Err(error.into()),
                }
            }
        }
    }
}
