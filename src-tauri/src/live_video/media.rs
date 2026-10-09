//! 有界的 MF 类型与压缩缓冲边界；GPU 输入不在这里转为 CPU 像素。
use super::Format;
use anyhow::{ensure, Result};
use std::mem::ManuallyDrop;
use windows::{core::GUID, Win32::Media::MediaFoundation::*};
pub(super) const MAX_ACCESS_UNIT: u32 = 1024 * 1024;

pub(super) fn media_type(format: Format, subtype: &GUID) -> Result<IMFMediaType> {
    unsafe {
        let media = MFCreateMediaType()?;
        media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        media.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        media.SetUINT64(
            &MF_MT_FRAME_SIZE,
            (u64::from(format.width) << 32) | u64::from(format.height),
        )?;
        media.SetUINT64(&MF_MT_FRAME_RATE, (u64::from(format.fps) << 32) | 1)?;
        media.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1_u64 << 32) | 1)?;
        media.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        media.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)?;
        media.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
        media.SetUINT32(&MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32)?;
        if *subtype == MFVideoFormat_H264 {
            let bitrate =
                (u64::from(format.width) * u64::from(format.height) * u64::from(format.fps) / 5)
                    .clamp(1_000_000, 24_000_000) as u32;
            media.SetUINT32(&MF_MT_AVG_BITRATE, bitrate)?;
            media.SetUINT32(&MF_MT_MPEG2_PROFILE, 66)?;
        } else {
            media.SetUINT32(&MF_MT_DEFAULT_STRIDE, format.width)?;
        }
        Ok(media)
    }
}

pub(super) fn receive(transform: &IMFTransform) -> Result<Option<IMFSample>> {
    unsafe {
        let info = transform.GetOutputStreamInfo(0)?;
        let sample = if info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 == 0 {
            let size = info.cbSize.max(4096);
            ensure!(size <= MAX_ACCESS_UNIT, "encoder allocation limit");
            let sample = MFCreateSample()?;
            sample.AddBuffer(&MFCreateMemoryBuffer(size)?)?;
            Some(sample)
        } else {
            None
        };
        let mut buffer = MFT_OUTPUT_DATA_BUFFER {
            pSample: ManuallyDrop::new(sample),
            ..Default::default()
        };
        let mut status = 0;
        let result = transform.ProcessOutput(0, std::slice::from_mut(&mut buffer), &mut status);
        drop(ManuallyDrop::take(&mut buffer.pEvents));
        let sample = ManuallyDrop::take(&mut buffer.pSample);
        match result {
            Ok(()) => Ok(sample),
            Err(error) if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => Ok(None),
            Err(error) => Err(error.into()),
        }
    }
}

struct Locked<'a>(&'a IMFMediaBuffer);
impl Drop for Locked<'_> {
    fn drop(&mut self) {
        unsafe {
            let _ = self.0.Unlock();
        }
    }
}

pub(super) fn read(sample: &IMFSample) -> Result<Vec<u8>> {
    unsafe {
        let size = sample.GetTotalLength()?;
        ensure!(
            size > 0 && size <= MAX_ACCESS_UNIT,
            "encoded frame size limit"
        );
        let buffer = sample.ConvertToContiguousBuffer()?;
        let mut ptr = std::ptr::null_mut();
        let mut length = 0;
        let mut capacity = 0;
        buffer.Lock(&mut ptr, Some(&mut capacity), Some(&mut length))?;
        let _lock = Locked(&buffer);
        ensure!(
            !ptr.is_null() && length == size && length <= capacity,
            "encoded buffer bounds"
        );
        Ok(std::slice::from_raw_parts(ptr, length as usize).to_vec())
    }
}
