pub fn analyze_long_capture_pair_images(
    previous: &RgbImage,
    current: &RgbImage,
    options: LongCaptureAnalyzeOptions,
) -> LongCaptureOverlapAnalysis {
    if previous.width() != current.width() || previous.height() != current.height() {
        return LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::NoOverlap,
            axis: options.axis,
            direction: options.direction,
            overlap_px: 0,
            crop_start_px: 0,
            append_px: 0,
            confidence: 0.0,
            seam_px: 0,
        };
    }

    if previous.as_raw() == current.as_raw() {
        return LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::Duplicate,
            axis: options.axis,
            direction: options.direction,
            overlap_px: previous.height().max(previous.width()),
            crop_start_px: 0,
            append_px: 0,
            confidence: 1.0,
            seam_px: 0,
        };
    }
    if is_near_duplicate_image(previous, current) {
        return LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::Duplicate,
            axis: options.axis,
            direction: options.direction,
            overlap_px: previous.height().max(previous.width()),
            crop_start_px: 0,
            append_px: 0,
            confidence: 0.99,
            seam_px: 0,
        };
    }

    let max_dimension = previous.height().max(previous.width());
    let max_scan = options
        .max_scan
        .unwrap_or_else(|| max_dimension.saturating_sub(1).max(1))
        .clamp(1, max_dimension.saturating_sub(1).max(1));
    let min_new_content_px = options.min_new_content_px.unwrap_or(8);

    if options.axis.is_none() && options.direction.is_none() {
        return analyze_auto_axis_by_image_content(
            previous,
            current,
            max_scan,
            options.min_overlap_px,
            min_new_content_px,
        )
        .unwrap_or(LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::NoOverlap,
            axis: None,
            direction: None,
            overlap_px: 0,
            crop_start_px: 0,
            append_px: 0,
            confidence: 0.0,
            seam_px: 0,
        });
    }

    let mut best: Option<(LongCaptureAxis, CandidateAnalysis)> = None;
    for direction in candidate_directions(options.axis, options.direction) {
        let candidate_axis = direction_axis(direction);
        let axis_len = match candidate_axis {
            LongCaptureAxis::Vertical => previous.height(),
            LongCaptureAxis::Horizontal => previous.width(),
        };
        let min_overlap_px = options
            .min_overlap_px
            .unwrap_or_else(|| default_min_overlap_px(axis_len, max_scan));
        let candidate = match candidate_axis {
            LongCaptureAxis::Vertical => analyze_vertical_direction(
                previous,
                current,
                direction,
                max_scan,
                min_overlap_px,
                min_new_content_px,
            ),
            LongCaptureAxis::Horizontal => analyze_horizontal_direction(
                previous,
                current,
                direction,
                max_scan,
                min_overlap_px,
                min_new_content_px,
            ),
        };

        if let Some(candidate) = candidate {
            let axis = direction_axis(candidate.direction);
            if best
                .map(|(_, item)| candidate_is_better(candidate, item, axis_len, min_new_content_px))
                .unwrap_or(true)
            {
                best = Some((axis, candidate));
            }
        }
    }

    best.map(|(axis, candidate)| classify_candidate(candidate, axis, min_new_content_px))
        .unwrap_or(LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::NoOverlap,
            axis: options.axis,
            direction: options.direction,
            overlap_px: 0,
            crop_start_px: 0,
            append_px: 0,
            confidence: 0.0,
            seam_px: 0,
        })
}

pub fn analyze_long_capture_pair_data_urls(
    previous: &str,
    current: &str,
    options: LongCaptureAnalyzeOptions,
) -> Result<LongCaptureOverlapAnalysis> {
    let previous = decode_frame_data_url(previous)?;
    let current = decode_frame_data_url(current)?;
    Ok(analyze_long_capture_pair_images(
        &previous, &current, options,
    ))
}
