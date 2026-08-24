fn analyze_vertical_direction(
    previous: &RgbImage,
    current: &RgbImage,
    direction: LongCaptureDirection,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
) -> Option<CandidateAnalysis> {
    if previous.width() != current.width() || previous.height() != current.height() {
        return None;
    }

    let height = previous.height();
    if height == 0 {
        return None;
    }

    let limit = max_scan.min(height.saturating_sub(1)).max(1);
    let min_overlap = min_overlap_px.min(limit).max(1);
    let edge_ignore = default_edge_ignore(previous.width());
    let cross_axis_weights = vertical_cross_axis_weights(previous, current, edge_ignore);
    let cross_axis_offsets = sampled_cross_axis_offsets(previous.width(), edge_ignore);
    let mut best: Option<CandidateAnalysis> = None;

    match direction {
        LongCaptureDirection::Down => {
            if let Some(candidate) = find_vertical_down_fixed_chrome_candidate(
                previous,
                current,
                max_scan,
                min_overlap,
                min_new_content_px,
                &cross_axis_weights,
                &cross_axis_offsets,
            ) {
                if candidate_is_fast_recording_match(candidate, min_new_content_px, height) {
                    return Some(candidate);
                }
                best = Some(candidate);
            }
            for overlap_px in min_overlap..=limit {
                let prev_start = height.saturating_sub(overlap_px);
                let (ratio, mean_diff, texture_score, content_ratio) = vertical_overlap_score(
                    previous,
                    current,
                    prev_start,
                    0,
                    overlap_px,
                    &cross_axis_weights,
                    &cross_axis_offsets,
                );
                let confidence = score_confidence(ratio, mean_diff);
                let append_px = height.saturating_sub(overlap_px);
                let candidate = CandidateAnalysis {
                    direction,
                    overlap_px,
                    crop_start_px: overlap_px,
                    append_px,
                    confidence,
                    mean_diff,
                    texture_score,
                    content_ratio,
                };
                if best
                    .map(|item| candidate_is_better(candidate, item, height, min_new_content_px))
                    .unwrap_or(true)
                {
                    best = Some(candidate);
                }
            }
        }
        LongCaptureDirection::Up => {
            if let Some(candidate) = find_vertical_up_fixed_chrome_candidate(
                previous,
                current,
                max_scan,
                min_overlap,
                min_new_content_px,
                &cross_axis_weights,
                &cross_axis_offsets,
            ) {
                if candidate_is_fast_recording_match(candidate, min_new_content_px, height) {
                    return Some(candidate);
                }
                best = Some(candidate);
            }
            let search_start = height.saturating_sub(limit);
            let search_end = height.saturating_sub(min_overlap);
            for curr_start in search_start..=search_end {
                let overlap_px = height.saturating_sub(curr_start);
                let (ratio, mean_diff, texture_score, content_ratio) = vertical_overlap_score(
                    previous,
                    current,
                    0,
                    curr_start,
                    overlap_px,
                    &cross_axis_weights,
                    &cross_axis_offsets,
                );
                let confidence = score_confidence(ratio, mean_diff);
                let append_px = curr_start;
                let candidate = CandidateAnalysis {
                    direction,
                    overlap_px,
                    crop_start_px: curr_start,
                    append_px,
                    confidence,
                    mean_diff,
                    texture_score,
                    content_ratio,
                };
                if best
                    .map(|item| candidate_is_better(candidate, item, height, min_new_content_px))
                    .unwrap_or(true)
                {
                    best = Some(candidate);
                }
            }
        }
        LongCaptureDirection::Right | LongCaptureDirection::Left => return None,
    }

    best
}

fn analyze_horizontal_direction(
    previous: &RgbImage,
    current: &RgbImage,
    direction: LongCaptureDirection,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
) -> Option<CandidateAnalysis> {
    if previous.width() != current.width() || previous.height() != current.height() {
        return None;
    }

    let width = previous.width();
    if width == 0 {
        return None;
    }

    let limit = max_scan.min(width.saturating_sub(1)).max(1);
    let min_overlap = min_overlap_px.min(limit).max(1);
    let edge_ignore = default_edge_ignore(previous.height());
    let cross_axis_weights = horizontal_cross_axis_weights(previous, current, edge_ignore);
    let cross_axis_offsets = sampled_cross_axis_offsets(previous.height(), edge_ignore);
    let mut best: Option<CandidateAnalysis> = None;

    match direction {
        LongCaptureDirection::Right => {
            if let Some(candidate) = find_horizontal_right_fixed_chrome_candidate(
                previous,
                current,
                max_scan,
                min_overlap,
                min_new_content_px,
                &cross_axis_weights,
                &cross_axis_offsets,
            ) {
                if candidate_is_fast_recording_match(candidate, min_new_content_px, width) {
                    return Some(candidate);
                }
                best = Some(candidate);
            }
            for overlap_px in min_overlap..=limit {
                let prev_start = width.saturating_sub(overlap_px);
                let (ratio, mean_diff, texture_score, content_ratio) = horizontal_overlap_score(
                    previous,
                    current,
                    prev_start,
                    0,
                    overlap_px,
                    &cross_axis_weights,
                    &cross_axis_offsets,
                );
                let confidence = score_confidence(ratio, mean_diff);
                let append_px = width.saturating_sub(overlap_px);
                let candidate = CandidateAnalysis {
                    direction,
                    overlap_px,
                    crop_start_px: overlap_px,
                    append_px,
                    confidence,
                    mean_diff,
                    texture_score,
                    content_ratio,
                };
                if best
                    .map(|item| candidate_is_better(candidate, item, width, min_new_content_px))
                    .unwrap_or(true)
                {
                    best = Some(candidate);
                }
            }
        }
        LongCaptureDirection::Left => {
            if let Some(candidate) = find_horizontal_left_fixed_chrome_candidate(
                previous,
                current,
                max_scan,
                min_overlap,
                min_new_content_px,
                &cross_axis_weights,
                &cross_axis_offsets,
            ) {
                if candidate_is_fast_recording_match(candidate, min_new_content_px, width) {
                    return Some(candidate);
                }
                best = Some(candidate);
            }
            let search_start = width.saturating_sub(limit);
            let search_end = width.saturating_sub(min_overlap);
            for curr_start in search_start..=search_end {
                let overlap_px = width.saturating_sub(curr_start);
                let (ratio, mean_diff, texture_score, content_ratio) = horizontal_overlap_score(
                    previous,
                    current,
                    0,
                    curr_start,
                    overlap_px,
                    &cross_axis_weights,
                    &cross_axis_offsets,
                );
                let confidence = score_confidence(ratio, mean_diff);
                let append_px = curr_start;
                let candidate = CandidateAnalysis {
                    direction,
                    overlap_px,
                    crop_start_px: curr_start,
                    append_px,
                    confidence,
                    mean_diff,
                    texture_score,
                    content_ratio,
                };
                if best
                    .map(|item| candidate_is_better(candidate, item, width, min_new_content_px))
                    .unwrap_or(true)
                {
                    best = Some(candidate);
                }
            }
        }
        LongCaptureDirection::Down | LongCaptureDirection::Up => return None,
    }

    best
}

fn direction_axis(direction: LongCaptureDirection) -> LongCaptureAxis {
    match direction {
        LongCaptureDirection::Down | LongCaptureDirection::Up => LongCaptureAxis::Vertical,
        LongCaptureDirection::Right | LongCaptureDirection::Left => LongCaptureAxis::Horizontal,
    }
}

fn candidate_directions(
    axis: Option<LongCaptureAxis>,
    direction: Option<LongCaptureDirection>,
) -> Vec<LongCaptureDirection> {
    if let Some(direction) = direction {
        return vec![direction];
    }

    match axis {
        Some(LongCaptureAxis::Vertical) => {
            vec![LongCaptureDirection::Down, LongCaptureDirection::Up]
        }
        Some(LongCaptureAxis::Horizontal) => {
            vec![LongCaptureDirection::Right, LongCaptureDirection::Left]
        }
        None => vec![
            LongCaptureDirection::Down,
            LongCaptureDirection::Up,
            LongCaptureDirection::Right,
            LongCaptureDirection::Left,
        ],
    }
}

fn classify_candidate(
    candidate: CandidateAnalysis,
    axis: LongCaptureAxis,
    min_new_content_px: u32,
) -> LongCaptureOverlapAnalysis {
    let has_texture_signal = candidate.texture_score >= 24.0 && candidate.content_ratio >= 0.01;
    let status =
        if has_texture_signal && candidate.confidence >= 0.88 && candidate.mean_diff <= 12.0 {
            if candidate.append_px < min_new_content_px {
                LongCaptureOverlapStatus::TooSmallMotion
            } else {
                LongCaptureOverlapStatus::Good
            }
        } else if has_texture_signal && candidate.confidence >= 0.65 {
            if candidate.append_px < min_new_content_px {
                LongCaptureOverlapStatus::TooSmallMotion
            } else {
                LongCaptureOverlapStatus::Weak
            }
        } else {
            LongCaptureOverlapStatus::NoOverlap
        };

    LongCaptureOverlapAnalysis {
        status,
        axis: Some(axis),
        direction: Some(candidate.direction),
        overlap_px: candidate.overlap_px,
        crop_start_px: candidate.crop_start_px,
        append_px: candidate.append_px,
        confidence: candidate.confidence,
        seam_px: candidate.crop_start_px,
    }
}

fn analyze_axis_candidate(
    previous: &RgbImage,
    current: &RgbImage,
    axis: LongCaptureAxis,
    directions: &[LongCaptureDirection],
    max_scan: u32,
    min_overlap_px: Option<u32>,
    min_new_content_px: u32,
) -> Option<CandidateAnalysis> {
    let axis_len = match axis {
        LongCaptureAxis::Vertical => previous.height(),
        LongCaptureAxis::Horizontal => previous.width(),
    };
    let min_overlap_px =
        min_overlap_px.unwrap_or_else(|| default_min_overlap_px(axis_len, max_scan));
    let mut best: Option<CandidateAnalysis> = None;

    for &direction in directions {
        let candidate = match axis {
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
            if best
                .map(|item| candidate_is_better(candidate, item, axis_len, min_new_content_px))
                .unwrap_or(true)
            {
                best = Some(candidate);
            }
        }
    }

    best
}

fn analysis_confirms_axis(analysis: &LongCaptureOverlapAnalysis, axis_len: u32) -> bool {
    matches!(
        analysis.status,
        LongCaptureOverlapStatus::Good | LongCaptureOverlapStatus::TooSmallMotion
    ) && analysis.overlap_px.saturating_mul(2) >= axis_len
}

fn analyze_auto_axis_by_image_content(
    previous: &RgbImage,
    current: &RgbImage,
    max_scan: u32,
    min_overlap_px: Option<u32>,
    min_new_content_px: u32,
) -> Option<LongCaptureOverlapAnalysis> {
    const VERTICAL_DIRECTIONS: [LongCaptureDirection; 2] =
        [LongCaptureDirection::Down, LongCaptureDirection::Up];
    const HORIZONTAL_DIRECTIONS: [LongCaptureDirection; 2] =
        [LongCaptureDirection::Right, LongCaptureDirection::Left];

    if let Some(candidate) = analyze_axis_candidate(
        previous,
        current,
        LongCaptureAxis::Vertical,
        &VERTICAL_DIRECTIONS,
        max_scan,
        min_overlap_px,
        min_new_content_px,
    ) {
        let analysis = classify_candidate(candidate, LongCaptureAxis::Vertical, min_new_content_px);
        if analysis_confirms_axis(&analysis, previous.height()) {
            return Some(analysis);
        }
    }

    if let Some(candidate) = analyze_axis_candidate(
        previous,
        current,
        LongCaptureAxis::Horizontal,
        &HORIZONTAL_DIRECTIONS,
        max_scan,
        min_overlap_px,
        min_new_content_px,
    ) {
        let analysis =
            classify_candidate(candidate, LongCaptureAxis::Horizontal, min_new_content_px);
        if analysis_confirms_axis(&analysis, previous.width()) {
            return Some(analysis);
        }
    }

    None
}
