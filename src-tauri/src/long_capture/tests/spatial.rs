// Spatial paths exercise original 1-D history, L coverage, revisits and exact crop.
fn spatial_scene() -> image::RgbImage {
    image::RgbImage::from_fn(200, 200, |x, y| {
        let n = x.wrapping_mul(73856093) ^ y.wrapping_mul(19349663);
        image::Rgb([n as u8, (n >> 8) as u8, (n >> 16) as u8])
    })
}

fn spatial_frame(scene: &image::RgbImage, x: u32, y: u32) -> image::RgbImage {
    image::imageops::crop_imm(scene, x, y, 40, 40).to_image()
}

fn spatial_stitcher(scene: &image::RgbImage) -> super::LongCaptureIncrementalStitcher {
    super::LongCaptureIncrementalStitcher::new(
        spatial_frame(scene, 20, 20),
        super::LongCaptureStitchOptions {
            axis: Some(super::LongCaptureAxis::Vertical),
            min_overlap_px: Some(8),
            max_scan: Some(39),
            direction: None,
        },
    )
}

#[test]
fn spatial_l_shape_keeps_history_and_exports_largest_solid_rectangle() {
    let scene = spatial_scene();
    let mut stitcher = spatial_stitcher(&scene);
    assert!(stitcher
        .push_frame_at(spatial_frame(&scene, 20, 40), (0, 0))
        .unwrap());
    assert!(stitcher
        .push_frame_at(spatial_frame(&scene, 40, 40), (20, 0))
        .unwrap());
    let (preview, w, h) = stitcher.preview_rgba();
    assert_eq!((w, h), (60, 60));
    assert_eq!(preview.get_pixel(59, 0)[3], 0);
    assert_eq!(preview.get_pixel(59, 59)[3], 255);
    let finished = stitcher.into_image();
    assert_eq!(finished.dimensions(), (40, 60));
    assert_eq!(
        finished,
        image::imageops::crop_imm(&scene, 20, 20, 40, 60).to_image()
    );
}

#[test]
fn spatial_return_fills_hole_and_expands_final_rectangle_without_overwriting() {
    let scene = spatial_scene();
    let mut stitcher = spatial_stitcher(&scene);
    stitcher
        .push_frame_at(spatial_frame(&scene, 20, 40), (0, 20))
        .unwrap();
    stitcher
        .push_frame_at(spatial_frame(&scene, 40, 40), (20, 0))
        .unwrap();
    stitcher
        .push_frame_at(spatial_frame(&scene, 40, 20), (0, -20))
        .unwrap();
    assert_eq!(
        stitcher.into_image(),
        image::imageops::crop_imm(&scene, 20, 20, 60, 60).to_image()
    );
}

#[test]
fn spatial_negative_moves_and_scrolling_after_turn_have_correct_coordinates() {
    let scene = spatial_scene();
    let mut stitcher = spatial_stitcher(&scene);
    stitcher
        .push_frame_at(spatial_frame(&scene, 10, 20), (-10, 0))
        .unwrap();
    stitcher
        .push_frame_at(spatial_frame(&scene, 10, 10), (0, -10))
        .unwrap();
    // Background scroll now adds 20 content pixels without moving the viewfinder.
    stitcher
        .push_frame_at(spatial_frame(&scene, 10, 30), (0, 0))
        .unwrap();
    let output = stitcher.into_image();
    assert_eq!(
        output,
        image::imageops::crop_imm(&scene, 10, 10, 40, 60).to_image()
    );
}

#[test]
fn spatial_motion_rejects_unrelated_content_without_changing_aggregate() {
    let scene = spatial_scene();
    let mut stitcher = spatial_stitcher(&scene);
    let before = stitcher.preview_rgba();
    assert!(stitcher
        .push_frame_at(spatial_frame(&scene, 150, 150), (20, 0))
        .is_err());
    assert_eq!(stitcher.frame_count(), 1);
    assert_eq!(stitcher.preview_rgba(), before);
}

#[test]
fn spatial_maximum_rectangle_matches_brute_force_for_all_small_masks() {
    for bits in 1u32..512 {
        let mask = image::RgbaImage::from_fn(3, 3, |x, y| {
            image::Rgba([
                0,
                0,
                0,
                if bits & (1 << (y * 3 + x)) != 0 {
                    255
                } else {
                    0
                },
            ])
        });
        let (x, y, w, h) = super::largest_covered_rectangle(&mask);
        let mut max_area = 0;
        for top in 0..3 {
            for left in 0..3 {
                for bottom in top + 1..=3 {
                    for right in left + 1..=3 {
                        if (top..bottom)
                            .all(|py| (left..right).all(|px| mask.get_pixel(px, py)[3] == 255))
                        {
                            max_area = max_area.max((right - left) * (bottom - top));
                        }
                    }
                }
            }
        }
        assert_eq!(w * h, max_area, "mask {bits}");
        assert!((y..y + h).all(|py| (x..x + w).all(|px| mask.get_pixel(px, py)[3] == 255)));
    }
}
