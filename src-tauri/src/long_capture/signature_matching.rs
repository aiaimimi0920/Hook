fn aggregate_candidate_direction(
    axis: LongCaptureAxis,
    origin: i64,
) -> Option<LongCaptureDirection> {
    match axis {
        LongCaptureAxis::Vertical if origin > 0 => Some(LongCaptureDirection::Down),
        LongCaptureAxis::Vertical if origin < 0 => Some(LongCaptureDirection::Up),
        LongCaptureAxis::Horizontal if origin > 0 => Some(LongCaptureDirection::Right),
        LongCaptureAxis::Horizontal if origin < 0 => Some(LongCaptureDirection::Left),
        _ => None,
    }
}

fn direction_matches_axis(direction: LongCaptureDirection, axis: LongCaptureAxis) -> bool {
    direction_axis(direction) == axis
}

fn aggregate_direction_allowed(
    axis: LongCaptureAxis,
    origin: i64,
    requested: Option<LongCaptureDirection>,
) -> bool {
    let Some(requested) = requested else {
        return true;
    };
    if !direction_matches_axis(requested, axis) {
        return false;
    }
    aggregate_candidate_direction(axis, origin)
        .map(|candidate| candidate == requested)
        .unwrap_or(false)
}

fn aggregate_match_is_near_perfect(candidate: AggregateMatch) -> bool {
    let misses = candidate
        .overlap_windows
        .saturating_sub(candidate.match_windows);
    misses <= 1
        && candidate.overlap_windows > 0
        && (candidate.match_windows as u64) * 100 >= (candidate.overlap_windows as u64) * 97
}

fn aggregate_match_is_better(candidate: AggregateMatch, current: AggregateMatch) -> bool {
    let candidate_new = candidate.prepend_px + candidate.append_px;
    let current_new = current.prepend_px + current.append_px;
    let candidate_near_perfect = aggregate_match_is_near_perfect(candidate);
    let current_near_perfect = aggregate_match_is_near_perfect(current);
    let same_extension_side = (candidate.append_px > 0
        && current.append_px > 0
        && candidate.prepend_px == 0
        && current.prepend_px == 0)
        || (candidate.prepend_px > 0
            && current.prepend_px > 0
            && candidate.append_px == 0
            && current.append_px == 0);
    if same_extension_side
        && candidate_near_perfect
        && current_near_perfect
        && candidate.overlap_px != current.overlap_px
    {
        return candidate.overlap_px > current.overlap_px;
    }
    let candidate_density = candidate.match_windows as u64 * current.overlap_windows.max(1) as u64;
    let current_density = current.match_windows as u64 * candidate.overlap_windows.max(1) as u64;

    candidate_density > current_density
        || (candidate_density == current_density && candidate.match_windows > current.match_windows)
        || (candidate_density == current_density
            && candidate.match_windows == current.match_windows
            && candidate.overlap_px > current.overlap_px)
        || (candidate_density == current_density
            && candidate.match_windows == current.match_windows
            && candidate.overlap_px == current.overlap_px
            && candidate_new < current_new)
        || (candidate_density == current_density
            && candidate.match_windows == current.match_windows
            && candidate.overlap_px == current.overlap_px
            && candidate_new == current_new
            && candidate.origin.abs() < current.origin.abs())
}

fn aligned_signature_match_counts(
    aggregate_signatures: &AxisSignatureList,
    current_signatures: &AxisSignatureList,
    aggregate_window_start: i64,
    current_window_start: i64,
    overlap_px: i64,
) -> Option<(u32, u32)> {
    let window_size = aggregate_signatures.window_size as i64;
    if overlap_px < window_size
        || aggregate_signatures.window_size != current_signatures.window_size
    {
        return None;
    }

    let overlap_windows = overlap_px - window_size + 1;
    let mut match_windows = 0u32;
    let mut informative_windows = 0u32;
    for offset in 0..overlap_windows {
        let aggregate_index = aggregate_window_start + offset;
        let current_index = current_window_start + offset;
        if aggregate_index < 0
            || current_index < 0
            || aggregate_index as usize >= aggregate_signatures.windows.len()
            || current_index as usize >= current_signatures.windows.len()
        {
            return None;
        }

        let aggregate_signature = aggregate_signatures.windows[aggregate_index as usize];
        let current_signature = current_signatures.windows[current_index as usize];
        if !aggregate_window_signature_is_informative(&aggregate_signature)
            && !aggregate_window_signature_is_informative(&current_signature)
        {
            continue;
        }

        informative_windows += 1;
        if aggregate_signature == current_signature {
            match_windows += 1;
        }
    }

    if informative_windows == 0 {
        None
    } else {
        Some((match_windows, informative_windows))
    }
}

fn aggregate_signature_cross_axis_offset_count(cross_len: u32) -> u64 {
    let edge_ignore = if cross_len >= 160 {
        default_edge_ignore(cross_len).max(24).min(cross_len / 4)
    } else {
        default_edge_ignore(cross_len)
    };
    let offsets = sampled_cross_axis_offsets(cross_len, edge_ignore);
    if offsets.is_empty() {
        sampled_cross_axis_offsets(cross_len, 0).len() as u64
    } else {
        offsets.len() as u64
    }
}

fn axis_window_signature_fuzzy_matches(
    left: AxisWindowSignature,
    right: AxisWindowSignature,
    sample_count: u64,
    window_size: u32,
) -> bool {
    if left == right {
        return true;
    }
    if !aggregate_window_signature_is_informative(&left)
        && !aggregate_window_signature_is_informative(&right)
    {
        return false;
    }

    let sample_window = sample_count
        .saturating_mul(window_size.max(1) as u64)
        .max(1);
    let color_tolerance = sample_window.saturating_mul(8);
    let texture_tolerance = sample_window.saturating_mul(20);
    let content_tolerance = ((sample_window as f64) * 0.10).ceil().max(2.0) as u32;

    left.r.abs_diff(right.r) <= color_tolerance
        && left.g.abs_diff(right.g) <= color_tolerance
        && left.b.abs_diff(right.b) <= color_tolerance
        && left.texture.abs_diff(right.texture) <= texture_tolerance
        && left.content.abs_diff(right.content) <= content_tolerance
}

fn aligned_signature_fuzzy_match_counts(
    aggregate_signatures: &AxisSignatureList,
    current_signatures: &AxisSignatureList,
    aggregate_window_start: i64,
    current_window_start: i64,
    overlap_px: i64,
) -> Option<(u32, u32)> {
    let window_size = aggregate_signatures.window_size as i64;
    if overlap_px < window_size
        || aggregate_signatures.window_size != current_signatures.window_size
        || aggregate_signatures.cross_len != current_signatures.cross_len
    {
        return None;
    }

    let sample_count = aggregate_signature_cross_axis_offset_count(aggregate_signatures.cross_len);
    let overlap_windows = overlap_px - window_size + 1;
    let mut match_windows = 0u32;
    let mut informative_windows = 0u32;
    for offset in 0..overlap_windows {
        let aggregate_index = aggregate_window_start + offset;
        let current_index = current_window_start + offset;
        if aggregate_index < 0
            || current_index < 0
            || aggregate_index as usize >= aggregate_signatures.windows.len()
            || current_index as usize >= current_signatures.windows.len()
        {
            return None;
        }

        let aggregate_signature = aggregate_signatures.windows[aggregate_index as usize];
        let current_signature = current_signatures.windows[current_index as usize];
        if !aggregate_window_signature_is_informative(&aggregate_signature)
            && !aggregate_window_signature_is_informative(&current_signature)
        {
            continue;
        }

        informative_windows += 1;
        if axis_window_signature_fuzzy_matches(
            aggregate_signature,
            current_signature,
            sample_count,
            aggregate_signatures.window_size,
        ) {
            match_windows += 1;
        }
    }

    if informative_windows == 0 {
        None
    } else {
        Some((match_windows, informative_windows))
    }
}

fn aggregate_match_required_windows(min_match_windows: u32, overlap_windows: u32) -> u32 {
    min_match_windows.max(((overlap_windows as f64) * 0.65).ceil().max(1.0) as u32)
}

fn aggregate_fuzzy_match_required_windows(min_match_windows: u32, overlap_windows: u32) -> u32 {
    min_match_windows.max(((overlap_windows as f64) * 0.88).ceil().max(1.0) as u32)
}

fn aggregate_frame_is_already_covered(
    aggregate_signatures: &AxisSignatureList,
    current_signatures: &AxisSignatureList,
    frame_len: i64,
    min_match_windows: u32,
) -> bool {
    if frame_len <= 0 || frame_len > aggregate_signatures.axis_len as i64 {
        return false;
    }
    if current_signatures.windows.is_empty()
        || aggregate_signatures.informative_positions.is_empty()
    {
        return false;
    }

    let mut anchors = current_signatures
        .windows
        .iter()
        .enumerate()
        .filter_map(|(current_position, signature)| {
            if !aggregate_window_signature_is_informative(signature) {
                return None;
            }
            let positions = aggregate_signatures.informative_positions.get(signature)?;
            Some((positions.len(), current_position as i64, *signature))
        })
        .collect::<Vec<_>>();
    anchors.sort_by_key(|(position_count, _, _)| *position_count);

    let mut origin_votes = HashMap::<i64, u32>::new();
    for (_, current_position, signature) in anchors.into_iter().take(12) {
        let Some(aggregate_positions) = aggregate_signatures.informative_positions.get(&signature)
        else {
            continue;
        };
        for &aggregate_position in aggregate_positions {
            let origin_delta = aggregate_position as i64 - current_position;
            if origin_delta >= 0 && origin_delta + frame_len <= aggregate_signatures.axis_len as i64
            {
                *origin_votes.entry(origin_delta).or_insert(0) += 1;
            }
        }
    }

    let mut origins = origin_votes.into_iter().collect::<Vec<_>>();
    origins.sort_by(|(left_origin, left_votes), (right_origin, right_votes)| {
        right_votes
            .cmp(left_votes)
            .then_with(|| left_origin.abs().cmp(&right_origin.abs()))
    });

    origins.into_iter().take(64).any(|(origin_delta, _)| {
        let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
            aggregate_signatures,
            current_signatures,
            origin_delta,
            0,
            frame_len,
        ) else {
            return false;
        };
        let required =
            min_match_windows.max(((overlap_windows as f64) * 0.85).ceil().max(1.0) as u32);
        match_windows >= required
    })
}

fn aggregate_candidate_new_slice_is_already_covered(
    aggregate_signatures: &AxisSignatureList,
    current_signatures: &AxisSignatureList,
    matched: AggregateMatch,
) -> bool {
    if aggregate_signatures.window_size != current_signatures.window_size
        || aggregate_signatures.cross_len != current_signatures.cross_len
        || aggregate_signatures.informative_positions.is_empty()
    {
        return false;
    }

    let frame_len = current_signatures.axis_len as i64;
    let window_size = current_signatures.window_size as i64;
    let (new_start, new_len) = if matched.append_px > 0 && matched.prepend_px == 0 {
        (frame_len - matched.append_px, matched.append_px)
    } else if matched.prepend_px > 0 && matched.append_px == 0 {
        (0, matched.prepend_px)
    } else {
        return false;
    };
    if new_start < 0 || new_len < window_size.max(16) {
        return false;
    }

    let new_window_end = new_start + new_len - window_size + 1;
    if new_window_end <= new_start || new_window_end as usize > current_signatures.windows.len() {
        return false;
    }

    let mut anchors = current_signatures.windows[new_start as usize..new_window_end as usize]
        .iter()
        .enumerate()
        .filter_map(|(offset, signature)| {
            if !aggregate_window_signature_is_informative(signature) {
                return None;
            }
            let positions = aggregate_signatures.informative_positions.get(signature)?;
            Some((positions.len(), new_start + offset as i64, *signature))
        })
        .collect::<Vec<_>>();
    if anchors.len() < 4 {
        return false;
    }
    anchors.sort_by_key(|(position_count, _, _)| *position_count);

    let mut origin_votes = HashMap::<i64, u32>::new();
    for (_, current_position, signature) in anchors.into_iter().take(24) {
        let Some(aggregate_positions) = aggregate_signatures.informative_positions.get(&signature)
        else {
            continue;
        };
        for &aggregate_position in aggregate_positions {
            let origin_delta = aggregate_position as i64 - current_position;
            let aggregate_new_start = origin_delta + new_start;
            if aggregate_new_start >= 0
                && aggregate_new_start + new_len <= aggregate_signatures.axis_len as i64
            {
                *origin_votes.entry(origin_delta).or_insert(0) += 1;
            }
        }
    }

    let mut origins = origin_votes.into_iter().collect::<Vec<_>>();
    origins.sort_by(|(left_origin, left_votes), (right_origin, right_votes)| {
        right_votes
            .cmp(left_votes)
            .then_with(|| left_origin.abs().cmp(&right_origin.abs()))
    });

    origins.into_iter().take(64).any(|(origin_delta, _)| {
        let aggregate_new_start = origin_delta + new_start;
        let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
            aggregate_signatures,
            current_signatures,
            aggregate_new_start,
            new_start,
            new_len,
        ) else {
            return false;
        };
        let required = ((overlap_windows as f64) * 0.92).ceil().max(4.0) as u32;
        match_windows >= required
    })
}

fn rebuild_informative_positions(
    windows: &[AxisWindowSignature],
) -> HashMap<AxisWindowSignature, Vec<u32>> {
    let mut informative_positions = HashMap::<AxisWindowSignature, Vec<u32>>::new();
    for (position, signature) in windows.iter().enumerate() {
        if aggregate_window_signature_is_informative(signature) {
            informative_positions
                .entry(*signature)
                .or_default()
                .push(position as u32);
        }
    }
    informative_positions
}

fn axis_signature_list_from_windows(
    axis_len: u32,
    cross_len: u32,
    window_size: u32,
    windows: Vec<AxisWindowSignature>,
) -> AxisSignatureList {
    let informative_positions = rebuild_informative_positions(&windows);
    AxisSignatureList {
        axis_len,
        cross_len,
        window_size,
        windows,
        informative_positions,
    }
}

fn merge_axis_signature_lists(
    aggregate_signatures: &AxisSignatureList,
    current_signatures: &AxisSignatureList,
    matched: AggregateMatch,
) -> Option<AxisSignatureList> {
    if aggregate_signatures.window_size != current_signatures.window_size
        || aggregate_signatures.cross_len != current_signatures.cross_len
    {
        return None;
    }

    let new_axis_len = i64::from(aggregate_signatures.axis_len)
        .checked_add(matched.prepend_px)?
        .checked_add(matched.append_px)
        .and_then(|len| u32::try_from(len).ok())?;
    let mut windows = Vec::new();
    if matched.prepend_px > 0 {
        let prepend_count = matched.prepend_px as usize;
        if prepend_count > current_signatures.windows.len() {
            return None;
        }
        let capacity = current_signatures
            .windows
            .len()
            .checked_add(aggregate_signatures.windows.len())?;
        windows.try_reserve(capacity).ok()?;
        windows.extend_from_slice(&current_signatures.windows[..prepend_count]);
        windows.extend_from_slice(&aggregate_signatures.windows);
    } else if matched.append_px > 0 {
        let append_count = matched.append_px as usize;
        if append_count > current_signatures.windows.len() {
            return None;
        }
        let append_start = current_signatures.windows.len() - append_count;
        let capacity = aggregate_signatures.windows.len().checked_add(append_count)?;
        windows.try_reserve(capacity).ok()?;
        windows.extend_from_slice(&aggregate_signatures.windows);
        windows.extend_from_slice(&current_signatures.windows[append_start..]);
    } else {
        windows.extend_from_slice(&aggregate_signatures.windows);
    }

    Some(axis_signature_list_from_windows(
        new_axis_len,
        aggregate_signatures.cross_len,
        aggregate_signatures.window_size,
        windows,
    ))
}
