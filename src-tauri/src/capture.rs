use tauri::Window;

use crate::screenshot;

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

#[tauri::command]
pub async fn capture_region(
    _window: Window,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) -> Result<CaptureResponse, String> {
    crate::append_runtime_log_line(&format!(
        "capture_region request :: x={} y={} w={} h={}",
        x, y, w, h
    ));
    // 1. Capture Region with proper DPI Scaling via Scap
    // Note: We pass logical coords (x,y,w,h) as received from frontend.
    // The backend `capture_area` handles conversion to physical pixels.
    let rgb_image = match screenshot::capture_area(x, y, w, h) {
        Ok(image) => image,
        Err(error) => {
            crate::append_runtime_log_line(&format!("capture_region failure :: {}", error));
            return Err(error.to_string());
        }
    };

    let width = rgb_image.width();
    let height = rgb_image.height();
    crate::append_runtime_log_line(&format!(
        "capture_region success :: width={} height={} mode=file-backed",
        width, height
    ));
    crate::encode_rgb_image_as_file_capture_response(rgb_image)
}
