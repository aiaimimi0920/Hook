    #[test]
    fn rejects_frame_dimensions_and_pixel_counts_above_resource_limits() {
        let dimension_error = validate_long_capture_frame_dimensions(
            MAX_LONG_CAPTURE_FRAME_DIMENSION + 1,
            1,
        )
        .expect_err("oversized dimensions must be rejected");
        assert!(dimension_error.to_string().contains("dimensions exceed"));

        let pixel_error = validate_long_capture_frame_dimensions(8_193, 8_193)
            .expect_err("oversized pixel count must be rejected");
        assert!(pixel_error.to_string().contains("pixel limit"));
    }

    #[test]
    fn rejects_encoded_payload_length_before_base64_allocation() {
        let error = validate_encoded_frame_len(MAX_LONG_CAPTURE_BASE64_CHARS + 1)
            .expect_err("oversized base64 payload must be rejected");
        assert!(error.to_string().contains("encoded frame exceeds"));
    }

    #[test]
    fn limited_decoder_preserves_valid_png_data_urls() {
        let source = solid_rows(2, &[[10, 20, 30], [40, 50, 60]]);
        let decoded = decode_frame_data_url(&png_data_url(source.clone()))
            .expect("valid bounded PNG should decode");
        assert_eq!(decoded, source);
    }

    #[test]
    fn limited_decoder_rejects_oversized_image_dimensions() {
        let source = RgbImage::new(MAX_LONG_CAPTURE_FRAME_DIMENSION + 1, 1);
        let error = decode_frame_data_url(&png_data_url(source))
            .expect_err("decoder dimension limits must reject the image");
        assert!(error.to_string().contains("image") || error.to_string().contains("limit"));
    }

    #[test]
    fn stitch_entry_points_reject_excessive_frame_counts() {
        let frame = RgbImage::from_pixel(1, 1, Rgb([1, 2, 3]));
        let frames = vec![frame; MAX_LONG_CAPTURE_FRAME_COUNT + 1];
        let error = stitch_vertical_frames(&frames, 1)
            .expect_err("excessive frame counts must be rejected");
        assert!(error.to_string().contains("frame count exceeds"));
    }

    #[test]
    fn capture_request_rejects_invalid_bounds_without_taking_a_screenshot() {
        assert!(validate_capture_request(0, 0, 0, 10, 1, 10).is_err());
        assert!(validate_capture_request(0, 0, 10, 10, 0, 10).is_err());
        assert!(validate_capture_request(0, 0, 10, 10, 513, 10).is_err());
        assert!(validate_capture_request(i32::MAX, 0, 10, 10, 1, 10).is_err());
        assert!(validate_capture_request(0, 0, 10, 10, 2, MAX_LONG_CAPTURE_SETTLE_MS + 1)
            .is_err());
    }

    #[test]
    fn aggregate_segments_reject_output_axis_growth_before_allocation() {
        let mut aggregate = LongCaptureAggregate {
            axis: Some(LongCaptureAxis::Vertical),
            origin: 0,
            segments: VecDeque::new(),
            signatures: None,
        };
        for _ in 0..4 {
            push_aggregate_segment(
                &mut aggregate,
                RgbImage::new(1, MAX_LONG_CAPTURE_FRAME_DIMENSION),
                LongCaptureAxis::Vertical,
                false,
            )
            .expect("output at the axis limit should be accepted");
        }
        let error = push_aggregate_segment(
            &mut aggregate,
            RgbImage::new(1, 1),
            LongCaptureAxis::Vertical,
            false,
        )
        .expect_err("output beyond the axis limit must be rejected");
        assert!(error.to_string().contains("output axis exceeds"));
    }

    #[test]
    fn incremental_stitcher_rejects_frames_after_the_shared_cap() {
        let frame = RgbImage::from_pixel(1, 1, Rgb([1, 2, 3]));
        let mut stitcher = LongCaptureIncrementalStitcher::new(
            frame.clone(),
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                ..LongCaptureStitchOptions::default()
            },
        );
        stitcher.frame_count = MAX_LONG_CAPTURE_FRAME_COUNT;
        let error = stitcher
            .push_frame_owned(frame)
            .expect_err("incremental stitching must enforce the frame cap");
        assert!(error.to_string().contains("frame count exceeds"));
    }

    #[test]
    fn crop_conversion_rejects_coordinates_above_u32() {
        let frame = RgbImage::new(1, 1);
        let error = crop_axis_segment(
            &frame,
            LongCaptureAxis::Vertical,
            i64::from(u32::MAX) + 1,
            1,
        )
        .expect_err("oversized crop coordinates must be rejected");
        assert!(error.to_string().contains("crop start is too large"));
    }

    #[test]
    fn fixed_chrome_candidate_ranges_preserve_sorted_boundaries() {
        let starts = [1, 3, 5, 7, 9];
        assert_eq!(sorted_starts_inclusive(&starts, 3, 7), &[3, 5, 7]);
        assert!(sorted_starts_inclusive(&starts, 8, 7).is_empty());
    }
