// Encodes SDR and HDR long-capture results to responses or cache files.

#[cfg(test)]
fn encode_rgb_image_as_capture_response(
    rgb_image: image::RgbImage,
) -> Result<CaptureResponse, String> {
    let started_at = Instant::now();
    let width = rgb_image.width();
    let height = rgb_image.height();
    let mut bytes = Vec::new();
    let encode_started_at = Instant::now();
    {
        use image::codecs::png::{CompressionType, FilterType, PngEncoder};
        use image::{ColorType, ImageEncoder};

        let encoder =
            PngEncoder::new_with_quality(&mut bytes, CompressionType::Fast, FilterType::NoFilter);
        encoder
            .write_image(rgb_image.as_raw(), width, height, ColorType::Rgb8.into())
            .map_err(|error| error.to_string())?;
    }
    let png_encode_ms = encode_started_at.elapsed().as_millis();

    let base64_started_at = Instant::now();
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let base64_encode_ms = base64_started_at.elapsed().as_millis();
    append_runtime_log_line(&format!(
        "encode_rgb_image_as_capture_response :: width={} height={} png_bytes={} encoded_chars={} png_encode_ms={} base64_encode_ms={} total_ms={}",
        width,
        height,
        bytes.len(),
        encoded.len(),
        png_encode_ms,
        base64_encode_ms,
        started_at.elapsed().as_millis()
    ));

    Ok(CaptureResponse {
        base64: format!("data:image/png;base64,{}", encoded),
        width,
        height,
        file_path: None,
        file_url: None,
        metadata: CaptureMetadata::sdr("test-encoder", false),
    })
}

fn file_url_from_path(path: &Path) -> String {
    let raw_path = path.to_string_lossy().replace('\\', "/");
    let mut url = String::from("file:///");
    const HEX: &[u8; 16] = b"0123456789ABCDEF";

    for &byte in raw_path.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' | b':' => {
                url.push(byte as char)
            }
            _ => {
                url.push('%');
                url.push(HEX[(byte >> 4) as usize] as char);
                url.push(HEX[(byte & 0x0f) as usize] as char);
            }
        }
    }

    url
}

pub(crate) fn encode_rgb_image_as_file_capture_response(
    rgb_image: image::RgbImage,
) -> Result<CaptureResponse, String> {
    encode_rgb_image_as_file_capture_response_with_metadata(
        rgb_image,
        CaptureMetadata::sdr("long-capture-stitch", false),
    )
}

pub(crate) fn encode_rgb_image_as_file_capture_response_with_metadata(
    rgb_image: image::RgbImage,
    metadata: CaptureMetadata,
) -> Result<CaptureResponse, String> {
    let started_at = Instant::now();
    let width = rgb_image.width();
    let height = rgb_image.height();
    let cache_dir = ensure_clipboard_cache_dir()?;
    let (file, file_path) =
        create_internal_capture_file(&cache_dir, "Hook_long_capture", &file_timestamp_component())?;

    let file_write_started_at = Instant::now();
    let write_result = (|| -> Result<(), String> {
        use image::codecs::png::{CompressionType, FilterType, PngEncoder};
        use image::{ColorType, ImageEncoder};

        let mut writer = BufWriter::new(file);
        let encoder =
            PngEncoder::new_with_quality(&mut writer, CompressionType::Fast, FilterType::NoFilter);
        encoder
            .write_image(rgb_image.as_raw(), width, height, ColorType::Rgb8.into())
            .map_err(|error| error.to_string())?;
        writer
            .flush()
            .map_err(|error| format!("Failed to flush PNG: {error}"))?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&file_path);
        return Err(error);
    }
    let file_write_ms = file_write_started_at.elapsed().as_millis();
    let png_bytes = fs::metadata(&file_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let file_url = file_url_from_path(&file_path);
    let file_path_string = file_path.to_string_lossy().to_string();
    append_runtime_log_line(&format!(
        "encode_rgb_image_as_file_capture_response :: width={} height={} png_bytes={} file_write_ms={} total_ms={} path={}",
        width,
        height,
        png_bytes,
        file_write_ms,
        started_at.elapsed().as_millis(),
        cache_file_name_for_log(&file_path)
    ));

    Ok(CaptureResponse {
        base64: String::new(),
        width,
        height,
        file_path: Some(file_path_string),
        file_url: Some(file_url),
        metadata,
    })
}

fn scaled_png_luminance(nits: f32) -> u32 {
    if !nits.is_finite() {
        return 0;
    }
    (nits.clamp(0.0, 10_000.0) * 10_000.0)
        .round()
        .clamp(0.0, u32::MAX as f32) as u32
}

fn write_hdr_png(writer: impl Write, image: &screenshot::HdrPqImage) -> Result<(), String> {
    let mut info = png::Info::with_size(image.width, image.height);
    info.color_type = png::ColorType::Rgb;
    info.bit_depth = png::BitDepth::Sixteen;
    info.source_chromaticities = Some(png::SourceChromaticities::new(
        (0.3127, 0.3290),
        (0.7080, 0.2920),
        (0.1700, 0.7970),
        (0.1310, 0.0460),
    ));
    let mut encoder = png::Encoder::with_info(writer, info).map_err(|error| error.to_string())?;
    encoder.set_compression(png::Compression::Fast);
    encoder.set_filter(png::Filter::NoFilter);
    let mut png_writer = encoder.write_header().map_err(|error| error.to_string())?;

    png_writer
        .write_chunk(png::chunk::cICP, &[9, 16, 0, 1])
        .map_err(|error| error.to_string())?;

    let chromaticity = |value: f32| (value * 50_000.0).round().clamp(0.0, u16::MAX as f32) as u16;
    let mut mastering_display = Vec::with_capacity(24);
    for value in [
        0.7080, 0.2920, // BT.2020 red
        0.1700, 0.7970, // BT.2020 green
        0.1310, 0.0460, // BT.2020 blue
        0.3127, 0.3290, // D65 white point
    ] {
        mastering_display.extend_from_slice(&chromaticity(value).to_be_bytes());
    }
    mastering_display
        .extend_from_slice(&scaled_png_luminance(image.mastering_max_luminance_nits).to_be_bytes());
    mastering_display
        .extend_from_slice(&scaled_png_luminance(image.mastering_min_luminance_nits).to_be_bytes());
    png_writer
        .write_chunk(png::chunk::mDCV, &mastering_display)
        .map_err(|error| error.to_string())?;

    let mut content_light = Vec::with_capacity(8);
    content_light
        .extend_from_slice(&scaled_png_luminance(image.max_content_light_level_nits).to_be_bytes());
    content_light.extend_from_slice(
        &scaled_png_luminance(image.max_frame_average_light_level_nits).to_be_bytes(),
    );
    png_writer
        .write_chunk(png::chunk::cLLI, &content_light)
        .map_err(|error| error.to_string())?;

    png_writer
        .write_image_data(&image.rgb16_be)
        .map_err(|error| error.to_string())?;
    png_writer.finish().map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn encode_hdr_image_as_file_capture_response(
    hdr_image: screenshot::HdrPqImage,
    metadata: CaptureMetadata,
) -> Result<CaptureResponse, String> {
    let started_at = Instant::now();
    let cache_dir = ensure_clipboard_cache_dir()?;
    let (file, file_path) =
        create_internal_capture_file(&cache_dir, "Hook_hdr_capture", &file_timestamp_component())?;
    let write_result = (|| -> Result<(), String> {
        let mut writer = BufWriter::new(file);
        write_hdr_png(&mut writer, &hdr_image)?;
        writer
            .flush()
            .map_err(|error| format!("Failed to flush HDR PNG: {error}"))?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&file_path);
        return Err(error);
    }

    let file_url = file_url_from_path(&file_path);
    let file_path_string = file_path.to_string_lossy().to_string();
    append_runtime_log_line(&format!(
        "encode_hdr_image_as_file_capture_response :: width={} height={} png_bytes={} max_cll_nits={} total_ms={} path={}",
        hdr_image.width,
        hdr_image.height,
        fs::metadata(&file_path).map(|metadata| metadata.len()).unwrap_or(0),
        hdr_image.max_content_light_level_nits,
        started_at.elapsed().as_millis(),
        cache_file_name_for_log(&file_path),
    ));

    Ok(CaptureResponse {
        base64: String::new(),
        width: hdr_image.width,
        height: hdr_image.height,
        file_path: Some(file_path_string),
        file_url: Some(file_url),
        metadata,
    })
}
