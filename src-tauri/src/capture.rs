use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::Window;

use crate::screenshot;

static REGION_CAPTURE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);
const REGION_CAPTURE_TIMEOUT: Duration = Duration::from_secs(6);

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
}

#[tauri::command]
pub async fn capture_region(
    _window: Window,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    composition_overlay_alpha: Option<f32>,
) -> Result<CaptureResponse, String> {
    crate::append_runtime_log_line(&format!(
        "capture_region request :: x={} y={} w={} h={} composition_overlay_alpha={:?}",
        x, y, w, h, composition_overlay_alpha
    ));

    if REGION_CAPTURE_IN_FLIGHT
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        crate::append_runtime_log_line("capture_region busy");
        return Err("Capture is already in progress; please try again".to_string());
    }

    let handle = tokio::task::spawn_blocking(move || -> Result<CaptureResponse, String> {
        let _in_flight_guard = RegionCaptureInFlightGuard;
        // Capture Region with proper DPI Scaling via Scap.
        // Note: We pass logical coords (x,y,w,h) as received from frontend.
        // The backend `capture_area` handles conversion to physical pixels.
        let overlay_gain = black_overlay_gain(composition_overlay_alpha).unwrap_or(1.0);
        let capture = match screenshot::capture_region_with_dynamic_range(x, y, w, h, overlay_gain)
        {
            Ok(capture) => capture,
            Err(error) => {
                crate::append_runtime_log_line(&format!("capture_region failure :: {}", error));
                return Err(error.to_string());
            }
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

    match tokio::time::timeout(REGION_CAPTURE_TIMEOUT, handle).await {
        Ok(join_result) => join_result.map_err(|error| {
            crate::append_runtime_log_line(&format!(
                "capture_region worker_join_failure :: {}",
                error
            ));
            error.to_string()
        })?,
        Err(_) => {
            crate::append_runtime_log_line("capture_region timeout");
            Err("Capture timed out; please try again".to_string())
        }
    }
}
