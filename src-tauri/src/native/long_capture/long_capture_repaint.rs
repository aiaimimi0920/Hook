// Bounded pixel validation rescues scrolling whose overlap was slightly repainted.
// The thumbnail is only an admission check; full-resolution aggregate matching
// still determines the final seam and can reject a candidate. No pixels are logged.
fn long_capture_validation_thumbnail(frame: &image::RgbImage) -> image::RgbImage {
    if frame.width() <= 320 && frame.height() <= 320 {
        frame.clone()
    } else {
        image::imageops::thumbnail(frame, 320, 320)
    }
}

fn long_capture_repaint_motion_is_valid(
    previous: &LongCaptureFrameFingerprint,
    current: &LongCaptureFrameFingerprint,
    axis: Option<long_capture::LongCaptureAxis>,
    max_scan: u32,
    min_overlap_px: u32,
) -> bool {
    if previous.width != current.width || previous.height != current.height {
        return false;
    }
    let scale = current.validation_thumbnail.width() as f64 / current.width.max(1) as f64;
    let analysis = long_capture::analyze_long_capture_pair_images(
        &previous.validation_thumbnail,
        &current.validation_thumbnail,
        long_capture::LongCaptureAnalyzeOptions {
            axis,
            direction: None,
            max_scan: Some((max_scan as f64 * scale).ceil().max(1.0) as u32),
            min_overlap_px: Some((min_overlap_px as f64 * scale).ceil().max(8.0) as u32),
            min_new_content_px: Some(1),
        },
    );
    matches!(
        analysis.status,
        long_capture::LongCaptureOverlapStatus::Good
    ) && analysis.append_px > 0
}

fn log_long_capture_classification(reason: &str) {
    static LAST_LOG: std::sync::Mutex<Option<Instant>> = std::sync::Mutex::new(None);
    if let Ok(mut last) = LAST_LOG.lock() {
        let now = Instant::now();
        if last.is_none_or(|instant| now.duration_since(instant) >= Duration::from_secs(1)) {
            append_runtime_log_line(&format!("long_capture_classification :: reason={reason}"));
            *last = Some(now);
        }
    }
}
