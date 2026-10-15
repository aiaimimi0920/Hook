// Verify known screen translation against overlap; infer page scrolling separately.
fn spatial_sample_error(a: &RgbImage, b: &RgbImage, ox: u32, oy: u32) -> f64 {
    let mut error = 0u64;
    let count = 24u32;
    for iy in 0..count {
        for ix in 0..count {
            // Ignore outer chrome/guide edges when anchoring a captured viewport.
            let x =
                ((ix + 3) as u64 * b.width().saturating_sub(1) as u64 / (count + 5) as u64) as u32;
            let y =
                ((iy + 3) as u64 * b.height().saturating_sub(1) as u64 / (count + 5) as u64) as u32;
            error += u64::from(pixel_diff_sum(
                a.get_pixel(x + ox, y + oy).0,
                b.get_pixel(x, y).0,
            ));
        }
    }
    error as f64 / (count * count * 3) as f64
}

fn locate_spatial_reference(
    aggregate: &RgbImage,
    frame: &RgbImage,
    axis: Option<LongCaptureAxis>,
) -> Result<(i64, i64)> {
    if frame.width() > aggregate.width() || frame.height() > aggregate.height() {
        return Err(anyhow!("Cannot anchor viewfinder to stitched content"));
    }
    let horizontal = axis == Some(LongCaptureAxis::Horizontal);
    let limit = if horizontal {
        aggregate.width() - frame.width()
    } else {
        aggregate.height() - frame.height()
    };
    let mut best = (f64::MAX, 0, 0);
    for step in 0..=limit {
        let (x, y) = if horizontal { (step, 0) } else { (0, step) };
        let error = spatial_sample_error(aggregate, frame, x, y);
        if error < best.0 {
            best = (error, x, y);
        }
        if error == 0.0 {
            break;
        }
    }
    if best.0 > 12.0 {
        return Err(anyhow!("Cannot anchor viewfinder to stitched content"));
    }
    Ok((i64::from(best.1), i64::from(best.2)))
}

fn spatial_frame_offset(
    previous: &RgbImage,
    current: &RgbImage,
    movement: (i64, i64),
    options: LongCaptureStitchOptions,
) -> Result<(i64, i64)> {
    if previous.dimensions() != current.dimensions() {
        return Err(anyhow!(
            "Capture dimensions changed during spatial sampling"
        ));
    }
    let (dx, dy) = movement;
    let w = i64::from(current.width()) - dx.abs();
    let h = i64::from(current.height()) - dy.abs();
    if w < 1 || h < 1 {
        return Err(anyhow!("Viewfinder movement has no overlap"));
    }
    let a = imageops::crop_imm(
        previous,
        dx.max(0) as u32,
        dy.max(0) as u32,
        w as u32,
        h as u32,
    )
    .to_image();
    let b = imageops::crop_imm(
        current,
        (-dx).max(0) as u32,
        (-dy).max(0) as u32,
        w as u32,
        h as u32,
    )
    .to_image();
    if spatial_sample_error(&a, &b, 0, 0) <= 3.0 {
        return Ok(movement);
    }
    let analyze_options = LongCaptureAnalyzeOptions {
        axis: options.axis,
        direction: None,
        max_scan: options.max_scan,
        min_overlap_px: options.min_overlap_px,
        min_new_content_px: Some(1),
    };
    let analysis = analyze_long_capture_motion_fingerprints(
        &long_capture_motion_fingerprint(&a),
        &long_capture_motion_fingerprint(&b),
        analyze_options,
    )
    .unwrap_or_else(|| analyze_long_capture_pair_images(&a, &b, analyze_options));
    if !matches!(analysis.status, LongCaptureOverlapStatus::Good) {
        return Err(anyhow!("Spatial capture overlap could not be verified; stop scrolling while moving the viewfinder"));
    }
    let distance = i64::from(analysis.append_px);
    let residual = match analysis.direction {
        Some(LongCaptureDirection::Down) => (0, distance),
        Some(LongCaptureDirection::Up) => (0, -distance),
        Some(LongCaptureDirection::Right) => (distance, 0),
        Some(LongCaptureDirection::Left) => (-distance, 0),
        None => return Err(anyhow!("Missing spatial capture direction")),
    };
    Ok((dx + residual.0, dy + residual.1))
}
