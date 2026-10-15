// Real scrolling can preserve geometry without preserving exact RGB hashes.
#[test]
fn long_capture_records_repainted_overlap_and_stitches_it() {
    let previous = solid_rows(64, &unique_rows_for_test(0, 160));
    let mut current = solid_rows(64, &unique_rows_for_test(40, 160));
    for pixel in current.pixels_mut() {
        for channel in &mut pixel.0 {
            *channel = channel.saturating_add(1);
        }
    }
    let previous_fingerprint = long_capture_frame_fingerprint(&previous);
    let current_fingerprint = long_capture_frame_fingerprint(&current);
    let options = long_capture::LongCaptureAnalyzeOptions {
        axis: Some(long_capture::LongCaptureAxis::Vertical),
        direction: None,
        max_scan: Some(159),
        min_overlap_px: Some(16),
        min_new_content_px: Some(1),
    };
    assert!(
        long_capture::analyze_long_capture_motion_fingerprints(
            &previous_fingerprint.motion,
            &current_fingerprint.motion,
            options,
        )
        .is_none(),
        "fixture must miss the exact-signature fast path"
    );
    let classification = classify_long_capture_recording_fingerprint(
        Some(&previous_fingerprint),
        &current_fingerprint,
        options.axis,
        159,
        16,
    );
    assert!(matches!(
        classification.status,
        LongCaptureSessionSampleStatus::Recorded
    ));
    let mut stitcher = long_capture::LongCaptureIncrementalStitcher::new(
        previous,
        long_capture::LongCaptureStitchOptions {
            axis: options.axis,
            direction: None,
            max_scan: Some(159),
            min_overlap_px: Some(16),
        },
    );
    assert!(stitcher.push_frame_owned(current).unwrap());
    assert_eq!(stitcher.into_image().dimensions(), (64, 200));
}

#[test]
fn long_capture_repaint_validation_is_bounded_for_large_frames_in_both_axes() {
    for horizontal in [false, true] {
        let frame = |offset: u32, tint: u8| {
            let image = image::RgbImage::from_fn(1280, 720, |x, y| {
                let row = (y + offset) / 4;
                let col = x / 16;
                let value = ((row.wrapping_mul(73) ^ col.wrapping_mul(131)) % 180 + 20) as u8;
                Rgb([value.saturating_add(tint), value / 2, 40])
            });
            if horizontal {
                image::imageops::rotate90(&image)
            } else {
                image
            }
        };
        let axis = if horizontal {
            long_capture::LongCaptureAxis::Horizontal
        } else {
            long_capture::LongCaptureAxis::Vertical
        };
        let first = frame(0, 0);
        let mut stitcher = long_capture::LongCaptureIncrementalStitcher::new(
            first.clone(),
            long_capture::LongCaptureStitchOptions {
                axis: Some(axis),
                direction: None,
                max_scan: Some(1279),
                min_overlap_px: Some(32),
            },
        );
        let mut previous = long_capture_frame_fingerprint(&first);
        for step in 1..=2 {
            let current = frame(step * 144, step as u8);
            let fingerprint = long_capture_frame_fingerprint(&current);
            assert!(fingerprint.validation_thumbnail.width() <= 320);
            assert!(fingerprint.validation_thumbnail.height() <= 320);
            let classification = classify_long_capture_recording_fingerprint(
                Some(&previous),
                &fingerprint,
                Some(axis),
                1279,
                32,
            );
            assert!(
                matches!(
                    classification.status,
                    LongCaptureSessionSampleStatus::Recorded
                ),
                "horizontal={horizontal} step={step}"
            );
            assert!(stitcher.push_frame_owned(current).unwrap());
            previous = fingerprint;
        }
        let expected = if horizontal {
            (1008, 1280)
        } else {
            (1280, 1008)
        };
        assert_eq!(stitcher.into_image().dimensions(), expected);
    }
}
