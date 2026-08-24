fn validate_capture_request(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    max_frames: u32,
    settle_ms: u64,
) -> Result<(i32, i32)> {
    if max_frames == 0 {
        return Err(anyhow!("max_frames must be greater than zero"));
    }
    validate_long_capture_frame_count(max_frames as usize)?;
    let frame_pixels = validate_long_capture_frame_dimensions(w, h)?;
    let projected_pixels = frame_pixels
        .checked_mul(u64::from(max_frames))
        .ok_or_else(|| anyhow!("Long-capture projected pixel count overflow"))?;
    if projected_pixels > MAX_LONG_CAPTURE_INPUT_PIXELS {
        return Err(anyhow!(
            "Long-capture request exceeds the {MAX_LONG_CAPTURE_INPUT_PIXELS}-pixel memory budget"
        ));
    }
    if settle_ms > MAX_LONG_CAPTURE_SETTLE_MS {
        return Err(anyhow!(
            "Long-capture settle delay exceeds {MAX_LONG_CAPTURE_SETTLE_MS} ms"
        ));
    }
    let total_settle_ms = settle_ms
        .checked_mul(u64::from(max_frames.saturating_sub(1)))
        .ok_or_else(|| anyhow!("Long-capture settle duration overflow"))?;
    if total_settle_ms > MAX_LONG_CAPTURE_TOTAL_SETTLE_MS {
        return Err(anyhow!(
            "Long-capture total settle duration exceeds {MAX_LONG_CAPTURE_TOTAL_SETTLE_MS} ms"
        ));
    }

    let half_w = i32::try_from(w / 2)
        .map_err(|_| anyhow!("Long-capture width cannot be represented as a screen coordinate"))?;
    let half_h = i32::try_from(h / 2)
        .map_err(|_| anyhow!("Long-capture height cannot be represented as a screen coordinate"))?;
    let center_x = x
        .checked_add(half_w)
        .ok_or_else(|| anyhow!("Long-capture horizontal center coordinate overflow"))?;
    let center_y = y
        .checked_add(half_h)
        .ok_or_else(|| anyhow!("Long-capture vertical center coordinate overflow"))?;
    Ok((center_x, center_y))
}

pub fn capture_vertical_long_region(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    max_frames: u32,
    scroll_delta: i32,
    settle_ms: u64,
    overlap_scan: u32,
) -> Result<RgbImage> {
    crate::append_runtime_log_line(&format!(
        "long_capture start :: x={} y={} w={} h={} max_frames={} scroll_delta={} settle_ms={} overlap_scan={}",
        x, y, w, h, max_frames, scroll_delta, settle_ms, overlap_scan
    ));
    let (center_x, center_y) = validate_capture_request(x, y, w, h, max_frames, settle_ms)?;
    let mut frames = Vec::with_capacity(max_frames as usize);
    let (center_x_physical, center_y_physical) = logical_to_primary_physical(center_x, center_y);

    for index in 0..max_frames {
        let frame = screenshot::capture_area_with_profile(
            x,
            y,
            w,
            h,
            screenshot::CaptureWorkloadProfile::LongCapture,
        )?;
        crate::append_runtime_log_line(&format!(
            "long_capture frame_captured :: index={} width={} height={}",
            index,
            frame.width(),
            frame.height()
        ));
        let is_duplicate = frames
            .last()
            .map(|previous: &RgbImage| previous.as_raw() == frame.as_raw())
            .unwrap_or(false);
        if is_duplicate {
            #[cfg(target_os = "windows")]
            if !frames.is_empty() {
                crate::append_runtime_log_line(&format!(
                    "long_capture duplicate_frame_retry :: index={}",
                    index
                ));
                page_down_at_point(center_x_physical, center_y_physical);
                thread::sleep(Duration::from_millis(settle_ms));
                let retry_frame = screenshot::capture_area_with_profile(
                    x,
                    y,
                    w,
                    h,
                    screenshot::CaptureWorkloadProfile::LongCapture,
                )?;
                let retry_duplicate = frames
                    .last()
                    .map(|previous: &RgbImage| previous.as_raw() == retry_frame.as_raw())
                    .unwrap_or(false);
                if !retry_duplicate {
                    crate::append_runtime_log_line(&format!(
                        "long_capture duplicate_retry_success :: index={} width={} height={}",
                        index,
                        retry_frame.width(),
                        retry_frame.height()
                    ));
                    frames.push(retry_frame);
                    continue;
                }
            }
            crate::append_runtime_log_line(&format!(
                "long_capture duplicate_frame_stop :: index={}",
                index
            ));
            break;
        }
        frames.push(frame);

        if index + 1 < max_frames {
            #[cfg(target_os = "windows")]
            {
                crate::append_runtime_log_line(&format!(
                    "long_capture scroll_step :: index={} center_x={} center_y={} physical_x={} physical_y={} delta={}",
                    index, center_x, center_y, center_x_physical, center_y_physical, scroll_delta
                ));
                scroll_vertical_at_point(center_x_physical, center_y_physical, scroll_delta);
                thread::sleep(Duration::from_millis(settle_ms));
            }
        }
    }

    let stitched = stitch_vertical_frames(&frames, overlap_scan)?;
    crate::append_runtime_log_line(&format!(
        "long_capture stitched :: frames={} width={} height={}",
        frames.len(),
        stitched.width(),
        stitched.height()
    ));
    Ok(stitched)
}
