    #[test]
    fn aggregate_signature_stitcher_merges_sparse_inbox_rows_scrolled_both_ways() {
        fn draw_inbox_text_bar(image: &mut RgbImage, x: u32, y: u32, width: u32, color: [u8; 3]) {
            for yy in y..(y + 3).min(image.height()) {
                for xx in x..(x + width).min(image.width()) {
                    image.put_pixel(xx, yy, Rgb(color));
                }
            }
        }

        fn inbox_frame(scroll_y: u32) -> RgbImage {
            let width = 640;
            let height = 144;
            let row_h = 48;
            let mut image = RgbImage::from_pixel(width, height, Rgb([255, 255, 255]));

            for y in 0..height {
                let doc_y = scroll_y + y;
                let row = doc_y / row_h;
                let in_row = doc_y % row_h;
                if in_row == row_h - 1 {
                    for x in 0..width {
                        image.put_pixel(x, y, Rgb([232, 232, 232]));
                    }
                    continue;
                }

                if (10..30).contains(&in_row) {
                    for x in 12..30 {
                        image.put_pixel(x, y, Rgb([235, 235, 235]));
                    }
                }

                let color = [
                    (20 + (row * 17 % 140)) as u8,
                    (20 + (row * 29 % 140)) as u8,
                    (20 + (row * 37 % 140)) as u8,
                ];
                if in_row == 15 {
                    draw_inbox_text_bar(&mut image, 70, y, 48 + (row % 5) * 12, color);
                    draw_inbox_text_bar(&mut image, 214, y, 140 + (row % 7) * 18, color);
                    draw_inbox_text_bar(&mut image, 590, y, 28, color);
                }
                if in_row == 26 {
                    draw_inbox_text_bar(&mut image, 214, y, 90 + (row % 4) * 20, [90, 90, 90]);
                }
            }

            image
        }

        let positions = [144, 96, 48, 0, 192, 240, 288];
        let frames = positions
            .iter()
            .map(|start| inbox_frame(*start))
            .collect::<Vec<_>>();

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &frames,
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(143),
                min_overlap_px: Some(16),
            },
        )
        .expect("sparse inbox rows should stitch when sampled while scrolling both ways");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 432);
        assert_eq!(result.skipped_frames, 0);
    }

    #[test]
    fn aggregate_signature_stitcher_does_not_lock_horizontal_from_blank_columns() {
        fn vertical_page_frame(scroll_y: u32, render_jitter: u8) -> RgbImage {
            let width = 360;
            let height = 160;
            let mut image = RgbImage::from_pixel(width, height, Rgb([255, 255, 255]));

            for y in 0..height {
                let doc_y = scroll_y + y;
                let color = unique_line_color(doc_y);
                let jittered = [
                    color[0].saturating_add(render_jitter),
                    color[1].saturating_add(render_jitter),
                    color[2].saturating_add(render_jitter),
                ];
                for x in 80..280 {
                    if (x + doc_y) % 11 <= 4 {
                        image.put_pixel(x, y, Rgb(jittered));
                    }
                }
            }

            image
        }

        let first = vertical_page_frame(0, 0);
        let second = vertical_page_frame(36, 1);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, second],
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(159),
                min_overlap_px: Some(16),
            },
        )
        .expect("blank columns must not produce a false horizontal long capture");

        assert_ne!(result.axis, Some(LongCaptureAxis::Horizontal));
        assert_eq!(result.image.width(), 360);
    }
    #[test]
    fn stitches_horizontal_frames_from_mixed_left_right_pair_analyses_without_duplicates() {
        let first_columns = generated_columns(50, 100);
        let second_columns = generated_columns(20, 100);
        let third_columns = generated_columns(80, 100);
        let fourth_columns = generated_columns(40, 100);
        let first = image_from_columns(3, &first_columns);
        let second = image_from_columns(3, &second_columns);
        let third = image_from_columns(3, &third_columns);
        let fourth = image_from_columns(3, &fourth_columns);

        let analysis_one = analyze_long_capture_pair_images(
            &first,
            &second,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Horizontal),
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
                axis: Some(LongCaptureAxis::Horizontal),
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
                axis: Some(LongCaptureAxis::Horizontal),
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis_one.direction, Some(LongCaptureDirection::Left));
        assert_eq!(analysis_two.direction, Some(LongCaptureDirection::Right));
        assert_eq!(analysis_three.direction, Some(LongCaptureDirection::Left));

        let stitched = stitch_long_capture_frames_with_analyses(
            &[first, second, third, fourth],
            &[analysis_one, analysis_two, analysis_three],
        )
        .expect("mixed horizontal directions should stitch into the captured range");

        assert_eq!(stitched.width(), 160);
        assert_eq!(stitched.get_pixel(0, 0).0, generated_line_color(20));
        assert_eq!(stitched.get_pixel(159, 0).0, generated_line_color(179));
    }

    #[test]
    fn stitches_horizontal_frames_when_direction_reverses_and_current_matches_earlier_frame() {
        let first_columns = generated_columns(70, 80);
        let left_columns = generated_columns(20, 80);
        let right_columns = generated_columns(120, 80);
        let first = image_from_columns(3, &first_columns);
        let left = image_from_columns(3, &left_columns);
        let right = image_from_columns(3, &right_columns);

        let stitched = stitch_long_capture_frames(
            &[first, left, right],
            LongCaptureStitchOptions {
                axis: None,
                direction: None,
                max_scan: Some(79),
                min_overlap_px: Some(1),
            },
        )
        .expect("horizontal direction reversal should stitch through an earlier overlapping frame");

        assert_eq!(stitched.width(), 180);
        assert_eq!(stitched.get_pixel(0, 0).0, generated_line_color(20));
        assert_eq!(stitched.get_pixel(179, 0).0, generated_line_color(199));
    }

    #[test]
    fn stitches_vertical_frame_data_urls_for_manual_capture() {
        let first = png_data_url(solid_rows(
            2,
            &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]],
        ));
        let second = png_data_url(solid_rows(
            2,
            &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0]],
        ));
        let stitched =
            stitch_vertical_frame_data_urls(&[first, second], 4).expect("stitch should succeed");
        assert_eq!(stitched.height(), 6);
        assert_eq!(stitched.get_pixel(0, 0).0, [10, 0, 0]);
        assert_eq!(stitched.get_pixel(0, 5).0, [60, 0, 0]);
    }

    #[test]
    fn analyzes_vertical_down_overlap_from_boundary_rows() {
        let previous = solid_rows(
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
        let current = solid_rows(
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

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(5),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Down));
        assert_eq!(analysis.overlap_px, 3);
        assert_eq!(analysis.crop_start_px, 3);
        assert_eq!(analysis.append_px, 3);
        assert!(analysis.confidence >= 0.9);
    }

    #[test]
    fn analyzes_horizontal_right_overlap_from_boundary_columns() {
        let previous = image_from_columns(
            2,
            &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0], [50, 0, 0]],
        );
        let current = image_from_columns(
            2,
            &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0], [70, 0, 0]],
        );

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(4),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.axis, Some(LongCaptureAxis::Horizontal));
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Right));
        assert_eq!(analysis.overlap_px, 3);
        assert_eq!(analysis.crop_start_px, 3);
        assert_eq!(analysis.append_px, 2);
        assert!(analysis.confidence >= 0.9);
    }

    #[test]
    fn analyzes_vertical_up_overlap_when_first_scroll_is_up() {
        let previous_rows = generated_rows(30, 100);
        let current_rows = generated_rows(0, 100);
        let previous = solid_rows(3, &previous_rows);
        let current = solid_rows(3, &current_rows);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Up));
        assert_eq!(analysis.append_px, 30);
    }
    #[test]
    fn analyzes_horizontal_left_overlap_when_first_scroll_is_left() {
        let previous_columns = generated_columns(30, 100);
        let current_columns = generated_columns(0, 100);
        let previous = image_from_columns(3, &previous_columns);
        let current = image_from_columns(3, &current_columns);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(99),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.axis, Some(LongCaptureAxis::Horizontal));
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Left));
        assert_eq!(analysis.append_px, 30);
    }
