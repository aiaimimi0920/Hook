    #[test]
    fn monotonic_down_scroll_with_repeated_blocks_does_not_prepend_extra_top_content() {
        const FRAME_HEIGHT: usize = 120;
        const DOC_HEIGHT: usize = 420;
        const STEPS: [usize; 6] = [0, 40, 80, 120, 160, 200];

        for duplicate_len in [40usize, 60, 80] {
            for source_start in (0..=140usize).step_by(20) {
                let source_end = source_start + duplicate_len;
                if source_end >= DOC_HEIGHT {
                    continue;
                }
                for duplicate_start in ((source_start + 40)..=240usize).step_by(20) {
                    let duplicate_end = duplicate_start + duplicate_len;
                    if duplicate_end >= DOC_HEIGHT {
                        continue;
                    }

                    let mut rows = unique_rows(0, DOC_HEIGHT as u32);
                    for offset in 0..duplicate_len {
                        rows[duplicate_start + offset] = rows[source_start + offset];
                    }

                    let frames = STEPS
                        .iter()
                        .map(|start| solid_rows(4, &rows[*start..(*start + FRAME_HEIGHT)]))
                        .collect::<Vec<_>>();
                    let stitched = stitch_long_capture_frames(
                        &frames,
                        LongCaptureStitchOptions {
                            axis: Some(LongCaptureAxis::Vertical),
                            direction: None,
                            max_scan: Some((FRAME_HEIGHT - 1) as u32),
                            min_overlap_px: Some(16),
                        },
                    )
                    .expect("monotonic down-scroll should stitch");

                    let expected_rows = &rows[STEPS[0]..(STEPS[STEPS.len() - 1] + FRAME_HEIGHT)];
                    let expected = solid_rows(4, expected_rows);
                    assert_eq!(
                        stitched.as_raw(),
                        expected.as_raw(),
                        "unexpected top prepend for source_start={source_start} duplicate_start={duplicate_start} duplicate_len={duplicate_len}: stitched_height={} expected_height={}",
                        stitched.height(),
                        expected.height(),
                    );
                }
            }
        }
    }

    #[test]
    fn aggregate_signature_stitcher_skips_frame_already_covered_by_aggregate() {
        let mut rows = unique_rows(0, 260);
        for offset in 0..80usize {
            rows[120 + offset] = rows[20 + offset];
        }

        let first = solid_rows(4, &rows[0..160]);
        let second = solid_rows(4, &rows[120..240]);
        let already_covered = solid_rows(4, &rows[80..200]);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, second, already_covered],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(119),
                min_overlap_px: Some(12),
            },
        )
        .expect("already covered repeated content should be ignored instead of duplicated");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 240);
        assert_eq!(result.image.get_pixel(0, 0).0, rows[0]);
        assert_eq!(result.image.get_pixel(0, 239).0, rows[239]);
    }
    #[test]
    fn aggregate_signature_stitcher_skips_trailing_duplicate_final_frame_before_adjacent_merge() {
        let frames = [0, 40, 80, 80]
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 120)))
            .collect::<Vec<_>>();

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &frames,
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(119),
                min_overlap_px: Some(16),
            },
        )
        .expect("a duplicate final frame should be ignored instead of appended again");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 200);
        assert_eq!(result.merged_frames, 3);
        assert_eq!(result.skipped_frames, 1);
    }

    #[test]
    fn aggregate_signature_stitcher_uses_adjacent_direction_when_scrolling_back_down() {
        let mut rows = unique_rows(0, 340);
        for offset in 0..60usize {
            rows[260 + offset] = rows[offset];
        }

        let first = solid_rows(4, &rows[100..220]);
        let above = solid_rows(4, &rows[0..120]);
        let first_again = solid_rows(4, &rows[100..220]);
        let mut below_rows = rows[200..320].to_vec();
        for color in below_rows.iter_mut().take(20) {
            color[0] = color[0].saturating_add(1);
            color[1] = color[1].saturating_add(1);
            color[2] = color[2].saturating_add(1);
        }
        let below = solid_rows(4, &below_rows);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, above, first_again, below],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(119),
                min_overlap_px: Some(16),
            },
        )
        .expect("scrolling down after capturing above should append below, not prepend a repeated block");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 320);
        assert_eq!(result.image.get_pixel(0, 0).0, rows[0]);
        assert_eq!(result.image.get_pixel(0, 219).0, rows[219]);
        assert_eq!(result.image.get_pixel(0, 319).0, below_rows[119]);
    }

    #[test]
    fn aggregate_signature_stitcher_does_not_drop_valid_frame_after_skipped_direction_hint() {
        let rows = unique_rows(0, 260);
        let first = solid_rows(4, &rows[100..220]);
        let skipped_above = solid_rows(4, &rows[0..120]);
        let partially_above = solid_rows(4, &rows[80..200]);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, skipped_above, partially_above],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(119),
                min_overlap_px: Some(32),
            },
        )
        .expect("a skipped previous frame must not force the next valid aggregate match direction");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 140);
        assert_eq!(result.image.get_pixel(0, 0).0, rows[80]);
        assert_eq!(result.image.get_pixel(0, 139).0, rows[219]);
        assert_eq!(result.skipped_frames, 1);
    }

    #[test]
    fn incremental_signature_stitcher_matches_batch_result_for_mixed_scroll() {
        let positions = [100, 80, 60, 40, 20, 0, 40, 80, 120, 160, 200, 240];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 80)))
            .collect::<Vec<_>>();
        let options = LongCaptureStitchOptions {
            axis: Some(LongCaptureAxis::Vertical),
            direction: None,
            max_scan: Some(79),
            min_overlap_px: Some(12),
        };

        let batch = stitch_long_capture_frames_with_aggregate_signatures(&frames, options)
            .expect("batch stitching should work");
        let mut incremental = LongCaptureIncrementalStitcher::new(frames[0].clone(), options);
        for frame in frames.iter().skip(1) {
            incremental
                .push_frame(frame)
                .expect("incremental stitching should accept the same frame sequence");
        }
        let incremental_axis = incremental.axis();
        let incremental_merged_frames = incremental.merged_frames();
        let incremental_skipped_frames = incremental.skipped_frames();
        let incremental_image = incremental.into_image();

        assert_eq!(incremental_axis, batch.axis);
        assert_eq!(incremental_merged_frames, batch.merged_frames);
        assert_eq!(incremental_skipped_frames, batch.skipped_frames);
        assert_eq!(incremental_image.dimensions(), batch.image.dimensions());
        assert_eq!(incremental_image.as_raw(), batch.image.as_raw());
    }

    #[test]
    fn incremental_signature_stitcher_uses_adjacent_boundary_fast_path_for_sequential_scroll() {
        let positions = [0, 24, 48, 72, 96, 120];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 120)))
            .collect::<Vec<_>>();
        let options = LongCaptureStitchOptions {
            axis: Some(LongCaptureAxis::Vertical),
            direction: None,
            max_scan: Some(119),
            min_overlap_px: Some(16),
        };

        let mut incremental = LongCaptureIncrementalStitcher::new(frames[0].clone(), options);
        for frame in frames.iter().skip(1) {
            incremental
                .push_frame(frame)
                .expect("sequential scroll frame should merge");
        }

        assert_eq!(incremental.axis(), Some(LongCaptureAxis::Vertical));
        assert_eq!(incremental.adjacent_fast_path_merges(), 5);
        assert_eq!(incremental.aggregate_signature_searches(), 0);
        assert_eq!(incremental.expensive_adjacent_pair_analyses(), 0);
        assert_eq!(incremental.aggregate_segment_count(), 6);
        assert_eq!(incremental.into_image().height(), 240);
    }

    #[test]
    fn incremental_signature_stitcher_skips_reverse_frames_already_inside_aggregate_without_expensive_pair_analysis(
    ) {
        let positions = [0, 40, 80, 120, 160, 120, 80, 40, 0];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 120)))
            .collect::<Vec<_>>();
        let options = LongCaptureStitchOptions {
            axis: Some(LongCaptureAxis::Vertical),
            direction: None,
            max_scan: Some(119),
            min_overlap_px: Some(16),
        };

        let mut incremental = LongCaptureIncrementalStitcher::new(frames[0].clone(), options);
        for frame in frames.iter().skip(1) {
            incremental
                .push_frame(frame)
                .expect("covered reverse frame should be skipped cheaply");
        }

        assert_eq!(incremental.axis(), Some(LongCaptureAxis::Vertical));
        assert_eq!(incremental.merged_frames(), 5);
        assert_eq!(incremental.skipped_frames(), 4);
        assert_eq!(incremental.expensive_adjacent_pair_analyses(), 0);
        assert_eq!(incremental.into_image().height(), 280);
    }

    #[test]
    fn incremental_signature_stitcher_rejects_boundary_match_when_appended_slice_is_already_covered(
    ) {
        let positions = [0, 40, 80, 120, 160];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 120)))
            .collect::<Vec<_>>();
        let options = LongCaptureStitchOptions {
            axis: Some(LongCaptureAxis::Vertical),
            direction: None,
            max_scan: Some(119),
            min_overlap_px: Some(16),
        };

        let mut false_append_rows = unique_rows(200, 80);
        false_append_rows.extend(unique_rows(60, 40));
        let false_append_frame = solid_rows(4, &false_append_rows);

        let mut incremental = LongCaptureIncrementalStitcher::new(frames[0].clone(), options);
        for frame in frames.iter().skip(1) {
            incremental
                .push_frame(frame)
                .expect("sequential scroll frame should merge");
        }
        let covered_boundary_frame = solid_rows(4, &unique_rows(160, 120));
        let covered_merged = incremental
            .push_frame(&covered_boundary_frame)
            .expect("covered boundary frame should be skipped");
        assert!(!covered_merged);

        let merged = incremental
            .push_frame(&false_append_frame)
            .expect("covered append slice should be rejected cheaply");

        assert!(!merged);
        assert_eq!(incremental.axis(), Some(LongCaptureAxis::Vertical));
        assert_eq!(incremental.merged_frames(), 5);
        assert_eq!(incremental.skipped_frames(), 2);
        assert_eq!(incremental.expensive_adjacent_pair_analyses(), 0);
        assert_eq!(incremental.into_image().height(), 280);
    }

    #[test]
    fn incremental_signature_stitcher_skips_disconnected_recorded_frames_without_expensive_pair_analysis(
    ) {
        let positions = [0, 40, 80, 120, 160, 1000, 1040, 1080, 1120];
        let frames = positions
            .iter()
            .map(|start| solid_rows(4, &unique_rows(*start, 120)))
            .collect::<Vec<_>>();
        let options = LongCaptureStitchOptions {
            axis: Some(LongCaptureAxis::Vertical),
            direction: None,
            max_scan: Some(119),
            min_overlap_px: Some(16),
        };

        let mut incremental = LongCaptureIncrementalStitcher::new(frames[0].clone(), options);
        for frame in frames.iter().skip(1) {
            incremental
                .push_frame(frame)
                .expect("disconnected frames should be skipped cheaply");
        }

        assert_eq!(incremental.axis(), Some(LongCaptureAxis::Vertical));
        assert_eq!(incremental.merged_frames(), 5);
        assert_eq!(incremental.skipped_frames(), 4);
        assert_eq!(incremental.expensive_adjacent_pair_analyses(), 0);
        assert_eq!(incremental.into_image().height(), 280);
    }

    #[test]
    fn aggregate_signature_stitcher_ignores_dynamic_vertical_scrollbar_edge() {
        fn mail_reader_frame(scroll_y: u32, scrollbar_color: [u8; 3]) -> RgbImage {
            let width = 240;
            let height = 120;
            let stable_content_end = 218;
            let mut image = RgbImage::from_pixel(width, height, Rgb([248, 249, 250]));

            for y in 0..height {
                let color = unique_line_color(scroll_y + y);
                for x in 16..stable_content_end {
                    image.put_pixel(x, y, Rgb(color));
                }
                for x in stable_content_end..width {
                    image.put_pixel(x, y, Rgb(scrollbar_color));
                }
            }

            image
        }

        let first = mail_reader_frame(0, [210, 210, 210]);
        let second = mail_reader_frame(40, [120, 120, 120]);

        let result = stitch_long_capture_frames_with_aggregate_signatures(
            &[first, second],
            LongCaptureStitchOptions {
                axis: Some(LongCaptureAxis::Vertical),
                direction: None,
                max_scan: Some(119),
                min_overlap_px: Some(12),
            },
        )
        .expect("dynamic scrollbar edge should not prevent stitching stable mail content");

        assert_eq!(result.axis, Some(LongCaptureAxis::Vertical));
        assert_eq!(result.image.height(), 160);
        assert_eq!(result.image.get_pixel(16, 0).0, unique_line_color(0));
        assert_eq!(result.image.get_pixel(16, 159).0, unique_line_color(159));
    }
