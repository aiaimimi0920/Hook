use super::*;

fn envelope(bytes: &[u8], mime: &str, width: u32, height: u32) -> (String, Value) {
    let id = format!("sha256:{:x}", Sha256::digest(bytes));
    let body = json!({ "protocolVersion": "loom.wall.v1", "resource": {
        "resourceId": id, "kind": "image", "mime": mime, "size": bytes.len(),
        "width": width, "height": height
    }, "dataBase64": STANDARD.encode(bytes) });
    (id, body)
}

#[test]
fn raw_pixels_are_hashed_and_normalized_to_a_real_png() {
    let pixels = [255, 0, 0, 255, 0, 255, 0, 255];
    let (id, body) = envelope(&pixels, "application/x-neuro-rgba8", 2, 1);
    let result = decode(body, &id).unwrap();
    let png = STANDARD
        .decode(
            result["dataUrl"]
                .as_str()
                .unwrap()
                .strip_prefix("data:image/png;base64,")
                .unwrap(),
        )
        .unwrap();
    let decoded = image::load_from_memory(&png).unwrap().to_rgba8();
    assert_eq!(decoded.dimensions(), (2, 1));
    assert_eq!(decoded.as_raw(), &pixels);
    let (png_id, encoded) = envelope(&png, "image/png", 2, 1);
    assert_eq!(decode(encoded, &png_id).unwrap()["resourceId"], png_id);
}

#[test]
fn rejects_digest_tampering_mime_confusion_and_unbounded_dimensions() {
    let (id, mut body) = envelope(&[255, 0, 0, 255], "application/x-neuro-rgba8", 1, 1);
    body["dataBase64"] = json!(STANDARD.encode([0, 0, 0, 255]));
    assert_eq!(
        decode(body, &id).unwrap_err(),
        "wall_image_integrity_failed"
    );
    let (id, body) = envelope(&[0; 4], "application/x-neuro-rgba8", 16384, 16384);
    assert_eq!(decode(body, &id).unwrap_err(), "wall_image_pixel_limit");
    let (id, body) = envelope(b"<svg/>", "image/svg+xml", 1, 1);
    assert_eq!(
        decode(body, &id).unwrap_err(),
        "wall_image_format_unsupported"
    );
    let (id, body) = envelope(&[0; 4], "application/x-neuro-rgba8", 2, 1);
    assert_eq!(decode(body, &id).unwrap_err(), "wall_image_invalid");
}

#[test]
fn encoded_dimensions_are_checked_before_decode_and_png_writer_is_bounded() {
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(&[0; 4], 1, 1, image::ExtendedColorType::Rgba8)
        .unwrap();
    let (id, body) = envelope(&png, "image/jpeg", 1, 1);
    assert_eq!(
        decode(body, &id).unwrap_err(),
        "wall_image_format_unsupported"
    );
    let (id, body) = envelope(&png, "image/png", 2, 1);
    assert_eq!(decode(body, &id).unwrap_err(), "wall_image_invalid");
    let mut writer = BoundedPng(vec![0; MAX_BYTES]);
    assert!(writer.write_all(&[1]).is_err());
    assert_eq!(writer.0.len(), MAX_BYTES);
}
