// Verifies long-capture recording classification, queuing, and fingerprints.

    #[test]
    fn long_capture_recording_classifies_first_frame_as_recorded() {
        let frame = image::RgbImage::from_pixel(16, 16, Rgb([255, 255, 255]));

        let classification = classify_long_capture_recording_frame(None, &frame, None, 32, 1, 1);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
    }

    #[test]
    fn long_capture_recording_ignores_duplicate_frame() {
        let previous = image::RgbImage::from_pixel(16, 16, Rgb([255, 255, 255]));
        let current = previous.clone();

        let classification =
            classify_long_capture_recording_frame(Some(&previous), &current, None, 32, 1, 1);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Duplicate
        ));
    }

    #[test]
    fn long_capture_recording_ignores_sparse_stationary_pixel_noise() {
        let previous = image::RgbImage::from_pixel(640, 160, Rgb([255, 255, 255]));
        let mut current = previous.clone();
        current.put_pixel(123, 77, Rgb([20, 20, 20]));

        let classification =
            classify_long_capture_recording_frame(Some(&previous), &current, None, 159, 16, 2);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Duplicate
        ));
        assert!(classification.analysis.is_none());
    }

    #[test]
    fn long_capture_recording_ignores_stationary_animation_without_scroll_motion() {
        let previous = image::RgbImage::from_pixel(320, 160, Rgb([255, 255, 255]));
        let mut current = previous.clone();
        for y in 48..112 {
            for x in 120..200 {
                current.put_pixel(x, y, Rgb([16, 96, 220]));
            }
        }

        let classification =
            classify_long_capture_recording_frame(Some(&previous), &current, None, 159, 16, 1);

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Duplicate
        ));
        assert!(classification.analysis.is_none());
    }

    #[test]
    fn long_capture_recording_keeps_tiny_vertical_scroll_motion() {
        let previous = solid_rows(32, &unique_rows_for_test(0, 80));
        let current = solid_rows(32, &unique_rows_for_test(1, 80));

        let classification = classify_long_capture_recording_frame(
            Some(&previous),
            &current,
            Some(long_capture::LongCaptureAxis::Vertical),
            79,
            16,
            2,
        );

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
        assert!(classification.analysis.is_none());
    }

    #[test]
    fn long_capture_recording_keeps_meaningfully_changed_frame() {
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
                [40, 0, 0],
                [50, 0, 0],
                [60, 0, 0],
                [70, 0, 0],
                [80, 0, 0],
                [90, 0, 0],
            ],
        );

        let classification = classify_long_capture_recording_frame(
            Some(&previous),
            &current,
            Some(long_capture::LongCaptureAxis::Vertical),
            5,
            1,
            1,
        );

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
    }

    #[test]
    fn long_capture_recording_ignores_non_duplicate_jump_without_scroll_overlap() {
        let previous = solid_rows(
            4,
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
            4,
            &[
                [130, 0, 0],
                [140, 0, 0],
                [150, 0, 0],
                [160, 0, 0],
                [170, 0, 0],
                [180, 0, 0],
            ],
        );

        let classification = classify_long_capture_recording_frame(
            Some(&previous),
            &current,
            Some(long_capture::LongCaptureAxis::Vertical),
            5,
            1,
            1,
        );

        assert!(matches!(
            classification.status,
            LongCaptureSessionSampleStatus::Duplicate
        ));
        assert!(classification.analysis.is_none());
    }

    #[test]
    fn long_capture_recording_queues_incremental_stitching_off_the_sample_path() {
        let rect = LongCaptureSessionRect {
            x: 0.0,
            y: 0.0,
            w: 8.0,
            h: 80.0,
        };
        let mut session = LongCaptureSessionState {
            rect,
            axis: Some(long_capture::LongCaptureAxis::Vertical),
            direction: None,
            frames: Vec::new(),
            last_frame_fingerprint: None,
            pair_analyses: Vec::new(),
            incremental_stitcher: None,
            stitch_worker_active: false,
            stitch_error: None,
            duplicate_count: 0,
            max_scan: 79,
            min_overlap_px: 12,
            created_at: Instant::now(),
        };
        let first = solid_rows(8, &[[10, 0, 0]; 80]);
        let second = solid_rows(8, &[[20, 0, 0]; 80]);
        let first_fingerprint = long_capture_frame_fingerprint(&first);
        let second_fingerprint = long_capture_frame_fingerprint(&second);

        let first_result = LongCaptureSessionSampleResult {
            frame: first,
            fingerprint: first_fingerprint,
            status: LongCaptureSessionSampleStatus::Recorded,
            analysis: None,
            expected_frame_count: 0,
        };
        let (_, first_should_spawn) =
            record_long_capture_session_sample_result(&mut session, first_result)
                .expect("first frame should initialize stitcher");
        assert!(!first_should_spawn);
        assert_eq!(
            session
                .incremental_stitcher
                .as_ref()
                .expect("stitcher should exist after first frame")
                .frame_count(),
            1
        );

        let second_result = LongCaptureSessionSampleResult {
            frame: second,
            fingerprint: second_fingerprint,
            status: LongCaptureSessionSampleStatus::Recorded,
            analysis: None,
            expected_frame_count: 1,
        };
        let (_, second_should_spawn) =
            record_long_capture_session_sample_result(&mut session, second_result)
                .expect("second frame should be queued for background stitching");

        assert!(second_should_spawn);
        assert!(session.stitch_worker_active);
        assert_eq!(session.frames.len(), 2);
        assert_eq!(
            session
                .incremental_stitcher
                .as_ref()
                .expect("stitcher should stay on first frame until worker drains queue")
                .frame_count(),
            1
        );
    }

    #[test]
    fn long_capture_frame_fingerprint_detects_duplicate_samples_without_previous_frame_clone() {
        let first = solid_rows(8, &unique_rows_for_test(0, 12));
        let same = first.clone();
        let scrolled = solid_rows(8, &unique_rows_for_test(1, 12));

        let first_fingerprint = long_capture_frame_fingerprint(&first);
        assert_eq!(first_fingerprint, long_capture_frame_fingerprint(&same));
        assert_ne!(first_fingerprint, long_capture_frame_fingerprint(&scrolled));

        let same_fingerprint = long_capture_frame_fingerprint(&same);
        let duplicate = classify_long_capture_recording_fingerprint(
            Some(&first_fingerprint),
            &same_fingerprint,
            Some(long_capture::LongCaptureAxis::Vertical),
            11,
            1,
        );
        assert!(matches!(
            duplicate.status,
            LongCaptureSessionSampleStatus::Duplicate
        ));

        let changed_fingerprint = long_capture_frame_fingerprint(&scrolled);
        let recorded = classify_long_capture_recording_fingerprint(
            Some(&first_fingerprint),
            &changed_fingerprint,
            Some(long_capture::LongCaptureAxis::Vertical),
            11,
            1,
        );
        assert!(matches!(
            recorded.status,
            LongCaptureSessionSampleStatus::Recorded
        ));
    }

