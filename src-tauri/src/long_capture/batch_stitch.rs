fn stitch_long_capture_frames_with_aggregate_signatures(
    frames: &[RgbImage],
    options: LongCaptureStitchOptions,
) -> Result<LongCaptureAggregateResult> {
    if frames.is_empty() {
        return Err(anyhow!("No frames to stitch"));
    }
    validate_long_capture_frames(frames)?;
    let inferred_axis = infer_axis_from_adjacent_frames(frames, options);
    let mut stitcher =
        LongCaptureIncrementalStitcher::new_with_axis(frames[0].clone(), options, inferred_axis);
    for current in frames.iter().skip(1) {
        stitcher.push_frame(current)?;
    }
    stitcher.finish_result()
}

pub fn stitch_long_capture_frames(
    frames: &[RgbImage],
    options: LongCaptureStitchOptions,
) -> Result<RgbImage> {
    let started_at = std::time::Instant::now();
    let result = stitch_long_capture_frames_with_aggregate_signatures(frames, options)?;
    crate::append_runtime_log_line(&format!(
        "long_capture stitch_complete :: input_frames={} merged_frames={} skipped_frames={} axis={:?} elapsed_ms={} width={} height={}",
        frames.len(),
        result.merged_frames,
        result.skipped_frames,
        result.axis,
        started_at.elapsed().as_millis(),
        result.image.width(),
        result.image.height()
    ));
    if result.skipped_frames > 0 {
        crate::append_runtime_log_line(&format!(
            "long_capture stitch_tolerant_complete :: input_frames={} skipped_frames={}",
            frames.len(),
            result.skipped_frames
        ));
    }
    Ok(result.image)
}

pub fn stitch_long_capture_frames_with_analyses(
    frames: &[RgbImage],
    analyses: &[LongCaptureOverlapAnalysis],
) -> Result<RgbImage> {
    if frames.is_empty() {
        return Err(anyhow!("No frames to stitch"));
    }
    validate_long_capture_frames(frames)?;
    if analyses.len() + 1 != frames.len() {
        return Err(anyhow!(
            "Long-capture analyses must line up with consecutive frame pairs"
        ));
    }
    if analyses.is_empty() {
        return Ok(frames[0].clone());
    }

    let first_direction = analyses[0]
        .direction
        .ok_or_else(|| anyhow!("Long-capture direction is missing"))?;
    let stitch_axis = analyses[0]
        .axis
        .unwrap_or_else(|| direction_axis(first_direction));
    let mut segments = VecDeque::new();
    segments.push_back(frames[0].clone());
    let mut aggregate = LongCaptureAggregate {
        axis: Some(stitch_axis),
        origin: 0,
        segments,
        signatures: None,
    };
    let mut previous_origin = 0i64;
    let mut min_origin = 0i64;
    let mut max_extent = match stitch_axis {
        LongCaptureAxis::Vertical => frames[0].height() as i64,
        LongCaptureAxis::Horizontal => frames[0].width() as i64,
    };

    for (index, analysis) in analyses.iter().enumerate() {
        let direction = analysis
            .direction
            .ok_or_else(|| anyhow!("Long-capture direction is missing"))?;
        let axis = analysis.axis.unwrap_or_else(|| direction_axis(direction));
        if axis != stitch_axis || direction_axis(direction) != stitch_axis {
            return Err(anyhow!(
                "Long-capture mixed-axis stitching is not supported"
            ));
        }

        let current = &frames[index + 1];
        let append_px = analysis.append_px as i64;
        if append_px <= 0 {
            continue;
        }

        match direction {
            LongCaptureDirection::Down => {
                if frames[0].width() != current.width() {
                    return Err(anyhow!(
                        "Vertical long-capture frames must have the same width"
                    ));
                }
                let current_origin = previous_origin
                    .checked_add(append_px)
                    .ok_or_else(|| anyhow!("Long-capture origin overflow"))?;
                let segment_start = current_origin
                    .checked_add(i64::from(analysis.crop_start_px))
                    .ok_or_else(|| anyhow!("Long-capture segment start overflow"))?;
                let segment_end = current_origin
                    .checked_add(i64::from(current.height()))
                    .ok_or_else(|| anyhow!("Long-capture segment end overflow"))?;
                let extension_start = segment_start.max(max_extent);
                if extension_start < segment_end {
                    let crop_y = i64::from(analysis.crop_start_px)
                        .checked_add(extension_start - segment_start)
                        .ok_or_else(|| anyhow!("Long-capture crop start overflow"))?;
                    let cropped = crop_axis_segment(
                        current,
                        LongCaptureAxis::Vertical,
                        crop_y,
                        segment_end - extension_start,
                    )?;
                    push_aggregate_segment(&mut aggregate, cropped, stitch_axis, false)?;
                    max_extent = max_extent.max(segment_end);
                }
                previous_origin = current_origin;
            }
            LongCaptureDirection::Up => {
                if frames[0].width() != current.width() {
                    return Err(anyhow!(
                        "Vertical long-capture frames must have the same width"
                    ));
                }
                let current_origin = previous_origin
                    .checked_sub(append_px)
                    .ok_or_else(|| anyhow!("Long-capture origin overflow"))?;
                let segment_start = current_origin;
                let segment_end = current_origin
                    .checked_add(append_px)
                    .ok_or_else(|| anyhow!("Long-capture segment end overflow"))?;
                let extension_end = segment_end.min(min_origin);
                if segment_start < extension_end {
                    let cropped = crop_axis_segment(
                        current,
                        LongCaptureAxis::Vertical,
                        0,
                        extension_end - segment_start,
                    )?;
                    push_aggregate_segment(&mut aggregate, cropped, stitch_axis, true)?;
                    min_origin = min_origin.min(segment_start);
                }
                previous_origin = current_origin;
            }
            LongCaptureDirection::Right => {
                if frames[0].height() != current.height() {
                    return Err(anyhow!(
                        "Horizontal long-capture frames must have the same height"
                    ));
                }
                let current_origin = previous_origin
                    .checked_add(append_px)
                    .ok_or_else(|| anyhow!("Long-capture origin overflow"))?;
                let segment_start = current_origin
                    .checked_add(i64::from(analysis.crop_start_px))
                    .ok_or_else(|| anyhow!("Long-capture segment start overflow"))?;
                let segment_end = current_origin
                    .checked_add(i64::from(current.width()))
                    .ok_or_else(|| anyhow!("Long-capture segment end overflow"))?;
                let extension_start = segment_start.max(max_extent);
                if extension_start < segment_end {
                    let crop_x = i64::from(analysis.crop_start_px)
                        .checked_add(extension_start - segment_start)
                        .ok_or_else(|| anyhow!("Long-capture crop start overflow"))?;
                    let cropped = crop_axis_segment(
                        current,
                        LongCaptureAxis::Horizontal,
                        crop_x,
                        segment_end - extension_start,
                    )?;
                    push_aggregate_segment(&mut aggregate, cropped, stitch_axis, false)?;
                    max_extent = max_extent.max(segment_end);
                }
                previous_origin = current_origin;
            }
            LongCaptureDirection::Left => {
                if frames[0].height() != current.height() {
                    return Err(anyhow!(
                        "Horizontal long-capture frames must have the same height"
                    ));
                }
                let current_origin = previous_origin
                    .checked_sub(append_px)
                    .ok_or_else(|| anyhow!("Long-capture origin overflow"))?;
                let segment_start = current_origin;
                let segment_end = current_origin
                    .checked_add(append_px)
                    .ok_or_else(|| anyhow!("Long-capture segment end overflow"))?;
                let extension_end = segment_end.min(min_origin);
                if segment_start < extension_end {
                    let cropped = crop_axis_segment(
                        current,
                        LongCaptureAxis::Horizontal,
                        0,
                        extension_end - segment_start,
                    )?;
                    push_aggregate_segment(&mut aggregate, cropped, stitch_axis, true)?;
                    min_origin = min_origin.min(segment_start);
                }
                previous_origin = current_origin;
            }
        }
    }
    aggregate_into_image(aggregate)
}

pub fn stitch_long_capture_frame_data_urls(
    frames: &[String],
    options: LongCaptureStitchOptions,
) -> Result<RgbImage> {
    if frames.is_empty() {
        return Err(anyhow!("No frames to stitch"));
    }
    let decoded_frames = decode_long_capture_frames(frames)?;
    stitch_long_capture_frames(&decoded_frames, options)
}

pub fn stitch_vertical_frames(frames: &[RgbImage], max_overlap_scan: u32) -> Result<RgbImage> {
    if frames.is_empty() {
        return Err(anyhow!("No frames to stitch"));
    }
    validate_long_capture_frames(frames)?;

    let width = frames[0].width();
    if frames.iter().any(|frame| frame.width() != width) {
        return Err(anyhow!("All frames must have the same width"));
    }

    let mut total_height = frames[0].height();
    let mut overlaps = Vec::with_capacity(frames.len().saturating_sub(1));

    for index in 1..frames.len() {
        let overlap = find_vertical_overlap(&frames[index - 1], &frames[index], max_overlap_scan);
        overlaps.push(overlap);
        total_height = total_height
            .checked_add(frames[index].height().saturating_sub(overlap))
            .ok_or_else(|| anyhow!("Vertical long-capture output height overflow"))?;
    }

    validate_long_capture_output_dimensions(width, total_height)?;
    let mut stitched = RgbImage::new(width, total_height);
    let mut cursor_y = 0u32;

    for (index, frame) in frames.iter().enumerate() {
        let skip = if index == 0 { 0 } else { overlaps[index - 1] };
        let crop_height = frame.height().saturating_sub(skip);
        let cropped = imageops::crop_imm(frame, 0, skip, frame.width(), crop_height).to_image();
        imageops::replace(&mut stitched, &cropped, 0, cursor_y as i64);
        cursor_y = cursor_y
            .checked_add(crop_height)
            .ok_or_else(|| anyhow!("Vertical long-capture output cursor overflow"))?;
    }

    Ok(stitched)
}

pub fn stitch_vertical_frame_data_urls(
    frames: &[String],
    max_overlap_scan: u32,
) -> Result<RgbImage> {
    if frames.is_empty() {
        return Err(anyhow!("No frames to stitch"));
    }

    let decoded_frames = decode_long_capture_frames(frames)?;
    stitch_vertical_frames(&decoded_frames, max_overlap_scan)
}
