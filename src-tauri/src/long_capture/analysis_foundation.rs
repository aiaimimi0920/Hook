fn mean_row_distance(row_a: &[u8], row_b: &[u8]) -> f64 {
    row_a
        .iter()
        .zip(row_b.iter())
        .map(|(a, b)| (*a as i32 - *b as i32).unsigned_abs() as f64)
        .sum::<f64>()
        / row_a.len().max(1) as f64
}

pub fn find_vertical_overlap(previous: &RgbImage, current: &RgbImage, max_scan: u32) -> u32 {
    if previous.width() != current.width() || previous.height() == 0 || current.height() == 0 {
        return 0;
    }

    let width_bytes = previous.width() as usize * 3;
    let prev_raw = previous.as_raw();
    let curr_raw = current.as_raw();
    let limit = max_scan.min(previous.height()).min(current.height());
    let mut best_overlap = 0;
    let mut best_score = f64::MAX;

    for overlap in 1..=limit {
        let mut total = 0.0;
        let sample_rows = overlap.min(12);
        for index in 0..sample_rows {
            let prev_y = previous.height() - overlap + index;
            let curr_y = index;
            let prev_start = prev_y as usize * width_bytes;
            let curr_start = curr_y as usize * width_bytes;
            total += mean_row_distance(
                &prev_raw[prev_start..prev_start + width_bytes],
                &curr_raw[curr_start..curr_start + width_bytes],
            );
        }

        let score = total / sample_rows.max(1) as f64;
        if score < best_score {
            best_score = score;
            best_overlap = overlap;
        }
    }

    if best_score <= 12.0 {
        best_overlap
    } else {
        0
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LongCaptureAxis {
    Vertical,
    Horizontal,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LongCaptureDirection {
    Down,
    Up,
    Right,
    Left,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LongCaptureOverlapStatus {
    Duplicate,
    TooSmallMotion,
    Good,
    Weak,
    NoOverlap,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongCaptureAnalyzeOptions {
    pub axis: Option<LongCaptureAxis>,
    pub direction: Option<LongCaptureDirection>,
    pub max_scan: Option<u32>,
    pub min_overlap_px: Option<u32>,
    pub min_new_content_px: Option<u32>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LongCaptureStitchOptions {
    pub axis: Option<LongCaptureAxis>,
    pub direction: Option<LongCaptureDirection>,
    pub max_scan: Option<u32>,
    pub min_overlap_px: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LongCaptureOverlapAnalysis {
    pub status: LongCaptureOverlapStatus,
    pub axis: Option<LongCaptureAxis>,
    pub direction: Option<LongCaptureDirection>,
    pub overlap_px: u32,
    pub crop_start_px: u32,
    pub append_px: u32,
    pub confidence: f64,
    pub seam_px: u32,
}

#[derive(Clone, Copy, Debug)]
struct CandidateAnalysis {
    direction: LongCaptureDirection,
    overlap_px: u32,
    crop_start_px: u32,
    append_px: u32,
    confidence: f64,
    mean_diff: f64,
    texture_score: f64,
    content_ratio: f64,
}

fn default_edge_ignore(cross_len: u32) -> u32 {
    if cross_len < 120 {
        0
    } else {
        (cross_len / 20).clamp(4, cross_len / 4)
    }
}

fn pixel_diff_sum(a: [u8; 3], b: [u8; 3]) -> u32 {
    (a[0] as i32 - b[0] as i32).unsigned_abs()
        + (a[1] as i32 - b[1] as i32).unsigned_abs()
        + (a[2] as i32 - b[2] as i32).unsigned_abs()
}

fn sample_count(axis_len: u32) -> u32 {
    axis_len.min(128).max(1)
}

const MAX_CROSS_AXIS_SAMPLES: u32 = 192;

fn sampled_offset(index: u32, count: u32, len: u32) -> u32 {
    if count <= 1 || len <= 1 {
        0
    } else {
        index.saturating_mul(len - 1) / (count - 1)
    }
}

fn sampled_axis_offsets(axis_len: u32, edge_ignore: u32, max_samples: u32) -> Vec<u32> {
    let start = edge_ignore.min(axis_len);
    let end = axis_len.saturating_sub(edge_ignore).max(start);
    if end <= start {
        return Vec::new();
    }

    let len = end - start;
    let count = len.min(max_samples.max(1));
    let mut offsets = Vec::with_capacity(count as usize);
    for index in 0..count {
        let offset = start + sampled_offset(index, count, len);
        if offsets.last().copied() != Some(offset) {
            offsets.push(offset);
        }
    }
    offsets
}

fn sampled_cross_axis_offsets(axis_len: u32, edge_ignore: u32) -> Vec<u32> {
    sampled_axis_offsets(axis_len, edge_ignore, MAX_CROSS_AXIS_SAMPLES)
}

const LINE_SIGNATURE_WINDOW: u32 = 10;

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq)]
struct RollingLineSignature {
    r: u64,
    g: u64,
    b: u64,
    texture: u64,
    content: u32,
}

impl RollingLineSignature {
    fn add_row(&mut self, image: &RgbImage, line: u32, cross_axis_offsets: &[u32]) {
        for &offset in cross_axis_offsets {
            let pixel = image.get_pixel(offset, line).0;
            self.r += pixel[0] as u64;
            self.g += pixel[1] as u64;
            self.b += pixel[2] as u64;
            self.texture += local_texture_strength(image, offset, line) as u64;
            if is_content_pixel(pixel) {
                self.content += 1;
            }
        }
    }

    fn remove_row(&mut self, image: &RgbImage, line: u32, cross_axis_offsets: &[u32]) {
        for &offset in cross_axis_offsets {
            let pixel = image.get_pixel(offset, line).0;
            self.r -= pixel[0] as u64;
            self.g -= pixel[1] as u64;
            self.b -= pixel[2] as u64;
            self.texture -= local_texture_strength(image, offset, line) as u64;
            if is_content_pixel(pixel) {
                self.content -= 1;
            }
        }
    }

    fn add_column(&mut self, image: &RgbImage, column: u32, cross_axis_offsets: &[u32]) {
        for &offset in cross_axis_offsets {
            let pixel = image.get_pixel(column, offset).0;
            self.r += pixel[0] as u64;
            self.g += pixel[1] as u64;
            self.b += pixel[2] as u64;
            self.texture += local_texture_strength(image, column, offset) as u64;
            if is_content_pixel(pixel) {
                self.content += 1;
            }
        }
    }

    fn remove_column(&mut self, image: &RgbImage, column: u32, cross_axis_offsets: &[u32]) {
        for &offset in cross_axis_offsets {
            let pixel = image.get_pixel(column, offset).0;
            self.r -= pixel[0] as u64;
            self.g -= pixel[1] as u64;
            self.b -= pixel[2] as u64;
            self.texture -= local_texture_strength(image, column, offset) as u64;
            if is_content_pixel(pixel) {
                self.content -= 1;
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct SignatureDeltaHint {
    match_count: usize,
    min_current_line: u32,
}

fn choose_signature_cross_axis_offsets(
    cross_axis_weights: &[f64],
    cross_axis_offsets: &[u32],
) -> Vec<u32> {
    let mut weighted_offsets = cross_axis_offsets
        .iter()
        .copied()
        .filter(|&offset| {
            cross_axis_weights
                .get(offset as usize)
                .copied()
                .unwrap_or(0.0)
                >= 0.35
        })
        .collect::<Vec<_>>();

    if weighted_offsets.len() >= 12 {
        return weighted_offsets;
    }

    if cross_axis_offsets.len() <= 48 {
        return cross_axis_offsets.to_vec();
    }

    let step = (cross_axis_offsets.len() / 48).max(1);
    weighted_offsets = cross_axis_offsets
        .iter()
        .copied()
        .step_by(step)
        .collect::<Vec<_>>();
    if weighted_offsets.last().copied() != cross_axis_offsets.last().copied() {
        if let Some(last) = cross_axis_offsets.last().copied() {
            weighted_offsets.push(last);
        }
    }
    weighted_offsets
}

fn rolling_line_signatures(
    image: &RgbImage,
    cross_axis_offsets: &[u32],
    window: u32,
) -> Vec<Option<RollingLineSignature>> {
    if cross_axis_offsets.is_empty() || image.height() < window || window == 0 {
        return Vec::new();
    }

    let line_count = image.height() as usize;
    let mut signatures = vec![None; line_count];
    let mut rolling = RollingLineSignature::default();

    for line in 0..window {
        rolling.add_row(image, line, cross_axis_offsets);
    }

    let min_texture = (cross_axis_offsets.len() as u64 * window as u64).max(24);
    let min_content = ((cross_axis_offsets.len() as u32 * window) / 20).max(4);
    let last_start = image.height() - window;
    for start in 0..=last_start {
        if rolling.texture >= min_texture && rolling.content >= min_content {
            signatures[start as usize] = Some(rolling);
        }

        if start < last_start {
            rolling.remove_row(image, start, cross_axis_offsets);
            rolling.add_row(image, start + window, cross_axis_offsets);
        }
    }

    signatures
}

fn rolling_column_signatures(
    image: &RgbImage,
    cross_axis_offsets: &[u32],
    window: u32,
) -> Vec<Option<RollingLineSignature>> {
    if cross_axis_offsets.is_empty() || image.width() < window || window == 0 {
        return Vec::new();
    }

    let column_count = image.width() as usize;
    let mut signatures = vec![None; column_count];
    let mut rolling = RollingLineSignature::default();

    for column in 0..window {
        rolling.add_column(image, column, cross_axis_offsets);
    }

    let min_texture = (cross_axis_offsets.len() as u64 * window as u64).max(24);
    let min_content = ((cross_axis_offsets.len() as u32 * window) / 20).max(4);
    let last_start = image.width() - window;
    for start in 0..=last_start {
        if rolling.texture >= min_texture && rolling.content >= min_content {
            signatures[start as usize] = Some(rolling);
        }

        if start < last_start {
            rolling.remove_column(image, start, cross_axis_offsets);
            rolling.add_column(image, start + window, cross_axis_offsets);
        }
    }

    signatures
}
