mod capture_pixels;
mod dispatch;
#[cfg(target_os = "windows")]
mod display_selection;
#[cfg(target_os = "windows")]
mod gdi_fallback;
#[cfg(target_os = "windows")]
mod hdr_analysis;
#[cfg(target_os = "windows")]
mod hdr_display;
#[cfg(target_os = "windows")]
mod wgc_frame_policy;
#[cfg(target_os = "windows")]
mod wgc_session;

pub use capture_pixels::HdrPqImage;
#[allow(unused_imports)]
pub use dispatch::{capture_area, capture_area_with_profile, capture_region_with_dynamic_range};
use image::RgbImage;

#[cfg(test)]
use crate::capture_coords::CaptureWindowMetrics;
#[cfg(all(test, target_os = "windows"))]
use capture_pixels::{pq_oetf_from_nits, scrgb_buffer_to_hdr_pq, scrgb_buffer_to_sdr_rgb};
#[cfg(all(test, target_os = "windows"))]
use display_selection::{
    capture_display_for_metrics, capture_display_geometry, capture_plan,
    local_logical_capture_rect_to_physical, select_capture_display_geometry_index,
    CaptureDisplayGeometry, LocalPhysicalCaptureRect,
};
#[cfg(all(test, target_os = "windows"))]
use half::f16;
#[cfg(all(test, target_os = "windows"))]
use hdr_analysis::{
    analyze_scrgb_buffer, content_exceeds_sdr_white, hdr_capture_mode_for,
    should_attempt_hdr_capture, should_report_hdr_downgrade_on_sdr_fallback, HdrCaptureMode,
    HdrDisplayInfo,
};
#[cfg(all(test, target_os = "windows"))]
use hdr_display::hdr_display_info_for;
#[cfg(all(test, target_os = "windows"))]
use scap_targets::Display;
#[cfg(all(test, target_os = "windows"))]
use wgc_frame_policy::{
    frame_has_suspicious_black_video_hole, select_wgc_timeout_fallback_frame,
    wgc_cached_frame_is_usable, wgc_frame_wait_timeout,
};
#[cfg(all(test, target_os = "windows"))]
use wgc_session::should_use_persistent_wgc;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CaptureWorkloadProfile {
    StandardRegion,
    LongCapture,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CaptureBackend {
    WgcHdr,
    WgcSdr,
    Gdi,
}

impl CaptureBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WgcHdr => "wgc-hdr-transient",
            Self::WgcSdr => "wgc-sdr",
            Self::Gdi => "gdi-sdr",
        }
    }
}

#[derive(Debug)]
pub enum DynamicCapturePixels {
    Sdr(RgbImage),
    Hdr(HdrPqImage),
}

#[derive(Debug)]
pub struct DynamicCaptureResult {
    pub pixels: DynamicCapturePixels,
    pub backend: CaptureBackend,
    pub downgraded_from_hdr: bool,
    pub overlay_compensated: bool,
}

fn capture_area_verbose_logging_enabled_for(value: Option<&str>) -> bool {
    matches!(
        value.map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if matches!(value.as_str(), "1" | "true" | "yes" | "on")
    )
}

fn capture_area_verbose_logging_enabled() -> bool {
    if cfg!(feature = "diag_capture") {
        return true;
    }

    capture_area_verbose_logging_enabled_for(
        std::env::var("HOOK_CAPTURE_AREA_VERBOSE_LOG")
            .ok()
            .as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wgc_fast_path_mode_env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .expect("wgc fast path env lock should not be poisoned")
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn display_selection_falls_back_to_the_monitor_containing_the_reported_center() {
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
                physical_origin_x: 1920,
                physical_origin_y: -100,
                physical_width: 2560,
                physical_height: 1440,
                logical_width: 2048.0,
                logical_height: 1152.0,
            },
        ];
        let slightly_rounded_metrics = CaptureWindowMetrics {
            physical_origin_x: 1917.0,
            physical_origin_y: -98.0,
            scale_factor: 1.25,
            logical_width: 2046.0,
            logical_height: 1150.0,
        };

        assert_eq!(
            select_capture_display_geometry_index(slightly_rounded_metrics, &geometries),
            Some(1),
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn converts_local_logical_capture_rect_using_the_selected_display_scale() {
        let geometry = CaptureDisplayGeometry {
            physical_origin_x: -2560,
            physical_origin_y: -200,
            physical_width: 2560,
            physical_height: 1440,
            logical_width: 2560.0 / 1.5,
            logical_height: 960.0,
        };

        let rect = local_logical_capture_rect_to_physical(100, 50, 400, 200, geometry)
            .expect("capture rect should intersect the selected display");
        assert_eq!(
            rect,
            LocalPhysicalCaptureRect {
                left: 150,
                top: 75,
                right: 750,
                bottom: 375,
            },
        );
        assert_eq!(geometry.physical_origin_x + rect.left as i32, -2410);
        assert_eq!(geometry.physical_origin_y + rect.top as i32, -125);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn live_display_metrics_resolve_back_to_the_same_capture_display() {
        let mut resolved_count = 0usize;
        for expected_display in Display::list() {
            let Some(geometry) = capture_display_geometry(&expected_display) else {
                continue;
            };
            let scale_factor = geometry.physical_width as f64 / geometry.logical_width;
            let metrics = CaptureWindowMetrics {
                physical_origin_x: geometry.physical_origin_x as f64,
                physical_origin_y: geometry.physical_origin_y as f64,
                scale_factor,
                logical_width: geometry.physical_width as f64 / scale_factor,
                logical_height: geometry.physical_height as f64 / scale_factor,
            };

            let (resolved_display, resolved_geometry) = capture_display_for_metrics(Some(metrics))
                .expect("live display metrics should resolve to a capture display");
            assert_eq!(resolved_display.id(), expected_display.id());
            assert_eq!(resolved_geometry, geometry);
            let plan = capture_plan(0, 0, 100, 100, Some(metrics))
                .expect("capture plan should use the resolved live display");
            assert_eq!(plan.display_id, expected_display.id());
            assert_eq!(plan.physical_origin_x, geometry.physical_origin_x);
            assert_eq!(plan.physical_origin_y, geometry.physical_origin_y);
            resolved_count += 1;
        }
        assert!(
            resolved_count > 0,
            "at least one capture display should resolve"
        );
    }

    #[test]
    fn capture_area_verbose_logging_is_opt_in() {
        assert!(!capture_area_verbose_logging_enabled_for(None));
        assert!(!capture_area_verbose_logging_enabled_for(Some("")));
        assert!(!capture_area_verbose_logging_enabled_for(Some("0")));
        assert!(!capture_area_verbose_logging_enabled_for(Some("false")));
        assert!(capture_area_verbose_logging_enabled_for(Some("1")));
        assert!(capture_area_verbose_logging_enabled_for(Some("true")));
        assert!(capture_area_verbose_logging_enabled_for(Some("yes")));
    }

    #[test]
    #[cfg(not(feature = "diag_capture"))]
    fn capture_area_verbose_logging_is_not_forced_in_normal_builds() {
        std::env::remove_var("HOOK_CAPTURE_AREA_VERBOSE_LOG");

        assert!(!capture_area_verbose_logging_enabled());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn dynamic_range_mode_defaults_to_auto_and_accepts_explicit_overrides() {
        assert_eq!(hdr_capture_mode_for(None), HdrCaptureMode::Auto);
        assert_eq!(hdr_capture_mode_for(Some("")), HdrCaptureMode::Auto);
        assert_eq!(
            hdr_capture_mode_for(Some("unexpected")),
            HdrCaptureMode::Auto
        );
        assert_eq!(hdr_capture_mode_for(Some(" HDR ")), HdrCaptureMode::Hdr);
        assert_eq!(hdr_capture_mode_for(Some("sdr")), HdrCaptureMode::Sdr);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn hdr_is_transient_region_only_and_requires_windows_11_with_hdr_enabled() {
        assert!(should_attempt_hdr_capture(
            HdrCaptureMode::Auto,
            CaptureWorkloadProfile::StandardRegion,
            true,
            true,
        ));
        assert!(!should_attempt_hdr_capture(
            HdrCaptureMode::Auto,
            CaptureWorkloadProfile::LongCapture,
            true,
            true,
        ));
        assert!(!should_attempt_hdr_capture(
            HdrCaptureMode::Auto,
            CaptureWorkloadProfile::StandardRegion,
            false,
            true,
        ));
        assert!(!should_attempt_hdr_capture(
            HdrCaptureMode::Sdr,
            CaptureWorkloadProfile::StandardRegion,
            true,
            true,
        ));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn hdr_downgrade_metadata_tracks_the_selected_display_fallback_reason() {
        assert!(should_report_hdr_downgrade_on_sdr_fallback(
            HdrCaptureMode::Auto,
            true,
            true,
            true,
        ));
        assert!(should_report_hdr_downgrade_on_sdr_fallback(
            HdrCaptureMode::Hdr,
            false,
            false,
            true,
        ));
        assert!(should_report_hdr_downgrade_on_sdr_fallback(
            HdrCaptureMode::Auto,
            false,
            true,
            false,
        ));
        assert!(!should_report_hdr_downgrade_on_sdr_fallback(
            HdrCaptureMode::Auto,
            false,
            false,
            true,
        ));
        assert!(!should_report_hdr_downgrade_on_sdr_fallback(
            HdrCaptureMode::Sdr,
            false,
            true,
            false,
        ));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn hdr_content_detection_uses_the_windows_sdr_white_level() {
        assert!(!content_exceeds_sdr_white(205.0, 203.0));
        assert!(content_exceeds_sdr_white(209.0, 203.0));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn primary_display_hdr_probe_returns_sane_values_when_available() {
        if let Some(info) = hdr_display_info_for(&Display::primary()) {
            console_line!(
                "primary display HDR probe: enabled={} sdr_white={} min={} max={}",
                info.enabled,
                info.sdr_white_level_nits,
                info.min_luminance_nits,
                info.max_luminance_nits,
            );
            assert!(info.sdr_white_level_nits.is_finite());
            assert!(info.sdr_white_level_nits >= 80.0);
            assert!(info.min_luminance_nits.is_finite());
            assert!(info.max_luminance_nits.is_finite());
            assert!(info.max_luminance_nits >= 1.0);
        }
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn pq_encoding_matches_reference_luminance_points() {
        assert!((pq_oetf_from_nits(100.0) - 0.508).abs() < 0.002);
        assert!((pq_oetf_from_nits(1_000.0) - 0.752).abs() < 0.002);
        assert!((pq_oetf_from_nits(10_000.0) - 1.0).abs() < 0.0001);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn scrgb_float_pixels_convert_to_real_16_bit_bt2020_pq_payload() {
        let mut data = Vec::new();
        for value in [12.5f32, 0.0, 0.0, 1.0] {
            data.extend_from_slice(&f16::from_f32(value).to_le_bytes());
        }
        let analysis =
            analyze_scrgb_buffer(&data, 1, 1, 8, 1.0).expect("scRGB analysis should succeed");
        assert!(analysis.max_content_light_level_nits > 200.0);

        let image = scrgb_buffer_to_hdr_pq(
            &data,
            1,
            1,
            8,
            analysis,
            HdrDisplayInfo {
                enabled: true,
                sdr_white_level_nits: 203.0,
                min_luminance_nits: 0.001,
                max_luminance_nits: 1_000.0,
            },
            1.0,
        )
        .expect("HDR conversion should succeed");
        assert_eq!(image.rgb16_be.len(), 6);
        assert_ne!(image.rgb16_be, vec![0; 6]);
        assert_eq!(image.width, 1);
        assert_eq!(image.height, 1);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn sdr_only_float_capture_maps_system_sdr_white_to_srgb_white() {
        let mut data = Vec::new();
        let scrgb_sdr_white = 203.0 / 80.0;
        for value in [scrgb_sdr_white, scrgb_sdr_white, scrgb_sdr_white, 1.0] {
            data.extend_from_slice(&f16::from_f32(value).to_le_bytes());
        }

        let image = scrgb_buffer_to_sdr_rgb(&data, 1, 1, 8, 203.0, 1.0)
            .expect("SDR conversion should succeed");
        assert_eq!(image.get_pixel(0, 0).0, [255, 255, 255]);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn auto_wgc_mode_defaults_to_transient_for_both_standard_and_long_capture() {
        let _lock = wgc_fast_path_mode_env_lock();
        std::env::remove_var("HOOK_WGC_FAST_PATH_MODE");

        assert!(!should_use_persistent_wgc(
            CaptureWorkloadProfile::StandardRegion
        ));
        assert!(!should_use_persistent_wgc(
            CaptureWorkloadProfile::LongCapture
        ));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn explicit_persistent_override_enables_persistent_wgc_for_every_capture_profile() {
        let _lock = wgc_fast_path_mode_env_lock();
        std::env::set_var("HOOK_WGC_FAST_PATH_MODE", "persistent");

        assert!(should_use_persistent_wgc(
            CaptureWorkloadProfile::StandardRegion
        ));
        assert!(should_use_persistent_wgc(
            CaptureWorkloadProfile::LongCapture
        ));

        std::env::remove_var("HOOK_WGC_FAST_PATH_MODE");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn explicit_transient_override_disables_persistent_wgc_for_every_capture_profile() {
        let _lock = wgc_fast_path_mode_env_lock();
        std::env::set_var("HOOK_WGC_FAST_PATH_MODE", "transient");

        assert!(!should_use_persistent_wgc(
            CaptureWorkloadProfile::StandardRegion
        ));
        assert!(!should_use_persistent_wgc(
            CaptureWorkloadProfile::LongCapture
        ));

        std::env::remove_var("HOOK_WGC_FAST_PATH_MODE");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn wgc_uses_short_refresh_timeout_when_a_usable_cached_frame_exists() {
        assert!(
            wgc_frame_wait_timeout(true) < wgc_frame_wait_timeout(false),
            "cached WGC frames should not make static-screen captures wait for the full initial frame timeout"
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn detects_black_video_hole_with_bright_controls_as_suspicious() {
        let mut image = RgbImage::new(320, 220);
        for y in 0..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([0, 0, 0]));
            }
        }
        for y in 190..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([238, 238, 238]));
            }
        }
        for y in 10..30 {
            for x in 220..310 {
                image.put_pixel(x, y, image::Rgb([230, 230, 230]));
            }
        }

        assert!(frame_has_suspicious_black_video_hole(&image));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn detects_black_video_hole_even_when_some_overlay_text_reduces_black_ratio() {
        let mut image = RgbImage::new(320, 220);
        for y in 0..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([0, 0, 0]));
            }
        }
        // Bilibili-style page/player text can reduce the sampled black ratio to
        // about 90%, while the video plane is still clearly a black hole.
        for y in 30..45 {
            for x in 40..280 {
                image.put_pixel(x, y, image::Rgb([210, 210, 210]));
            }
        }
        for y in 190..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([238, 238, 238]));
            }
        }

        assert!(frame_has_suspicious_black_video_hole(&image));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn suspicious_black_video_hole_is_not_a_usable_cached_wgc_frame() {
        let mut image = RgbImage::new(320, 220);
        for y in 0..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([0, 0, 0]));
            }
        }
        for y in 190..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([238, 238, 238]));
            }
        }

        assert!(!wgc_cached_frame_is_usable(&image, None));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn wgc_timeout_fallback_prefers_recent_usable_backup_over_suspicious_frame() {
        let suspicious = RgbImage::from_pixel(2, 1, image::Rgb([0, 0, 0]));
        let recent_usable = RgbImage::from_pixel(2, 1, image::Rgb([20, 80, 160]));
        let selected = select_wgc_timeout_fallback_frame(
            Some(suspicious),
            Some((recent_usable, std::time::Instant::now())),
        )
        .expect("recent usable backup should be selected");

        assert_eq!(selected.get_pixel(0, 0).0, [20, 80, 160]);
    }
}
