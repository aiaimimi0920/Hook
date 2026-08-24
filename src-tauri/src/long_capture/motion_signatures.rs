fn signature_hash_mix(mut hash: u64, value: u64) -> u64 {
    hash ^= value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    hash = hash.wrapping_mul(0x1000_0000_01b3);
    hash.rotate_left(13)
}

fn aggregate_signature_cross_axis_offsets(image: &RgbImage, axis: LongCaptureAxis) -> Vec<u32> {
    let cross_len = match axis {
        LongCaptureAxis::Vertical => image.width(),
        LongCaptureAxis::Horizontal => image.height(),
    };
    let edge_ignore = if cross_len >= 160 {
        default_edge_ignore(cross_len).max(24).min(cross_len / 4)
    } else {
        default_edge_ignore(cross_len)
    };
    let offsets = sampled_cross_axis_offsets(cross_len, edge_ignore);
    if offsets.is_empty() {
        sampled_cross_axis_offsets(cross_len, 0)
    } else {
        offsets
    }
}

fn axis_line_signature(
    image: &RgbImage,
    axis: LongCaptureAxis,
    index: u32,
    cross_axis_offsets: &[u32],
) -> AxisLineSignature {
    let mut r = 0u64;
    let mut g = 0u64;
    let mut b = 0u64;
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    let mut texture = 0u64;
    let mut content = 0u32;

    match axis {
        LongCaptureAxis::Vertical => {
            for &x in cross_axis_offsets {
                let pixel = image.get_pixel(x, index).0;
                r += pixel[0] as u64;
                g += pixel[1] as u64;
                b += pixel[2] as u64;
                texture += local_texture_strength(image, x, index) as u64;
                if is_content_pixel(pixel) {
                    content += 1;
                }
                let packed = ((pixel[0] as u64) << 16) | ((pixel[1] as u64) << 8) | pixel[2] as u64;
                hash = signature_hash_mix(hash, packed ^ x as u64);
            }
        }
        LongCaptureAxis::Horizontal => {
            for &y in cross_axis_offsets {
                let pixel = image.get_pixel(index, y).0;
                r += pixel[0] as u64;
                g += pixel[1] as u64;
                b += pixel[2] as u64;
                texture += local_texture_strength(image, index, y) as u64;
                if is_content_pixel(pixel) {
                    content += 1;
                }
                let packed = ((pixel[0] as u64) << 16) | ((pixel[1] as u64) << 8) | pixel[2] as u64;
                hash = signature_hash_mix(hash, packed ^ y as u64);
            }
        }
    }

    AxisLineSignature {
        r,
        g,
        b,
        hash,
        texture,
        content,
    }
}

fn aggregate_window_signature_is_informative(signature: &AxisWindowSignature) -> bool {
    signature.content > 0 || signature.texture >= 24
}

fn axis_signature_list(image: &RgbImage, axis: LongCaptureAxis) -> AxisSignatureList {
    let axis_len = match axis {
        LongCaptureAxis::Vertical => image.height(),
        LongCaptureAxis::Horizontal => image.width(),
    };
    let cross_len = match axis {
        LongCaptureAxis::Vertical => image.width(),
        LongCaptureAxis::Horizontal => image.height(),
    };
    let window_size = AGGREGATE_SIGNATURE_WINDOW.min((axis_len / 2).max(1)).max(1);
    let cross_axis_offsets = aggregate_signature_cross_axis_offsets(image, axis);
    let mut lines = Vec::with_capacity(axis_len as usize);
    for index in 0..axis_len {
        lines.push(axis_line_signature(image, axis, index, &cross_axis_offsets));
    }

    let mut windows = Vec::new();
    let mut informative_positions = HashMap::<AxisWindowSignature, Vec<u32>>::new();
    if axis_len >= window_size {
        windows.reserve((axis_len - window_size + 1) as usize);
        for start in 0..=axis_len - window_size {
            let mut r = 0u64;
            let mut g = 0u64;
            let mut b = 0u64;
            let mut hash = 0xcbf2_9ce4_8422_2325u64;
            let mut texture = 0u64;
            let mut content = 0u32;
            for offset in 0..window_size {
                let line = lines[(start + offset) as usize];
                r += line.r;
                g += line.g;
                b += line.b;
                texture += line.texture;
                content += line.content;
                hash = signature_hash_mix(hash, line.hash ^ offset as u64);
            }
            windows.push(AxisWindowSignature {
                r,
                g,
                b,
                hash,
                texture,
                content,
            });
            let signature = *windows
                .last()
                .expect("signature was just appended to the windows list");
            if aggregate_window_signature_is_informative(&signature) {
                informative_positions
                    .entry(signature)
                    .or_default()
                    .push(start);
            }
        }
    }

    AxisSignatureList {
        axis_len,
        cross_len,
        window_size,
        windows,
        informative_positions,
    }
}

pub(crate) fn long_capture_motion_fingerprint(image: &RgbImage) -> LongCaptureMotionFingerprint {
    LongCaptureMotionFingerprint {
        width: image.width(),
        height: image.height(),
        vertical: axis_signature_list(image, LongCaptureAxis::Vertical),
        horizontal: axis_signature_list(image, LongCaptureAxis::Horizontal),
    }
}

fn motion_signature_candidate_for_direction(
    previous: &AxisSignatureList,
    current: &AxisSignatureList,
    axis: LongCaptureAxis,
    direction: LongCaptureDirection,
    max_scan: u32,
    min_overlap_px: u32,
    min_new_content_px: u32,
) -> Option<AggregateMatch> {
    if previous.cross_len != current.cross_len
        || previous.window_size != current.window_size
        || previous.windows.is_empty()
        || current.windows.is_empty()
        || !direction_matches_axis(direction, axis)
    {
        return None;
    }

    let current_informative_windows = current
        .windows
        .iter()
        .filter(|signature| aggregate_window_signature_is_informative(signature))
        .count() as u32;
    let previous_informative_windows = previous
        .windows
        .iter()
        .filter(|signature| aggregate_window_signature_is_informative(signature))
        .count() as u32;
    if current_informative_windows == 0 || previous_informative_windows == 0 {
        return None;
    }

    let previous_axis_len = previous.axis_len as i64;
    let current_axis_len = current.axis_len as i64;
    let max_new_px = max_scan.min(current.axis_len.saturating_sub(1)).max(1) as i64;
    let min_new_content_px = min_new_content_px.max(1) as i64;
    let min_overlap_px = min_overlap_px
        .min(current.axis_len.saturating_sub(1).max(1))
        .max(1) as i64;
    let max_overlap_px = previous_axis_len.min(current_axis_len);
    if max_overlap_px < min_overlap_px {
        return None;
    }

    let min_match_windows = (min_overlap_px / 3)
        .max(1)
        .min(24)
        .min(current_informative_windows.min(previous_informative_windows) as i64)
        .max(1) as u32;
    let mut best: Option<AggregateMatch> = None;

    for overlap_px in min_overlap_px..=max_overlap_px {
        let new_px = current_axis_len - overlap_px;
        if new_px < min_new_content_px || new_px > max_new_px {
            continue;
        }

        let (previous_window_start, current_window_start, prepend_px, append_px, origin) =
            match direction {
                LongCaptureDirection::Down | LongCaptureDirection::Right => {
                    (previous_axis_len - overlap_px, 0, 0, new_px, new_px)
                }
                LongCaptureDirection::Up | LongCaptureDirection::Left => {
                    (0, current_axis_len - overlap_px, new_px, 0, -new_px)
                }
            };

        let Some((match_windows, overlap_windows)) = aligned_signature_match_counts(
            previous,
            current,
            previous_window_start,
            current_window_start,
            overlap_px,
        ) else {
            continue;
        };
        let required_match_windows =
            aggregate_match_required_windows(min_match_windows, overlap_windows);
        if match_windows < required_match_windows {
            continue;
        }

        let candidate = AggregateMatch {
            origin,
            overlap_px,
            prepend_px,
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

    best
}

fn motion_signature_analysis_for_axis(
    previous: &AxisSignatureList,
    current: &AxisSignatureList,
    axis: LongCaptureAxis,
    options: LongCaptureAnalyzeOptions,
) -> Option<LongCaptureOverlapAnalysis> {
    let max_scan = options
        .max_scan
        .unwrap_or_else(|| current.axis_len.saturating_sub(1).max(1));
    let min_overlap_px = options
        .min_overlap_px
        .unwrap_or_else(|| default_min_overlap_px(current.axis_len, max_scan));
    let min_new_content_px = options.min_new_content_px.unwrap_or(1).max(1);
    let directions: Vec<LongCaptureDirection> = candidate_directions(Some(axis), options.direction)
        .into_iter()
        .filter(|direction| direction_matches_axis(*direction, axis))
        .collect();
    let mut best: Option<(LongCaptureDirection, AggregateMatch)> = None;

    for direction in directions {
        let Some(candidate) = motion_signature_candidate_for_direction(
            previous,
            current,
            axis,
            direction,
            max_scan,
            min_overlap_px,
            min_new_content_px,
        ) else {
            continue;
        };
        if best
            .map(|(_, current)| aggregate_match_is_better(candidate, current))
            .unwrap_or(true)
        {
            best = Some((direction, candidate));
        }
    }

    best.map(|(direction, candidate)| {
        let append_px = (candidate.prepend_px + candidate.append_px).max(0) as u32;
        let crop_start_px = match direction {
            LongCaptureDirection::Down | LongCaptureDirection::Right => candidate.overlap_px,
            LongCaptureDirection::Up | LongCaptureDirection::Left => append_px as i64,
        }
        .max(0) as u32;
        LongCaptureOverlapAnalysis {
            status: LongCaptureOverlapStatus::Good,
            axis: Some(axis),
            direction: Some(direction),
            overlap_px: candidate.overlap_px.max(0) as u32,
            crop_start_px,
            append_px,
            confidence: candidate.match_windows as f64 / candidate.overlap_windows.max(1) as f64,
            seam_px: crop_start_px,
        }
    })
}

pub(crate) fn analyze_long_capture_motion_fingerprints(
    previous: &LongCaptureMotionFingerprint,
    current: &LongCaptureMotionFingerprint,
    options: LongCaptureAnalyzeOptions,
) -> Option<LongCaptureOverlapAnalysis> {
    if previous.width != current.width || previous.height != current.height {
        return None;
    }

    let candidate_axes: &[LongCaptureAxis] = match options.axis {
        Some(LongCaptureAxis::Vertical) => &[LongCaptureAxis::Vertical],
        Some(LongCaptureAxis::Horizontal) => &[LongCaptureAxis::Horizontal],
        None => &[LongCaptureAxis::Vertical, LongCaptureAxis::Horizontal],
    };

    let mut best: Option<LongCaptureOverlapAnalysis> = None;
    for axis in candidate_axes {
        let analysis = match axis {
            LongCaptureAxis::Vertical => motion_signature_analysis_for_axis(
                &previous.vertical,
                &current.vertical,
                LongCaptureAxis::Vertical,
                options,
            ),
            LongCaptureAxis::Horizontal => motion_signature_analysis_for_axis(
                &previous.horizontal,
                &current.horizontal,
                LongCaptureAxis::Horizontal,
                options,
            ),
        };
        let Some(analysis) = analysis else {
            continue;
        };
        if options.axis.is_none() {
            let axis_len = match axis {
                LongCaptureAxis::Vertical => previous.height,
                LongCaptureAxis::Horizontal => previous.width,
            };
            if !analysis_confirms_axis(&analysis, axis_len) {
                continue;
            }
        }
        if best
            .map(|current| {
                let candidate = AggregateMatch {
                    origin: match analysis.direction {
                        Some(LongCaptureDirection::Down | LongCaptureDirection::Right) => {
                            analysis.append_px as i64
                        }
                        Some(LongCaptureDirection::Up | LongCaptureDirection::Left) => {
                            -(analysis.append_px as i64)
                        }
                        None => 0,
                    },
                    overlap_px: analysis.overlap_px as i64,
                    prepend_px: if matches!(
                        analysis.direction,
                        Some(LongCaptureDirection::Up | LongCaptureDirection::Left)
                    ) {
                        analysis.append_px as i64
                    } else {
                        0
                    },
                    append_px: if matches!(
                        analysis.direction,
                        Some(LongCaptureDirection::Down | LongCaptureDirection::Right)
                    ) {
                        analysis.append_px as i64
                    } else {
                        0
                    },
                    match_windows: (analysis.confidence * analysis.overlap_px.max(1) as f64).round()
                        as u32,
                    overlap_windows: analysis.overlap_px.max(1),
                };
                let current = AggregateMatch {
                    origin: match current.direction {
                        Some(LongCaptureDirection::Down | LongCaptureDirection::Right) => {
                            current.append_px as i64
                        }
                        Some(LongCaptureDirection::Up | LongCaptureDirection::Left) => {
                            -(current.append_px as i64)
                        }
                        None => 0,
                    },
                    overlap_px: current.overlap_px as i64,
                    prepend_px: if matches!(
                        current.direction,
                        Some(LongCaptureDirection::Up | LongCaptureDirection::Left)
                    ) {
                        current.append_px as i64
                    } else {
                        0
                    },
                    append_px: if matches!(
                        current.direction,
                        Some(LongCaptureDirection::Down | LongCaptureDirection::Right)
                    ) {
                        current.append_px as i64
                    } else {
                        0
                    },
                    match_windows: (current.confidence * current.overlap_px.max(1) as f64).round()
                        as u32,
                    overlap_windows: current.overlap_px.max(1),
                };
                aggregate_match_is_better(candidate, current)
            })
            .unwrap_or(true)
        {
            best = Some(analysis);
        }
    }

    best
}
