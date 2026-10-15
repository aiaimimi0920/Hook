#[test]
fn preview_matches_finished_aggregate_in_both_axes_without_consuming_it() {
    for axis in [LongCaptureAxis::Vertical, LongCaptureAxis::Horizontal] {
        let first = RgbImage::from_fn(40, 60, |x, y| image::Rgb([x as u8, y as u8, 10]));
        let mut stitcher = LongCaptureIncrementalStitcher::new(
            first,
            LongCaptureStitchOptions {
                axis: Some(axis),
                direction: None,
                max_scan: None,
                min_overlap_px: None,
            },
        );
        // Include prepend and append segments to exercise global rather than per-tile scaling.
        stitcher
            .aggregate
            .segments
            .push_front(RgbImage::from_pixel(40, 60, image::Rgb([1, 2, 3])));
        stitcher
            .aggregate
            .segments
            .push_back(RgbImage::from_pixel(40, 60, image::Rgb([4, 5, 6])));
        let (preview, width, height) = stitcher.preview_image();
        let finished = stitcher.into_image();
        assert_eq!((width, height), finished.dimensions());
        assert_eq!(preview, finished);
    }
}

#[test]
fn preview_is_bounded_and_samples_global_coordinates_across_segments() {
    for axis in [LongCaptureAxis::Vertical, LongCaptureAxis::Horizontal] {
        let first = RgbImage::from_fn(500, 800, |x, y| image::Rgb([x as u8, y as u8, 10]));
        let mut stitcher = LongCaptureIncrementalStitcher::new(
            first.clone(),
            LongCaptureStitchOptions {
                axis: Some(axis),
                direction: None,
                max_scan: None,
                min_overlap_px: None,
            },
        );
        stitcher.aggregate.segments.push_back(first);
        let (preview, width, height) = stitcher.preview_image();
        assert!(preview.width() <= 320 && preview.height() <= 640);
        let finished = stitcher.into_image();
        for (x, y, pixel) in preview.enumerate_pixels() {
            assert_eq!(
                pixel,
                finished.get_pixel(
                    (x as u64 * width as u64 / preview.width() as u64) as u32,
                    (y as u64 * height as u64 / preview.height() as u64) as u32,
                )
            );
        }
    }
}
