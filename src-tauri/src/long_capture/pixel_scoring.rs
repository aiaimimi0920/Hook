pub(crate) fn is_near_duplicate_image(previous: &RgbImage, current: &RgbImage) -> bool {
    if previous.width() != current.width() || previous.height() != current.height() {
        return false;
    }

    let x_offsets = sampled_axis_offsets(previous.width(), 0, 64);
    let y_offsets = sampled_axis_offsets(previous.height(), 0, 64);
    if x_offsets.is_empty() || y_offsets.is_empty() {
        return false;
    }

    let mut total = 0u64;
    let mut changed = 0u64;
    let mut diff_total = 0u64;
    let mut max_diff = 0u32;

    for &y in &y_offsets {
        for &x in &x_offsets {
            let diff = pixel_diff_sum(previous.get_pixel(x, y).0, current.get_pixel(x, y).0);
            if diff >= 18 {
                changed += 1;
            }
            max_diff = max_diff.max(diff);
            diff_total += diff as u64;
            total += 1;
        }
    }

    if total == 0 {
        return false;
    }

    let changed_ratio = changed as f64 / total as f64;
    let mean_diff = diff_total as f64 / total as f64;
    changed_ratio <= 0.01 && mean_diff <= 3.0 && max_diff <= 48
}

fn fallback_uniform_weights(weights: &mut [f64], start: u32, end: u32) {
    for index in start..end {
        weights[index as usize] = 1.0;
    }
}

fn dynamic_column_or_row_weight(significant_count: u32, max_diff: u32, sample_count: u32) -> f64 {
    let significant_ratio = significant_count as f64 / sample_count.max(1) as f64;
    let peak_score = (max_diff as f64 / 160.0).clamp(0.0, 1.0);
    (significant_ratio * 1.8 + peak_score * 0.2).clamp(0.0, 1.0)
}

fn candidate_priority(candidate: CandidateAnalysis, axis_len: u32) -> f64 {
    let overlap_ratio = (candidate.overlap_px as f64 / axis_len.max(1) as f64).clamp(0.0, 1.0);
    let diff_score = (1.0 - (candidate.mean_diff / 64.0)).clamp(0.0, 1.0);
    (candidate.confidence * 0.65 + diff_score * 0.25 + overlap_ratio * 0.10).clamp(0.0, 1.0)
}

fn candidate_is_fast_recording_match(
    candidate: CandidateAnalysis,
    min_new_content_px: u32,
    axis_len: u32,
) -> bool {
    let max_fast_append_px = axis_len.saturating_sub(1).min(24).max(min_new_content_px);
    candidate.append_px >= min_new_content_px
        && candidate.append_px <= max_fast_append_px
        && candidate.texture_score >= 24.0
        && candidate.content_ratio >= 0.01
        && candidate.confidence >= 0.88
        && candidate.mean_diff <= 12.0
}

fn vertical_cross_axis_weights(
    previous: &RgbImage,
    current: &RgbImage,
    edge_ignore: u32,
) -> Vec<f64> {
    let width = previous.width();
    let height = previous.height();
    let start_x = edge_ignore.min(width);
    let end_x = width.saturating_sub(edge_ignore).max(start_x);
    let rows = sample_count(height);
    let mut weights = vec![0.0; width as usize];
    let mut total_weight = 0.0;

    for x in start_x..end_x {
        let mut significant_count = 0;
        let mut max_diff = 0;
        for row_index in 0..rows {
            let y = sampled_offset(row_index, rows, height);
            let diff = pixel_diff_sum(previous.get_pixel(x, y).0, current.get_pixel(x, y).0);
            if diff >= 45 {
                significant_count += 1;
            }
            max_diff = max_diff.max(diff);
        }
        let weight = dynamic_column_or_row_weight(significant_count, max_diff, rows);
        weights[x as usize] = weight;
        total_weight += weight;
    }

    if total_weight < 1.0 {
        fallback_uniform_weights(&mut weights, start_x, end_x);
    }

    weights
}

fn horizontal_cross_axis_weights(
    previous: &RgbImage,
    current: &RgbImage,
    edge_ignore: u32,
) -> Vec<f64> {
    let width = previous.width();
    let height = previous.height();
    let start_y = edge_ignore.min(height);
    let end_y = height.saturating_sub(edge_ignore).max(start_y);
    let columns = sample_count(width);
    let mut weights = vec![0.0; height as usize];
    let mut total_weight = 0.0;

    for y in start_y..end_y {
        let mut significant_count = 0;
        let mut max_diff = 0;
        for column_index in 0..columns {
            let x = sampled_offset(column_index, columns, width);
            let diff = pixel_diff_sum(previous.get_pixel(x, y).0, current.get_pixel(x, y).0);
            if diff >= 45 {
                significant_count += 1;
            }
            max_diff = max_diff.max(diff);
        }
        let weight = dynamic_column_or_row_weight(significant_count, max_diff, columns);
        weights[y as usize] = weight;
        total_weight += weight;
    }

    if total_weight < 1.0 {
        fallback_uniform_weights(&mut weights, start_y, end_y);
    }

    weights
}

fn local_texture_strength(image: &RgbImage, x: u32, y: u32) -> u32 {
    let pixel = image.get_pixel(x, y).0;
    let mut strength = 0;

    if x > 0 {
        strength = strength.max(pixel_diff_sum(pixel, image.get_pixel(x - 1, y).0));
    }
    if x + 1 < image.width() {
        strength = strength.max(pixel_diff_sum(pixel, image.get_pixel(x + 1, y).0));
    }
    if y > 0 {
        strength = strength.max(pixel_diff_sum(pixel, image.get_pixel(x, y - 1).0));
    }
    if y + 1 < image.height() {
        strength = strength.max(pixel_diff_sum(pixel, image.get_pixel(x, y + 1).0));
    }

    strength
}

fn color_content_strength(pixel: [u8; 3]) -> u32 {
    let min_channel = pixel[0].min(pixel[1]).min(pixel[2]);
    let max_channel = pixel[0].max(pixel[1]).max(pixel[2]);
    let saturation = (max_channel as i32 - min_channel as i32).unsigned_abs();
    let darkness = 255u32.saturating_sub(max_channel as u32);
    saturation.max(darkness)
}

fn is_content_pixel(pixel: [u8; 3]) -> bool {
    color_content_strength(pixel) >= 18
}

fn pixel_texture_weight(
    previous: &RgbImage,
    current: &RgbImage,
    prev_x: u32,
    prev_y: u32,
    curr_x: u32,
    curr_y: u32,
) -> f64 {
    let strength = local_texture_strength(previous, prev_x, prev_y)
        .max(local_texture_strength(current, curr_x, curr_y))
        .max(color_content_strength(previous.get_pixel(prev_x, prev_y).0))
        .max(color_content_strength(current.get_pixel(curr_x, curr_y).0));
    0.03 + 0.97 * (strength as f64 / 96.0).clamp(0.0, 1.0)
}

fn motion_weight(diff: u32) -> f64 {
    0.02 + 0.98 * (diff as f64 / 96.0).clamp(0.0, 1.0)
}

fn vertical_overlap_score(
    previous: &RgbImage,
    current: &RgbImage,
    prev_y: u32,
    curr_y: u32,
    overlap_len: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> (f64, f64, f64, f64) {
    let rows = sample_count(overlap_len);
    let mut matched = 0.0;
    let mut total = 0.0;
    let mut diff_total = 0.0;
    let mut texture_total = 0.0;
    let mut texture_count = 0.0f64;
    let mut content_total = 0.0;

    for row_index in 0..rows {
        let y_offset = sampled_offset(row_index, rows, overlap_len);
        for &x in cross_axis_offsets {
            let weight = cross_axis_weights.get(x as usize).copied().unwrap_or(1.0);
            if weight <= 0.0 {
                continue;
            }
            let diff = pixel_diff_sum(
                previous.get_pixel(x, prev_y + y_offset).0,
                current.get_pixel(x, curr_y + y_offset).0,
            );
            let same_viewport_y = curr_y + y_offset;
            let same_viewport_diff = if same_viewport_y < previous.height() {
                pixel_diff_sum(
                    previous.get_pixel(x, same_viewport_y).0,
                    current.get_pixel(x, same_viewport_y).0,
                )
            } else {
                diff
            };
            let weight = weight
                * pixel_texture_weight(
                    previous,
                    current,
                    x,
                    prev_y + y_offset,
                    x,
                    curr_y + y_offset,
                )
                * motion_weight(same_viewport_diff);
            texture_total += local_texture_strength(previous, x, prev_y + y_offset)
                .max(local_texture_strength(current, x, curr_y + y_offset))
                .max(color_content_strength(
                    previous.get_pixel(x, prev_y + y_offset).0,
                ))
                .max(color_content_strength(
                    current.get_pixel(x, curr_y + y_offset).0,
                )) as f64
                * weight;
            texture_count += weight;
            if is_content_pixel(previous.get_pixel(x, prev_y + y_offset).0)
                || is_content_pixel(current.get_pixel(x, curr_y + y_offset).0)
            {
                content_total += weight;
            }
            if diff <= 30 {
                matched += weight;
            }
            diff_total += diff as f64 * weight;
            total += weight;
        }
    }

    if total <= 0.0 {
        return (0.0, 255.0, 0.0, 0.0);
    }

    (
        matched / total,
        diff_total / total,
        texture_total / texture_count.max(1.0),
        content_total / total,
    )
}

fn horizontal_overlap_score(
    previous: &RgbImage,
    current: &RgbImage,
    prev_x: u32,
    curr_x: u32,
    overlap_len: u32,
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> (f64, f64, f64, f64) {
    let columns = sample_count(overlap_len);
    let mut matched = 0.0;
    let mut total = 0.0;
    let mut diff_total = 0.0;
    let mut texture_total = 0.0;
    let mut texture_count = 0.0f64;
    let mut content_total = 0.0;

    for column_index in 0..columns {
        let x_offset = sampled_offset(column_index, columns, overlap_len);
        for &y in cross_axis_offsets {
            let weight = cross_axis_weights.get(y as usize).copied().unwrap_or(1.0);
            if weight <= 0.0 {
                continue;
            }
            let diff = pixel_diff_sum(
                previous.get_pixel(prev_x + x_offset, y).0,
                current.get_pixel(curr_x + x_offset, y).0,
            );
            let same_viewport_x = curr_x + x_offset;
            let same_viewport_diff = if same_viewport_x < previous.width() {
                pixel_diff_sum(
                    previous.get_pixel(same_viewport_x, y).0,
                    current.get_pixel(same_viewport_x, y).0,
                )
            } else {
                diff
            };
            let weight = weight
                * pixel_texture_weight(
                    previous,
                    current,
                    prev_x + x_offset,
                    y,
                    curr_x + x_offset,
                    y,
                )
                * motion_weight(same_viewport_diff);
            texture_total += local_texture_strength(previous, prev_x + x_offset, y)
                .max(local_texture_strength(current, curr_x + x_offset, y))
                .max(color_content_strength(
                    previous.get_pixel(prev_x + x_offset, y).0,
                ))
                .max(color_content_strength(
                    current.get_pixel(curr_x + x_offset, y).0,
                )) as f64
                * weight;
            texture_count += weight;
            if is_content_pixel(previous.get_pixel(prev_x + x_offset, y).0)
                || is_content_pixel(current.get_pixel(curr_x + x_offset, y).0)
            {
                content_total += weight;
            }
            if diff <= 30 {
                matched += weight;
            }
            diff_total += diff as f64 * weight;
            total += weight;
        }
    }

    if total <= 0.0 {
        return (0.0, 255.0, 0.0, 0.0);
    }

    (
        matched / total,
        diff_total / total,
        texture_total / texture_count.max(1.0),
        content_total / total,
    )
}

fn score_confidence(match_ratio: f64, mean_diff: f64) -> f64 {
    let diff_score = (1.0 - (mean_diff / 64.0)).clamp(0.0, 1.0);
    (0.70 * match_ratio + 0.30 * diff_score).clamp(0.0, 1.0)
}

fn default_min_overlap_px(axis_len: u32, max_scan: u32) -> u32 {
    if axis_len <= 12 {
        1
    } else {
        ((axis_len as f64) * 0.03)
            .round()
            .max(16.0)
            .min(max_scan as f64)
            .max(1.0) as u32
    }
}

fn candidate_is_better(
    candidate: CandidateAnalysis,
    current: CandidateAnalysis,
    axis_len: u32,
    min_new_content_px: u32,
) -> bool {
    let candidate_actionable = candidate.append_px >= min_new_content_px;
    let current_actionable = current.append_px >= min_new_content_px;
    match (candidate_actionable, current_actionable) {
        (true, false) => return true,
        (false, true) => return false,
        _ => {}
    }

    let candidate_good = candidate.confidence >= 0.88 && candidate.mean_diff <= 12.0;
    let current_good = current.confidence >= 0.88 && current.mean_diff <= 12.0;
    let candidate_rank = candidate_priority(candidate, axis_len);
    let current_rank = candidate_priority(current, axis_len);

    match (candidate_good, current_good) {
        (true, false) => true,
        (false, true) => false,
        _ => {
            candidate_rank > current_rank + 0.01
                || ((candidate_rank - current_rank).abs() <= 0.01
                    && candidate.overlap_px > current.overlap_px)
        }
    }
}
