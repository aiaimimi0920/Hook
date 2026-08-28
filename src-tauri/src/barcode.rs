//! Bounded local QR/barcode decoding. UI and workflow layers consume the DTOs;
//! this module never opens URLs, writes the clipboard, or performs network I/O.

use image::ImageReader;
use reqwest::Url;
use rxing::helpers::detect_multiple_in_luma_with_hints;
use rxing::DecodeHints;
use serde::Serialize;
use std::io::Cursor;

const MAX_RESULTS: usize = 32;
const MAX_PAYLOAD_BYTES: usize = 16 * 1024;
const MAX_POINTS: usize = 16;
const MAX_PIXELS: u64 = 50_000_000;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BarcodePoint {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BarcodeBounds {
    pub left: f32,
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BarcodeResult {
    pub id: String,
    pub format: String,
    pub text: String,
    pub url: Option<String>,
    pub points: Vec<BarcodePoint>,
    pub bounds: Option<BarcodeBounds>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BarcodeScanResponse {
    pub width: u32,
    pub height: u32,
    pub results: Vec<BarcodeResult>,
}

fn classify_http_url(text: &str) -> Option<String> {
    let candidate = text.trim();
    let (_, authority_and_path) = candidate.split_once("://")?;
    let authority = authority_and_path
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    if authority.is_empty() {
        return None;
    }
    let parsed = Url::parse(candidate).ok()?;
    match parsed.scheme() {
        "http" | "https" if parsed.host_str().is_some() => Some(candidate.to_owned()),
        _ => None,
    }
}

fn bounded_points(points: &[rxing::Point]) -> (Vec<BarcodePoint>, Option<BarcodeBounds>) {
    let points: Vec<BarcodePoint> = points
        .iter()
        .take(MAX_POINTS)
        .filter_map(|point| {
            if point.x.is_finite() && point.y.is_finite() {
                Some(BarcodePoint {
                    x: point.x,
                    y: point.y,
                })
            } else {
                None
            }
        })
        .collect();
    let Some(first) = points.first() else {
        return (points, None);
    };
    let mut bounds = BarcodeBounds {
        left: first.x,
        top: first.y,
        right: first.x,
        bottom: first.y,
    };
    for point in points.iter().skip(1) {
        bounds.left = bounds.left.min(point.x);
        bounds.top = bounds.top.min(point.y);
        bounds.right = bounds.right.max(point.x);
        bounds.bottom = bounds.bottom.max(point.y);
    }
    (points, Some(bounds))
}

fn decode_luma(image_base64: &str) -> Result<BarcodeScanResponse, String> {
    let bytes = crate::decode_base64_image_data(image_base64)?;
    let image = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| format!("Barcode image format could not be detected: {error}"))?
        .decode()
        .map_err(|error| format!("Barcode image could not be decoded: {error}"))?;
    let width = image.width();
    let height = image.height();
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| "Barcode image dimensions overflow".to_owned())?;
    if pixels == 0 || pixels > MAX_PIXELS {
        return Err(format!(
            "Barcode image is outside the {} pixel limit",
            MAX_PIXELS
        ));
    }

    let luma = image.to_luma8().into_raw();
    let mut hints = DecodeHints::default();
    hints.AlsoInverted = Some(true);
    let decoded = match detect_multiple_in_luma_with_hints(luma, width, height, &mut hints) {
        Ok(results) => results,
        Err(rxing::Exceptions::NotFoundException(_)) => Vec::new(),
        Err(error) => return Err(format!("Barcode decoder failed: {error}")),
    };

    let mut results = decoded
        .into_iter()
        .filter_map(|result| {
            let text = result.getText().trim();
            if text.is_empty() || text.len() > MAX_PAYLOAD_BYTES {
                return None;
            }
            let (points, bounds) = bounded_points(result.getPoints());
            Some(BarcodeResult {
                id: String::new(),
                format: result.getBarcodeFormat().to_string(),
                text: text.to_owned(),
                url: classify_http_url(text),
                points,
                bounds,
            })
        })
        .collect::<Vec<_>>();
    results.sort_by(|left, right| {
        left.bounds
            .as_ref()
            .map(|bounds| (bounds.top, bounds.left))
            .partial_cmp(
                &right
                    .bounds
                    .as_ref()
                    .map(|bounds| (bounds.top, bounds.left)),
            )
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results.truncate(MAX_RESULTS);
    for (index, result) in results.iter_mut().enumerate() {
        result.id = format!("code-{}", index + 1);
    }

    Ok(BarcodeScanResponse {
        width,
        height,
        results,
    })
}

#[tauri::command]
pub fn decode_barcodes(image_base64: String) -> Result<BarcodeScanResponse, String> {
    decode_luma(&image_base64)
}

#[cfg(test)]
mod tests {
    use super::{classify_http_url, decode_luma};

    #[test]
    fn only_http_urls_are_actionable() {
        assert_eq!(
            classify_http_url("https://example.com/path"),
            Some("https://example.com/path".to_owned())
        );
        assert_eq!(classify_http_url("ftp://example.com/file"), None);
        assert_eq!(classify_http_url("https:///missing-host"), None);
    }

    #[test]
    fn url_classification_trims_transport_whitespace() {
        assert_eq!(
            classify_http_url("  http://localhost:1420/  "),
            Some("http://localhost:1420/".to_owned())
        );
    }

    #[test]
    fn decodes_qr_payload_and_reports_geometry() {
        let fixture = "iVBORw0KGgoAAAANSUhEUgAAAUoAAAFKAQAAAABTUiuoAAAB8UlEQVR4nO1bwW3DMAw8ygL6tIEO0FGcDbqyPUo2sP4OWJCUnTRAAbWPmoh5D0VS7kGAOOlIJcRoxJxamUBQU1AR1GakoCKozUhBhYAqsswygEJEFxkUF0+xNiG9NHVkwQLwJMm79Czuo9NddhZrC9JrU8suIdwIKCIwE112F+t5qflpTegX0DyA/imAFFT8nTpeiTAuxwXwMxLOTs31s5fbqUgR/MF1kCV7ijWdnopHH4GOMS73YdtWDzIdHms6PTXr+CCheehswt+VheNjTUGFQO2gFli65EmM4ay11lC/hZdYz0xFPQm1wLIqS/a08rK91SgcJyGcUJmvRMxXORf7VY5D2S1EPJW3qI7daosnyZYYDJ2ZykJbTqiwVOzG8DE9doOFJ3To4LuqLV2qeZccYeS4t/xpa5H0LJ0pSnNkN9je2uXIFjxli3nLkc5sqTdYZMtlL0MgfsO0ZQhtuXQZiu2lSzpP96VgOjzWFFR8fzu2UqvWW9ljrGem4klRdblra6dwaAvu3o7JmoXa0CBtG4q19xVrA9I5qGzdwZKtMGZebvErGrcv/ZglNfWlv1sxf66ZncSaTk/Nz2/HmiOUdxkGSVn8isbz2zFLTSzV8aSl1taD4nAZOJxK8a8FBLUZKagIajNSUBHUZvzCZXwBqA9sRqfvC2QAAAAASUVORK5CYII=";
        let response = decode_luma(fixture).expect("QR fixture should decode");
        assert_eq!((response.width, response.height), (330, 330));
        assert_eq!(response.results.len(), 1);
        assert_eq!(response.results[0].text, "https://example.com/hook");
        assert_eq!(
            response.results[0].url.as_deref(),
            Some("https://example.com/hook")
        );
        assert!(response.results[0].bounds.is_some());
    }
}
