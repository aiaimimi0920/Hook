#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct CaptureWindowMetrics {
    pub physical_origin_x: f64,
    pub physical_origin_y: f64,
    pub scale_factor: f64,
    pub logical_width: f64,
    pub logical_height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct CapturePoint {
    pub x: f64,
    pub y: f64,
}

pub(crate) fn normalize_global_physical_to_local_logical(
    global_x: f64,
    global_y: f64,
    metrics: CaptureWindowMetrics,
) -> CapturePoint {
    let scale = if metrics.scale_factor.is_finite() && metrics.scale_factor > 0.0 {
        metrics.scale_factor
    } else {
        1.0
    };

    let x = (global_x - metrics.physical_origin_x) / scale;
    let y = (global_y - metrics.physical_origin_y) / scale;

    CapturePoint {
        x: x.clamp(0.0, metrics.logical_width),
        y: y.clamp(0.0, metrics.logical_height),
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_global_physical_to_local_logical, CapturePoint, CaptureWindowMetrics};

    #[test]
    fn converts_global_physical_to_local_logical_using_scale_factor() {
        let metrics = CaptureWindowMetrics {
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            scale_factor: 1.5,
            logical_width: 2560.0,
            logical_height: 1440.0,
        };

        let point = normalize_global_physical_to_local_logical(150.0, 300.0, metrics);

        assert_eq!(
            point,
            CapturePoint { x: 100.0, y: 200.0 },
            "150 percent scaling should divide physical coordinates back to logical overlay coordinates",
        );
    }

    #[test]
    fn clamps_point_into_visible_logical_bounds() {
        let metrics = CaptureWindowMetrics {
            physical_origin_x: 1920.0,
            physical_origin_y: 0.0,
            scale_factor: 1.25,
            logical_width: 1536.0,
            logical_height: 864.0,
        };

        let point = normalize_global_physical_to_local_logical(10000.0, -50.0, metrics);

        assert_eq!(point, CapturePoint { x: 1536.0, y: 0.0 });
    }
}
