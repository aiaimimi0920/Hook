// Owns long-capture session start, sample, finish, and cancellation commands.

fn logical_rect_to_capture_bounds(
    rect: LongCaptureSessionRect,
) -> Result<(i32, i32, u32, u32), String> {
    let width = rect.w.round();
    let height = rect.h.round();
    if width < 1.0 || height < 1.0 {
        return Err("Long capture session rectangle must be at least 1x1".to_string());
    }

    Ok((
        rect.x.round() as i32,
        rect.y.round() as i32,
        width as u32,
        height as u32,
    ))
}

#[tauri::command]
fn start_long_capture_session(
    sessions: tauri::State<SharedLongCaptureSessions>,
    rect: LongCaptureSessionRect,
    axis: Option<long_capture::LongCaptureAxis>,
) -> Result<String, String> {
    let (_, _, width, height) = logical_rect_to_capture_bounds(rect)?;
    let max_dimension = width.max(height);
    let max_scan = max_dimension.saturating_sub(1).max(32);
    let min_overlap_px = ((max_dimension as f64) * 0.03).round().max(16.0) as u32;
    let session_id = uuid::Uuid::new_v4().to_string();
    let session = LongCaptureSessionState {
        rect,
        axis,
        direction: None,
        frames: Vec::new(),
        last_frame_fingerprint: None,
        pair_analyses: Vec::new(),
        incremental_stitcher: None,
        stitch_worker_active: false,
        stitch_error: None,
        duplicate_count: 0,
        max_scan,
        min_overlap_px,
        created_at: Instant::now(),
    };

    let mut guard = sessions
        .sessions
        .lock()
        .map_err(|_| "long capture session lock poisoned".to_string())?;
    guard.insert(session_id.clone(), session);
    append_runtime_log_line(&format!(
        "start_long_capture_session :: id={} x={} y={} w={} h={} axis={:?}",
        session_id, rect.x, rect.y, rect.w, rect.h, axis
    ));
    Ok(session_id)
}

#[tauri::command]
async fn sample_long_capture_session(
    sessions: tauri::State<'_, SharedLongCaptureSessions>,
    session_id: String,
) -> Result<LongCaptureSessionSampleResponse, String> {
    let started_at = Instant::now();
    let work = {
        let guard = sessions
            .sessions
            .lock()
            .map_err(|_| "long capture session lock poisoned".to_string())?;
        let session = guard
            .get(&session_id)
            .ok_or_else(|| format!("Long capture session not found: {session_id}"))?;
        LongCaptureSessionSampleWork {
            rect: session.rect,
            previous_fingerprint: session.last_frame_fingerprint.clone(),
            expected_frame_count: session.frames.len(),
            axis: session
                .incremental_stitcher
                .as_ref()
                .and_then(|stitcher| stitcher.axis())
                .or(session.axis),
            max_scan: session.max_scan,
            min_overlap_px: session.min_overlap_px,
        }
    };

    let result =
        tokio::task::spawn_blocking(move || capture_and_classify_long_capture_sample(work))
            .await
            .map_err(|error| error.to_string())??;

    let mut guard = sessions
        .sessions
        .lock()
        .map_err(|_| "long capture session lock poisoned".to_string())?;
    let session = guard
        .get_mut(&session_id)
        .ok_or_else(|| format!("Long capture session not found: {session_id}"))?;

    if session.frames.len() != result.expected_frame_count {
        return Err(format!(
            "Long capture session changed while sample was in flight: expected {} frames, found {}",
            result.expected_frame_count,
            session.frames.len()
        ));
    }

    let (response, should_spawn_worker) =
        record_long_capture_session_sample_result(session, result)?;
    drop(guard);

    if should_spawn_worker {
        spawn_long_capture_stitch_worker(sessions.inner().clone(), session_id.clone());
    }

    let elapsed_ms = started_at.elapsed().as_millis();
    if should_log_long_capture_sample(&response, elapsed_ms) {
        append_runtime_log_line(&format!(
            "sample_long_capture_session :: id={} frame_count={} duplicate_count={} recorded={} status={:?} elapsed_ms={}",
            session_id,
            response.frame_count,
            response.duplicate_count,
            response.recorded,
            response.status,
            elapsed_ms
        ));
    }
    Ok(response)
}

#[tauri::command]
async fn finish_long_capture_session(
    sessions: tauri::State<'_, SharedLongCaptureSessions>,
    session_id: String,
) -> Result<CaptureResponse, String> {
    let finish_started_at = Instant::now();
    let wait_started_at = Instant::now();
    wait_for_long_capture_stitch_worker(sessions.inner().clone(), &session_id).await?;
    let wait_ms = wait_started_at.elapsed().as_millis();

    let session = {
        let remove_started_at = Instant::now();
        let mut guard = sessions
            .sessions
            .lock()
            .map_err(|_| "long capture session lock poisoned".to_string())?;
        let session = guard
            .remove(&session_id)
            .ok_or_else(|| format!("Long capture session not found: {session_id}"))?;
        append_runtime_log_line(&format!(
            "finish_long_capture_session_remove :: id={} elapsed_ms={}",
            session_id,
            remove_started_at.elapsed().as_millis()
        ));
        session
    };

    append_runtime_log_line(&format!(
        "finish_long_capture_session :: id={} frame_count={} wait_ms={} elapsed_ms={}",
        session_id,
        session.frames.len(),
        wait_ms,
        session.created_at.elapsed().as_millis()
    ));

    if session.frames.is_empty() {
        return Err("Long capture session has no frames".to_string());
    }

    let blocking_session_id = session_id.clone();
    let response = tokio::task::spawn_blocking(move || -> Result<CaptureResponse, String> {
        let blocking_started_at = Instant::now();
        let LongCaptureSessionState {
            frames,
            pair_analyses,
            incremental_stitcher,
            axis,
            max_scan,
            min_overlap_px,
            ..
        } = session;
        let stitch_started_at = Instant::now();
        let stitched = if let Some(stitcher) = incremental_stitcher {
            let flatten_started_at = Instant::now();
            let frame_count = stitcher.frame_count();
            let merged_frames = stitcher.merged_frames();
            let skipped_frames = stitcher.skipped_frames();
            let stitcher_axis = stitcher.axis();
            let adjacent_fast_path_merges = stitcher.adjacent_fast_path_merges();
            let aggregate_signature_searches = stitcher.aggregate_signature_searches();
            let expensive_adjacent_pair_analyses = stitcher.expensive_adjacent_pair_analyses();
            let aggregate_segment_count = stitcher.aggregate_segment_count();
            let image = stitcher.into_image();
            append_runtime_log_line(&format!(
                "finish_long_capture_session_incremental :: frame_count={} merged_frames={} skipped_frames={} axis={:?} fast_path={} aggregate_searches={} expensive_pair_analyses={} segments={} flatten_ms={} width={} height={}",
                frame_count,
                merged_frames,
                skipped_frames,
                stitcher_axis,
                adjacent_fast_path_merges,
                aggregate_signature_searches,
                expensive_adjacent_pair_analyses,
                aggregate_segment_count,
                flatten_started_at.elapsed().as_millis(),
                image.width(),
                image.height()
            ));
            image
        } else if frames.len() == 1 {
            frames[0].clone()
        } else if pair_analyses.len() + 1 == frames.len() {
            long_capture::stitch_long_capture_frames_with_analyses(
                &frames,
                &pair_analyses,
            )
            .map_err(|error| error.to_string())?
        } else {
            long_capture::stitch_long_capture_frames(
                &frames,
                long_capture::LongCaptureStitchOptions {
                    axis,
                    direction: None,
                    max_scan: Some(max_scan),
                    min_overlap_px: Some(min_overlap_px),
                },
            )
            .map_err(|error| error.to_string())?
        };

        let stitch_ms = stitch_started_at.elapsed().as_millis();
        let encode_started_at = Instant::now();
        let response = encode_rgb_image_as_file_capture_response(stitched)?;
        append_runtime_log_line(&format!(
            "finish_long_capture_session_blocking :: id={} stitch_ms={} encode_ms={} total_ms={}",
            blocking_session_id,
            stitch_ms,
            encode_started_at.elapsed().as_millis(),
            blocking_started_at.elapsed().as_millis()
        ));
        Ok(response)
    })
    .await
    .map_err(|error| error.to_string())??;
    append_runtime_log_line(&format!(
        "finish_long_capture_session_total :: id={} wait_ms={} total_ms={}",
        session_id,
        wait_ms,
        finish_started_at.elapsed().as_millis()
    ));
    Ok(response)
}

#[tauri::command]
fn cancel_long_capture_session(
    sessions: tauri::State<SharedLongCaptureSessions>,
    session_id: String,
) -> Result<(), String> {
    let mut guard = sessions
        .sessions
        .lock()
        .map_err(|_| "long capture session lock poisoned".to_string())?;
    let removed = guard.remove(&session_id);
    append_runtime_log_line(&format!(
        "cancel_long_capture_session :: id={} existed={}",
        session_id,
        removed.is_some()
    ));
    Ok(())
}
