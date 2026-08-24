// Long captures process caller-controlled images, so every decode and aggregate
// path shares the same conservative memory and dimension budgets.
const MAX_LONG_CAPTURE_FRAME_COUNT: usize = 512;
const MAX_LONG_CAPTURE_ENCODED_FRAME_BYTES: usize = 64 * 1024 * 1024;
const MAX_LONG_CAPTURE_BASE64_CHARS: usize =
    ((MAX_LONG_CAPTURE_ENCODED_FRAME_BYTES + 2) / 3) * 4;
const MAX_LONG_CAPTURE_FRAME_DIMENSION: u32 = 32_768;
const MAX_LONG_CAPTURE_FRAME_PIXELS: u64 = 64 * 1024 * 1024;
const MAX_LONG_CAPTURE_INPUT_PIXELS: u64 = 128 * 1024 * 1024;
const MAX_LONG_CAPTURE_OUTPUT_AXIS: u32 = 131_072;
const MAX_LONG_CAPTURE_OUTPUT_PIXELS: u64 = 128 * 1024 * 1024;
const MAX_LONG_CAPTURE_DECODE_ALLOC_BYTES: u64 = MAX_LONG_CAPTURE_FRAME_PIXELS * 4;
const MAX_LONG_CAPTURE_SETTLE_MS: u64 = 10_000;
const MAX_LONG_CAPTURE_TOTAL_SETTLE_MS: u64 = 300_000;

fn checked_pixel_count(width: u32, height: u32, label: &str) -> Result<u64> {
    u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| anyhow!("{label} pixel count overflow"))
}

fn validate_long_capture_frame_count(count: usize) -> Result<()> {
    if count > MAX_LONG_CAPTURE_FRAME_COUNT {
        return Err(anyhow!(
            "Long-capture frame count exceeds the limit of {MAX_LONG_CAPTURE_FRAME_COUNT}"
        ));
    }
    Ok(())
}

fn validate_long_capture_frame_dimensions(width: u32, height: u32) -> Result<u64> {
    if width == 0 || height == 0 {
        return Err(anyhow!("Long-capture frames must have non-zero dimensions"));
    }
    if width > MAX_LONG_CAPTURE_FRAME_DIMENSION || height > MAX_LONG_CAPTURE_FRAME_DIMENSION {
        return Err(anyhow!(
            "Long-capture frame dimensions exceed {MAX_LONG_CAPTURE_FRAME_DIMENSION} pixels"
        ));
    }
    let pixels = checked_pixel_count(width, height, "Long-capture frame")?;
    if pixels > MAX_LONG_CAPTURE_FRAME_PIXELS {
        return Err(anyhow!(
            "Long-capture frame exceeds the {MAX_LONG_CAPTURE_FRAME_PIXELS}-pixel limit"
        ));
    }
    Ok(pixels)
}

fn validate_long_capture_output_dimensions(width: u32, height: u32) -> Result<()> {
    if width == 0 || height == 0 {
        return Err(anyhow!("Long-capture output must have non-zero dimensions"));
    }
    if width > MAX_LONG_CAPTURE_OUTPUT_AXIS || height > MAX_LONG_CAPTURE_OUTPUT_AXIS {
        return Err(anyhow!(
            "Long-capture output axis exceeds {MAX_LONG_CAPTURE_OUTPUT_AXIS} pixels"
        ));
    }
    let pixels = checked_pixel_count(width, height, "Long-capture output")?;
    if pixels > MAX_LONG_CAPTURE_OUTPUT_PIXELS {
        return Err(anyhow!(
            "Long-capture output exceeds the {MAX_LONG_CAPTURE_OUTPUT_PIXELS}-pixel limit"
        ));
    }
    Ok(())
}

fn validate_long_capture_frames(frames: &[RgbImage]) -> Result<()> {
    validate_long_capture_frame_count(frames.len())?;
    let mut total_pixels = 0u64;
    for frame in frames {
        let pixels = validate_long_capture_frame_dimensions(frame.width(), frame.height())?;
        total_pixels = total_pixels
            .checked_add(pixels)
            .ok_or_else(|| anyhow!("Long-capture input pixel count overflow"))?;
        if total_pixels > MAX_LONG_CAPTURE_INPUT_PIXELS {
            return Err(anyhow!(
                "Long-capture inputs exceed the {MAX_LONG_CAPTURE_INPUT_PIXELS}-pixel memory budget"
            ));
        }
    }
    Ok(())
}

fn validate_encoded_frame_len(payload_len: usize) -> Result<()> {
    if payload_len > MAX_LONG_CAPTURE_BASE64_CHARS {
        return Err(anyhow!(
            "Long-capture encoded frame exceeds the {MAX_LONG_CAPTURE_ENCODED_FRAME_BYTES}-byte limit"
        ));
    }
    Ok(())
}

fn decode_frame_data_url(frame: &str) -> Result<RgbImage> {
    let payload = frame
        .split_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(frame);
    validate_encoded_frame_len(payload.len())?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(payload)?;
    if bytes.len() > MAX_LONG_CAPTURE_ENCODED_FRAME_BYTES {
        return Err(anyhow!(
            "Long-capture encoded frame exceeds the {MAX_LONG_CAPTURE_ENCODED_FRAME_BYTES}-byte limit"
        ));
    }

    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_LONG_CAPTURE_FRAME_DIMENSION);
    limits.max_image_height = Some(MAX_LONG_CAPTURE_FRAME_DIMENSION);
    limits.max_alloc = Some(MAX_LONG_CAPTURE_DECODE_ALLOC_BYTES);
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    reader.limits(limits);
    let decoded = reader.decode()?;
    validate_long_capture_frame_dimensions(decoded.width(), decoded.height())?;
    Ok(decoded.to_rgb8())
}

fn decode_long_capture_frames(frames: &[String]) -> Result<Vec<RgbImage>> {
    validate_long_capture_frame_count(frames.len())?;
    let mut decoded_frames = Vec::with_capacity(frames.len());
    let mut total_pixels = 0u64;
    for frame in frames {
        let decoded = decode_frame_data_url(frame)?;
        let pixels = checked_pixel_count(decoded.width(), decoded.height(), "Long-capture input")?;
        total_pixels = total_pixels
            .checked_add(pixels)
            .ok_or_else(|| anyhow!("Long-capture input pixel count overflow"))?;
        if total_pixels > MAX_LONG_CAPTURE_INPUT_PIXELS {
            return Err(anyhow!(
                "Long-capture inputs exceed the {MAX_LONG_CAPTURE_INPUT_PIXELS}-pixel memory budget"
            ));
        }
        decoded_frames.push(decoded);
    }
    Ok(decoded_frames)
}
