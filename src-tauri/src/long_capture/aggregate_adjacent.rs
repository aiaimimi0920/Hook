fn aggregate_boundary_fuzzy_match_confirms(
    aggregate: &LongCaptureAggregate,
    current: &RgbImage,
    axis: LongCaptureAxis,
    direction: LongCaptureDirection,
    overlap_px: u32,
) -> bool {
    let boundary = match crop_aggregate_boundary(aggregate, axis, direction, overlap_px) {
        Some(boundary) => boundary,
        None => return false,
    };

    match direction {
        LongCaptureDirection::Down if axis == LongCaptureAxis::Vertical => {
            if boundary.width() != current.width()
                || overlap_px == 0
                || overlap_px > current.height()
            {
                return false;
            }
            let edge_ignore = default_edge_ignore(current.width());
            let offsets = sampled_cross_axis_offsets(current.width(), edge_ignore);
            let weights = vec![1.0; current.width() as usize];
            let (ratio, mean_diff, texture_score, content_ratio) =
                vertical_overlap_score(&boundary, current, 0, 0, overlap_px, &weights, &offsets);
            score_confidence(ratio, mean_diff) >= 0.65
                && (texture_score >= 12.0 || content_ratio >= 0.01)
        }
        LongCaptureDirection::Up if axis == LongCaptureAxis::Vertical => {
            if boundary.width() != current.width()
                || overlap_px == 0
                || overlap_px > current.height()
            {
                return false;
            }
            let edge_ignore = default_edge_ignore(current.width());
            let offsets = sampled_cross_axis_offsets(current.width(), edge_ignore);
            let weights = vec![1.0; current.width() as usize];
            let curr_start = current.height() - overlap_px;
            let (ratio, mean_diff, texture_score, content_ratio) = vertical_overlap_score(
                &boundary, current, 0, curr_start, overlap_px, &weights, &offsets,
            );
            score_confidence(ratio, mean_diff) >= 0.65
                && (texture_score >= 12.0 || content_ratio >= 0.01)
        }
        LongCaptureDirection::Right if axis == LongCaptureAxis::Horizontal => {
            if boundary.height() != current.height()
                || overlap_px == 0
                || overlap_px > current.width()
            {
                return false;
            }
            let edge_ignore = default_edge_ignore(current.height());
            let offsets = sampled_cross_axis_offsets(current.height(), edge_ignore);
            let weights = vec![1.0; current.height() as usize];
            let (ratio, mean_diff, texture_score, content_ratio) =
                horizontal_overlap_score(&boundary, current, 0, 0, overlap_px, &weights, &offsets);
            score_confidence(ratio, mean_diff) >= 0.65
                && (texture_score >= 12.0 || content_ratio >= 0.01)
        }
        LongCaptureDirection::Left if axis == LongCaptureAxis::Horizontal => {
            if boundary.height() != current.height()
                || overlap_px == 0
                || overlap_px > current.width()
            {
                return false;
            }
            let edge_ignore = default_edge_ignore(current.height());
            let offsets = sampled_cross_axis_offsets(current.height(), edge_ignore);
            let weights = vec![1.0; current.height() as usize];
            let curr_start = current.width() - overlap_px;
            let (ratio, mean_diff, texture_score, content_ratio) = horizontal_overlap_score(
                &boundary, current, 0, curr_start, overlap_px, &weights, &offsets,
            );
            score_confidence(ratio, mean_diff) >= 0.65
                && (texture_score >= 12.0 || content_ratio >= 0.01)
        }
        _ => false,
    }
}

fn aggregate_match_from_adjacent_signatures(
    aggregate: &LongCaptureAggregate,
    previous_signatures: &AxisSignatureList,
    current: &RgbImage,
    axis: LongCaptureAxis,
    options: LongCaptureStitchOptions,
) -> Option<AggregateMatchCandidate> {
    let aggregate_signatures = aggregate.signatures.as_ref()?;
    let current_signatures = axis_signature_list(current, axis);
    if aggregate_signatures.cross_len != current_signatures.cross_len
        || aggregate_signatures.window_size != current_signatures.window_size
        || previous_signatures.cross_len != current_signatures.cross_len
        || previous_signatures.window_size != current_signatures.window_size
        || current_signatures.windows.is_empty()
        || previous_signatures.windows.is_empty()
    {
        return None;
    }

    let current_informative_windows = current_signatures
        .windows
        .iter()
        .filter(|signature| aggregate_window_signature_is_informative(signature))
        .count() as u32;
    if current_informative_windows == 0 {
        return None;
    }

    let previous_axis_len = previous_signatures.axis_len as i64;
    let aggregate_axis_len = i64::from(aggregate_axis_len(aggregate, axis)?);
    let frame_len = current_signatures.axis_len as i64;
    let min_overlap_px = options.min_overlap_px.unwrap_or_else(|| {
        default_min_overlap_px(
            current_signatures.axis_len,
            options
                .max_scan
                .unwrap_or_else(|| current_signatures.axis_len.saturating_sub(1).max(1)),
        )
    }) as i64;
    let max_new_px = options
        .max_scan
        .unwrap_or_else(|| current_signatures.axis_len.saturating_sub(1).max(1))
        as i64;
    let max_overlap_px = previous_axis_len.min(frame_len);
    if max_overlap_px < min_overlap_px {
        return None;
    }
    let min_match_windows = (min_overlap_px / 3)
        .max(1)
        .min(24)
        .min(current_informative_windows as i64)
        .max(1) as u32;

    let mut best: Option<AggregateMatch> = None;
    for overlap_px in min_overlap_px..=max_overlap_px {
        let new_px = frame_len - overlap_px;
        if new_px <= 0 || new_px > max_new_px {
            continue;
        }

        let direction = match axis {
            LongCaptureAxis::Vertical => LongCaptureDirection::Down,
            LongCaptureAxis::Horizontal => LongCaptureDirection::Right,
        };
        if aggregate_direction_allowed(axis, aggregate_axis_len - overlap_px, options.direction) {
            if let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
                previous_signatures,
                &current_signatures,
                previous_axis_len - overlap_px,
                0,
                overlap_px,
            ) {
                let required_match_windows =
                    aggregate_match_required_windows(min_match_windows, overlap_windows);
                if match_windows >= required_match_windows
                    && aggregate_boundary_fuzzy_match_confirms(
                        aggregate,
                        current,
                        axis,
                        direction,
                        overlap_px as u32,
                    )
                {
                    let candidate = AggregateMatch {
                        origin: aggregate.origin + aggregate_axis_len - overlap_px,
                        overlap_px,
                        prepend_px: 0,
                        append_px: new_px,
                        match_windows,
                        overlap_windows,
                    };
                    if best
                        .map(|current| aggregate_match_is_better(candidate, current))
                        .unwrap_or(true)
                    {
                        best = Some(candidate);
                    }
                }
            }
        }

        let direction = match axis {
            LongCaptureAxis::Vertical => LongCaptureDirection::Up,
            LongCaptureAxis::Horizontal => LongCaptureDirection::Left,
        };
        if aggregate_direction_allowed(axis, -new_px, options.direction) {
            if let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
                previous_signatures,
                &current_signatures,
                0,
                frame_len - overlap_px,
                overlap_px,
            ) {
                let required_match_windows =
                    aggregate_match_required_windows(min_match_windows, overlap_windows);
                if match_windows >= required_match_windows
                    && aggregate_boundary_fuzzy_match_confirms(
                        aggregate,
                        current,
                        axis,
                        direction,
                        overlap_px as u32,
                    )
                {
                    let candidate = AggregateMatch {
                        origin: aggregate.origin - new_px,
                        overlap_px,
                        prepend_px: new_px,
                        append_px: 0,
                        match_windows,
                        overlap_windows,
                    };
                    if best
                        .map(|current| aggregate_match_is_better(candidate, current))
                        .unwrap_or(true)
                    {
                        best = Some(candidate);
                    }
                }
            }
        }
    }

    best.map(|matched| AggregateMatchCandidate {
        matched,
        current_signatures,
    })
}

fn aggregate_match_direction(
    matched: AggregateMatch,
    axis: LongCaptureAxis,
) -> Option<LongCaptureDirection> {
    match axis {
        LongCaptureAxis::Vertical if matched.append_px > 0 && matched.prepend_px == 0 => {
            Some(LongCaptureDirection::Down)
        }
        LongCaptureAxis::Vertical if matched.prepend_px > 0 && matched.append_px == 0 => {
            Some(LongCaptureDirection::Up)
        }
        LongCaptureAxis::Horizontal if matched.append_px > 0 && matched.prepend_px == 0 => {
            Some(LongCaptureDirection::Right)
        }
        LongCaptureAxis::Horizontal if matched.prepend_px > 0 && matched.append_px == 0 => {
            Some(LongCaptureDirection::Left)
        }
        _ => None,
    }
}

fn choose_aggregate_match_candidate(
    exact: Option<AggregateMatchCandidate>,
    directed: Option<AggregateMatchCandidate>,
    axis: LongCaptureAxis,
) -> Option<AggregateMatchCandidate> {
    match (exact, directed) {
        (Some(exact), Some(directed)) => {
            let exact_direction = aggregate_match_direction(exact.matched, axis);
            let directed_direction = aggregate_match_direction(directed.matched, axis);
            if exact_direction.is_some()
                && directed_direction.is_some()
                && exact_direction != directed_direction
            {
                return Some(directed);
            }
            if aggregate_match_is_better(directed.matched, exact.matched) {
                Some(directed)
            } else {
                Some(exact)
            }
        }
        (Some(exact), None) => Some(exact),
        (None, Some(directed)) => Some(directed),
        (None, None) => None,
    }
}
