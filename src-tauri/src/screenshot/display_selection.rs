use anyhow::anyhow;
use scap_targets::Display;
use windows::Win32::Graphics::Direct3D11::D3D11_BOX;

use super::capture_area_verbose_logging_enabled;
use crate::capture_coords::CaptureWindowMetrics;

/// Resolves a logical capture rectangle against the exact physical display.
pub(super) struct CapturePlan {
    pub(super) display: Display,
    pub(super) display_id: scap_targets::DisplayId,
    pub(super) crop: D3D11_BOX,
    pub(super) physical_origin_x: i32,
    pub(super) physical_origin_y: i32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct CaptureDisplayGeometry {
    pub(super) physical_origin_x: i32,
    pub(super) physical_origin_y: i32,
    pub(super) physical_width: u32,
    pub(super) physical_height: u32,
    pub(super) logical_width: f64,
    pub(super) logical_height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct LocalPhysicalCaptureRect {
    pub(super) left: u32,
    pub(super) top: u32,
    pub(super) right: u32,
    pub(super) bottom: u32,
}

pub(super) fn capture_display_geometry(display: &Display) -> Option<CaptureDisplayGeometry> {
    let physical_bounds = display.raw_handle().physical_bounds()?;
    let physical_position = physical_bounds.position();
    let physical_size = physical_bounds.size();
    let logical_size = display.logical_size()?;
    if physical_size.width() <= 0.0
        || physical_size.height() <= 0.0
        || logical_size.width() <= 0.0
        || logical_size.height() <= 0.0
    {
        return None;
    }

    Some(CaptureDisplayGeometry {
        physical_origin_x: physical_position.x().round() as i32,
        physical_origin_y: physical_position.y().round() as i32,
        physical_width: physical_size.width().round() as u32,
        physical_height: physical_size.height().round() as u32,
        logical_width: logical_size.width(),
        logical_height: logical_size.height(),
    })
}

fn capture_display_matches_metrics(
    geometry: CaptureDisplayGeometry,
    metrics: CaptureWindowMetrics,
) -> bool {
    let expected_width = metrics.logical_width * metrics.scale_factor;
    let expected_height = metrics.logical_height * metrics.scale_factor;
    (geometry.physical_origin_x as f64 - metrics.physical_origin_x).abs() <= 1.0
        && (geometry.physical_origin_y as f64 - metrics.physical_origin_y).abs() <= 1.0
        && (geometry.physical_width as f64 - expected_width).abs() <= 2.0
        && (geometry.physical_height as f64 - expected_height).abs() <= 2.0
}

pub(super) fn select_capture_display_geometry_index(
    metrics: CaptureWindowMetrics,
    geometries: &[CaptureDisplayGeometry],
) -> Option<usize> {
    geometries
        .iter()
        .position(|geometry| capture_display_matches_metrics(*geometry, metrics))
        .or_else(|| {
            let expected_width = metrics.logical_width * metrics.scale_factor;
            let expected_height = metrics.logical_height * metrics.scale_factor;
            let center_x = metrics.physical_origin_x + expected_width / 2.0;
            let center_y = metrics.physical_origin_y + expected_height / 2.0;
            geometries.iter().position(|geometry| {
                center_x >= geometry.physical_origin_x as f64
                    && center_x < geometry.physical_origin_x as f64 + geometry.physical_width as f64
                    && center_y >= geometry.physical_origin_y as f64
                    && center_y
                        < geometry.physical_origin_y as f64 + geometry.physical_height as f64
            })
        })
}

pub(super) fn local_logical_capture_rect_to_physical(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    geometry: CaptureDisplayGeometry,
) -> Option<LocalPhysicalCaptureRect> {
    if w == 0 || h == 0 || geometry.logical_width <= 0.0 || geometry.logical_height <= 0.0 {
        return None;
    }

    let scale_x = geometry.physical_width as f64 / geometry.logical_width;
    let scale_y = geometry.physical_height as f64 / geometry.logical_height;
    let left = (x as f64 * scale_x).floor();
    let top = (y as f64 * scale_y).floor();
    let right = (left + w as f64 * scale_x).ceil();
    let bottom = (top + h as f64 * scale_y).ceil();
    let left = left.max(0.0).min(geometry.physical_width as f64) as u32;
    let top = top.max(0.0).min(geometry.physical_height as f64) as u32;
    let right = right.max(left as f64).min(geometry.physical_width as f64) as u32;
    let bottom = bottom.max(top as f64).min(geometry.physical_height as f64) as u32;
    (right > left && bottom > top).then_some(LocalPhysicalCaptureRect {
        left,
        top,
        right,
        bottom,
    })
}

pub(super) fn capture_display_for_metrics(
    metrics: Option<CaptureWindowMetrics>,
) -> anyhow::Result<(Display, CaptureDisplayGeometry)> {
    if let Some(metrics) = metrics {
        let candidates = Display::list()
            .into_iter()
            .filter_map(|display| {
                capture_display_geometry(&display).map(|geometry| (display, geometry))
            })
            .collect::<Vec<_>>();
        let geometries = candidates
            .iter()
            .map(|(_, geometry)| *geometry)
            .collect::<Vec<_>>();
        let index = select_capture_display_geometry_index(metrics, &geometries)
            .ok_or_else(|| anyhow!("Capture display no longer matches the active monitor"))?;
        return Ok(candidates[index]);
    }

    let display = Display::primary();
    let geometry = capture_display_geometry(&display)
        .ok_or_else(|| anyhow!("Primary display geometry is unavailable"))?;
    Ok((display, geometry))
}

pub(super) fn capture_plan(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: Option<CaptureWindowMetrics>,
) -> anyhow::Result<CapturePlan> {
    let verbose_log = capture_area_verbose_logging_enabled();
    if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area enter :: x={} y={} w={} h={}",
            x, y, w, h
        ));
    }

    let (display, geometry) = capture_display_for_metrics(display_metrics)?;
    let display_id = display.id();
    if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area display :: id={} origin={},{} logical={}x{} physical={}x{} scale={}x{}",
            display_id,
            geometry.physical_origin_x,
            geometry.physical_origin_y,
            geometry.logical_width,
            geometry.logical_height,
            geometry.physical_width,
            geometry.physical_height,
            geometry.physical_width as f64 / geometry.logical_width,
            geometry.physical_height as f64 / geometry.logical_height,
        ));
    }

    let physical_rect = local_logical_capture_rect_to_physical(x, y, w, h, geometry)
        .ok_or_else(|| anyhow!("Capture rectangle is outside the target display"))?;
    let crop = D3D11_BOX {
        left: physical_rect.left,
        top: physical_rect.top,
        right: physical_rect.right,
        bottom: physical_rect.bottom,
        front: 0,
        back: 1,
    };
    if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area crop :: left={} top={} right={} bottom={}",
            crop.left, crop.top, crop.right, crop.bottom
        ));
    }

    Ok(CapturePlan {
        display,
        display_id,
        crop,
        physical_origin_x: geometry.physical_origin_x,
        physical_origin_y: geometry.physical_origin_y,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_the_display_matching_negative_origin_and_mixed_dpi_metrics() {
        let geometries = [
            CaptureDisplayGeometry {
                physical_origin_x: 0,
                physical_origin_y: 0,
                physical_width: 1920,
                physical_height: 1080,
                logical_width: 1920.0,
                logical_height: 1080.0,
            },
            CaptureDisplayGeometry {
                physical_origin_x: -2560,
                physical_origin_y: -200,
                physical_width: 2560,
                physical_height: 1440,
                logical_width: 2560.0 / 1.5,
                logical_height: 960.0,
            },
        ];
        let metrics = CaptureWindowMetrics {
            physical_origin_x: -2560.0,
            physical_origin_y: -200.0,
            scale_factor: 1.5,
            logical_width: 2560.0 / 1.5,
            logical_height: 960.0,
        };

        assert_eq!(
            select_capture_display_geometry_index(metrics, &geometries),
            Some(1),
        );
    }

    #[test]
    fn distinguishes_identical_monitors_by_virtual_desktop_origin() {
        let geometries = [
            CaptureDisplayGeometry {
                physical_origin_x: 0,
                physical_origin_y: 0,
                physical_width: 1920,
                physical_height: 1080,
                logical_width: 1536.0,
                logical_height: 864.0,
            },
            CaptureDisplayGeometry {
                physical_origin_x: 1920,
                physical_origin_y: 0,
                physical_width: 1920,
                physical_height: 1080,
                logical_width: 1536.0,
                logical_height: 864.0,
            },
        ];
        let metrics = CaptureWindowMetrics {
            physical_origin_x: 1920.0,
            physical_origin_y: 0.0,
            scale_factor: 1.25,
            logical_width: 1536.0,
            logical_height: 864.0,
        };

        assert_eq!(
            select_capture_display_geometry_index(metrics, &geometries),
            Some(1),
        );
    }
}
