    use super::*;
    use image::Rgb;

    fn solid_rows(width: u32, rows: &[[u8; 3]]) -> RgbImage {
        let mut img = RgbImage::new(width, rows.len() as u32);
        for (y, color) in rows.iter().enumerate() {
            for x in 0..width {
                img.put_pixel(x, y as u32, Rgb(*color));
            }
        }
        img
    }

    fn generated_line_color(value: u32) -> [u8; 3] {
        [
            ((value * 3 + 7) % 251) as u8,
            ((value * 5 + 17) % 251) as u8,
            ((value * 7 + 29) % 251) as u8,
        ]
    }

    fn generated_rows(start: u32, count: u32) -> Vec<[u8; 3]> {
        (start..start + count).map(generated_line_color).collect()
    }

    fn generated_columns(start: u32, count: u32) -> Vec<[u8; 3]> {
        (start..start + count).map(generated_line_color).collect()
    }

    fn unique_line_color(value: u32) -> [u8; 3] {
        [
            (value & 0xff) as u8,
            ((value >> 8) & 0xff) as u8,
            ((value * 37 + 19) % 251) as u8,
        ]
    }

    fn unique_rows(start: u32, count: u32) -> Vec<[u8; 3]> {
        (start..start + count).map(unique_line_color).collect()
    }

    fn unique_columns(start: u32, count: u32) -> Vec<[u8; 3]> {
        (start..start + count).map(unique_line_color).collect()
    }

    fn png_data_url(image: RgbImage) -> String {
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("png encode should succeed");
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    }
