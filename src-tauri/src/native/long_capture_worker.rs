// Owns the incremental long-capture stitch worker lifecycle and pacing.

const LONG_CAPTURE_SAMPLE_LOG_EVERY_EVENTS: usize = 20;
const LONG_CAPTURE_SAMPLE_SLOW_MS: u128 = 40;
const LONG_CAPTURE_STITCH_WORKER_IDLE_YIELD_MS: u64 = 1;
const LONG_CAPTURE_STITCH_WORKER_BURST_FRAME_LIMIT: usize = 8;
const LONG_CAPTURE_STITCH_WORKER_LOG_EVERY_FRAMES: usize = 20;
const LONG_CAPTURE_STITCH_WORKER_SLOW_FRAME_MS: u128 = 40;
const LONG_CAPTURE_FINISH_WAIT_SLEEP_MS: u64 = 5;

fn should_log_long_capture_sample(
    response: &LongCaptureSessionSampleResponse,
    elapsed_ms: u128,
) -> bool {
    elapsed_ms >= LONG_CAPTURE_SAMPLE_SLOW_MS
        || if response.recorded {
            response.frame_count <= 2
                || response.frame_count % LONG_CAPTURE_SAMPLE_LOG_EVERY_EVENTS == 0
        } else {
            response.duplicate_count <= 2
                || response.duplicate_count % LONG_CAPTURE_SAMPLE_LOG_EVERY_EVENTS == 0
        }
}

fn should_rest_long_capture_stitch_worker(
    remaining_frames: usize,
    frames_since_rest: usize,
    elapsed_ms: u128,
) -> bool {
    remaining_frames == 0
        || frames_since_rest >= LONG_CAPTURE_STITCH_WORKER_BURST_FRAME_LIMIT
        || elapsed_ms >= LONG_CAPTURE_STITCH_WORKER_SLOW_FRAME_MS
}

fn lower_long_capture_worker_thread_priority() {
    #[cfg(target_os = "windows")]
    unsafe {
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

fn prepare_long_capture_stitch_worker(
    shared: &SharedLongCaptureSessions,
    session_id: &str,
) -> Result<bool, String> {
    let mut guard = shared
        .sessions
        .lock()
        .map_err(|_| "long capture session lock poisoned".to_string())?;
    let session = guard
        .get_mut(session_id)
        .ok_or_else(|| format!("Long capture session not found: {session_id}"))?;
    if let Some(error) = &session.stitch_error {
        return Err(error.clone());
    }
    if long_capture_stitch_worker_needed(session) {
        session.stitch_worker_active = true;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn spawn_long_capture_stitch_worker(shared: SharedLongCaptureSessions, session_id: String) {
    tokio::spawn(async move {
        let shared_for_worker = shared.clone();
        let session_id_for_worker = session_id.clone();
        if let Err(error) = tokio::task::spawn_blocking(move || {
            run_long_capture_stitch_worker(shared_for_worker, session_id_for_worker)
        })
        .await
        {
            append_runtime_log_line(&format!(
                "long_capture stitch_worker_join_failed :: id={} error={}",
                session_id, error
            ));
            if let Ok(mut guard) = shared.sessions.lock() {
                if let Some(session) = guard.get_mut(&session_id) {
                    session.stitch_worker_active = false;
                    session.stitch_error = Some(error.to_string());
                }
            }
        }
    });
}

fn run_long_capture_stitch_worker(shared: SharedLongCaptureSessions, session_id: String) {
    lower_long_capture_worker_thread_priority();
    let mut frames_since_rest = 0usize;

    loop {
        let (mut stitcher, frame, frame_index) = {
            let mut guard = match shared.sessions.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            let Some(session) = guard.get_mut(&session_id) else {
                return;
            };
            if session.stitch_error.is_some() {
                session.stitch_worker_active = false;
                return;
            }
            let Some(stitcher) = session.incremental_stitcher.take() else {
                session.stitch_worker_active = false;
                return;
            };
            let next_index = stitcher.frame_count();
            if next_index >= session.frames.len() {
                session.incremental_stitcher = Some(stitcher);
                session.stitch_worker_active = false;
                return;
            }
            let frame =
                std::mem::replace(&mut session.frames[next_index], image::RgbImage::new(0, 0));
            if frame.width() == 0 || frame.height() == 0 {
                session.incremental_stitcher = Some(stitcher);
                session.stitch_worker_active = false;
                append_runtime_log_line(&format!(
                    "long_capture stitch_worker_empty_frame :: id={} frame_index={}",
                    session_id, next_index
                ));
                return;
            }
            (stitcher, frame, next_index)
        };

        let started_at = Instant::now();
        let push_result = stitcher
            .push_frame_owned(frame)
            .map_err(|error| error.to_string());
        let elapsed_ms = started_at.elapsed().as_millis();

        let mut guard = match shared.sessions.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let Some(session) = guard.get_mut(&session_id) else {
            return;
        };
        let remaining_frames;
        match push_result {
            Ok(merged) => {
                session.axis = stitcher.axis().or(session.axis);
                remaining_frames = session.frames.len().saturating_sub(stitcher.frame_count());
                let fast_path_merges = stitcher.adjacent_fast_path_merges();
                let aggregate_searches = stitcher.aggregate_signature_searches();
                let aggregate_segments = stitcher.aggregate_segment_count();
                let expensive_adjacent_pair_analyses = stitcher.expensive_adjacent_pair_analyses();
                let should_log_frame = frame_index <= 2
                    || frame_index % LONG_CAPTURE_STITCH_WORKER_LOG_EVERY_FRAMES == 0
                    || elapsed_ms >= LONG_CAPTURE_STITCH_WORKER_SLOW_FRAME_MS
                    || remaining_frames == 0;
                session.incremental_stitcher = Some(stitcher);
                if should_log_frame {
                    append_runtime_log_line(&format!(
                        "long_capture stitch_worker_frame :: id={} frame_index={} merged={} remaining={} elapsed_ms={} fast_path={} aggregate_searches={} expensive_pair_analyses={} segments={}",
                        session_id,
                        frame_index,
                        merged,
                        remaining_frames,
                        elapsed_ms,
                        fast_path_merges,
                        aggregate_searches,
                        expensive_adjacent_pair_analyses,
                        aggregate_segments
                    ));
                }
            }
            Err(error) => {
                session.incremental_stitcher = Some(stitcher);
                session.stitch_error = Some(error.clone());
                session.stitch_worker_active = false;
                append_runtime_log_line(&format!(
                    "long_capture stitch_worker_failed :: id={} frame_index={} error={}",
                    session_id, frame_index, error
                ));
                return;
            }
        }
        drop(guard);

        frames_since_rest += 1;
        std::thread::yield_now();
        if should_rest_long_capture_stitch_worker(remaining_frames, frames_since_rest, elapsed_ms) {
            frames_since_rest = 0;
            std::thread::sleep(Duration::from_millis(
                LONG_CAPTURE_STITCH_WORKER_IDLE_YIELD_MS,
            ));
        }
    }
}

