// Captures, classifies, and records one long-capture session sample.

fn capture_and_classify_long_capture_sample(
    work: LongCaptureSessionSampleWork,
) -> Result<LongCaptureSessionSampleResult, String> {
    let (x, y, w, h) = logical_rect_to_capture_bounds(work.rect)?;
    let mut frame = screenshot::capture_area_with_profile(
        x,
        y,
        w,
        h,
        screenshot::CaptureWorkloadProfile::LongCapture,
    )
    .map_err(|error| error.to_string())?;
    remove_long_capture_overlay_guide_edges(&mut frame);
    let fingerprint = long_capture_frame_fingerprint(&frame);
    let classification = classify_long_capture_recording_fingerprint(
        work.previous_fingerprint.as_deref(),
        &fingerprint,
        work.axis,
        work.max_scan,
        work.min_overlap_px,
    );

    Ok(LongCaptureSessionSampleResult {
        frame,
        fingerprint,
        status: classification.status,
        analysis: classification.analysis,
        expected_frame_count: work.expected_frame_count,
    })
}

fn long_capture_stitch_worker_needed(session: &LongCaptureSessionState) -> bool {
    session.stitch_error.is_none()
        && !session.stitch_worker_active
        && session
            .incremental_stitcher
            .as_ref()
            .map(|stitcher| stitcher.frame_count() < session.frames.len())
            .unwrap_or(false)
}

fn record_long_capture_session_sample_result(
    session: &mut LongCaptureSessionState,
    result: LongCaptureSessionSampleResult,
) -> Result<(LongCaptureSessionSampleResponse, bool), String> {
    let status = result.status;
    let mut recorded = false;
    let mut should_spawn_worker = false;

    if matches!(status, LongCaptureSessionSampleStatus::Recorded) {
        if let Some(analysis) = result.analysis {
            session.axis = analysis.axis.or(session.axis);
            session.direction = analysis.direction;
            session.pair_analyses.push(analysis);
        }
        if session.incremental_stitcher.is_none() {
            let stitch_options = long_capture::LongCaptureStitchOptions {
                axis: session.axis,
                direction: None,
                max_scan: Some(session.max_scan),
                min_overlap_px: Some(session.min_overlap_px),
            };
            session.incremental_stitcher = Some(long_capture::LongCaptureIncrementalStitcher::new(
                result.frame.clone(),
                stitch_options,
            ));
        }
        session.frames.push(result.frame);
        session.last_frame_fingerprint = Some(Arc::new(result.fingerprint));
        recorded = true;

        if long_capture_stitch_worker_needed(session) {
            session.stitch_worker_active = true;
            should_spawn_worker = true;
        }
    } else {
        session.last_frame_fingerprint = Some(Arc::new(result.fingerprint));
        session.duplicate_count += 1;
    }

    let response = LongCaptureSessionSampleResponse {
        status,
        frame_count: session.frames.len(),
        duplicate_count: session.duplicate_count,
        recorded,
        axis: session
            .incremental_stitcher
            .as_ref()
            .and_then(|stitcher| stitcher.axis())
            .or(session.axis),
        direction: session.direction,
    };

    Ok((response, should_spawn_worker))
}
