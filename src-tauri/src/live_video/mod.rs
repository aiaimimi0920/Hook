//! Windows 连续视频 owner：捕获交接与硬件编码独立于 JPEG/本地预览。
pub mod capture;
mod decode_bounds;
mod decode_layout;
mod decode_output;
mod decoder;
mod encoder;
mod gpu;
mod media;
mod runtime;
pub use decoder::{DecodedImage, Decoder};
pub use encoder::Encoder;

mod annex_b;
#[cfg(test)]
mod decoder_native_tests;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Format {
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

impl Format {
    pub fn new(width: u32, height: u32, fps: u32) -> anyhow::Result<Self> {
        anyhow::ensure!(
            width >= 2
                && height >= 2
                && width <= 4096
                && height <= 4096
                && u64::from(width) * u64::from(height) <= 8_294_400
                && width % 2 == 0
                && height % 2 == 0
                && (1..=60).contains(&fps),
            "H264 requires bounded even dimensions and 1..60 fps"
        );
        Ok(Self { width, height, fps })
    }

    pub fn duration(self) -> i64 {
        10_000_000 / i64::from(self.fps)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn format_rejects_unsupported_and_unbounded_frames() {
        assert!(Format::new(1920, 1080, 30).is_ok());
        for (w, h, fps) in [
            (0, 2, 30),
            (321, 240, 30),
            (4096, 4096, 30),
            (320, 240, 0),
            (320, 240, 61),
        ] {
            assert!(Format::new(w, h, fps).is_err());
        }
    }
}
