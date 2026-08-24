fn sorted_starts_inclusive(starts: &[u32], minimum: u32, maximum: u32) -> &[u32] {
    if minimum > maximum {
        return &[];
    }
    let first = starts.partition_point(|start| *start < minimum);
    let after_last = starts.partition_point(|start| *start <= maximum);
    &starts[first..after_last]
}

fn find_vertical_down_fixed_chrome_candidate(
    previous: &RgbImage,
    current: &RgbImage,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> Option<CandidateAnalysis> {
    let height = previous.height();
    let signature_window = LINE_SIGNATURE_WINDOW.min(height).max(1);
    let signature_offsets =
        choose_signature_cross_axis_offsets(cross_axis_weights, cross_axis_offsets);
    let previous_signatures =
        rolling_line_signatures(previous, &signature_offsets, signature_window);
    let current_signatures = rolling_line_signatures(current, &signature_offsets, signature_window);
    if previous_signatures.is_empty() || current_signatures.is_empty() {
        return None;
    }

    let mut current_signature_rows = HashMap::<RollingLineSignature, Vec<u32>>::new();
    let current_last_start = height - signature_window;
    for start in 0..=current_last_start {
        if let Some(signature) = current_signatures[start as usize] {
            current_signature_rows
                .entry(signature)
                .or_default()
                .push(start);
        }
    }

    let mut delta_hints = HashMap::<u32, SignatureDeltaHint>::new();
    let previous_last_start = height - signature_window;
    for prev_start in 0..=previous_last_start {
        let Some(signature) = previous_signatures[prev_start as usize] else {
            continue;
        };
        let Some(current_starts) = current_signature_rows.get(&signature) else {
            continue;
        };
        let minimum = prev_start.saturating_sub(max_scan);
        let maximum = prev_start.saturating_sub(min_new_content_px);
        for &curr_start in sorted_starts_inclusive(current_starts, minimum, maximum) {
            if prev_start <= curr_start {
                continue;
            }
            let append_px = prev_start - curr_start;
            if append_px < min_new_content_px || append_px > max_scan {
                continue;
            }
            let crop_start_px = height.saturating_sub(append_px);
            if crop_start_px <= curr_start {
                continue;
            }
            let overlap_px = crop_start_px - curr_start;
            if overlap_px < min_overlap_px {
                continue;
            }

            delta_hints
                .entry(append_px)
                .and_modify(|hint| {
                    hint.match_count += 1;
                    hint.min_current_line = hint.min_current_line.min(curr_start);
                })
                .or_insert(SignatureDeltaHint {
                    match_count: 1,
                    min_current_line: curr_start,
                });
        }
    }

    let mut best: Option<CandidateAnalysis> = None;
    for (append_px, hint) in delta_hints {
        if hint.match_count < 2 {
            continue;
        }

        let crop_start_px = height.saturating_sub(append_px);
        if crop_start_px <= hint.min_current_line {
            continue;
        }
        let overlap_px = crop_start_px - hint.min_current_line;
        if overlap_px < min_overlap_px {
            continue;
        }
        let prev_start = height.saturating_sub(overlap_px);
        let (ratio, mean_diff, texture_score, content_ratio) = vertical_overlap_score(
            previous,
            current,
            prev_start,
            hint.min_current_line,
            overlap_px,
            cross_axis_weights,
            cross_axis_offsets,
        );
        let confidence = score_confidence(ratio, mean_diff);
        let candidate = CandidateAnalysis {
            direction: LongCaptureDirection::Down,
            overlap_px,
            crop_start_px,
            append_px,
            confidence: (confidence + (hint.match_count as f64 * 0.015)).clamp(0.0, 1.0),
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

    best
}

fn find_vertical_up_fixed_chrome_candidate(
    previous: &RgbImage,
    current: &RgbImage,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> Option<CandidateAnalysis> {
    let height = previous.height();
    let signature_window = LINE_SIGNATURE_WINDOW.min(height).max(1);
    let signature_offsets =
        choose_signature_cross_axis_offsets(cross_axis_weights, cross_axis_offsets);
    let previous_signatures =
        rolling_line_signatures(previous, &signature_offsets, signature_window);
    let current_signatures = rolling_line_signatures(current, &signature_offsets, signature_window);
    if previous_signatures.is_empty() || current_signatures.is_empty() {
        return None;
    }

    let mut current_signature_rows = HashMap::<RollingLineSignature, Vec<u32>>::new();
    let current_last_start = height - signature_window;
    for start in 0..=current_last_start {
        if let Some(signature) = current_signatures[start as usize] {
            current_signature_rows
                .entry(signature)
                .or_default()
                .push(start);
        }
    }

    let mut delta_hints = HashMap::<u32, SignatureDeltaHint>::new();
    let previous_last_start = height - signature_window;
    for prev_start in 0..=previous_last_start {
        let Some(signature) = previous_signatures[prev_start as usize] else {
            continue;
        };
        let Some(current_starts) = current_signature_rows.get(&signature) else {
            continue;
        };
        let minimum = prev_start.saturating_add(min_new_content_px);
        let maximum = prev_start.saturating_add(max_scan);
        for &curr_start in sorted_starts_inclusive(current_starts, minimum, maximum) {
            if curr_start <= prev_start {
                continue;
            }
            let append_px = curr_start - prev_start;
            if append_px < min_new_content_px || append_px > max_scan {
                continue;
            }
            let overlap_px = height.saturating_sub(append_px);
            if overlap_px < min_overlap_px {
                continue;
            }

            delta_hints
                .entry(append_px)
                .and_modify(|hint| {
                    hint.match_count += 1;
                    hint.min_current_line = hint.min_current_line.min(curr_start);
                })
                .or_insert(SignatureDeltaHint {
                    match_count: 1,
                    min_current_line: curr_start,
                });
        }
    }

    let mut best: Option<CandidateAnalysis> = None;
    for (append_px, hint) in delta_hints {
        if hint.match_count < 2 {
            continue;
        }

        let overlap_px = height.saturating_sub(append_px);
        if overlap_px < min_overlap_px {
            continue;
        }
        let (ratio, mean_diff, texture_score, content_ratio) = vertical_overlap_score(
            previous,
            current,
            0,
            append_px,
            overlap_px,
            cross_axis_weights,
            cross_axis_offsets,
        );
        let confidence = score_confidence(ratio, mean_diff);
        let candidate = CandidateAnalysis {
            direction: LongCaptureDirection::Up,
            overlap_px,
            crop_start_px: append_px,
            append_px,
            confidence: (confidence + (hint.match_count as f64 * 0.015)).clamp(0.0, 1.0),
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

    best
}

fn find_horizontal_right_fixed_chrome_candidate(
    previous: &RgbImage,
    current: &RgbImage,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> Option<CandidateAnalysis> {
    let width = previous.width();
    let signature_window = LINE_SIGNATURE_WINDOW.min(width).max(1);
    let signature_offsets =
        choose_signature_cross_axis_offsets(cross_axis_weights, cross_axis_offsets);
    let previous_signatures =
        rolling_column_signatures(previous, &signature_offsets, signature_window);
    let current_signatures =
        rolling_column_signatures(current, &signature_offsets, signature_window);
    if previous_signatures.is_empty() || current_signatures.is_empty() {
        return None;
    }

    let mut current_signature_columns = HashMap::<RollingLineSignature, Vec<u32>>::new();
    let current_last_start = width - signature_window;
    for start in 0..=current_last_start {
        if let Some(signature) = current_signatures[start as usize] {
            current_signature_columns
                .entry(signature)
                .or_default()
                .push(start);
        }
    }

    let mut delta_hints = HashMap::<u32, SignatureDeltaHint>::new();
    let previous_last_start = width - signature_window;
    for prev_start in 0..=previous_last_start {
        let Some(signature) = previous_signatures[prev_start as usize] else {
            continue;
        };
        let Some(current_starts) = current_signature_columns.get(&signature) else {
            continue;
        };
        let minimum = prev_start.saturating_sub(max_scan);
        let maximum = prev_start.saturating_sub(min_new_content_px);
        for &curr_start in sorted_starts_inclusive(current_starts, minimum, maximum) {
            if prev_start <= curr_start {
                continue;
            }
            let append_px = prev_start - curr_start;
            if append_px < min_new_content_px || append_px > max_scan {
                continue;
            }
            let crop_start_px = width.saturating_sub(append_px);
            if crop_start_px <= curr_start {
                continue;
            }
            let overlap_px = crop_start_px - curr_start;
            if overlap_px < min_overlap_px {
                continue;
            }

            delta_hints
                .entry(append_px)
                .and_modify(|hint| {
                    hint.match_count += 1;
                    hint.min_current_line = hint.min_current_line.min(curr_start);
                })
                .or_insert(SignatureDeltaHint {
                    match_count: 1,
                    min_current_line: curr_start,
                });
        }
    }

    let mut best: Option<CandidateAnalysis> = None;
    for (append_px, hint) in delta_hints {
        if hint.match_count < 2 {
            continue;
        }

        let crop_start_px = width.saturating_sub(append_px);
        if crop_start_px <= hint.min_current_line {
            continue;
        }
        let overlap_px = crop_start_px - hint.min_current_line;
        if overlap_px < min_overlap_px {
            continue;
        }
        let prev_start = width.saturating_sub(overlap_px);
        let (ratio, mean_diff, texture_score, content_ratio) = horizontal_overlap_score(
            previous,
            current,
            prev_start,
            hint.min_current_line,
            overlap_px,
            cross_axis_weights,
            cross_axis_offsets,
        );
        let confidence = score_confidence(ratio, mean_diff);
        let candidate = CandidateAnalysis {
            direction: LongCaptureDirection::Right,
            overlap_px,
            crop_start_px,
            append_px,
            confidence: (confidence + (hint.match_count as f64 * 0.015)).clamp(0.0, 1.0),
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

    best
}

fn find_horizontal_left_fixed_chrome_candidate(
    previous: &RgbImage,
    current: &RgbImage,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> Option<CandidateAnalysis> {
    let width = previous.width();
    let signature_window = LINE_SIGNATURE_WINDOW.min(width).max(1);
    let signature_offsets =
        choose_signature_cross_axis_offsets(cross_axis_weights, cross_axis_offsets);
    let previous_signatures =
        rolling_column_signatures(previous, &signature_offsets, signature_window);
    let current_signatures =
        rolling_column_signatures(current, &signature_offsets, signature_window);
    if previous_signatures.is_empty() || current_signatures.is_empty() {
        return None;
    }

    let mut current_signature_columns = HashMap::<RollingLineSignature, Vec<u32>>::new();
    let current_last_start = width - signature_window;
    for start in 0..=current_last_start {
        if let Some(signature) = current_signatures[start as usize] {
            current_signature_columns
                .entry(signature)
                .or_default()
                .push(start);
        }
    }

    let mut delta_hints = HashMap::<u32, SignatureDeltaHint>::new();
    let previous_last_start = width - signature_window;
    for prev_start in 0..=previous_last_start {
        let Some(signature) = previous_signatures[prev_start as usize] else {
            continue;
        };
        let Some(current_starts) = current_signature_columns.get(&signature) else {
            continue;
        };
        let minimum = prev_start.saturating_add(min_new_content_px);
        let maximum = prev_start.saturating_add(max_scan);
        for &curr_start in sorted_starts_inclusive(current_starts, minimum, maximum) {
            if curr_start <= prev_start {
                continue;
            }
            let append_px = curr_start - prev_start;
            if append_px < min_new_content_px || append_px > max_scan {
                continue;
            }
            let overlap_px = width.saturating_sub(append_px);
            if overlap_px < min_overlap_px {
                continue;
            }

            delta_hints
                .entry(append_px)
                .and_modify(|hint| {
                    hint.match_count += 1;
                    hint.min_current_line = hint.min_current_line.min(curr_start);
                })
                .or_insert(SignatureDeltaHint {
                    match_count: 1,
                    min_current_line: curr_start,
                });
        }
    }

    let mut best: Option<CandidateAnalysis> = None;
    for (append_px, hint) in delta_hints {
        if hint.match_count < 2 {
            continue;
        }

        let overlap_px = width.saturating_sub(append_px);
        if overlap_px < min_overlap_px {
            continue;
        }
        let (ratio, mean_diff, texture_score, content_ratio) = horizontal_overlap_score(
            previous,
            current,
            0,
            append_px,
            overlap_px,
            cross_axis_weights,
            cross_axis_offsets,
        );
        let confidence = score_confidence(ratio, mean_diff);
        let candidate = CandidateAnalysis {
            direction: LongCaptureDirection::Left,
            overlap_px,
            crop_start_px: append_px,
            append_px,
            confidence: (confidence + (hint.match_count as f64 * 0.015)).clamp(0.0, 1.0),
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

    best
}
