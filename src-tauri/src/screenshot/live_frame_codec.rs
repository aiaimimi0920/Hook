// Local presentation codec; keeps the existing JPEG wire format and full-resolution snapshots.
use image::RgbImage;

const MAX_ENCODED_BYTES: usize = 64 * 1024 * 1024;
mod wic {
    include!("live_frame_wic.rs");
}

pub(super) fn encode_live_jpeg(image: &RgbImage) -> Result<Vec<u8>, String> {
    if image.width() == 0
        || image.height() == 0
        || image.width() > 16_384
        || image.height() > 16_384
    {
        return Err("live frame dimensions are invalid".to_string());
    }
    match wic::encode(image, MAX_ENCODED_BYTES) {
        Ok(bytes) => return Ok(bytes),
        Err(error) => {
            static LOGGED: std::sync::atomic::AtomicBool =
                std::sync::atomic::AtomicBool::new(false);
            if !LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                crate::append_runtime_log_line(&format!(
                    "live_jpeg_native_fallback :: code={}",
                    error.code()
                ));
            }
        }
    }
    // Retain capture on systems where the built-in codec cannot initialize.
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 82)
        .encode_image(image)
        .map_err(|error| format!("JPEG encode failed: {error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_ENCODED_BYTES {
        return Err("encoded live frame exceeds the bounded payload".to_string());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn video_pattern(width: u32, height: u32) -> RgbImage {
        RgbImage::from_fn(width, height, |x, y| {
            image::Rgb([
                ((x * 3 + y) % 256) as u8,
                ((x + y * 2) % 256) as u8,
                ((x / 8 + y / 8) % 256) as u8,
            ])
        })
    }

    #[test]
    fn live_jpeg_retains_dimensions_and_rejects_empty_frames() {
        assert!(encode_live_jpeg(&RgbImage::new(0, 10)).is_err());
        let bytes = encode_live_jpeg(&video_pattern(160, 90)).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (160, 90));
    }

    #[test]
    fn live_native_jpeg_preserves_rgb_channel_order() {
        for expected in [[230, 15, 20], [20, 230, 15], [15, 20, 230]] {
            let source = RgbImage::from_pixel(32, 32, image::Rgb(expected));
            let bytes = wic::encode(&source, MAX_ENCODED_BYTES).unwrap();
            let decoded = image::load_from_memory(&bytes).unwrap().to_rgb8();
            for (actual, wanted) in decoded.get_pixel(16, 16).0.into_iter().zip(expected) {
                assert!(actual.abs_diff(wanted) < 8, "JPEG channel order changed");
            }
        }
    }

    #[test]
    #[ignore = "release-profile timing evidence; does not read desktop pixels"]
    fn live_jpeg_encode_benchmark() {
        for (width, height) in [(640, 360), (1280, 720), (1920, 1080)] {
            let frame = video_pattern(width, height);
            let mut samples = Vec::new();
            for _ in 0..18 {
                let start = std::time::Instant::now();
                let bytes = encode_live_jpeg(std::hint::black_box(&frame)).unwrap();
                std::hint::black_box(bytes);
                samples.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            samples.sort_by(f64::total_cmp);
            println!(
                "live_jpeg_benchmark width={width} height={height} median_ms={:.3} p95_ms={:.3}",
                samples[9], samples[17]
            );
        }
    }
}
