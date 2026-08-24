// Owns bounded image decoding and internal image-file naming helpers.

fn file_timestamp_component() -> String {
    unix_timestamp_millis().to_string()
}

fn create_internal_capture_file(
    cache_dir: &Path,
    prefix: &str,
    timestamp: &str,
) -> Result<(File, PathBuf), String> {
    create_unique_file(cache_dir, &format!("{prefix}_{timestamp}"), Some("png"))
}

fn sanitize_internal_asset_component(hint: Option<&str>) -> String {
    let sanitized: String = hint
        .unwrap_or("hook")
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();

    let collapsed = sanitized.trim_matches('_');
    if collapsed.is_empty() {
        "hook".to_string()
    } else {
        collapsed.chars().take(48).collect()
    }
}

const MAX_BASE64_IMAGE_ENCODED_BYTES: usize = 64 * 1024 * 1024;
const MAX_IMAGE_DECODED_RGBA_BYTES: u64 = 256 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = MAX_IMAGE_DECODED_RGBA_BYTES / 4;
// Per-image limits above bound a single frame, but a stitch call takes a whole
// Vec of frames that are each decoded to a full bitmap. Without an aggregate cap
// a caller can submit thousands of max-size frames and exhaust memory. This caps
// the frame count; combined with the per-frame pixel limit it bounds peak memory.
const MAX_STITCH_FRAME_COUNT: usize = 512;
#[cfg(test)]
const CLIPBOARD_CACHE_MAX_AGE_SECS: u64 = 7 * 24 * 60 * 60;
const SESSION_IMAGE_ASSET_RETENTION_SECS: u64 = 30 * 24 * 60 * 60;

fn decode_base64_image_data(base64_image: &str) -> Result<Vec<u8>, String> {
    let base64_data = base64_image.split(",").last().unwrap_or(base64_image);
    if base64_data.len() > MAX_BASE64_IMAGE_ENCODED_BYTES {
        return Err(format!(
            "Image payload too large: {} encoded bytes exceeds limit {}",
            base64_data.len(),
            MAX_BASE64_IMAGE_ENCODED_BYTES
        ));
    }

    let image_data = base64::engine::general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;
    validate_image_data_limits(&image_data)?;
    Ok(image_data)
}

fn validate_image_data_limits(image_data: &[u8]) -> Result<(), String> {
    let reader = image::ImageReader::new(std::io::Cursor::new(image_data))
        .with_guessed_format()
        .map_err(|e| format!("Image load failed: {}", e))?;
    let dimensions = reader
        .into_dimensions()
        .map_err(|e| format!("Image load failed: {}", e))?;
    validate_image_dimensions(u64::from(dimensions.0), u64::from(dimensions.1))?;

    image::load_from_memory(image_data).map_err(|e| format!("Image load failed: {}", e))?;
    Ok(())
}

fn validate_image_dimensions(width: u64, height: u64) -> Result<(), String> {
    let pixels = width
        .checked_mul(height)
        .ok_or_else(|| "Image dimensions overflow pixel count".to_string())?;
    if pixels > MAX_IMAGE_PIXELS {
        return Err(format!(
            "Image dimensions too large: {}x{} exceeds {} pixels",
            width, height, MAX_IMAGE_PIXELS
        ));
    }
    Ok(())
}

fn validate_rgba_image_layout(
    width: usize,
    height: usize,
    actual_bytes: usize,
) -> Result<(u32, u32), String> {
    let width_u32 = u32::try_from(width).map_err(|_| "Image width exceeds u32".to_string())?;
    let height_u32 = u32::try_from(height).map_err(|_| "Image height exceeds u32".to_string())?;
    validate_image_dimensions(width as u64, height as u64)?;

    let expected_bytes = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| "Image RGBA byte count overflow".to_string())?;
    if expected_bytes as u64 > MAX_IMAGE_DECODED_RGBA_BYTES {
        return Err(format!(
            "Image RGBA data too large: {} bytes exceeds limit {}",
            expected_bytes, MAX_IMAGE_DECODED_RGBA_BYTES
        ));
    }
    if actual_bytes != expected_bytes {
        return Err(format!(
            "Image RGBA byte count mismatch: expected {}, received {}",
            expected_bytes, actual_bytes
        ));
    }

    Ok((width_u32, height_u32))
}
