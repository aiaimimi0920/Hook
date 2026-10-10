//! 连接线程持有的 Windows MF decoder；AU 顺序解码后才允许进入 latest-image 槽。
use super::{
    decode_bounds,
    decode_output::{self, Output},
    runtime::{Activations, Runtime, Transform},
    Format,
};
use anyhow::{ensure, Context, Result};
use std::{
    collections::VecDeque,
    sync::atomic::{AtomicBool, Ordering},
};
use windows::{
    core::Interface,
    Win32::{Media::MediaFoundation::*, System::Variant::VARIANT},
};

pub struct DecodedImage {
    pub timestamp: i64,
    pub bgra: Vec<u8>,
}

pub struct Decoder {
    transform: Transform,
    format: Format,
    pending: VecDeque<i64>,
    last_input: Option<i64>,
    failed: bool,
    _runtime: Runtime,
    _permit: DecoderPermit,
}

impl Decoder {
    pub fn new(format: Format) -> Result<Self> {
        let permit = DecoderPermit::acquire()?;
        let format = Format::new(format.width, format.height, format.fps)?;
        let runtime = Runtime::start()?;
        let mut list = Activations::default();
        unsafe {
            let input = MFT_REGISTER_TYPE_INFO {
                guidMajorType: MFMediaType_Video,
                guidSubtype: MFVideoFormat_H264,
            };
            let output = MFT_REGISTER_TYPE_INFO {
                guidMajorType: MFMediaType_Video,
                guidSubtype: MFVideoFormat_NV12,
            };
            // Windows system synchronous decoder, not a claim of GPU decoding or bundled codec software.
            MFTEnumEx(
                MFT_CATEGORY_VIDEO_DECODER,
                MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_SORTANDFILTER,
                Some(&input),
                Some(&output),
                &mut list.ptr,
                &mut list.count,
            )?;
            ensure!(
                !list.ptr.is_null() && list.count > 0 && list.count <= 64,
                "no bounded Windows H264 decoder inventory"
            );
            let activation = (*list.ptr)
                .as_ref()
                .context("empty decoder activation")?
                .clone();
            let transform = Transform {
                transform: activation.ActivateObject()?,
                activation,
            };
            transform
                .transform
                .GetAttributes()?
                .SetUINT32(&MF_LOW_LATENCY, 1)?;
            let codec: ICodecAPI = transform.transform.cast()?;
            codec.SetValue(&CODECAPI_AVLowLatencyMode, &VARIANT::from(1_u32))?;
            let media = MFCreateMediaType()?;
            media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
            media.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264)?;
            media.SetUINT64(
                &MF_MT_FRAME_SIZE,
                (u64::from(format.width) << 32) | u64::from(format.height),
            )?;
            media.SetUINT64(&MF_MT_FRAME_RATE, (u64::from(format.fps) << 32) | 1)?;
            media.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
            transform.transform.SetInputType(0, &media, 0)?;
            decode_output::select_type(&transform.transform, format)?;
            transform
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
            transform
                .transform
                .ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
            Ok(Self {
                transform,
                format,
                pending: VecDeque::new(),
                last_input: None,
                failed: false,
                _runtime: runtime,
                _permit: permit,
            })
        }
    }

    pub fn decode(
        &mut self,
        bytes: &[u8],
        timestamp: i64,
        keyframe: bool,
        stop: &AtomicBool,
    ) -> Result<Option<DecodedImage>> {
        ensure!(!self.failed, "decoder reference chain already failed");
        let result = self.decode_inner(bytes, timestamp, keyframe, stop);
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    fn decode_inner(
        &mut self,
        bytes: &[u8],
        timestamp: i64,
        keyframe: bool,
        stop: &AtomicBool,
    ) -> Result<Option<DecodedImage>> {
        ensure!(!stop.load(Ordering::Acquire), "video decoding cancelled");
        ensure!(
            self.last_input.is_some() || keyframe,
            "decoder requires initial IDR"
        );
        ensure!(
            timestamp >= 0 && self.last_input.is_none_or(|previous| timestamp > previous),
            "decoder input timeline invalid"
        );
        ensure!(self.pending.len() < 4, "decoder pending picture budget");
        decode_bounds::validate(bytes, self.format, keyframe)?;
        unsafe {
            let sample = MFCreateSample()?;
            let buffer = MFCreateMemoryBuffer(bytes.len() as u32)?;
            let mut ptr = std::ptr::null_mut();
            buffer.Lock(&mut ptr, None, None)?;
            if ptr.is_null() {
                let _ = buffer.Unlock();
                anyhow::bail!("decoder input buffer missing");
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
            buffer.Unlock()?;
            buffer.SetCurrentLength(bytes.len() as u32)?;
            sample.AddBuffer(&buffer)?;
            sample.SetSampleTime(timestamp)?;
            sample.SetSampleDuration(self.format.duration())?;
            sample.SetUINT32(&MFSampleExtension_CleanPoint, u32::from(keyframe))?;
            self.transform.transform.ProcessInput(0, &sample, 0)?;
            self.pending.push_back(timestamp);
            self.last_input = Some(timestamp);
            for _ in 0..3 {
                ensure!(!stop.load(Ordering::Acquire), "video decoding cancelled");
                match decode_output::receive(&self.transform.transform)? {
                    Output::NeedInput => return Ok(None),
                    Output::FormatChanged => {
                        decode_output::select_type(&self.transform.transform, self.format)?
                    }
                    Output::Frame(sample) => {
                        let timestamp = sample.GetSampleTime()?;
                        ensure!(
                            self.pending.pop_front() == Some(timestamp),
                            "decoder output reordered"
                        );
                        let bgra =
                            decode_output::pixels(&sample, &self.transform.transform, self.format)?;
                        ensure!(!stop.load(Ordering::Acquire), "video decoding cancelled");
                        return Ok(Some(DecodedImage { timestamp, bgra }));
                    }
                }
            }
        }
        anyhow::bail!("decoder repeated format changes")
    }
}

// C1 admits one native viewer decoder per process. Additional viewers retain image fallback.
static DECODER_ACTIVE: AtomicBool = AtomicBool::new(false);
struct DecoderPermit;
impl DecoderPermit {
    fn acquire() -> Result<Self> {
        ensure!(
            DECODER_ACTIVE
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .is_ok(),
            "C1 decoder already in use"
        );
        Ok(Self)
    }
}
impl Drop for DecoderPermit {
    fn drop(&mut self) {
        DECODER_ACTIVE.store(false, Ordering::Release);
    }
}
