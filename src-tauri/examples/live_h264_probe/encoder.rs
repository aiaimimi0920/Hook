//! 硬件限定的异步 MFT 探针。所有等待有截止时间，关闭时释放激活对象及 MF/COM。
use super::{annex_b, gpu_input::GpuInput, samples};
use anyhow::{ensure, Context, Result};
use std::{
    mem::ManuallyDrop,
    time::{Duration, Instant},
};
use windows::{
    core::Interface,
    Win32::{
        Media::MediaFoundation::*,
        System::{Com::*, Variant::VARIANT},
    },
};

struct Runtime;
impl Runtime {
    fn start() -> Result<Self> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
            if let Err(error) = MFStartup(MF_VERSION, MFSTARTUP_FULL) {
                CoUninitialize();
                return Err(error.into());
            }
        }
        Ok(Self)
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        unsafe {
            let _ = MFShutdown();
            CoUninitialize();
        }
    }
}

#[derive(Default)]
struct Activations {
    ptr: *mut Option<IMFActivate>,
    count: u32,
}
impl Drop for Activations {
    fn drop(&mut self) {
        if !self.ptr.is_null() {
            unsafe {
                for slot in std::slice::from_raw_parts_mut(self.ptr, self.count as usize) {
                    drop(slot.take());
                }
                CoTaskMemFree(Some(self.ptr.cast()));
            }
        }
    }
}

struct Encoder {
    activation: IMFActivate,
    transform: IMFTransform,
}
impl Drop for Encoder {
    fn drop(&mut self) {
        unsafe {
            let _ = self.transform.ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0);
            let _ = self
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
            let _ = self.activation.ShutdownObject();
        }
    }
}

pub struct Encoded {
    pub name: String,
    pub bytes: Vec<u8>,
    pub frames: Vec<serde_json::Value>,
}

pub fn run(use_gpu: bool) -> Result<Encoded> {
    let _runtime = Runtime::start()?;
    let gpu = if use_gpu {
        Some(GpuInput::create()?)
    } else {
        None
    };
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
        if let Some(gpu) = &gpu {
            MFTEnum2(
                MFT_CATEGORY_VIDEO_ENCODER,
                MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
                Some(&input),
                Some(&output),
                &gpu.gpu.enumeration,
                &mut list.ptr,
                &mut list.count,
            )?;
        } else {
            MFTEnumEx(
                MFT_CATEGORY_VIDEO_ENCODER,
                MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
                Some(&input),
                Some(&output),
                &mut list.ptr,
                &mut list.count,
            )?;
        }
        ensure!(
            !list.ptr.is_null() && list.count > 0 && list.count <= 64,
            "no bounded hardware H264 encoder inventory"
        );
        let activation = (*list.ptr)
            .as_ref()
            .context("empty hardware activation")?
            .clone();
        activation
            .GetItemType(&MFT_ENUM_HARDWARE_URL_Attribute)
            .context("hardware identity missing")?;
        let length = activation.GetStringLength(&MFT_FRIENDLY_NAME_Attribute)?;
        ensure!(length <= 512, "encoder name too long");
        let mut name = vec![0; length as usize + 1];
        activation.GetString(&MFT_FRIENDLY_NAME_Attribute, &mut name, None)?;
        let name = String::from_utf16_lossy(&name[..length as usize]);
        let transform: IMFTransform = activation.ActivateObject()?;
        let encoder = Encoder {
            activation,
            transform,
        };
        let attrs = encoder.transform.GetAttributes()?;
        ensure!(
            attrs.GetUINT32(&MF_TRANSFORM_ASYNC)? == 1,
            "hardware encoder must be asynchronous"
        );
        attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)?;
        attrs.SetUINT32(&MF_LOW_LATENCY, 1)?;
        if let Some(gpu) = &gpu {
            gpu.gpu.attach(&encoder.transform)?;
        }
        let codec: ICodecAPI = encoder.transform.cast()?;
        codec.SetValue(&CODECAPI_AVLowLatencyMode, &VARIANT::from(true))?;
        codec.SetValue(&CODECAPI_AVEncMPVGOPSize, &VARIANT::from(60_u32))?;
        encoder
            .transform
            .SetOutputType(0, &samples::media_type(&MFVideoFormat_H264)?, 0)?;
        encoder
            .transform
            .SetInputType(0, &samples::media_type(&MFVideoFormat_NV12)?, 0)?;
        encoder
            .transform
            .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
        encoder
            .transform
            .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        encode(&encoder.transform, &codec, name, gpu.as_ref())
    }
}

fn receive(transform: &IMFTransform) -> Result<Option<IMFSample>> {
    unsafe {
        let info = transform.GetOutputStreamInfo(0)?;
        let sample = if info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 == 0 {
            Some(samples::output_sample(info.cbSize.max(4096))?)
        } else {
            None
        };
        let mut buffer = MFT_OUTPUT_DATA_BUFFER {
            dwStreamID: 0,
            pSample: ManuallyDrop::new(sample),
            ..Default::default()
        };
        let mut status = 0;
        let result = transform.ProcessOutput(0, std::slice::from_mut(&mut buffer), &mut status);
        // windows 的 ABI 结构使用 ManuallyDrop；成功和错误路径都必须接回 COM 引用所有权。
        drop(ManuallyDrop::take(&mut buffer.pEvents));
        let sample = ManuallyDrop::take(&mut buffer.pSample);
        match result {
            Ok(()) => Ok(sample),
            Err(error) if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => Ok(None),
            Err(error) => Err(error.into()),
        }
    }
}

fn encode(
    transform: &IMFTransform,
    codec: &ICodecAPI,
    name: String,
    gpu: Option<&GpuInput>,
) -> Result<Encoded> {
    let events: IMFMediaEventGenerator = transform.cast()?;
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut sent = 0;
    let mut credits = 0_usize;
    let mut draining = false;
    let mut encoded = Encoded {
        name,
        bytes: Vec::new(),
        frames: Vec::new(),
    };
    while encoded.frames.len() < samples::FRAME_COUNT {
        ensure!(
            Instant::now() < deadline,
            "hardware encode deadline exceeded: sent={sent}, received={}",
            encoded.frames.len()
        );
        unsafe {
            match events.GetEvent(MF_EVENT_FLAG_NO_WAIT) {
                Ok(event) => {
                    event.GetStatus()?.ok()?;
                    match event.GetType()? {
                        kind if kind == METransformNeedInput.0 as u32 => {
                            credits += 1;
                            ensure!(credits <= 64, "unbounded input event credits");
                        }
                        kind if kind == METransformHaveOutput.0 as u32 => {
                            if let Some(sample) = receive(transform)? {
                                let bytes = samples::read(&sample)?;
                                let nal = annex_b::inspect(&bytes)?;
                                ensure!(
                                    nal.idr || nal.delta,
                                    "output must contain a coded picture"
                                );
                                let timestamp = sample.GetSampleTime()?;
                                ensure!(
                                    timestamp == encoded.frames.len() as i64 * samples::DURATION,
                                    "unexpected output reorder or timestamp"
                                );
                                if encoded.frames.is_empty()
                                    || timestamp
                                        == samples::FORCE_KEYFRAME_AT as i64 * samples::DURATION
                                {
                                    ensure!(
                                        nal.idr && nal.sps && nal.pps,
                                        "requested random access point lacks IDR/SPS/PPS"
                                    );
                                }
                                ensure!(
                                    encoded.bytes.len() + bytes.len() <= 4 * 1024 * 1024,
                                    "probe output budget exceeded"
                                );
                                encoded.frames.push(serde_json::json!({"offset": encoded.bytes.len(), "length": bytes.len(), "timestamp100ns": timestamp, "nal": nal}));
                                encoded.bytes.extend_from_slice(&bytes);
                            }
                        }
                        _ => {}
                    }
                }
                Err(error) if error.code() == MF_E_NO_EVENTS_AVAILABLE => {
                    std::thread::sleep(Duration::from_millis(2))
                }
                Err(error) => return Err(error.into()),
            }
            if credits > 0
                && sent < samples::FRAME_COUNT
                && sent.saturating_sub(encoded.frames.len()) < 4
            {
                if sent == samples::FORCE_KEYFRAME_AT {
                    codec.SetValue(&CODECAPI_AVEncVideoForceKeyFrame, &VARIANT::from(1_u32))?;
                }
                let sample = match gpu {
                    Some(gpu) => gpu.sample(sent)?,
                    None => samples::input(sent)?,
                };
                transform.ProcessInput(0, &sample, 0)?;
                sent += 1;
                credits -= 1;
            }
            if sent == samples::FRAME_COUNT && !draining {
                transform.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0)?;
                transform.ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)?;
                draining = true;
            }
        }
    }
    ensure!(
        encoded
            .frames
            .iter()
            .any(|frame| frame["nal"]["delta"] == true),
        "encoder emitted no inter frames"
    );
    Ok(encoded)
}
