    #[test]
    fn rejects_pair_without_overlap() {
        let previous = solid_rows(2, &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0]]);
        let current = solid_rows(2, &[[80, 0, 0], [90, 0, 0], [100, 0, 0], [110, 0, 0]]);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(3),
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::NoOverlap);
        assert!(analysis.confidence < 0.65);
    }

    #[test]
    fn caps_cross_axis_samples_for_large_capture_regions() {
        assert!(sampled_cross_axis_offsets(3840, 0).len() <= 192);
        assert!(sampled_cross_axis_offsets(2160, 8).len() <= 192);
        assert_eq!(sampled_cross_axis_offsets(4, 0), vec![0, 1, 2, 3]);
    }
    #[test]
    fn treats_tiny_capture_noise_as_duplicate_without_full_overlap_search() {
        let previous = solid_rows(240, &[[248, 248, 248]; 120]);
        let mut current = previous.clone();
        current.put_pixel(11, 9, Rgb([246, 246, 246]));
        current.put_pixel(113, 58, Rgb([249, 249, 249]));
        current.put_pixel(201, 111, Rgb([247, 247, 247]));

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: None,
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Duplicate);
        assert_eq!(analysis.append_px, 0);
    }

    #[test]
    fn rejects_small_boundary_only_match_without_real_overlap() {
        let mut previous_rows = Vec::new();
        for y in 0..100u8 {
            previous_rows.push([
                ((y as u32 * 11) % 251) as u8,
                ((y as u32 * 17 + 40) % 251) as u8,
                ((y as u32 * 23 + 80) % 251) as u8,
            ]);
        }
        for _ in 0..20 {
            previous_rows.push([255, 255, 255]);
        }

        let mut current_rows = Vec::new();
        for _ in 0..20 {
            current_rows.push([255, 255, 255]);
        }
        for y in 0..100u8 {
            current_rows.push([
                ((y as u32 * 29 + 13) % 251) as u8,
                ((y as u32 * 31 + 90) % 251) as u8,
                ((y as u32 * 37 + 120) % 251) as u8,
            ]);
        }

        let previous = solid_rows(4, &previous_rows);
        let current = solid_rows(4, &current_rows);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(60),
                min_overlap_px: None,
                min_new_content_px: Some(8),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::NoOverlap);
    }

    #[test]
    fn detects_tiny_scroll_overlap_from_high_frequency_sampling() {
        fn generated_rows(start: u32, count: u32) -> Vec<[u8; 3]> {
            (start..start + count)
                .map(|value| {
                    [
                        ((value * 3) % 251) as u8,
                        ((value * 5 + 17) % 251) as u8,
                        ((value * 7 + 29) % 251) as u8,
                    ]
                })
                .collect()
        }

        let previous_rows = generated_rows(0, 100);
        let current_rows = generated_rows(10, 100);
        let previous = solid_rows(3, &previous_rows);
        let current = solid_rows(3, &current_rows);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: None,
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.overlap_px, 90);
        assert_eq!(analysis.append_px, 10);
    }

    #[test]
    fn detects_sub_minimum_scroll_when_default_scan_is_used() {
        fn generated_rows(start: u32, count: u32) -> Vec<[u8; 3]> {
            (start..start + count)
                .map(|value| {
                    [
                        ((value * 11 + 3) % 251) as u8,
                        ((value * 13 + 19) % 251) as u8,
                        ((value * 17 + 37) % 251) as u8,
                    ]
                })
                .collect()
        }

        let previous = solid_rows(3, &generated_rows(0, 100));
        let current = solid_rows(3, &generated_rows(2, 100));

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: None,
                min_overlap_px: Some(1),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.overlap_px, 98);
        assert_eq!(analysis.append_px, 2);
    }

    #[test]
    fn prefers_document_overlap_over_static_sidebar_and_blank_background() {
        fn article_frame(scroll_y: u32) -> RgbImage {
            let width = 120;
            let height = 140;
            let mut image = RgbImage::from_pixel(width, height, Rgb([250, 250, 250]));

            for viewport_y in 0..height {
                let doc_y = scroll_y + viewport_y;

                if doc_y % 19 <= 2 {
                    let text_end = 18 + ((doc_y / 19) % 42);
                    for x in 8..text_end.min(70) {
                        image.put_pixel(x, viewport_y, Rgb([24, 24, 24]));
                    }
                }
                if doc_y % 47 == 11 {
                    for y in viewport_y..(viewport_y + 4).min(height) {
                        for x in 8..62 {
                            image.put_pixel(x, y, Rgb([70, 70, 70]));
                        }
                    }
                }

                for x in 80..width {
                    image.put_pixel(x, viewport_y, Rgb([238, 238, 238]));
                }
            }

            image
        }

        let previous = article_frame(0);
        let current = article_frame(30);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(132),
                min_overlap_px: Some(16),
                min_new_content_px: Some(1),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Down));
        assert_eq!(analysis.overlap_px, 110);
        assert_eq!(analysis.append_px, 30);
    }

    #[test]
    fn does_not_follow_static_sidebar_when_article_column_scrolls() {
        fn sticky_sidebar_article_frame(scroll_y: u32) -> RgbImage {
            let width = 400;
            let height = 160;
            let mut image = RgbImage::from_pixel(width, height, Rgb([250, 250, 250]));

            for viewport_y in 0..height {
                let doc_y = scroll_y + viewport_y;

                for x in 0..46 {
                    image.put_pixel(x, viewport_y, Rgb([254, 254, 254]));
                }

                if doc_y % 17 == 0 {
                    let text_end = 8 + ((doc_y * 13) % 34);
                    for x in 8..text_end {
                        image.put_pixel(x, viewport_y, Rgb([20, 20, 20]));
                    }
                }

                for x in 46..280 {
                    image.put_pixel(x, viewport_y, Rgb([250, 250, 250]));
                }

                for x in 280..width {
                    let tint = if (viewport_y / 16) % 2 == 0 { 236 } else { 230 };
                    image.put_pixel(x, viewport_y, Rgb([tint, tint, tint]));
                }
            }

            image
        }

        let previous = sticky_sidebar_article_frame(0);
        let current = sticky_sidebar_article_frame(36);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(159),
                min_overlap_px: Some(16),
                min_new_content_px: Some(8),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.overlap_px, 124);
        assert_eq!(analysis.append_px, 36);
    }
