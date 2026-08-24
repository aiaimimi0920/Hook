// Verifies capture encoders, cache files, drag staging, throttling, and guide cleanup.

    #[test]
    fn fast_png_capture_response_roundtrips_rgb_image() {
        let image = solid_rows(4, &[[10, 20, 30], [40, 50, 60]]);
        let response =
            encode_rgb_image_as_capture_response(image.clone()).expect("fast png encode succeeds");
        let image_bytes =
            decode_base64_image_data(&response.base64).expect("fast png response decodes");
        let decoded = image::load_from_memory(&image_bytes)
            .expect("fast png bytes load")
            .to_rgb8();

        assert_eq!(response.width, image.width());
        assert_eq!(response.height, image.height());
        assert_eq!(decoded, image);
    }

    #[test]
    fn hdr_png_encoder_writes_16_bit_bt2020_pq_metadata() {
        let image = screenshot::HdrPqImage {
            width: 1,
            height: 1,
            rgb16_be: vec![0x80, 0x00, 0x40, 0x00, 0x20, 0x00],
            max_content_light_level_nits: 1_000.0,
            max_frame_average_light_level_nits: 250.0,
            mastering_min_luminance_nits: 0.001,
            mastering_max_luminance_nits: 1_000.0,
        };
        let mut bytes = Vec::new();
        write_hdr_png(&mut bytes, &image).expect("HDR PNG encode succeeds");

        let decoder = png::Decoder::new(std::io::BufReader::new(std::io::Cursor::new(bytes)));
        let reader = decoder.read_info().expect("HDR PNG metadata decodes");
        let info = reader.info();
        assert_eq!(info.bit_depth, png::BitDepth::Sixteen);
        assert_eq!(info.color_type, png::ColorType::Rgb);
        let cicp = info
            .coding_independent_code_points
            .expect("HDR PNG must contain cICP");
        assert_eq!(cicp.color_primaries, 9);
        assert_eq!(cicp.transfer_function, 16);
        assert_eq!(cicp.matrix_coefficients, 0);
        assert!(cicp.is_video_full_range_image);
        assert_eq!(
            info.content_light_level
                .expect("HDR PNG must contain cLLI")
                .max_content_light_level,
            10_000_000,
        );
    }

    #[test]
    fn file_url_from_path_escapes_windows_path_for_webview_images() {
        let path = PathBuf::from(r"C:\Users\Public\Hook Cache\long#1%.png");

        assert_eq!(
            file_url_from_path(&path),
            "file:///C:/Users/Public/Hook%20Cache/long%231%25.png"
        );
    }

    #[test]
    fn remote_image_cache_extension_prefers_actual_image_bytes() {
        let image =
            image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(1, 1, Rgb([1, 2, 3])));
        let mut bytes = Vec::new();
        image
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("encode png bytes");

        assert_eq!(
            remote_image_cache_extension(
                "https://example.com/photo.jpg?format=jpeg",
                &bytes,
                Some("image/jpeg"),
            ),
            "png"
        );
    }

    #[test]
    fn find_cached_remote_image_path_matches_url_hash_prefix() {
        let root = std::env::temp_dir().join(format!(
            "hook-remote-image-cache-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create cache test dir");
        let url = "https://example.com/images/cat.png?size=small";
        let expected = root.join(format!("remote_{}.webp", remote_image_cache_key(url)));
        std::fs::write(&expected, [1u8, 2, 3]).expect("write cached remote file");

        let found =
            find_cached_remote_image_path(&root, url).expect("remote cache lookup succeeds");

        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(found, Some(expected));
    }

    #[test]
    fn file_capture_response_writes_png_cache_without_base64_payload() {
        let _env_guard = clipboard_cache_env_lock();
        let env_name = "HOOK_CLIPBOARD_CACHE_DIR";
        let cache_dir = std::env::temp_dir().join(format!(
            "hook-file-capture-response-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::env::set_var(env_name, &cache_dir);

        let image = solid_rows(4, &[[10, 20, 30], [40, 50, 60]]);
        let response = encode_rgb_image_as_file_capture_response(image.clone())
            .expect("file-backed png response succeeds");

        std::env::remove_var(env_name);

        assert!(response.base64.is_empty());
        assert_eq!(response.width, image.width());
        assert_eq!(response.height, image.height());
        let file_path = response.file_path.expect("file path is returned");
        let file_url = response.file_url.expect("file URL is returned");
        assert_eq!(file_url, file_url_from_path(Path::new(&file_path)));

        let decoded = image::open(&file_path)
            .expect("written png loads")
            .to_rgb8();
        let _ = std::fs::remove_dir_all(&cache_dir);
        assert_eq!(decoded, image);
    }

    #[test]
    fn internal_capture_file_allocation_is_atomic_for_identical_timestamps() {
        let root = std::env::temp_dir().join(format!(
            "hook-internal-capture-allocation-test-{}-{}",
            std::process::id(),
            file_timestamp_component(),
        ));
        std::fs::create_dir_all(&root).expect("create capture allocation test dir");

        let (mut first, first_path) =
            create_internal_capture_file(&root, "Hook_long_capture", "1234").unwrap();
        first.write_all(b"first").unwrap();
        drop(first);
        let (mut second, second_path) =
            create_internal_capture_file(&root, "Hook_long_capture", "1234").unwrap();
        second.write_all(b"second").unwrap();
        drop(second);

        assert_ne!(first_path, second_path);
        assert_eq!(std::fs::read(&first_path).unwrap(), b"first");
        assert_eq!(std::fs::read(&second_path).unwrap(), b"second");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn failed_internal_hdr_capture_removes_partial_file() {
        let _env_guard = clipboard_cache_env_lock();
        let env_name = "HOOK_CLIPBOARD_CACHE_DIR";
        let cache_dir = std::env::temp_dir().join(format!(
            "hook-failed-hdr-capture-test-{}-{}",
            std::process::id(),
            file_timestamp_component(),
        ));
        std::env::set_var(env_name, &cache_dir);
        let invalid_image = screenshot::HdrPqImage {
            width: 1,
            height: 1,
            rgb16_be: Vec::new(),
            max_content_light_level_nits: 1_000.0,
            max_frame_average_light_level_nits: 250.0,
            mastering_min_luminance_nits: 0.001,
            mastering_max_luminance_nits: 1_000.0,
        };

        let result = encode_hdr_image_as_file_capture_response(
            invalid_image,
            CaptureMetadata::hdr("test-invalid-hdr"),
        );

        std::env::remove_var(env_name);
        assert!(result.is_err());
        assert!(
            !cache_dir.exists()
                || std::fs::read_dir(&cache_dir).unwrap().all(|entry| !entry
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".png")),
            "failed HDR encoding must not leave a partial PNG"
        );
        let _ = std::fs::remove_dir_all(cache_dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn stage_drag_out_file_copy_creates_disposable_copy_without_moving_original() {
        let _env_guard = clipboard_cache_env_lock();
        let env_name = "HOOK_CLIPBOARD_CACHE_DIR";
        let root = std::env::temp_dir().join(format!(
            "hook-stage-drag-file-copy-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        let cache_dir = root.join("cache");
        let source_dir = root.join("source");
        std::fs::create_dir_all(&cache_dir).expect("create cache dir");
        std::fs::create_dir_all(&source_dir).expect("create source dir");
        std::env::set_var(env_name, &cache_dir);

        let source_path = source_dir.join("original sticker.png");
        let source_bytes = vec![1u8, 2, 3, 4, 5, 6];
        std::fs::write(&source_path, &source_bytes).expect("write source file");

        let staged_path =
            stage_drag_out_file_copy(&source_path, Some("导出贴图")).expect("stage drag file copy");

        std::env::remove_var(env_name);

        assert!(
            source_path.exists(),
            "original sticker file should remain in place"
        );
        assert!(staged_path.exists(), "staged drag file should exist");
        assert_ne!(
            staged_path, source_path,
            "staged path should differ from source path"
        );
        assert_eq!(
            std::fs::read(&staged_path).expect("read staged file"),
            source_bytes
        );
        assert_eq!(staged_path.file_name().unwrap(), "导出贴图.png");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn bounded_file_copy_rejects_an_oversized_source_before_copying() {
        let root = std::env::temp_dir().join(format!(
            "hook-bounded-file-copy-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let source_path = root.join("source.bin");
        let target_path = root.join("target.bin");
        std::fs::write(&source_path, [1u8, 2, 3, 4, 5]).unwrap();
        let mut target_file = File::create(&target_path).unwrap();

        let error = copy_file_with_limit(&source_path, &mut target_file, 4, "test copy")
            .expect_err("oversized copy must fail");

        assert!(error.contains("4-byte limit"));
        assert!(std::fs::read(&target_path).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn long_capture_sample_logging_is_throttled_to_first_periodic_and_slow_samples() {
        let response = LongCaptureSessionSampleResponse {
            status: LongCaptureSessionSampleStatus::Recorded,
            frame_count: 3,
            duplicate_count: 0,
            recorded: true,
            axis: Some(long_capture::LongCaptureAxis::Vertical),
            direction: None,
        };
        assert!(!should_log_long_capture_sample(&response, 5));

        let first_response = LongCaptureSessionSampleResponse {
            frame_count: 1,
            ..response.clone()
        };
        assert!(should_log_long_capture_sample(&first_response, 5));

        let periodic_response = LongCaptureSessionSampleResponse {
            frame_count: 20,
            ..response.clone()
        };
        assert!(should_log_long_capture_sample(&periodic_response, 5));

        assert!(should_log_long_capture_sample(&response, 45));
    }

    #[test]
    fn long_capture_worker_rest_policy_yields_when_idle_slow_or_after_a_burst() {
        assert!(should_rest_long_capture_stitch_worker(0, 1, 1));
        assert!(should_rest_long_capture_stitch_worker(5, 1, 45));
        assert!(should_rest_long_capture_stitch_worker(5, 8, 1));
        assert!(!should_rest_long_capture_stitch_worker(5, 3, 1));
    }

    #[test]
    fn long_capture_sample_removes_captured_guide_blue_edge_lines() {
        let mut frame = image::RgbImage::from_pixel(12, 8, Rgb([245, 245, 245]));
        for x in 0..frame.width() {
            frame.put_pixel(x, 0, Rgb([170, 196, 255]));
            frame.put_pixel(x, 1, Rgb([170, 196, 255]));
        }
        for y in 0..frame.height() {
            frame.put_pixel(0, y, Rgb([170, 196, 255]));
            frame.put_pixel(frame.width() - 1, y, Rgb([170, 196, 255]));
        }
        frame.put_pixel(6, 4, Rgb([20, 30, 40]));

        remove_long_capture_overlay_guide_edges(&mut frame);

        assert_ne!(frame.get_pixel(6, 0).0, [170, 196, 255]);
        assert_ne!(frame.get_pixel(0, 4).0, [170, 196, 255]);
        assert_eq!(frame.get_pixel(6, 4).0, [20, 30, 40]);
    }

    #[test]
    fn long_capture_recording_defers_vertical_axis_detection_to_finish_time() {
        let previous = solid_rows(
            8,
            &[
                [10, 0, 0],
                [20, 0, 0],
                [30, 0, 0],
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
            ],
        );
        let current = solid_rows(
            8,
            &[
                [30, 0, 0],
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
                [70, 0, 0],
                [80, 0, 0],
            ],
        );

        let classification =
            classify_long_capture_recording_frame(Some(&previous), &current, None, 5, 1, 1);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
        assert!(classification.analysis.is_none());
    }

    #[test]
    fn long_capture_recording_defers_horizontal_axis_detection_to_finish_time() {
        let previous = patterned_columns(8, 0, 8);
        let current = patterned_columns(8, 2, 8);

        let classification =
            classify_long_capture_recording_frame(Some(&previous), &current, None, 7, 1, 1);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
        assert!(classification.analysis.is_none());
    }
