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
}

fn remove_black_overlay_alpha(rgb_image: &mut image::RgbImage, alpha: Option<f32>) -> bool {
    let Some(alpha) = alpha else {
        return false;
    };
    if !alpha.is_finite() {
        return false;
    }

    let alpha = alpha.clamp(0.0, 0.85);
    if alpha <= 0.0 {
        return false;
    }

    let multiplier = 1.0 / (1.0 - alpha);
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
        let mut rgb_image = match screenshot::capture_area(x, y, w, h) {
            Ok(image) => image,
            Err(error) => {
                crate::append_runtime_log_line(&format!("capture_region failure :: {}", error));
                return Err(error.to_string());
            }
        };
        if remove_black_overlay_alpha(&mut rgb_image, composition_overlay_alpha) {
            crate::append_runtime_log_line(
                "capture_region overlay_compensation :: removed_black_overlay",
            );
        }

        let width = rgb_image.width();
        let height = rgb_image.height();
        crate::append_runtime_log_line(&format!(
            "capture_region success :: width={} height={} mode=file-backed",
            width, height
        ));
        crate::encode_rgb_image_as_file_capture_response(rgb_image)
    });

    match tokio::time::timeout(REGION_CAPTURE_TIMEOUT, handle).await {
        Ok(join_result) => join_result.map_err(|error| {
            crate::append_runtime_log_line(&format!("capture_region worker_join_failure :: {}", error));
            error.to_string()
        })?,
        Err(_) => {
            crate::append_runtime_log_line("capture_region timeout");
            Err("Capture timed out; please try again".to_string())
        }
    }
}
