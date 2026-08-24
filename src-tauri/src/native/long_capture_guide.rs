// Detects and removes Hook's long-capture guide pixels from frame edges.

fn is_long_capture_guide_blue(pixel: [u8; 3]) -> bool {
    let r_delta = (pixel[0] as i16 - 170).abs();
    let g_delta = (pixel[1] as i16 - 196).abs();
    let b_delta = (pixel[2] as i16 - 255).abs();
    r_delta <= 60 && g_delta <= 70 && b_delta <= 45 && pixel[2] >= pixel[0].saturating_add(28)
}

fn edge_line_has_long_capture_guide_color(
    image: &image::RgbImage,
    horizontal: bool,
    index: u32,
) -> bool {
    let len = if horizontal {
        image.width()
    } else {
        image.height()
    };
    if len == 0 {
        return false;
    }

    let mut guide_count = 0u32;
    let mut run = 0u32;
    let mut longest_run = 0u32;
    for offset in 0..len {
        let pixel = if horizontal {
            image.get_pixel(offset, index).0
        } else {
            image.get_pixel(index, offset).0
        };
        if is_long_capture_guide_blue(pixel) {
            guide_count += 1;
            run += 1;
            longest_run = longest_run.max(run);
        } else {
            run = 0;
        }
    }

    guide_count * 100 >= len * 45 || longest_run * 100 >= len * 35
}

fn copy_row(image: &mut image::RgbImage, from_y: u32, to_y: u32) {
    if from_y == to_y {
        return;
    }
    for x in 0..image.width() {
        let pixel = *image.get_pixel(x, from_y);
        image.put_pixel(x, to_y, pixel);
    }
}

fn copy_column(image: &mut image::RgbImage, from_x: u32, to_x: u32) {
    if from_x == to_x {
        return;
    }
    for y in 0..image.height() {
        let pixel = *image.get_pixel(from_x, y);
        image.put_pixel(to_x, y, pixel);
    }
}

fn nearest_non_guide_row(image: &image::RgbImage, from_y: u32, direction: i32) -> Option<u32> {
    let mut y = from_y as i32 + direction;
    while y >= 0 && y < image.height() as i32 {
        let row = y as u32;
        if !edge_line_has_long_capture_guide_color(image, true, row) {
            return Some(row);
        }
        y += direction;
    }
    None
}

fn nearest_non_guide_column(image: &image::RgbImage, from_x: u32, direction: i32) -> Option<u32> {
    let mut x = from_x as i32 + direction;
    while x >= 0 && x < image.width() as i32 {
        let column = x as u32;
        if !edge_line_has_long_capture_guide_color(image, false, column) {
            return Some(column);
        }
        x += direction;
    }
    None
}

fn remove_long_capture_overlay_guide_edges(frame: &mut image::RgbImage) {
    let width = frame.width();
    let height = frame.height();
    if width < 3 || height < 3 {
        return;
    }

    let edge_band = 4u32.min(width / 2).min(height / 2).max(1);
    for y in 0..edge_band {
        if edge_line_has_long_capture_guide_color(frame, true, y) {
            if let Some(source_y) = nearest_non_guide_row(frame, y, 1) {
                copy_row(frame, source_y, y);
            }
        }
    }
    for y in height.saturating_sub(edge_band)..height {
        if edge_line_has_long_capture_guide_color(frame, true, y) {
            if let Some(source_y) = nearest_non_guide_row(frame, y, -1) {
                copy_row(frame, source_y, y);
            }
        }
    }
    for x in 0..edge_band {
        if edge_line_has_long_capture_guide_color(frame, false, x) {
            if let Some(source_x) = nearest_non_guide_column(frame, x, 1) {
                copy_column(frame, source_x, x);
            }
        }
    }
    for x in width.saturating_sub(edge_band)..width {
        if edge_line_has_long_capture_guide_color(frame, false, x) {
            if let Some(source_x) = nearest_non_guide_column(frame, x, -1) {
                copy_column(frame, source_x, x);
            }
        }
    }
}
