//! 可见区域与 MF 宏块对齐 surface 分离；仅接受 C1 的右/下边界 padding。
use super::Format;
use anyhow::{ensure, Result};
use windows::Win32::Media::MediaFoundation::*;

pub(super) struct Layout {
    pub width: usize,
    pub height: usize,
}

impl Layout {
    pub fn read(media: &IMFMediaType, format: Format) -> Result<Self> {
        unsafe {
            let size = media.GetUINT64(&MF_MT_FRAME_SIZE)?;
            let (width, height) = ((size >> 32) as u32, size as u32);
            ensure!(
                (width == format.width || width == format.width.div_ceil(16) * 16)
                    && (height == format.height || height == format.height.div_ceil(16) * 16)
                    && u64::from(width) * u64::from(height) <= 8_294_400,
                "decoder negotiated dimensions mismatch: {width}x{height} for {}x{}",
                format.width,
                format.height
            );
            let mut aperture = false;
            for attribute in [MF_MT_MINIMUM_DISPLAY_APERTURE, MF_MT_GEOMETRIC_APERTURE] {
                match media.GetBlobSize(&attribute) {
                    Ok(size) => {
                        ensure!(size == 16, "decoder aperture size invalid");
                        let mut bytes = [0; 16];
                        media.GetBlob(&attribute, &mut bytes, None)?;
                        validate_aperture(&bytes, format)?;
                        aperture = true;
                    }
                    Err(error) if error.code() == MF_E_ATTRIBUTENOTFOUND => {}
                    Err(error) => return Err(error.into()),
                }
            }
            ensure!(
                aperture || (width == format.width && height == format.height),
                "padded decoder output has no visible aperture"
            );
            Ok(Self {
                width: width as usize,
                height: height as usize,
            })
        }
    }

    pub fn packed_size(&self) -> usize {
        self.width * self.height * 3 / 2
    }

    pub fn checked_stride(&self, stride: i32) -> Result<usize> {
        ensure!(
            stride >= self.width as i32 && stride <= 8192 && stride % 2 == 0,
            "decoder stride bounds"
        );
        Ok(stride as usize)
    }
}

fn validate_aperture(bytes: &[u8; 16], format: Format) -> Result<()> {
    // MFVideoArea: two MFOffset values, then native little-endian SIZE. No pointer cast/alignment assumption.
    ensure!(
        bytes[..8] == [0; 8]
            && i32::from_le_bytes(bytes[8..12].try_into().unwrap()) == format.width as i32
            && i32::from_le_bytes(bytes[12..16].try_into().unwrap()) == format.height as i32,
        "decoder visible aperture mismatch"
    );
    Ok(())
}

pub(super) fn copy_visible(
    source: &[u8],
    stride: usize,
    stored_height: usize,
    format: Format,
) -> Result<Vec<u8>> {
    let (width, height) = (format.width as usize, format.height as usize);
    ensure!(
        stride >= width
            && stride <= 8192
            && stride % 2 == 0
            && stored_height >= height
            && stored_height <= 4096
            && stored_height % 2 == 0
            && source.len() >= stride * stored_height * 3 / 2,
        "decoder cropped buffer bounds"
    );
    let mut out = vec![0; width * height * 3 / 2];
    for row in 0..height {
        out[row * width..(row + 1) * width]
            .copy_from_slice(&source[row * stride..row * stride + width]);
    }
    let uv_start = stride * stored_height;
    for row in 0..height / 2 {
        let dest = width * height + row * width;
        let src = uv_start + row * stride;
        out[dest..dest + width].copy_from_slice(&source[src..src + width]);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stride_covers_storage_width_and_whole_chroma_pairs() {
        let layout = Layout {
            width: 688,
            height: 432,
        };
        assert!(layout.checked_stride(680).is_err());
        assert!(layout.checked_stride(689).is_err());
        assert!(layout.checked_stride(-688).is_err());
        assert_eq!(layout.checked_stride(704).unwrap(), 704);
    }
    #[test]
    fn padded_nv12_uses_storage_height_for_chroma_not_visible_height() {
        let format = Format::new(2, 2, 30).unwrap();
        let mut source = vec![99; 4 * 4 * 3 / 2];
        source[..2].copy_from_slice(&[16, 32]);
        source[4..6].copy_from_slice(&[64, 128]);
        source[16..18].copy_from_slice(&[120, 140]);
        assert_eq!(
            copy_visible(&source, 4, 4, format).unwrap(),
            [16, 32, 64, 128, 120, 140]
        );
        assert!(copy_visible(&source[..17], 4, 4, format).is_err());
        assert!(copy_visible(&source, 1, 4, format).is_err());
    }
    #[test]
    fn aperture_requires_exact_visible_size_and_zero_fractional_offsets() {
        let format = Format::new(680, 430, 30).unwrap();
        let mut bytes = [0; 16];
        bytes[8..12].copy_from_slice(&680_i32.to_le_bytes());
        bytes[12..16].copy_from_slice(&430_i32.to_le_bytes());
        assert!(validate_aperture(&bytes, format).is_ok());
        bytes[0] = 1;
        assert!(validate_aperture(&bytes, format).is_err());
    }
}
