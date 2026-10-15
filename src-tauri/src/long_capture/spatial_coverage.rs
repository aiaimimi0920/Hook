// Exact largest all-covered rectangle, O(width * height) time and O(width) memory.
// Alpha records sampling coverage, never inferred from pixel colour.
fn largest_covered_rectangle(image: &image::RgbaImage) -> (u32, u32, u32, u32) {
    let width = image.width() as usize;
    let mut heights = vec![0u32; width];
    let mut stack: Vec<(usize, u32)> = Vec::with_capacity(width);
    let mut best = (0, 0, 0, 0);
    let mut area = 0u64;
    for y in 0..image.height() {
        for (x, height) in heights.iter_mut().enumerate() {
            *height = if image.get_pixel(x as u32, y)[3] == 255 {
                *height + 1
            } else {
                0
            };
        }
        stack.clear();
        for x in 0..=width {
            let h = if x == width { 0 } else { heights[x] };
            let mut start = x;
            while let Some(&(left, previous)) = stack.last() {
                if previous <= h {
                    break;
                }
                stack.pop();
                let w = (x - left) as u32;
                let candidate = (left as u32, y + 1 - previous, w, previous);
                let candidate_area = u64::from(w) * u64::from(previous);
                // Ties prefer topmost, then leftmost for deterministic exports.
                if candidate_area > area
                    || (candidate_area == area && (candidate.1, candidate.0) < (best.1, best.0))
                {
                    area = candidate_area;
                    best = candidate;
                }
                start = left;
            }
            if h > 0 && stack.last().map(|&(_, value)| value != h).unwrap_or(true) {
                stack.push((start, h));
            }
        }
    }
    best
}
