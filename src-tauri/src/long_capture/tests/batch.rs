
    #[test]
    fn detects_vertical_overlap_between_frames() {
        let previous = solid_rows(2, &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]]);
        let current = solid_rows(2, &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0]]);
        let overlap = find_vertical_overlap(&previous, &current, 4);
        assert_eq!(overlap, 2);
    }

    #[test]
    fn stitches_vertical_frames_without_duplicate_overlap_rows() {
        let first = solid_rows(2, &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]]);
        let second = solid_rows(2, &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0]]);
        let stitched = stitch_vertical_frames(&[first, second], 4).expect("stitch should succeed");
        assert_eq!(stitched.height(), 6);
        assert_eq!(stitched.get_pixel(0, 0).0, [10, 0, 0]);
        assert_eq!(stitched.get_pixel(0, 5).0, [60, 0, 0]);
    }

    #[test]
    fn stitches_long_capture_after_skipping_bad_recorded_frame() {
        let first = solid_rows(2, &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]]);
        let bad = solid_rows(2, &[[180, 0, 0], [190, 0, 0], [200, 0, 0], [210, 0, 0]]);
        let second = solid_rows(2, &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0]]);

        let stitched = stitch_long_capture_frames(
            &[first, bad, second],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(3),
                min_overlap_px: Some(1),
            },
        )
        .expect("bad middle frame should be skipped");

        assert_eq!(stitched.height(), 6);
        assert_eq!(stitched.get_pixel(0, 0).0, [10, 0, 0]);
        assert_eq!(stitched.get_pixel(0, 5).0, [60, 0, 0]);
    }

    #[test]
    fn stitches_long_capture_frames_from_recorded_pair_analyses() {
        let first = solid_rows(
            2,
            &[
                [10, 0, 0],
                [20, 0, 0],
                [30, 0, 0],
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
            ],
        );
        let second = solid_rows(
            2,
            &[
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
                [70, 0, 0],
                [80, 0, 0],
                [90, 0, 0],
            ],
        );
        let third = solid_rows(
            2,
            &[
                [70, 0, 0],
                [80, 0, 0],
                [90, 0, 0],
                [100, 0, 0],
                [110, 0, 0],
                [120, 0, 0],
            ],
        );

        let analysis_one = analyze_long_capture_pair_images(
            &first,
            &second,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(5),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );
        let analysis_two = analyze_long_capture_pair_images(
            &second,
            &third,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(5),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        let stitched = stitch_long_capture_frames_with_analyses(
            &[first, second, third],
            &[analysis_one, analysis_two],
        )
        .expect("recorded analyses should stitch without rescanning");

        assert_eq!(stitched.height(), 12);
        assert_eq!(stitched.get_pixel(0, 0).0, [10, 0, 0]);
        assert_eq!(stitched.get_pixel(0, 11).0, [120, 0, 0]);
    }

    #[test]
    fn stitches_vertical_frames_from_mixed_up_down_pair_analyses_without_duplicates() {
        let first_rows = generated_rows(50, 100);
        let second_rows = generated_rows(20, 100);
        let third_rows = generated_rows(80, 100);
        let fourth_rows = generated_rows(40, 100);
        let first = solid_rows(3, &first_rows);
        let second = solid_rows(3, &second_rows);
        let third = solid_rows(3, &third_rows);
        let fourth = solid_rows(3, &fourth_rows);

        let analysis_one = analyze_long_capture_pair_images(
            &first,
            &second,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );
        let analysis_two = analyze_long_capture_pair_images(
            &second,
            &third,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );
        let analysis_three = analyze_long_capture_pair_images(
            &third,
            &fourth,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis_one.direction, Some(LongCaptureDirection::Up));
        assert_eq!(analysis_two.direction, Some(LongCaptureDirection::Down));
        assert_eq!(analysis_three.direction, Some(LongCaptureDirection::Up));

        let stitched = stitch_long_capture_frames_with_analyses(
            &[first, second, third, fourth],
            &[analysis_one, analysis_two, analysis_three],
        )
        .expect("mixed vertical directions should stitch into the captured range");

        assert_eq!(stitched.height(), 160);
        assert_eq!(stitched.get_pixel(0, 0).0, generated_line_color(20));
        assert_eq!(stitched.get_pixel(0, 159).0, generated_line_color(179));
    }

    #[test]
    fn stitches_vertical_frames_when_direction_reverses_and_current_matches_earlier_frame() {
        let first_rows = generated_rows(70, 80);
        let above_rows = generated_rows(20, 80);
        let below_rows = generated_rows(120, 80);
        let first = solid_rows(3, &first_rows);
        let above = solid_rows(3, &above_rows);
        let below = solid_rows(3, &below_rows);

        let stitched = stitch_long_capture_frames(
            &[first, above, below],
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(79),
                min_overlap_px: Some(1),
            },
        )
        .expect("direction reversal should still stitch through an earlier overlapping frame");

        assert_eq!(stitched.height(), 180);
        assert_eq!(stitched.get_pixel(0, 0).0, generated_line_color(20));
        assert_eq!(stitched.get_pixel(0, 179).0, generated_line_color(199));
    }

    #[test]
    fn aggregate_signature_stitcher_handles_many_vertical_frames_by_matching_the_merged_image() {
        let positions = [
            100, 80, 60, 40, 20, 0, 40, 80, 120, 160, 200, 240, 220, 260, 300,
        ];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 80)))
            .collect::<Vec<_>>();

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &frames,
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(79),
                min_overlap_px: Some(12),
            },
        )
        .expect("aggregate signature stitching should merge many back-and-forth frames");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 380);
        assert_eq!(result.image.get_pixel(0, 0).0, unique_line_color(0));
        assert_eq!(result.image.get_pixel(0, 379).0, unique_line_color(379));
        assert!(result.merged_frames >= 10);
    }

    #[test]
    fn aggregate_signature_stitcher_handles_many_horizontal_frames_by_matching_the_merged_image() {
        let positions = [
            100, 80, 60, 40, 20, 0, 40, 80, 120, 160, 200, 240, 220, 260, 300,
        ];
        let frames = positions
            .iter()
            .map(|start| image_from_columns(4, &unique_columns(*start, 80)))
            .collect::<Vec<_>>();

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &frames,
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(79),
                min_overlap_px: Some(12),
            },
        )
        .expect("aggregate signature stitching should merge many horizontal frames");

        assert_eq!(result.axis, Some(LongCaptureAxis::Horizontal));
        assert_eq!(result.image.width(), 380);
        assert_eq!(result.image.get_pixel(0, 0).0, unique_line_color(0));
        assert_eq!(result.image.get_pixel(379, 0).0, unique_line_color(379));
        assert!(result.merged_frames >= 10);
    }

    #[test]
    fn aggregate_signature_stitcher_prunes_the_other_axis_after_locking() {
        let frames = [100, 80, 60, 40]
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 80)))
            .collect::<Vec<_>>();

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &frames,
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(79),
                min_overlap_px: Some(12),
            },
        )
        .expect("aggregate signature stitching should lock vertical axis");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
    }

    #[test]
    fn aggregate_signature_stitcher_prefers_dense_true_overlap_over_far_repeated_block() {
        let mut rows = unique_rows(0, 140);
        for offset in 0..=40 {
            rows[(80 + offset) as usize] = rows[offset as usize];
        }

        let first = solid_rows(4, &rows[0..100]);
        let second = solid_rows(4, &rows[20..120]);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, second],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(12),
            },
        )
        .expect("repeated content should not cause a far false prepend");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 120);
        assert_eq!(result.image.get_pixel(0, 0).0, rows[0]);
        assert_eq!(result.image.get_pixel(0, 119).0, rows[119]);
    }

    #[test]
    fn aggregate_signature_stitcher_only_appends_from_boundary_overlap_for_repeated_feed() {
        let mut rows = unique_rows(0, 220);
        for offset in 0..80usize {
            rows[80 + offset] = rows[20 + offset];
        }

        let first = solid_rows(4, &rows[0..120]);
        let second = solid_rows(4, &rows[80..200]);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, second],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(119),
                min_overlap_px: Some(12),
            },
        )
        .expect("repeated internal content must not beat the true boundary overlap");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 200);
        assert_eq!(result.image.get_pixel(0, 0).0, rows[0]);
        assert_eq!(result.image.get_pixel(0, 119).0, rows[119]);
        assert_eq!(result.image.get_pixel(0, 120).0, rows[120]);
        assert_eq!(result.image.get_pixel(0, 199).0, rows[199]);
    }
