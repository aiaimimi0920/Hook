fn aggregate_contains_current_frame(
    aggregate: &LongCaptureAggregate,
    current: &RgbImage,
    axis: LongCaptureAxis,
    options: LongCaptureStitchOptions,
) -> bool {
    let Some(aggregate_signatures) = aggregate.signatures.as_ref() else {
        return false;
    };
    if aggregate_signatures.cross_len
        != match axis {
            LongCaptureAxis::Vertical => current.width(),
            LongCaptureAxis::Horizontal => current.height(),
        }
    {
        return false;
    }

    let current_signatures = axis_signature_list(current, axis);
    if aggregate_signatures.window_size != current_signatures.window_size
        || aggregate_signatures.windows.is_empty()
        || current_signatures.windows.is_empty()
    {
        return false;
    }

    let current_informative_windows = current_signatures
        .windows
        .iter()
        .filter(|signature| aggregate_window_signature_is_informative(signature))
        .count() as u32;
    if current_informative_windows == 0 {
        return false;
    }

    let min_overlap_px = options.min_overlap_px.unwrap_or_else(|| {
        default_min_overlap_px(
            current_signatures.axis_len,
            options
                .max_scan
                .unwrap_or_else(|| current_signatures.axis_len.saturating_sub(1).max(1)),
        )
    }) as i64;
    let min_match_windows = (min_overlap_px / 3)
        .max(1)
        .min(24)
        .min(current_informative_windows as i64)
        .max(1) as u32;

    aggregate_frame_is_already_covered(
        aggregate_signatures,
        &current_signatures,
        current_signatures.axis_len as i64,
        min_match_windows,
    )
}

fn find_aggregate_signature_match(
    aggregate: &LongCaptureAggregate,
    current: &RgbImage,
    axis: LongCaptureAxis,
    options: LongCaptureStitchOptions,
) -> Option<AggregateMatchCandidate> {
    let aggregate_signatures = aggregate.signatures.as_ref()?;
    if aggregate_signatures.cross_len
        != match axis {
            LongCaptureAxis::Vertical => current.width(),
            LongCaptureAxis::Horizontal => current.height(),
        }
    {
        return None;
    }

    let current_signatures = axis_signature_list(current, axis);
    if aggregate_signatures.window_size != current_signatures.window_size
        || aggregate_signatures.windows.is_empty()
        || current_signatures.windows.is_empty()
    {
        return None;
    }

    if aggregate_signatures.informative_positions.is_empty() {
        return None;
    }

    let mut current_informative_windows = 0u32;
    for signature in &current_signatures.windows {
        if aggregate_window_signature_is_informative(signature) {
            current_informative_windows += 1;
        }
    }
    if current_informative_windows == 0 {
        return None;
    }

    let aggregate_axis_len = aggregate_signatures.axis_len as i64;
    let frame_len = current_signatures.axis_len as i64;
    let min_overlap_px = options.min_overlap_px.unwrap_or_else(|| {
        default_min_overlap_px(
            current_signatures.axis_len,
            options
                .max_scan
                .unwrap_or_else(|| current_signatures.axis_len.saturating_sub(1).max(1)),
        )
    }) as i64;
    let min_match_windows = (min_overlap_px / 3)
        .max(1)
        .min(24)
        .min(current_informative_windows as i64)
        .max(1) as u32;

    if aggregate_frame_is_already_covered(
        aggregate_signatures,
        &current_signatures,
        frame_len,
        min_match_windows,
    ) {
        return None;
    }

    let max_overlap_px = aggregate_axis_len.min(frame_len);
    if max_overlap_px < min_overlap_px {
        return None;
    }
    let max_new_px = options
        .max_scan
        .unwrap_or_else(|| current_signatures.axis_len.saturating_sub(1).max(1))
        as i64;

    let mut best: Option<AggregateMatch> = None;
    for overlap_px in min_overlap_px..=max_overlap_px {
        let append_px = frame_len - overlap_px;
        if append_px > 0 && append_px <= max_new_px {
            let origin = aggregate.origin + aggregate_axis_len - overlap_px;
            if aggregate_direction_allowed(axis, origin - aggregate.origin, options.direction) {
                let mut accepted_counts = None;
                if let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
                    aggregate_signatures,
                    &current_signatures,
                    aggregate_axis_len - overlap_px,
                    0,
                    overlap_px,
                ) {
                    let required_match_windows =
                        aggregate_match_required_windows(min_match_windows, overlap_windows);
                    if match_windows >= required_match_windows {
                        accepted_counts = Some((match_windows, overlap_windows));
                    }
                }
                if accepted_counts.is_none() {
                    if let Some((match_windows, overlap_windows)) =
                        aligned_signature_fuzzy_match_counts(
                            aggregate_signatures,
                            &current_signatures,
                            aggregate_axis_len - overlap_px,
                            0,
                            overlap_px,
                        )
                    {
                        let required_match_windows = aggregate_fuzzy_match_required_windows(
                            min_match_windows,
                            overlap_windows,
                        );
                        let direction = match axis {
                            LongCaptureAxis::Vertical => LongCaptureDirection::Down,
                            LongCaptureAxis::Horizontal => LongCaptureDirection::Right,
                        };
                        if match_windows >= required_match_windows
                            && aggregate_boundary_fuzzy_match_confirms(
                                aggregate,
                                current,
                                axis,
                                direction,
                                overlap_px as u32,
                            )
                        {
                            accepted_counts = Some((match_windows, overlap_windows));
                        }
                    }
                }
                if let Some((match_windows, overlap_windows)) = accepted_counts {
                    let candidate = AggregateMatch {
                        origin,
                        overlap_px,
                        prepend_px: 0,
                        append_px,
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

        let prepend_px = frame_len - overlap_px;
        if prepend_px > 0 && prepend_px <= max_new_px {
            let origin = aggregate.origin - prepend_px;
            if aggregate_direction_allowed(axis, origin - aggregate.origin, options.direction) {
                let mut accepted_counts = None;
                if let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
                    aggregate_signatures,
                    &current_signatures,
                    0,
                    frame_len - overlap_px,
                    overlap_px,
                ) {
                    let required_match_windows =
                        aggregate_match_required_windows(min_match_windows, overlap_windows);
                    if match_windows >= required_match_windows {
                        accepted_counts = Some((match_windows, overlap_windows));
                    }
                }
                if accepted_counts.is_none() {
                    if let Some((match_windows, overlap_windows)) =
                        aligned_signature_fuzzy_match_counts(
                            aggregate_signatures,
                            &current_signatures,
                            0,
                            frame_len - overlap_px,
                            overlap_px,
                        )
                    {
                        let required_match_windows = aggregate_fuzzy_match_required_windows(
                            min_match_windows,
                            overlap_windows,
                        );
                        let direction = match axis {
                            LongCaptureAxis::Vertical => LongCaptureDirection::Up,
                            LongCaptureAxis::Horizontal => LongCaptureDirection::Left,
                        };
                        if match_windows >= required_match_windows
                            && aggregate_boundary_fuzzy_match_confirms(
                                aggregate,
                                current,
                                axis,
                                direction,
                                overlap_px as u32,
                            )
                        {
                            accepted_counts = Some((match_windows, overlap_windows));
                        }
                    }
                }
                if let Some((match_windows, overlap_windows)) = accepted_counts {
                    let candidate = AggregateMatch {
                        origin,
                        overlap_px,
                        prepend_px,
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
