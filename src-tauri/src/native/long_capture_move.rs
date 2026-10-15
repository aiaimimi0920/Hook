// Move only the sampling rectangle; preserve aggregate content and reject in-flight old positions.
fn move_long_capture_rect(
    session: &mut LongCaptureSessionState,
    dx: f64,
    dy: f64,
) -> Result<LongCaptureSessionRect, String> {
    if session
        .frame_rects
        .last()
        .is_some_and(|rect| rect.x != session.rect.x || rect.y != session.rect.y)
    {
        return Err("Wait for the moved viewfinder to be sampled before moving again".into());
    }
    if let Some(error) = &session.stitch_error {
        return Err(error.clone());
    }
    if !dx.is_finite()
        || !dy.is_finite()
        || dx.abs() > 64.0
        || dy.abs() > 64.0
        || (dx != 0.0 && dy != 0.0)
    {
        return Err("Invalid long capture rectangle movement".into());
    }
    let mut rect = session.rect;
    rect.x += dx;
    rect.y += dy;
    if !rect.x.is_finite() || !rect.y.is_finite() {
        return Err("Invalid capture position".into());
    }
    logical_rect_to_capture_bounds(rect)?;
    session.rect_revision = session
        .rect_revision
        .checked_add(1)
        .ok_or("Capture revision overflow")?;
    session.rect = rect;
    Ok(rect)
}

#[tauri::command]
fn move_long_capture_session(
    sessions: tauri::State<SharedLongCaptureSessions>,
    session_id: String,
    dx: f64,
    dy: f64,
) -> Result<LongCaptureSessionRect, String> {
    let mut guard = sessions
        .sessions
        .lock()
        .map_err(|_| "long capture session lock poisoned")?;
    let session = guard
        .get_mut(&session_id)
        .ok_or("Long capture session not found")?;
    move_long_capture_rect(session, dx, dy)
}
