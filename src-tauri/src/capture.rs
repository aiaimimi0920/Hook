use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{Manager, Window};

use crate::capture_coords::CaptureWindowMetrics;
#[cfg(target_os = "windows")]
use crate::capture_protected_target::overlapping_protected_window;
use crate::capture_protected_target::ResolvedProtectedWindow;
use crate::screenshot;

static REGION_CAPTURE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
const REGION_CAPTURE_TIMEOUT: Duration = Duration::from_secs(6);

fn capture_display_metrics(window: &Window) -> Option<CaptureWindowMetrics> {
    let monitor = window.current_monitor().ok().flatten()?;
    let position = monitor.position();
    let physical_size = monitor.size();
    let scale_factor = monitor.scale_factor();
    Some(CaptureWindowMetrics {
        physical_origin_x: position.x as f64,
        physical_origin_y: position.y as f64,
        scale_factor,
        logical_width: physical_size.width as f64 / scale_factor,
        logical_height: physical_size.height as f64 / scale_factor,
    })
}

struct RegionCaptureInFlightGuard;

impl Drop for RegionCaptureInFlightGuard {
    fn drop(&mut self) {
        REGION_CAPTURE_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResponse {
    pub base64: String,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_url: Option<String>,
    #[serde(flatten)]
    pub metadata: CaptureMetadata,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureMetadata {
    pub dynamic_range: String,
    pub bit_depth: u8,
    pub color_space: String,
    pub capture_backend: String,
    pub downgraded_from_hdr: bool,
}

impl CaptureMetadata {
    pub(crate) fn sdr(capture_backend: impl Into<String>, downgraded_from_hdr: bool) -> Self {
        Self {
            dynamic_range: "sdr".to_string(),
            bit_depth: 8,
            color_space: "srgb".to_string(),
            capture_backend: capture_backend.into(),
            downgraded_from_hdr,
        }
    }

    pub(crate) fn hdr(capture_backend: impl Into<String>) -> Self {
        Self {
            dynamic_range: "hdr".to_string(),
            bit_depth: 16,
            color_space: "bt2020-pq".to_string(),
            capture_backend: capture_backend.into(),
            downgraded_from_hdr: false,
        }
    }
}

fn black_overlay_gain(alpha: Option<f32>) -> Option<f32> {
    let alpha = alpha?;
    if !alpha.is_finite() {
        return None;
    }
    let alpha = alpha.clamp(0.0, 0.85);
    (alpha > 0.0).then_some(1.0 / (1.0 - alpha))
}

fn remove_black_overlay_alpha(rgb_image: &mut image::RgbImage, alpha: Option<f32>) -> bool {
    let Some(multiplier) = black_overlay_gain(alpha) else {
        return false;
    };
    for pixel in rgb_image.pixels_mut() {
        for channel in &mut pixel.0 {
            *channel = ((*channel as f32) * multiplier).round().clamp(0.0, 255.0) as u8;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn black_composition_overlay_compensation_restores_pixel_brightness() {
        let alpha = 0.18;
        let original = [82u8, 164u8, 205u8];
        let dimmed = original.map(|channel| ((channel as f32) * (1.0 - alpha)).round() as u8);
        let mut image = image::RgbImage::from_pixel(1, 1, image::Rgb(dimmed));

        remove_black_overlay_alpha(&mut image, Some(alpha));

        let restored = image.get_pixel(0, 0).0;
        for (actual, expected) in restored.iter().zip(original.iter()) {
            assert!(
                (*actual as i16 - *expected as i16).abs() <= 1,
                "expected restored channel {actual} to be within 1 of {expected}"
            );
        }
    }

    #[test]
    fn capture_metadata_exposes_real_hdr_and_downgrade_state() {
        let hdr = CaptureMetadata::hdr("wgc-hdr-transient");
        assert_eq!(hdr.dynamic_range, "hdr");
        assert_eq!(hdr.bit_depth, 16);
        assert_eq!(hdr.color_space, "bt2020-pq");
        assert!(!hdr.downgraded_from_hdr);

        let sdr = CaptureMetadata::sdr("gdi-sdr", true);
        assert_eq!(sdr.dynamic_range, "sdr");
        assert_eq!(sdr.bit_depth, 8);
        assert!(sdr.downgraded_from_hdr);
    }

    #[test]
    fn capture_response_flattens_dynamic_range_metadata_for_frontend_ipc() {
        let response = CaptureResponse {
            base64: String::new(),
            width: 1,
            height: 1,
            file_path: Some("capture.png".to_string()),
            file_url: None,
            metadata: CaptureMetadata::hdr("wgc-hdr-transient"),
        };
        let value = serde_json::to_value(response).expect("capture response should serialize");
        assert_eq!(value["dynamicRange"], "hdr");
        assert_eq!(value["bitDepth"], 16);
        assert_eq!(value["colorSpace"], "bt2020-pq");
        assert_eq!(value["captureBackend"], "wgc-hdr-transient");
    }

    #[test]
    #[ignore = "requires a visible protected window HWND in HOOK_PROTECTED_WINDOW_HWND"]
    fn resolves_a_protected_window_that_only_partially_overlaps_a_region() {
        let expected = std::env::var("HOOK_PROTECTED_WINDOW_HWND")
            .expect("HOOK_PROTECTED_WINDOW_HWND must be set for the live target probe");
        let metrics = CaptureWindowMetrics {
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            scale_factor: 1.0,
            logical_width: 2560.0,
            logical_height: 1440.0,
        };
        assert_eq!(
            overlapping_protected_window(33, 0, 1000, 1200, metrics).map(|resolved| resolved.id),
            Some(expected)
        );
    }
}

#[tauri::command]
pub async fn capture_region(
    window: Window,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    composition_overlay_alpha: Option<f32>,
    capture_window_id: Option<String>,
) -> Result<CaptureResponse, String> {
    let display_metrics = capture_display_metrics(&window)
        .ok_or_else(|| "Capture display metrics are unavailable".to_string())?;
    crate::append_runtime_log_line(&format!(
        "capture_region request :: x={} y={} w={} h={} composition_overlay_alpha={:?} capture_window_id={:?} display_origin={:?}",
        x,
        y,
        w,
        h,
        composition_overlay_alpha,
        capture_window_id,
        (display_metrics.physical_origin_x, display_metrics.physical_origin_y),
    ));

    if REGION_CAPTURE_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        crate::append_runtime_log_line("capture_region busy");
        return Err("Capture is already in progress; please try again".to_string());
    }

    #[cfg(target_os = "windows")]
    let auto_protected_window: Option<ResolvedProtectedWindow> = {
        let resolved = overlapping_protected_window(x, y, w, h, display_metrics);
        if let Some(window) = resolved.as_ref() {
            crate::append_runtime_log_line(&format!(
                "capture_region protected_target_resolved :: target={} requested={:?} occluders={}",
                window.id,
                capture_window_id,
                window.occluding_windows.len()
            ));
        }
        resolved
    };
    #[cfg(not(target_os = "windows"))]
    let auto_protected_window: Option<ResolvedProtectedWindow> = None;
    let protected_composition_window_id = auto_protected_window
        .as_ref()
        .map(|window| window.id.clone());
    let capture_window_id_for_capture = capture_window_id
        .clone()
        .or_else(|| protected_composition_window_id.clone());
    let compose_protected_region = protected_composition_window_id.is_some();
    let protected_occluding_windows = auto_protected_window
        .as_ref()
        .map(|window| window.occluding_windows.clone())
        .unwrap_or_default();

    // The selection overlay is a topmost WebView.  Leaving it visible while a
    // GPU-composited target is captured can suspend that target's compositor
    // surface (Telegram then produces no WGC frame and the display fallback
    // samples the desktop behind it).  Hide only for HWND-backed captures; the
    // normal region path keeps its existing overlay compensation behavior.
    // This must happen before spawn_blocking: starting the worker first races
    // GraphicsCaptureItem creation against the asynchronous overlay hide.
    let overlay_hidden_for_window_capture = capture_window_id_for_capture.is_some();
    let overlay_hit_map_was_active = overlay_hidden_for_window_capture
        .then(|| crate::OVERLAY_MOUSE_HIT_MAP_ACTIVE.swap(false, Ordering::SeqCst));
    if overlay_hidden_for_window_capture {
        #[cfg(target_os = "windows")]
        {
            // The native input shield is a separate topmost HWND. Hiding only
            // the WebView leaves that shield as the foreground window, so
            // Telegram keeps WDA_EXCLUDEFROMCAPTURE and WGC receives no frame.
            crate::hide_overlay_input_shield_window();
            crate::append_runtime_log_line("capture_window input_shield_hidden");
        }
        if let Err(error) = window.hide() {
            crate::append_runtime_log_line(&format!(
                "capture_window overlay_hide_failed :: error={error}"
            ));
        } else {
            crate::append_runtime_log_line("capture_window overlay_hidden");
        }
        // WebView visibility changes cross the Win32 message queue. Give DWM a
        // short bounded interval to expose the target before WGC starts.
        tokio::time::sleep(Duration::from_millis(80)).await;
    }

    let handle = tokio::task::spawn_blocking(move || -> Result<CaptureResponse, String> {
        let _in_flight_guard = RegionCaptureInFlightGuard;
        // Capture Region with proper DPI Scaling via Scap.
        // Note: We pass logical coords (x,y,w,h) as received from frontend.
        // The backend `capture_area` handles conversion to physical pixels.
        let overlay_gain = black_overlay_gain(composition_overlay_alpha).unwrap_or(1.0);
        let capture = match capture_window_id_for_capture.as_deref() {
            Some(window_id) => {
                if compose_protected_region {
                    let protected_window_id = protected_composition_window_id
                        .as_deref()
                        .unwrap_or(window_id);
                    screenshot::capture_region_with_protected_window(
                        protected_window_id,
                        x,
                        y,
                        w,
                        h,
                        display_metrics,
                        &protected_occluding_windows,
                    )
                    .map_err(|error| {
                        format!("protected window region composition failed: {error:#}")
                    })?
                } else {
                    // The frontend target is sampled before the overlay repaint.
                    // Telegram can replace or minimize that HWND while the
                    // capture request is waiting, so retry with the current
                    // top-level window from the same process whose bounds contain
                    // the requested region before falling back to a desktop crop.
                    let selection_right = x as f64 + w as f64;
                    let selection_bottom = y as f64 + h as f64;
                    let target_contains_selection =
                        |target: &crate::capture_windows::CaptureWindowTarget| {
                            target.x <= x as f64 + 1.0
                                && target.y <= y as f64 + 1.0
                                && target.x + target.w + 1.0 >= selection_right
                                && target.y + target.h + 1.0 >= selection_bottom
                        };
                    let requested_process_id =
                        crate::capture_windows::process_id_for_capture_window_id(window_id);
                    #[cfg(target_os = "windows")]
                    let requested_window_is_protected =
                        screenshot::window_display_affinity(window_id)
                            .is_some_and(|affinity| affinity != 0);
                    #[cfg(not(target_os = "windows"))]
                    let requested_window_is_protected = false;
                    let mut candidate_ids = vec![window_id.to_string()];
                    for target in
                        crate::capture_windows::list_capture_window_targets(display_metrics)
                    {
                        if target.id != window_id
                            && target_contains_selection(&target)
                            && requested_process_id == Some(target.process_id)
                        {
                            candidate_ids.push(target.id);
                        }
                    }

                    let mut direct_capture = None;
                    let mut last_error = "Window surface capture is unavailable".to_string();
                    for candidate_id in candidate_ids {
                        match screenshot::capture_window_with_dynamic_range(
                            &candidate_id,
                            x,
                            y,
                            w,
                            h,
                            display_metrics,
                        ) {
                            Ok(capture) => {
                                if candidate_id != window_id {
                                    crate::append_runtime_log_line(&format!(
                                        "capture_window target_recovered :: requested={} resolved={}",
                                        window_id, candidate_id
                                    ));
                                }
                                direct_capture = Some(capture);
                                break;
                            }
                            Err(error) => {
                                crate::append_runtime_log_line(&format!(
                                    "capture_window direct_attempt_failed :: target={} error={}",
                                    candidate_id, error
                                ));
                                last_error = error.to_string();
                            }
                        }
                    }

                    match direct_capture {
                        Some(capture) => capture,
                        None => {
                            if requested_window_is_protected {
                                crate::append_runtime_log_line(&format!(
                                    "capture_window protected_capture_unavailable :: target={} error={}",
                                    window_id, last_error
                                ));
                                return Err(
                                    "The selected window is protected from standard capture and its DWM surface is unavailable"
                                        .to_string(),
                                );
                            }
                            crate::append_runtime_log_line(&format!(
                                "capture_window fallback_to_display_region :: target={} error={}",
                                window_id, last_error
                            ));
                            screenshot::capture_region_with_dynamic_range(
                                x,
                                y,
                                w,
                                h,
                                Some(display_metrics),
                                overlay_gain,
                            )
                            .map_err(|fallback_error| {
                                format!(
                                    "window capture failed: {last_error}; display fallback failed: {fallback_error}"
                                )
                            })?
                        }
                    }
                }
            }
            None => screenshot::capture_region_with_dynamic_range(
                x,
                y,
                w,
                h,
                Some(display_metrics),
                overlay_gain,
            )
            .map_err(|error| error.to_string())?,
        };
        let backend = capture.backend.as_str();
        match capture.pixels {
            screenshot::DynamicCapturePixels::Sdr(mut rgb_image) => {
                if !capture.overlay_compensated
                    && remove_black_overlay_alpha(&mut rgb_image, composition_overlay_alpha)
                {
                    crate::append_runtime_log_line(
                        "capture_region overlay_compensation :: removed_black_overlay",
                    );
                }
                crate::append_runtime_log_line(&format!(
                    "capture_region success :: width={} height={} dynamic_range=sdr backend={} downgraded_from_hdr={} mode=file-backed",
                    rgb_image.width(),
                    rgb_image.height(),
                    backend,
                    capture.downgraded_from_hdr,
                ));
                crate::encode_rgb_image_as_file_capture_response_with_metadata(
                    rgb_image,
                    CaptureMetadata::sdr(backend, capture.downgraded_from_hdr),
                )
            }
            screenshot::DynamicCapturePixels::Hdr(hdr_image) => {
                crate::append_runtime_log_line(&format!(
                    "capture_region success :: width={} height={} dynamic_range=hdr backend={} max_cll_nits={} mode=file-backed",
                    hdr_image.width,
                    hdr_image.height,
                    backend,
                    hdr_image.max_content_light_level_nits,
                ));
                crate::encode_hdr_image_as_file_capture_response(
                    hdr_image,
                    CaptureMetadata::hdr(backend),
                )
            }
        }
    });

    let mut handle = handle;
    let result = match tokio::time::timeout(REGION_CAPTURE_TIMEOUT, &mut handle).await {
        Ok(join_result) => join_result.map_err(|error| {
            crate::append_runtime_log_line(&format!(
                "capture_region worker_join_failure :: {}",
                error
            ));
            error.to_string()
        })?,
        Err(_) => {
            crate::append_runtime_log_line("capture_region timeout");
            // `spawn_blocking` work cannot be aborted safely. Wait for the
            // worker to finish before restoring the overlay/shield; otherwise
            // a late WGC callback can race the restored UI and contaminate the
            // next capture request.
            let _ = handle.await;
            Err("Capture timed out; please try again".to_string())
        }
    };
    if overlay_hidden_for_window_capture {
        if let Err(error) = window.show() {
            crate::append_runtime_log_line(&format!(
                "capture_window overlay_restore_failed :: error={error}"
            ));
        } else {
            crate::append_runtime_log_line("capture_window overlay_restored");
        }
        if let Some(was_active) = overlay_hit_map_was_active {
            crate::OVERLAY_MOUSE_HIT_MAP_ACTIVE.store(was_active, Ordering::SeqCst);
        }
        #[cfg(target_os = "windows")]
        if let Some(webview) = window.app_handle().get_webview_window("main") {
            crate::sync_overlay_input_shield_from_runtime_state(&webview);
        }
    }
    result
}
