    #[test]
    fn gmail_like_inbox_prefers_true_scroll_delta_under_fixed_chrome() {
        fn draw_email_row(
            image: &mut RgbImage,
            y: u32,
            row_height: u32,
            list_x: u32,
            list_w: u32,
            email_index: u32,
        ) {
            let row_bottom = (y + row_height).min(image.height());
            for row_y in y..row_bottom {
                for x in list_x..(list_x + list_w).min(image.width()) {
                    image.put_pixel(x, row_y, Rgb([255, 255, 255]));
                }
            }

            for x in list_x..(list_x + list_w).min(image.width()) {
                image.put_pixel(x, y, Rgb([232, 234, 237]));
            }

            let checkbox_x = list_x + 10;
            for px in checkbox_x..checkbox_x + 12 {
                for py in y + 6..(y + 14).min(row_bottom) {
                    image.put_pixel(px, py, Rgb([189, 193, 198]));
                }
            }

            let sender_width = 28 + ((email_index * 7) % 5);
            for px in list_x + 42..(list_x + 42 + sender_width).min(image.width()) {
                for py in y + 7..(y + 10).min(row_bottom) {
                    image.put_pixel(px, py, Rgb([32, 33, 36]));
                }
            }

            let subject_width = 86 + ((email_index * 11) % 9);
            for px in list_x + 112..(list_x + 112 + subject_width).min(image.width()) {
                for py in y + 8..(y + 11).min(row_bottom) {
                    image.put_pixel(px, py, Rgb([60, 64, 67]));
                }
            }

            let unique_anchor_x = list_x + 218 + ((email_index * 13) % 17);
            for px in unique_anchor_x..(unique_anchor_x + 2).min(image.width()) {
                for py in y + 5..(y + 13).min(row_bottom) {
                    image.put_pixel(px, py, Rgb([26, 115, 232]));
                }
            }

            let date_width = 10 + ((email_index * 5) % 4);
            for px in list_x + list_w.saturating_sub(26)
                ..(list_x + list_w.saturating_sub(26) + date_width).min(image.width())
            {
                for py in y + 7..(y + 10).min(row_bottom) {
                    image.put_pixel(px, py, Rgb([95, 99, 104]));
                }
            }
        }

        fn gmail_like_frame(scroll_y: u32) -> RgbImage {
            let width = 720;
            let height = 220;
            let top_bar_h = 34;
            let tabs_h = 26;
            let header_h = top_bar_h + tabs_h;
            let left_sidebar_w = 118;
            let list_x = left_sidebar_w + 26;
            let list_w = width - list_x - 24;
            let row_height = 18;
            let mut image = RgbImage::from_pixel(width, height, Rgb([248, 249, 250]));

            for y in 0..top_bar_h {
                for x in 0..width {
                    image.put_pixel(x, y, Rgb([241, 243, 244]));
                }
            }
            for y in top_bar_h..header_h {
                for x in list_x..(list_x + list_w).min(width) {
                    image.put_pixel(x, y, Rgb([255, 255, 255]));
                }
            }
            for x in list_x..(list_x + 136).min(width) {
                image.put_pixel(x, header_h - 1, Rgb([26, 115, 232]));
            }

            for y in 0..height {
                for x in 0..left_sidebar_w {
                    image.put_pixel(x, y, Rgb([248, 249, 250]));
                }
            }
            for item in 0..7u32 {
                let item_y = 72 + item * 22;
                if item_y + 16 >= height {
                    break;
                }
                for x in 16..(left_sidebar_w - 10) {
                    for y in item_y..item_y + 14 {
                        let shade = if item == 1 { 218 } else { 248 };
                        image.put_pixel(x, y, Rgb([shade, shade, shade]));
                    }
                }
            }

            let doc_row_count = 80u32;
            for viewport_y in header_h..height {
                let content_y = viewport_y - header_h;
                let doc_y = scroll_y + content_y;
                let email_index = (doc_y / row_height).min(doc_row_count - 1);
                let row_offset = doc_y % row_height;
                let row_top = viewport_y.saturating_sub(row_offset);
                draw_email_row(&mut image, row_top, row_height, list_x, list_w, email_index);
            }

            image
        }

        let previous = gmail_like_frame(0);
        let current = gmail_like_frame(36);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: Some(LongCaptureDirection::Down),
                max_scan: Some(180),
                min_overlap_px: Some(12),
                min_new_content_px: Some(8),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Down));
        assert_eq!(analysis.append_px, 36);
    }

    #[test]
    fn wide_board_prefers_horizontal_right_after_vertical_rows_fail() {
        fn draw_board_column(image: &mut RgbImage, x: u32, content_top: u32, doc_x: u32) {
            for y in content_top..image.height() {
                image.put_pixel(x, y, Rgb([255, 255, 255]));
            }

            if doc_x % 23 <= 2 {
                let top = content_top + 18 + ((doc_x * 7) % 36);
                for px in x..(x + 3).min(image.width()) {
                    for py in top..(top + 72).min(image.height()) {
                        image.put_pixel(px, py, Rgb([32, 33, 36]));
                    }
                }
            }

            if doc_x % 37 == 11 {
                let top = content_top + 8 + ((doc_x * 5) % 42);
                for px in x..(x + 5).min(image.width()) {
                    for py in top..(top + 24).min(image.height()) {
                        image.put_pixel(px, py, Rgb([26, 115, 232]));
                    }
                }
            }

            if doc_x % 19 == 3 {
                let top = content_top + 86 + ((doc_x * 3) % 28);
                for px in x..(x + 2).min(image.width()) {
                    for py in top..(top + 18).min(image.height()) {
                        image.put_pixel(px, py, Rgb([95, 99, 104]));
                    }
                }
            }
        }

        fn wide_board_frame(scroll_x: u32) -> RgbImage {
            let width = 260;
            let height = 180;
            let fixed_left_w = 40;
            let header_h = 28;
            let mut image = RgbImage::from_pixel(width, height, Rgb([248, 249, 250]));

            for y in 0..header_h {
                for x in 0..width {
                    image.put_pixel(x, y, Rgb([241, 243, 244]));
                }
            }

            for x in 0..fixed_left_w {
                for y in 0..height {
                    let shade = if (y / 18) % 2 == 0 { 247 } else { 235 };
                    image.put_pixel(x, y, Rgb([shade, shade, shade]));
                }
            }

            for viewport_x in fixed_left_w..width {
                let doc_x = scroll_x + viewport_x - fixed_left_w;
                draw_board_column(&mut image, viewport_x, header_h, doc_x);
            }

            image
        }

        let previous = wide_board_frame(0);
        let current = wide_board_frame(36);

        let analysis = analyze_long_capture_pair_images(
            &previous,
            &current,
            LongCaptureAnalyzeOptions {
                axis: None,
                direction: None,
                max_scan: Some(220),
                min_overlap_px: Some(12),
                min_new_content_px: Some(8),
            },
        );

        assert_eq!(analysis.status, LongCaptureOverlapStatus::Good);
        assert_eq!(analysis.axis, Some(LongCaptureAxis::Horizontal));
        assert_eq!(analysis.direction, Some(LongCaptureDirection::Right));
        assert_eq!(analysis.append_px, 36);
    }

    #[test]
    fn stitches_horizontal_frames_without_duplicate_overlap_columns() {
        let first = image_from_columns(
            2,
            &[[10, 0, 0], [20, 0, 0], [30, 0, 0], [40, 0, 0], [50, 0, 0]],
        );
        let second = image_from_columns(
            2,
            &[[30, 0, 0], [40, 0, 0], [50, 0, 0], [60, 0, 0], [70, 0, 0]],
        );

        let stitched = stitch_long_capture_frames(
            &[first, second],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Horizontal),
                direction: Some(LongCaptureDirection::Right),
                max_scan: Some(4),
                min_overlap_px: Some(1),
            },
        )
        .expect("horizontal stitch should succeed");

        assert_eq!(stitched.width(), 7);
        assert_eq!(stitched.height(), 2);
        assert_eq!(stitched.get_pixel(0, 0).0, [10, 0, 0]);
        assert_eq!(stitched.get_pixel(6, 0).0, [70, 0, 0]);
    }

    fn image_from_columns(height: u32, columns: &[[u8; 3]]) -> RgbImage {
        let mut img = RgbImage::new(columns.len() as u32, height);
        for (x, color) in columns.iter().enumerate() {
            for y in 0..height {
                img.put_pixel(x as u32, y, Rgb(*color));
            }
        }
        img
    }
