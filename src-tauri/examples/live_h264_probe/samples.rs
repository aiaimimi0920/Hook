//! 合成 NV12 样本与 COM 缓冲生命周期；仅处理探针自有像素。
use anyhow::{ensure, Result};
use windows::Win32::Media::MediaFoundation::*;

pub const WIDTH: u32 = 320;
pub const HEIGHT: u32 = 240;
pub const FPS: u32 = 30;
pub const FRAME_COUNT: usize = 24;
pub const FORCE_KEYFRAME_AT: usize = 12;
pub const DURATION: i64 = 10_000_000 / FPS as i64;

struct Locked<'a>(&'a IMFMediaBuffer);
impl Drop for Locked<'_> {
    fn drop(&mut self) {
        unsafe {
            let _ = self.0.Unlock();
        }
    }
}

pub fn input(index: usize) -> Result<IMFSample> {
    // 固定偶数尺寸，Y 随帧改变，UV 中性；不读取任何桌面纹理。
    let size = WIDTH * HEIGHT * 3 / 2;
    unsafe {
        let buffer = MFCreateMemoryBuffer(size)?;
        let mut ptr = std::ptr::null_mut();
        let mut maximum = 0;
        buffer.Lock(&mut ptr, Some(&mut maximum), None)?;
        let lock = Locked(&buffer);
        ensure!(!ptr.is_null() && maximum >= size, "input buffer bounds");
        let bytes = std::slice::from_raw_parts_mut(ptr, size as usize);
        bytes[..(WIDTH * HEIGHT) as usize].fill(32 + index as u8 * 4);
        bytes[(WIDTH * HEIGHT) as usize..].fill(128);
        drop(lock);
        buffer.SetCurrentLength(size)?;
        let sample = MFCreateSample()?;
        sample.AddBuffer(&buffer)?;
        sample.SetSampleTime(index as i64 * DURATION)?;
        sample.SetSampleDuration(DURATION)?;
        Ok(sample)
    }
}

pub fn output_sample(capacity: u32) -> Result<IMFSample> {
    ensure!(
        capacity > 0 && capacity <= 1024 * 1024,
        "output allocation bounds"
    );
    unsafe {
        let sample = MFCreateSample()?;
        sample.AddBuffer(&MFCreateMemoryBuffer(capacity)?)?;
        Ok(sample)
    }
}

pub fn read(sample: &IMFSample) -> Result<Vec<u8>> {
    unsafe {
        let length = sample.GetTotalLength()?;
        ensure!(length > 0 && length <= 1024 * 1024, "output size bounds");
        let buffer = sample.ConvertToContiguousBuffer()?;
        let mut ptr = std::ptr::null_mut();
        let mut current = 0;
        let mut maximum = 0;
        buffer.Lock(&mut ptr, Some(&mut maximum), Some(&mut current))?;
        let _lock = Locked(&buffer);
        ensure!(
            !ptr.is_null() && current == length && current <= maximum,
            "output buffer bounds"
        );
        Ok(std::slice::from_raw_parts(ptr, current as usize).to_vec())
    }
}

pub fn media_type(subtype: &windows::core::GUID) -> Result<IMFMediaType> {
    unsafe {
        let media = MFCreateMediaType()?;
        media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        media.SetGUID(&MF_MT_SUBTYPE, subtype)?;
        media.SetUINT64(
            &MF_MT_FRAME_SIZE,
            (u64::from(WIDTH) << 32) | u64::from(HEIGHT),
        )?;
        media.SetUINT64(&MF_MT_FRAME_RATE, (u64::from(FPS) << 32) | 1)?;
        media.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1_u64 << 32) | 1)?;
        media.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
        if *subtype == MFVideoFormat_H264 {
            media.SetUINT32(&MF_MT_AVG_BITRATE, 1_000_000)?;
            media.SetUINT32(&MF_MT_MPEG2_PROFILE, 66)?;
        } else {
            media.SetUINT32(&MF_MT_DEFAULT_STRIDE, WIDTH)?;
        }
        Ok(media)
    }
}
