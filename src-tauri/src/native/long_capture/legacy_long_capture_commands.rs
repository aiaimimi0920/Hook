// Owns stateless long-capture frame capture, analysis, and stitching commands.

#[tauri::command]
async fn capture_vertical_long_region(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    max_frames: Option<u32>,
    scroll_delta: Option<i32>,
    settle_ms: Option<u64>,
    overlap_scan: Option<u32>,
) -> Result<CaptureResponse, String> {
    let started_at = std::time::Instant::now();
    let stitched = long_capture::capture_vertical_long_region(
        x,
        y,
        w,
        h,
        max_frames.unwrap_or(8),
        scroll_delta.unwrap_or(-480),
        settle_ms.unwrap_or(180),
        overlap_scan.unwrap_or((h / 3).clamp(32, 240)),
    )
    .map_err(|error| error.to_string())?;

    let width = stitched.width();
    let height = stitched.height();
    let mut bytes = Vec::new();
    let dynamic_image = image::DynamicImage::ImageRgb8(stitched);
    dynamic_image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|error| error.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    append_runtime_log_line(&format!(
        "capture_vertical_long_region_metrics :: elapsed_ms={} png_bytes={} encoded_bytes={} width={} height={}",
        started_at.elapsed().as_millis(),
        bytes.len(),
        b64.len(),
        width,
        height
    ));

    Ok(CaptureResponse {
        base64: format!("data:image/png;base64,{}", b64),
        width,
        height,
        file_path: None,
        file_url: None,
        metadata: CaptureMetadata::sdr("long-capture", false),
    })
}

#[tauri::command]
async fn stitch_vertical_long_capture_frames(
    frames: Vec<String>,
    overlap_scan: Option<u32>,
) -> Result<CaptureResponse, String> {
    let started_at = std::time::Instant::now();
    let input_frame_count = frames.len();
    if input_frame_count > MAX_STITCH_FRAME_COUNT {
        return Err(format!(
            "Too many frames to stitch: {} exceeds limit of {}",
            input_frame_count, MAX_STITCH_FRAME_COUNT
        ));
    }
    let stitched = long_capture::stitch_vertical_frame_data_urls(
        &frames,
        overlap_scan.unwrap_or(160).clamp(32, 480),
    )
    .map_err(|error| error.to_string())?;

    let width = stitched.width();
    let height = stitched.height();
    let mut bytes = Vec::new();
    let dynamic_image = image::DynamicImage::ImageRgb8(stitched);
    dynamic_image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|error| error.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    append_runtime_log_line(&format!(
        "stitch_vertical_long_capture_frames_metrics :: elapsed_ms={} frames={} png_bytes={} encoded_bytes={} width={} height={}",
        started_at.elapsed().as_millis(),
        input_frame_count,
        bytes.len(),
        b64.len(),
        width,
        height
    ));

    Ok(CaptureResponse {
        base64: format!("data:image/png;base64,{}", b64),
        width,
        height,
        file_path: None,
        file_url: None,
        metadata: CaptureMetadata::sdr("long-capture-stitch", false),
    })
}

#[tauri::command]
async fn analyze_long_capture_pair(
    previous: String,
    current: String,
    axis: Option<long_capture::LongCaptureAxis>,
    direction: Option<long_capture::LongCaptureDirection>,
    max_scan: Option<u32>,
    min_overlap_px: Option<u32>,
    min_new_content_px: Option<u32>,
) -> Result<long_capture::LongCaptureOverlapAnalysis, String> {
    let started_at = std::time::Instant::now();
    let analysis = long_capture::analyze_long_capture_pair_data_urls(
        &previous,
        &current,
        long_capture::LongCaptureAnalyzeOptions {
            axis,
            direction,
            max_scan,
            min_overlap_px,
            min_new_content_px,
        },
    )
    .map_err(|error| error.to_string())?;
    append_runtime_log_line(&format!(
        "analyze_long_capture_pair_metrics :: elapsed_ms={} previous_chars={} current_chars={} status={:?} axis={:?} direction={:?} overlap_px={} append_px={} confidence={:.3}",
        started_at.elapsed().as_millis(),
        previous.len(),
        current.len(),
        analysis.status,
        analysis.axis,
        analysis.direction,
        analysis.overlap_px,
        analysis.append_px,
        analysis.confidence
    ));
    Ok(analysis)
}

#[tauri::command]
async fn stitch_long_capture_frames(
    frames: Vec<String>,
    axis: Option<long_capture::LongCaptureAxis>,
    direction: Option<long_capture::LongCaptureDirection>,
    max_scan: Option<u32>,
    min_overlap_px: Option<u32>,
) -> Result<CaptureResponse, String> {
    let started_at = std::time::Instant::now();
    let input_frame_count = frames.len();
    if input_frame_count > MAX_STITCH_FRAME_COUNT {
        return Err(format!(
            "Too many frames to stitch: {} exceeds limit of {}",
            input_frame_count, MAX_STITCH_FRAME_COUNT
        ));
    }
    let stitched = long_capture::stitch_long_capture_frame_data_urls(
        &frames,
        long_capture::LongCaptureStitchOptions {
            axis,
            direction,
            max_scan,
            min_overlap_px,
        },
    )
    .map_err(|error| error.to_string())?;

    let width = stitched.width();
    let height = stitched.height();
    let mut bytes = Vec::new();
    let dynamic_image = image::DynamicImage::ImageRgb8(stitched);
    dynamic_image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|error| error.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    append_runtime_log_line(&format!(
        "stitch_long_capture_frames_metrics :: elapsed_ms={} frames={} axis={:?} direction={:?} png_bytes={} encoded_bytes={} width={} height={}",
        started_at.elapsed().as_millis(),
        input_frame_count,
        axis,
        direction,
        bytes.len(),
        b64.len(),
        width,
        height
    ));

    Ok(CaptureResponse {
        base64: format!("data:image/png;base64,{}", b64),
        width,
        height,
        file_path: None,
        file_url: None,
        metadata: CaptureMetadata::sdr("long-capture-stitch", false),
    })
}
