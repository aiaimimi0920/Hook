// Covers local image resolution and inline/shared-memory Art input preparation.
    use super::*;
    use image::Rgba;
    use std::path::PathBuf;

    fn write_test_png(path: &std::path::Path, width: u32, height: u32, rgba: [u8; 4]) {
        let mut img = RgbaImage::new(width, height);
        for pixel in img.pixels_mut() {
            *pixel = Rgba(rgba);
        }
        img.save(path).expect("save test png");
    }

    fn asset_localhost_url_for(path: &std::path::Path) -> String {
        let raw = path.to_string_lossy().to_string();
        let encoded = raw
            .replace('%', "%25")
            .replace(':', "%3A")
            .replace('\\', "%5C")
            .replace(' ', "%20");
        format!("http://asset.localhost/{encoded}")
    }

    #[test]
    fn loads_asset_localhost_input_image_into_rgba_buffer() {
        let temp_path =
            std::env::temp_dir().join(format!("loom-hook-input-{}.png", Uuid::new_v4()));
        write_test_png(&temp_path, 3, 2, [12, 34, 56, 255]);

        let asset_url = asset_localhost_url_for(&temp_path);
        let img = load_input_rgba_image(Some(&asset_url)).expect("load asset input");

        assert_eq!((img.width(), img.height()), (3, 2));
        assert_eq!(img.get_pixel(0, 0).0, [12, 34, 56, 255]);

        let _ = std::fs::remove_file(temp_path);
    }

    #[test]
    fn materializes_asset_localhost_shader_input_back_to_local_path() {
        let temp_path = std::env::temp_dir().join(format!(
            "loom-hook-materialize-asset-{}.png",
            Uuid::new_v4()
        ));
        write_test_png(&temp_path, 4, 3, [44, 55, 66, 255]);

        let asset_url = asset_localhost_url_for(&temp_path);
        let materialized = materialize_shader_image_input(Some(&asset_url), "reference")
            .expect("materialize asset-localhost shader input");

        assert_eq!(PathBuf::from(materialized), temp_path);

        let _ = std::fs::remove_file(temp_path);
    }

    #[test]
    fn materializes_file_url_shader_input_back_to_local_path() {
        let temp_path = std::env::temp_dir().join(format!(
            "loom-hook-materialize-file-url-{}.png",
            Uuid::new_v4()
        ));
        write_test_png(&temp_path, 5, 1, [77, 88, 99, 255]);

        let file_url = reqwest::Url::from_file_path(&temp_path)
            .expect("file url")
            .to_string();
        let materialized = materialize_shader_image_input(Some(&file_url), "input")
            .expect("materialize file-url shader input");

        assert_eq!(PathBuf::from(materialized), temp_path);

        let _ = std::fs::remove_file(temp_path);
    }

    #[test]
    fn loads_plain_file_path_input_image_into_rgba_buffer() {
        let temp_path =
            std::env::temp_dir().join(format!("loom-hook-path-input-{}.png", Uuid::new_v4()));
        write_test_png(&temp_path, 2, 4, [90, 80, 70, 255]);

        let img = load_input_rgba_image(Some(&temp_path.to_string_lossy().to_string()))
            .expect("load file path input");

        assert_eq!((img.width(), img.height()), (2, 4));
        assert_eq!(img.get_pixel(1, 3).0, [90, 80, 70, 255]);

        let _ = std::fs::remove_file(temp_path);
    }

    #[test]
    fn large_local_art_input_prefers_shared_memory_when_negotiated() {
        let mut image = RgbaImage::new(256, 256);
        image.put_pixel(0, 0, Rgba([12, 34, 56, 78]));

        let prepared = prepare_hook_input(&image, true).expect("prepare shared input");

        assert_eq!(prepared.descriptor["kind"], "shared_memory");
        assert_eq!(
            prepared.descriptor["size"].as_u64(),
            Some((256 * 256 * 4) as u64)
        );
        let guard = prepared.shmem_guard.as_ref().expect("shared memory guard");
        let first_pixel = unsafe { std::slice::from_raw_parts(guard.0.as_ptr(), 4) };
        assert_eq!(first_pixel, [12, 34, 56, 78]);
    }

    #[test]
    fn art_input_keeps_inline_resource_fallback_for_small_or_non_shared_sessions() {
        let small = RgbaImage::from_pixel(1, 1, Rgba([1, 2, 3, 255]));
        let small_prepared = prepare_hook_input(&small, true).expect("prepare small input");
        assert_eq!(small_prepared.descriptor["kind"], "inline_resource");
        assert!(small_prepared.shmem_guard.is_none());

        let large = RgbaImage::from_pixel(256, 256, Rgba([4, 5, 6, 255]));
        let fallback = prepare_hook_input(&large, false).expect("prepare fallback input");
        assert_eq!(fallback.descriptor["kind"], "inline_resource");
        assert!(!fallback.descriptor["dataBase64"]
            .as_str()
            .expect("base64 payload")
            .starts_with("data:"));
        assert!(fallback.shmem_guard.is_none());
    }

