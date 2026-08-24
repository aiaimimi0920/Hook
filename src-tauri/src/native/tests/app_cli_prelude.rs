// Defines shared app CLI test imports, acceptance checks, and image/file fixtures.

    use super::*;
    use image::Rgb;

    #[test]
    fn native_acceptance_exit_requires_an_explicit_truthy_environment_value() {
        for enabled in ["1", "true", "TRUE", "yes", "on", " on "] {
            assert!(native_acceptance_enabled_value(Some(enabled)));
        }
        for disabled in ["", "0", "false", "no", "off", "unexpected"] {
            assert!(!native_acceptance_enabled_value(Some(disabled)));
        }
        assert!(!native_acceptance_enabled_value(None));
    }

    #[test]
    fn native_acceptance_exit_marker_is_bounded_and_log_safe() {
        assert!(native_acceptance_marker_is_valid("restart-0123456789ab"));
        assert!(native_acceptance_marker_is_valid("first_exit"));
        assert!(!native_acceptance_marker_is_valid(""));
        assert!(!native_acceptance_marker_is_valid("line\nbreak"));
        assert!(!native_acceptance_marker_is_valid("contains space"));
        assert!(!native_acceptance_marker_is_valid(&"a".repeat(129)));
    }

    fn solid_rows(width: u32, rows: &[[u8; 3]]) -> image::RgbImage {
        let mut image = image::RgbImage::new(width, rows.len() as u32);
        for (y, color) in rows.iter().enumerate() {
            for x in 0..width {
                image.put_pixel(x, y as u32, Rgb(*color));
            }
        }
        image
    }

    fn unique_line_color_for_test(value: u32) -> [u8; 3] {
        [
            (value & 0xff) as u8,
            ((value >> 8) & 0xff) as u8,
            ((value * 37 + 19) % 251) as u8,
        ]
    }

    fn unique_rows_for_test(start: u32, count: u32) -> Vec<[u8; 3]> {
        (start..start + count)
            .map(unique_line_color_for_test)
            .collect()
    }

    fn patterned_columns(height: u32, start: u32, count: u32) -> image::RgbImage {
        let mut image = image::RgbImage::new(count, height);
        for x in 0..count {
            let doc_x = start + x;
            for y in 0..height {
                image.put_pixel(
                    x,
                    y,
                    Rgb([
                        ((doc_x * 11 + y * 3) % 251) as u8,
                        ((doc_x * 13 + y * 5 + 17) % 251) as u8,
                        ((doc_x * 17 + y * 7 + 29) % 251) as u8,
                    ]),
                );
            }
        }
        image
    }

    fn tiny_png_data_url_for_test(color: [u8; 3]) -> String {
        let image = image::RgbImage::from_pixel(1, 1, Rgb(color));
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("encode tiny png");
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    }

    fn set_file_modified_time_for_test(path: &Path, time: SystemTime) -> std::io::Result<()> {
        let file_time = filetime::FileTime::from_system_time(time);
        filetime::set_file_mtime(path, file_time)
    }

    fn clipboard_cache_env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .expect("clipboard cache env lock should not be poisoned")
    }

