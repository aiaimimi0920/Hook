use crate::capture_coords::CaptureWindowMetrics;
use image::RgbImage;

#[cfg(not(target_os = "windows"))]
use anyhow::anyhow;

#[cfg(target_os = "windows")]
use super::capture_area_verbose_logging_enabled;
#[cfg(target_os = "windows")]
use super::capture_pixels::HdrFrameDecision;
#[cfg(target_os = "windows")]
use super::display_selection::{capture_plan, CapturePlan};
#[cfg(target_os = "windows")]
use super::dwm_shared_surface::try_capture_protected_window;
#[cfg(target_os = "windows")]
use super::gdi_fallback::{capture_area_gdi, checked_gdi_capture_rect};
#[cfg(target_os = "windows")]
use super::hdr_analysis::{
    hdr_capture_mode, should_attempt_hdr_capture, should_report_hdr_downgrade_on_sdr_fallback,
    HdrDisplayInfo,
};
#[cfg(target_os = "windows")]
use super::hdr_display::hdr_display_info_for;
#[cfg(target_os = "windows")]
use super::wgc_session::{
    try_fast_capture, try_fast_capture_window, try_hdr_capture_transient, wgc_note_failure,
    wgc_note_success,
};
use super::{CaptureBackend, CaptureWorkloadProfile, DynamicCapturePixels, DynamicCaptureResult};

#[cfg(target_os = "windows")]
fn capture_backend_mode() -> String {
    // WGC captures hardware-overlay video; GDI remains an explicit diagnostic fallback.
    std::env::var("HOOK_CAPTURE_BACKEND")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "auto".to_string())
}

#[cfg(target_os = "windows")]
struct SdrCaptureResult {
    image: RgbImage,
    backend: CaptureBackend,
}

#[cfg(target_os = "windows")]
fn capture_sdr_from_plan(
    plan: &CapturePlan,
    profile: CaptureWorkloadProfile,
) -> anyhow::Result<SdrCaptureResult> {
    let verbose_log = capture_area_verbose_logging_enabled();
    let backend_mode = capture_backend_mode();
    if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area dispatch :: mode={} profile={:?}",
            backend_mode, profile
        ));
    }
    if backend_mode == "auto" {
        if let Some(image) = try_fast_capture(plan.display_id.clone(), Some(plan.crop), profile) {
            wgc_note_success();
            if verbose_log {
                crate::append_runtime_log_line(&format!(
                    "capture_area fast_success :: width={} height={}",
                    image.width(),
                    image.height()
                ));
            }
            return Ok(SdrCaptureResult {
                image,
                backend: CaptureBackend::WgcSdr,
            });
        }
        wgc_note_failure();
        if verbose_log {
            crate::append_runtime_log_line("capture_area fast_path_none :: falling_back_to_gdi");
        }
    } else if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area fast_path_skipped :: mode={}",
            backend_mode
        ));
    }

    let (src_x, src_y, width, height) =
        checked_gdi_capture_rect(plan.physical_origin_x, plan.physical_origin_y, &plan.crop)?;
    let image = capture_area_gdi(src_x, src_y, width, height)?;
    if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area gdi_capture_success :: width={} height={}",
            image.width(),
            image.height()
        ));
    }
    Ok(SdrCaptureResult {
        image,
        backend: CaptureBackend::Gdi,
    })
}

pub fn capture_area_with_profile(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    profile: CaptureWorkloadProfile,
) -> anyhow::Result<RgbImage> {
    #[cfg(target_os = "windows")]
    {
        let plan = capture_plan(x, y, w, h, None)?;
        return capture_sdr_from_plan(&plan, profile).map(|result| result.image);
    }

    #[cfg(not(target_os = "windows"))]
    Err(anyhow!("Only Windows is supported"))
}

pub fn capture_region_with_dynamic_range(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: Option<CaptureWindowMetrics>,
    overlay_gain: f32,
) -> anyhow::Result<DynamicCaptureResult> {
    #[cfg(target_os = "windows")]
    {
        let profile = CaptureWorkloadProfile::StandardRegion;
        let plan = capture_plan(x, y, w, h, display_metrics)?;
        let mode = hdr_capture_mode();
        let display_info = hdr_display_info_for(&plan.display).unwrap_or(HdrDisplayInfo {
            enabled: false,
            sdr_white_level_nits: 203.0,
            min_luminance_nits: 0.0,
            max_luminance_nits: 1_000.0,
        });
        let windows_11_or_newer = scap_direct3d::WindowsVersion::detect()
            .map(|version| version.is_windows_11())
            .unwrap_or(false);
        let attempt_hdr =
            should_attempt_hdr_capture(mode, profile, windows_11_or_newer, display_info.enabled);

        if attempt_hdr {
            crate::append_runtime_log_line(&format!(
                "capture_area hdr_attempt :: mode={mode:?} sdr_white_nits={} max_luminance_nits={}",
                display_info.sdr_white_level_nits, display_info.max_luminance_nits
            ));
            if let Some(frame) = try_hdr_capture_transient(
                plan.display_id.clone(),
                plan.crop,
                display_info,
                mode,
                overlay_gain,
            ) {
                wgc_note_success();
                return Ok(match frame {
                    HdrFrameDecision::Hdr(image) => DynamicCaptureResult {
                        pixels: DynamicCapturePixels::Hdr(image),
                        backend: CaptureBackend::WgcHdr,
                        downgraded_from_hdr: false,
                        overlay_compensated: true,
                    },
                    HdrFrameDecision::Sdr(image) => DynamicCaptureResult {
                        pixels: DynamicCapturePixels::Sdr(image),
                        backend: CaptureBackend::WgcHdr,
                        downgraded_from_hdr: true,
                        overlay_compensated: true,
                    },
                });
            }
            crate::append_runtime_log_line(
                "capture_area hdr_failed :: falling_back_to_sdr_wgc_then_gdi",
            );
        }

        let sdr = capture_sdr_from_plan(&plan, profile)?;
        let downgraded_from_hdr = should_report_hdr_downgrade_on_sdr_fallback(
            mode,
            attempt_hdr,
            display_info.enabled,
            windows_11_or_newer,
        );
        return Ok(DynamicCaptureResult {
            pixels: DynamicCapturePixels::Sdr(sdr.image),
            backend: sdr.backend,
            downgraded_from_hdr,
            overlay_compensated: false,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let image = capture_area_with_profile(x, y, w, h, CaptureWorkloadProfile::StandardRegion)?;
        let _ = (display_metrics, overlay_gain);
        Ok(DynamicCaptureResult {
            pixels: DynamicCapturePixels::Sdr(image),
            backend: CaptureBackend::Gdi,
            downgraded_from_hdr: false,
            overlay_compensated: false,
        })
    }
}

/// Captures a confirmed whole-window target from the HWND-backed WGC source.
///
/// This deliberately stays SDR: window captures do not include Hook's black
/// composition overlay and therefore must not run the display HDR/overlay
/// compensation path. Callers can fall back to the normal display crop when
/// WGC cannot create a window item.
pub fn capture_window_with_dynamic_range(
    capture_window_id: &str,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: CaptureWindowMetrics,
) -> anyhow::Result<DynamicCaptureResult> {
    #[cfg(target_os = "windows")]
    {
        if let Some(image) =
            try_capture_protected_window(capture_window_id, x, y, w, h, display_metrics)
        {
            return Ok(DynamicCaptureResult {
                pixels: DynamicCapturePixels::Sdr(image),
                backend: CaptureBackend::DwmSharedSurface,
                downgraded_from_hdr: false,
                overlay_compensated: true,
            });
        }
        let image = try_fast_capture_window(capture_window_id, x, y, w, h, display_metrics)
            .ok_or_else(|| anyhow::anyhow!("Window surface capture is unavailable"))?;
        return Ok(DynamicCaptureResult {
            pixels: DynamicCapturePixels::Sdr(image),
            backend: CaptureBackend::WgcSdr,
            downgraded_from_hdr: false,
            // The source is the window itself, so there is no desktop overlay
            // to remove from the returned pixels.
            overlay_compensated: true,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (capture_window_id, x, y, w, h, display_metrics);
        Err(anyhow!("Only Windows is supported"))
    }
}

#[allow(dead_code)]
pub fn capture_area(x: i32, y: i32, w: u32, h: u32) -> anyhow::Result<RgbImage> {
    capture_area_with_profile(x, y, w, h, CaptureWorkloadProfile::StandardRegion)
}
