//! MF NV12 输出的尺寸/stride/分配校验，转换为现有图片呈现路径支持的 BGRA。
use super::Format;
use anyhow::{ensure, Result};
use std::mem::ManuallyDrop;
use windows::{core::Interface, Win32::Media::MediaFoundation::*};

const MAX_DECODE_BUFFER: u32 = 32 * 1024 * 1024;
pub(super) enum Output {
    NeedInput,
    FormatChanged,
    Frame(IMFSample),
}

pub(super) fn receive(transform: &IMFTransform) -> Result<Output> {
    unsafe {
        let info = transform.GetOutputStreamInfo(0)?;
        ensure!(
            info.cbSize <= MAX_DECODE_BUFFER,
            "decoder output allocation budget"
        );
        let sample = if info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 == 0 {
            let sample = MFCreateSample()?;
            sample.AddBuffer(&MFCreateMemoryBuffer(info.cbSize.max(4096))?)?;
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
            Ok(()) => {
                Ok(Output::Frame(sample.ok_or_else(|| {
                    anyhow::anyhow!("decoder missing output")
                })?))
            }
            Err(error) if error.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => Ok(Output::NeedInput),
            Err(error) if error.code() == MF_E_TRANSFORM_STREAM_CHANGE => Ok(Output::FormatChanged),
            Err(error) => Err(error.into()),
        }
    }
}

pub(super) fn select_type(transform: &IMFTransform, format: Format) -> Result<()> {
    unsafe {
        for index in 0..32 {
            let media = transform.GetOutputAvailableType(0, index)?;
            if media.GetGUID(&MF_MT_SUBTYPE)? != MFVideoFormat_NV12 {
                continue;
            }
            let size = media.GetUINT64(&MF_MT_FRAME_SIZE)?;
            ensure!(
                size >> 32 == u64::from(format.width) && size as u32 == format.height,
                "decoder negotiated dimensions mismatch"
            );
            // An absent/unknown output attribute inherits C1's fixed color contract;
            // an explicit conflicting matrix, transfer or range must fall back, not relabel pixels.
            for (attribute, expected) in [
                (MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32),
                (MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32),
                (MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32),
                (MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_sRGB.0 as u32),
            ] {
                if let Ok(value) = media.GetUINT32(&attribute) {
                    ensure!(
                        value == 0 || value == expected,
                        "decoder output color contract mismatch"
                    );
                }
            }
            transform.SetOutputType(0, &media, 0)?;
            ensure!(
                transform.GetOutputStreamInfo(0)?.cbSize <= MAX_DECODE_BUFFER,
                "decoder output budget"
            );
            return Ok(());
        }
    }
    anyhow::bail!("decoder has no bounded NV12 output")
}

pub(super) fn pixels(
    sample: &IMFSample,
    transform: &IMFTransform,
    format: Format,
) -> Result<Vec<u8>> {
    let (width, height) = (format.width as usize, format.height as usize);
    let size = width * height * 3 / 2;
    unsafe {
        ensure!(
            sample.GetTotalLength()? <= MAX_DECODE_BUFFER,
            "decoded sample budget"
        );
        let buffer = sample.ConvertToContiguousBuffer()?;
        let mut packed = vec![0; size];
        if let Ok(surface) = buffer.cast::<IMF2DBuffer>() {
            ensure!(
                surface.GetContiguousLength()? as usize == size,
                "decoded surface dimensions mismatch"
            );
            surface.ContiguousCopyTo(&mut packed)?;
        } else {
            let stride = transform
                .GetOutputCurrentType(0)?
                .GetUINT32(&MF_MT_DEFAULT_STRIDE)
                .unwrap_or(format.width) as i32;
            ensure!(
                stride >= format.width as i32 && stride <= 8192,
                "decoder stride bounds"
            );
            let stride = stride as usize;
            let mut ptr = std::ptr::null_mut();
            let mut capacity = 0;
            let mut length = 0;
            buffer.Lock(&mut ptr, Some(&mut capacity), Some(&mut length))?;
            let _lock = Locked(&buffer);
            ensure!(
                !ptr.is_null()
                    && length <= capacity
                    && length <= MAX_DECODE_BUFFER
                    && length as usize >= stride * height * 3 / 2,
                "decoder buffer bounds"
            );
            for row in 0..height * 3 / 2 {
                packed[row * width..(row + 1) * width]
                    .copy_from_slice(std::slice::from_raw_parts(ptr.add(row * stride), width));
            }
        }
        Ok(nv12_bgra(&packed, width, height))
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

fn nv12_bgra(nv12: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut out = vec![0; width * height * 4];
    for y in 0..height {
        for x in 0..width {
            let luma = i32::from(nv12[y * width + x]) - 16;
            let uv = width * height + (y / 2) * width + (x & !1);
            let u = i32::from(nv12[uv]) - 128;
            let v = i32::from(nv12[uv + 1]) - 128;
            // BT.709 limited-range, 8-bit output with integer rounding.
            let channel = |value: i32| ((value + 128) >> 8).clamp(0, 255) as u8;
            out[(y * width + x) * 4..(y * width + x + 1) * 4].copy_from_slice(&[
                channel(298 * luma + 541 * u),
                channel(298 * luma - 55 * u - 136 * v),
                channel(298 * luma + 459 * v),
                255,
            ]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nv12_bt709_preserves_gray_extremes_and_chroma_order() {
        assert_eq!(
            nv12_bgra(&[16, 16, 235, 235, 128, 128], 2, 2),
            [vec![0, 0, 0, 255, 0, 0, 0, 255], vec![255; 8]].concat()
        );
        let red = nv12_bgra(&[63, 63, 63, 63, 102, 240], 2, 2);
        for pixel in red.chunks_exact(4) {
            assert!(pixel[0] <= 2 && pixel[1] <= 2 && pixel[2] >= 253 && pixel[3] == 255);
        }
    }
}
