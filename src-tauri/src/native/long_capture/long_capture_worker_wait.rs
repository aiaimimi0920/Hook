// Waits asynchronously for a long-capture stitch worker to become idle.

async fn wait_for_long_capture_stitch_worker(
    shared: SharedLongCaptureSessions,
    session_id: &str,
) -> Result<(), String> {
    loop {
        let should_spawn = prepare_long_capture_stitch_worker(&shared, session_id)?;
        if should_spawn {
            spawn_long_capture_stitch_worker(shared.clone(), session_id.to_string());
        }

        let is_active = {
            let guard = shared
                .sessions
                .lock()
                .map_err(|_| "long capture session lock poisoned".to_string())?;
            let session = guard
                .get(session_id)
                .ok_or_else(|| format!("Long capture session not found: {session_id}"))?;
            if let Some(error) = &session.stitch_error {
                return Err(error.clone());
            }
            session.stitch_worker_active
        };
        if !is_active {
            return Ok(());
        }

        tokio::time::sleep(Duration::from_millis(LONG_CAPTURE_FINISH_WAIT_SLEEP_MS)).await;
    }
}
