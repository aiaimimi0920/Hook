use anyhow::{anyhow, Context};
use image::RgbImage;

use super::dispatch::capture_area_with_profile;
use super::dwm_shared_surface::try_capture_protected_window_region;
use super::{CaptureBackend, CaptureWorkloadProfile, DynamicCapturePixels, DynamicCaptureResult};
use crate::capture_coords::CaptureWindowMetrics;
use crate::capture_windows::CaptureWindowTarget;

/// Captures the desktop portion first, then overlays the protected window's
/// DWM surface at its physical intersection with the requested region. Pixels
/// covered by a higher z-order window remain from the desktop capture, which
/// preserves the visible stacking order for mixed-window selections.
///
/// Standard display capture intentionally omits WDA-protected pixels. Returning
/// that frame unchanged would silently replace Telegram with the desktop, so a
/// missing protected surface is an error rather than a partial screenshot.
pub(crate) fn capture_region_with_protected_window(
    capture_window_id: &str,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: CaptureWindowMetrics,
    occluding_windows: &[CaptureWindowTarget],
) -> anyhow::Result<DynamicCaptureResult> {
    let protected =
        try_capture_protected_window_region(capture_window_id, x, y, w, h, display_metrics)
            .ok_or_else(|| {
                anyhow!("protected window surface is unavailable for the selected region")
            })?;
    // Acquire the protected surface before starting display capture. Some GPU
    // clients rotate or temporarily release their shared DWM handle when a
    // display capture session is opened; sampling it first avoids that race.
    let mut background =
        capture_area_with_profile(x, y, w, h, CaptureWorkloadProfile::StandardRegion)?;
    let occlusion_rects =
        occlusion_rects_for_targets(x, y, display_metrics, &background, occluding_windows);
    paste_protected_surface(
        &mut background,
        &protected.image,
        protected.offset_x,
        protected.offset_y,
        &occlusion_rects,
    )
    .context("protected surface does not intersect the desktop capture")?;
    crate::append_runtime_log_line(&format!(
        "capture_region protected_composite_success :: target={} width={} height={} offset_x={} offset_y={} occluders={}",
        capture_window_id,
        background.width(),
        background.height(),
        protected.offset_x,
        protected.offset_y,
        occlusion_rects.len()
    ));
    Ok(DynamicCaptureResult {
        pixels: DynamicCapturePixels::Sdr(background),
        backend: CaptureBackend::DwmSharedSurface,
        downgraded_from_hdr: false,
        overlay_compensated: true,
    })
}

fn paste_protected_surface(
    destination: &mut RgbImage,
    source: &RgbImage,
    offset_x: u32,
    offset_y: u32,
    occlusion_rects: &[(u32, u32, u32, u32)],
) -> anyhow::Result<()> {
    if offset_x >= destination.width() || offset_y >= destination.height() {
        return Err(anyhow!(
            "protected surface offset is outside the desktop capture"
        ));
    }
    let copy_width = source.width().min(destination.width() - offset_x);
    let copy_height = source.height().min(destination.height() - offset_y);
    if copy_width == 0 || copy_height == 0 {
        return Err(anyhow!("protected surface crop is empty"));
    }
    for row in 0..copy_height {
        for column in 0..copy_width {
            let destination_x = offset_x + column;
            let destination_y = offset_y + row;
            if occlusion_rects.iter().any(|&(left, top, right, bottom)| {
                destination_x >= left
                    && destination_x < right
                    && destination_y >= top
                    && destination_y < bottom
            }) {
                continue;
            }
            let pixel = *source.get_pixel(column, row);
            destination.put_pixel(destination_x, destination_y, pixel);
        }
    }
    Ok(())
}

fn occlusion_rects_for_targets(
    x: i32,
    y: i32,
    display_metrics: CaptureWindowMetrics,
    destination: &RgbImage,
    targets: &[CaptureWindowTarget],
) -> Vec<(u32, u32, u32, u32)> {
    let scale = display_metrics
        .scale_factor
        .is_finite()
        .then_some(display_metrics.scale_factor)
        .filter(|scale| *scale > 0.0)
        .unwrap_or(1.0);
    let selection_left = (x as f64 * scale).floor();
    let selection_top = (y as f64 * scale).floor();
    let width = destination.width();
    let height = destination.height();
    targets
        .iter()
        .filter_map(|target| {
            let left = (target.x * scale).floor() - selection_left;
            let top = (target.y * scale).floor() - selection_top;
            let right = ((target.x + target.w) * scale).ceil() - selection_left;
            let bottom = ((target.y + target.h) * scale).ceil() - selection_top;
            let left = left.max(0.0).min(width as f64) as u32;
            let top = top.max(0.0).min(height as f64) as u32;
            let right = right.max(left as f64).min(width as f64) as u32;
            let bottom = bottom.max(top as f64).min(height as f64) as u32;
            (right > left && bottom > top).then_some((left, top, right, bottom))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{paste_protected_surface, CaptureWindowMetrics};
    use image::{Rgb, RgbImage};

    #[test]
    fn pastes_partial_protected_surface_without_changing_requested_canvas_size() {
        let mut background = RgbImage::from_pixel(6, 4, Rgb([10, 20, 30]));
        let protected = RgbImage::from_pixel(3, 2, Rgb([220, 120, 40]));

        paste_protected_surface(&mut background, &protected, 2, 1, &[])
            .expect("protected surface should overlap the background");

        assert_eq!((background.width(), background.height()), (6, 4));
        assert_eq!(*background.get_pixel(2, 1), Rgb([220, 120, 40]));
        assert_eq!(*background.get_pixel(4, 2), Rgb([220, 120, 40]));
        assert_eq!(*background.get_pixel(0, 0), Rgb([10, 20, 30]));
    }

    #[test]
    fn rejects_a_protected_surface_that_cannot_intersect_the_background() {
        let mut background = RgbImage::new(4, 4);
        let protected = RgbImage::new(2, 2);

        assert!(paste_protected_surface(&mut background, &protected, 4, 0, &[]).is_err());
    }

    #[test]
    fn preserves_higher_window_pixels_when_compositing_protected_surface() {
        let mut background = RgbImage::from_pixel(6, 4, Rgb([10, 20, 30]));
        let protected = RgbImage::from_pixel(5, 3, Rgb([220, 120, 40]));

        paste_protected_surface(&mut background, &protected, 0, 0, &[(2, 1, 5, 3)])
            .expect("protected surface should overlap the background");

        assert_eq!(*background.get_pixel(1, 1), Rgb([220, 120, 40]));
        assert_eq!(*background.get_pixel(2, 1), Rgb([10, 20, 30]));
        assert_eq!(*background.get_pixel(4, 2), Rgb([10, 20, 30]));
    }

    #[test]
    #[ignore = "requires a visible protected window and desktop capture permissions"]
    fn captures_a_partial_protected_region_with_fixed_output_dimensions() {
        let hwnd = std::env::var("HOOK_PROTECTED_WINDOW_HWND")
            .expect("HOOK_PROTECTED_WINDOW_HWND must be set for the live composite probe");
        if super::super::dwm_shared_surface::window_display_affinity(&hwnd)
            .is_none_or(|affinity| affinity == 0)
        {
            eprintln!(
                "protected region composite probe skipped: target is not currently WDA-protected"
            );
            return;
        }
        let parse = |name: &str, default: &str| {
            std::env::var(name)
                .unwrap_or_else(|_| default.to_string())
                .parse::<i32>()
                .expect("probe coordinates must be integers")
        };
        let x = parse("HOOK_PROTECTED_REGION_X", "33");
        let y = parse("HOOK_PROTECTED_REGION_Y", "0");
        let w = u32::try_from(parse("HOOK_PROTECTED_REGION_W", "2393"))
            .expect("probe width must be positive");
        let h = u32::try_from(parse("HOOK_PROTECTED_REGION_H", "1200"))
            .expect("probe height must be positive");
        let metrics = CaptureWindowMetrics {
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            scale_factor: 1.0,
            logical_width: (x + i32::try_from(w).unwrap_or_default()) as f64,
            logical_height: (y + i32::try_from(h).unwrap_or_default()) as f64,
        };
        let targets = crate::capture_windows::list_capture_window_targets(metrics);
        let occluding_windows = targets
            .iter()
            .find(|target| target.id == hwnd)
            .map(|protected| {
                targets
                    .iter()
                    .filter(|target| {
                        target.z_order < protected.z_order
                            && target.x < protected.x + protected.w
                            && target.x + target.w > protected.x
                            && target.y < protected.y + protected.h
                            && target.y + target.h > protected.y
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let result = super::super::protected_region::capture_region_with_protected_window(
            &hwnd,
            x,
            y,
            w,
            h,
            metrics,
            &occluding_windows,
        )
        .expect("partial protected region composition should succeed");
        let image = match result.pixels {
            super::super::DynamicCapturePixels::Sdr(image) => image,
            super::super::DynamicCapturePixels::Hdr(_) => {
                panic!("protected region composition must stay SDR")
            }
        };
        assert_eq!(image.width(), w, "composite must preserve requested width");
        assert_eq!(
            image.height(),
            h,
            "composite must preserve requested height"
        );
        assert!(image
            .pixels()
            .any(|pixel| pixel.0.iter().any(|channel| *channel > 8)));
        let path = std::env::temp_dir().join("hook-protected-region-composite-probe.png");
        image
            .save(&path)
            .expect("composite probe image should be writable");
        eprintln!(
            "protected region composite probe: {} -> {}",
            image.dimensions().0,
            path.display()
        );
    }
}
