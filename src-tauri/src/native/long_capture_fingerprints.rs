// Owns long-capture frame sampling, near-duplicate detection, and motion classification.

fn long_capture_frame_fingerprint(frame: &image::RgbImage) -> LongCaptureFrameFingerprint {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for &byte in frame.as_raw() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    LongCaptureFrameFingerprint {
        width: frame.width(),
        height: frame.height(),
        byte_len: frame.as_raw().len(),
        hash,
        sampled_pixels: long_capture_frame_fingerprint_samples(frame),
        motion: long_capture::long_capture_motion_fingerprint(frame),
    }
}

fn long_capture_sample_axis_offsets(len: u32) -> Vec<u32> {
    if len == 0 {
        return Vec::new();
    }
    let sample_count = len.min(32);
    (0..sample_count)
        .map(|index| (((index as u64 * 2 + 1) * len as u64) / (sample_count as u64 * 2)) as u32)
        .map(|index| index.min(len.saturating_sub(1)))
        .collect()
}

fn long_capture_frame_fingerprint_samples(frame: &image::RgbImage) -> Vec<[u8; 3]> {
    let x_offsets = long_capture_sample_axis_offsets(frame.width());
    let y_offsets = long_capture_sample_axis_offsets(frame.height());
    let mut sampled_pixels = Vec::with_capacity(x_offsets.len() * y_offsets.len());
    for y in y_offsets {
        for &x in &x_offsets {
            sampled_pixels.push(frame.get_pixel(x, y).0);
        }
    }
    sampled_pixels
}

fn long_capture_fingerprints_are_near_duplicate(
    previous: &LongCaptureFrameFingerprint,
    current: &LongCaptureFrameFingerprint,
) -> bool {
    if previous.width != current.width
        || previous.height != current.height
        || previous.byte_len != current.byte_len
        || previous.sampled_pixels.len() != current.sampled_pixels.len()
        || previous.sampled_pixels.is_empty()
    {
        return false;
    }

    let mut changed = 0usize;
    let mut diff_total = 0u64;
    for (previous, current) in previous
        .sampled_pixels
        .iter()
        .zip(current.sampled_pixels.iter())
    {
        let diff = previous[0].abs_diff(current[0]) as u32
            + previous[1].abs_diff(current[1]) as u32
            + previous[2].abs_diff(current[2]) as u32;
        if diff >= 48 {
            changed += 1;
        }
        diff_total += diff as u64;
    }

    let total = previous.sampled_pixels.len();
    let changed_ratio = changed as f64 / total as f64;
    let mean_diff = diff_total as f64 / total as f64;
    changed_ratio <= 0.015 && mean_diff <= 8.0
}

fn classify_long_capture_recording_fingerprint(
    previous: Option<&LongCaptureFrameFingerprint>,
    current: &LongCaptureFrameFingerprint,
    axis: Option<long_capture::LongCaptureAxis>,
    max_scan: u32,
    min_overlap_px: u32,
) -> LongCaptureRecordingClassification {
    match previous {
        Some(previous)
            if previous == current
                || long_capture_fingerprints_are_near_duplicate(previous, current) =>
        {
            LongCaptureRecordingClassification {
                status: LongCaptureSessionSampleStatus::Duplicate,
                analysis: None,
            }
        }
        Some(previous) => {
            let motion_analysis = long_capture::analyze_long_capture_motion_fingerprints(
                &previous.motion,
                &current.motion,
                long_capture::LongCaptureAnalyzeOptions {
                    axis,
                    direction: None,
                    max_scan: Some(max_scan),
                    min_overlap_px: Some(min_overlap_px),
                    min_new_content_px: Some(1),
                },
            );
            if motion_analysis.is_some() {
                LongCaptureRecordingClassification {
                    status: LongCaptureSessionSampleStatus::Recorded,
                    analysis: None,
                }
            } else {
                LongCaptureRecordingClassification {
                    status: LongCaptureSessionSampleStatus::Duplicate,
                    analysis: None,
                }
            }
        }
        None => LongCaptureRecordingClassification {
            status: LongCaptureSessionSampleStatus::Recorded,
            analysis: None,
        },
    }
}

#[cfg(test)]
fn classify_long_capture_recording_frame(
    previous: Option<&image::RgbImage>,
    current: &image::RgbImage,
    _axis: Option<long_capture::LongCaptureAxis>,
    _max_scan: u32,
    _min_overlap_px: u32,
    _min_new_content_px: u32,
) -> LongCaptureRecordingClassification {
    let previous_fingerprint = previous.map(long_capture_frame_fingerprint);
    let current_fingerprint = long_capture_frame_fingerprint(current);
    classify_long_capture_recording_fingerprint(
        previous_fingerprint.as_ref(),
        &current_fingerprint,
        _axis,
        _max_scan,
        _min_overlap_px,
    )
}
