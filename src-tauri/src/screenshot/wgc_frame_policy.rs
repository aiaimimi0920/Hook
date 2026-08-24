use image::RgbImage;
use windows::Win32::Graphics::Direct3D11::D3D11_BOX;

/// Detects compositor warm-up frames without scanning every pixel.
pub(super) fn frame_is_mostly_black(img: &RgbImage) -> bool {
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return true;
    }

    let step_x = (w / 64).max(1);
    let step_y = (h / 64).max(1);
    let mut sampled: u64 = 0;
    let mut black: u64 = 0;
    let mut y = 0;
    while y < h {
        let mut x = 0;
        while x < w {
            let p = img.get_pixel(x, y).0;
            sampled += 1;
            if p[0] <= 8 && p[1] <= 8 && p[2] <= 8 {
                black += 1;
            }
            x += step_x;
        }
        y += step_y;
    }
    if sampled == 0 {
        return true;
    }
    black * 100 >= sampled * 99
}

fn frame_has_suspicious_black_video_hole_with(
    w: u32,
    h: u32,
    mut pixel_at: impl FnMut(u32, u32) -> [u8; 3],
) -> bool {
    if w < 80 || h < 80 {
        return false;
    }

    let left = w / 8;
    let right = w - left;
    let top = h / 8;
    let bottom = h * 3 / 4;
    let step_x = ((right - left) / 80).max(1);
    let step_y = ((bottom - top) / 80).max(1);
    let mut sampled: u64 = 0;
    let mut black: u64 = 0;

    let mut y = top;
    while y < bottom {
        let mut x = left;
        while x < right {
            let p = pixel_at(x, y);
            sampled += 1;
            if p[0] <= 10 && p[1] <= 10 && p[2] <= 10 {
                black += 1;
            }
            x += step_x;
        }
        y += step_y;
    }

    sampled > 0 && black * 100 >= sampled * 88
}

/// Rejects frames whose central video plane is black while controls remain visible.
pub(super) fn frame_has_suspicious_black_video_hole(img: &RgbImage) -> bool {
    frame_has_suspicious_black_video_hole_with(img.width(), img.height(), |x, y| {
        img.get_pixel(x, y).0
    })
}

#[derive(Clone, Copy)]
struct CropBounds {
    left: u32,
    top: u32,
    width: u32,
    height: u32,
}

fn clamped_crop_bounds(full: &RgbImage, crop: &D3D11_BOX) -> Option<CropBounds> {
    let img_w = full.width();
    let img_h = full.height();
    if img_w == 0 || img_h == 0 {
        return None;
    }
    let left = crop.left.min(img_w.saturating_sub(1));
    let top = crop.top.min(img_h.saturating_sub(1));
    let right = crop.right.min(img_w).max(left + 1);
    let bottom = crop.bottom.min(img_h).max(top + 1);
    Some(CropBounds {
        left,
        top,
        width: right - left,
        height: bottom - top,
    })
}

/// Samples a crop in place, avoiding a full temporary image allocation for heuristics.
pub(super) fn frame_has_suspicious_black_video_hole_in_crop(
    full: &RgbImage,
    crop: &D3D11_BOX,
) -> bool {
    let Some(bounds) = clamped_crop_bounds(full, crop) else {
        return false;
    };
    frame_has_suspicious_black_video_hole_with(bounds.width, bounds.height, |x, y| {
        full.get_pixel(bounds.left + x, bounds.top + y).0
    })
}

/// Crops a full-screen persistent frame to a clamped physical rectangle.
pub(super) fn crop_rgb(full: &RgbImage, crop: &D3D11_BOX) -> RgbImage {
    let Some(bounds) = clamped_crop_bounds(full, crop) else {
        return RgbImage::new(0, 0);
    };

    let mut out = RgbImage::new(bounds.width, bounds.height);
    for row in 0..bounds.height {
        for col in 0..bounds.width {
            let px = full.get_pixel(bounds.left + col, bounds.top + row);
            out.put_pixel(col, row, *px);
        }
    }
    out
}

pub(super) fn wgc_cached_frame_is_usable(img: &RgbImage, crop_rect: Option<&D3D11_BOX>) -> bool {
    if frame_is_mostly_black(img) {
        return false;
    }

    let has_video_hole = crop_rect
        .map(|crop| frame_has_suspicious_black_video_hole_in_crop(img, crop))
        .unwrap_or_else(|| frame_has_suspicious_black_video_hole(img));

    !has_video_hole
}

pub(super) fn wgc_frame_wait_timeout(has_usable_cached_frame: bool) -> std::time::Duration {
    if has_usable_cached_frame {
        std::time::Duration::from_millis(120)
    } else {
        std::time::Duration::from_millis(1200)
    }
}

pub(super) fn wgc_last_usable_fallback_max_age() -> std::time::Duration {
    std::time::Duration::from_secs(12)
}

pub(super) fn select_wgc_timeout_fallback_frame(
    latest_suspicious_frame: Option<RgbImage>,
    recent_usable_backup: Option<(RgbImage, std::time::Instant)>,
) -> Option<RgbImage> {
    match recent_usable_backup {
        Some((image, captured_at))
            if captured_at.elapsed() <= wgc_last_usable_fallback_max_age() =>
        {
            Some(image)
        }
        _ => latest_suspicious_frame,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_rgb_returns_empty_for_zero_sized_source() {
        let crop = D3D11_BOX {
            left: 0,
            top: 0,
            right: 1,
            bottom: 1,
            front: 0,
            back: 1,
        };

        let result = crop_rgb(&RgbImage::new(0, 0), &crop);

        assert_eq!(result.dimensions(), (0, 0));
    }

    #[test]
    fn in_place_crop_sampling_matches_materialized_crop_sampling() {
        let mut image = RgbImage::from_pixel(340, 240, image::Rgb([0, 0, 0]));
        for y in 200..230 {
            for x in 20..320 {
                image.put_pixel(x, y, image::Rgb([238, 238, 238]));
            }
        }
        let crop = D3D11_BOX {
            left: 20,
            top: 10,
            right: 320,
            bottom: 230,
            front: 0,
            back: 1,
        };

        assert_eq!(
            frame_has_suspicious_black_video_hole_in_crop(&image, &crop),
            frame_has_suspicious_black_video_hole(&crop_rgb(&image, &crop)),
        );
    }
}
