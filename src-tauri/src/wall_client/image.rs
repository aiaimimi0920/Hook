//! Verify content identity and decode within a pixel/allocation budget before WebView delivery.
use std::io::{Cursor, Write};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::ImageEncoder;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_PIXELS: u64 = 16_777_216;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImageResponse {
    protocol_version: String,
    resource: ImageDescriptor,
    data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImageDescriptor {
    resource_id: String,
    kind: String,
    mime: String,
    size: u64,
    width: Option<u32>,
    height: Option<u32>,
}

pub(super) fn validate_id(id: &str) -> bool {
    id.len() == 71
        && id.starts_with("sha256:")
        && id.as_bytes()[7..]
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn dimensions(width: u32, height: u32) -> Result<(), &'static str> {
    if width == 0
        || height == 0
        || width > 16384
        || height > 16384
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err("wall_image_pixel_limit");
    }
    Ok(())
}

struct BoundedPng(Vec<u8>);
impl Write for BoundedPng {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > MAX_BYTES {
            return Err(std::io::Error::other("wall PNG exceeds output budget"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub(super) fn decode(body: Value, expected_id: &str) -> Result<Value, &'static str> {
    let response: ImageResponse = serde_json::from_value(body).map_err(|_| "wall_image_invalid")?;
    let resource = response.resource;
    if response.protocol_version != "loom.wall.v1"
        || !validate_id(expected_id)
        || resource.resource_id != expected_id
        || resource.kind != "image"
        || resource.size == 0
        || resource.size > MAX_BYTES as u64
        || response.data_base64.len() > MAX_BYTES.div_ceil(3) * 4
    {
        return Err("wall_image_invalid");
    }
    let bytes = STANDARD
        .decode(response.data_base64)
        .map_err(|_| "wall_image_invalid")?;
    if bytes.len() as u64 != resource.size
        || format!("sha256:{:x}", Sha256::digest(&bytes)) != expected_id
    {
        return Err("wall_image_integrity_failed");
    }
    let rgba = if resource.mime == "application/x-neuro-rgba8" {
        let (width, height) = resource
            .width
            .zip(resource.height)
            .ok_or("wall_image_invalid")?;
        dimensions(width, height)?;
        if u64::from(width) * u64::from(height) * 4 != bytes.len() as u64 {
            return Err("wall_image_invalid");
        }
        image::RgbaImage::from_raw(width, height, bytes).ok_or("wall_image_invalid")?
    } else {
        let format = image::guess_format(&bytes).map_err(|_| "wall_image_format_unsupported")?;
        let mime = match format {
            image::ImageFormat::Png => "image/png",
            image::ImageFormat::Jpeg => "image/jpeg",
            image::ImageFormat::WebP => "image/webp",
            image::ImageFormat::Bmp => "image/bmp",
            image::ImageFormat::Gif => "image/gif",
            _ => return Err("wall_image_format_unsupported"),
        };
        if resource.mime != mime {
            return Err("wall_image_format_unsupported");
        }
        let (width, height) = image::ImageReader::with_format(Cursor::new(&bytes), format)
            .into_dimensions()
            .map_err(|_| "wall_image_invalid")?;
        dimensions(width, height)?;
        if resource.width.is_some_and(|value| value != width)
            || resource.height.is_some_and(|value| value != height)
        {
            return Err("wall_image_invalid");
        }
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(16384);
        limits.max_image_height = Some(16384);
        limits.max_alloc = Some(MAX_PIXELS * 4);
        let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), format);
        reader.limits(limits);
        reader
            .decode()
            .map_err(|_| "wall_image_decode_failed")?
            .to_rgba8()
    };
    let mut png = BoundedPng(Vec::new());
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(
            rgba.as_raw(),
            rgba.width(),
            rgba.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|_| "wall_image_encode_failed")?;
    Ok(
        json!({ "resourceId": expected_id, "width": rgba.width(), "height": rgba.height(),
        "dataUrl": format!("data:image/png;base64,{}", STANDARD.encode(png.0)) }),
    )
}

#[cfg(test)]
mod tests;
