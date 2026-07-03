use base64::{engine::general_purpose, Engine as _};
use image::ImageFormat;
use std::io::Cursor;
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

    // 2. Convert to PNG & Encode
    let width = rgb_image.width();
    let height = rgb_image.height();
    let mut bytes: Vec<u8> = Vec::new();
    let dynamic_image = image::DynamicImage::ImageRgb8(rgb_image);
    dynamic_image
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
        .map_err(|e| e.to_string())?;

    let b64 = general_purpose::STANDARD.encode(&bytes);
    crate::append_runtime_log_line(&format!(
        "capture_region success :: width={} height={}",
        width, height
    ));
    Ok(CaptureResponse {
        base64: format!("data:image/png;base64,{}", b64),
        width,
        height,
        file_path: None,
        file_url: None,
    })
}
