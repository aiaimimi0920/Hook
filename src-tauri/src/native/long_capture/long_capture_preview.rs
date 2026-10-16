// Preview is in-memory only. Never finish a session or write full captures to poll it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LongCapturePreviewResponse {
    revision: usize,
    width: u32,
    height: u32,
    data_url: String,
}

#[tauri::command]
async fn preview_long_capture_session(
    sessions: tauri::State<'_, SharedLongCaptureSessions>,
    session_id: String,
    revision: Option<usize>,
) -> Result<Option<LongCapturePreviewResponse>, String> {
    let shared = sessions.inner().clone();
    tokio::task::spawn_blocking(move || {
        let (image, width, height, current_revision) = {
            let guard = shared
                .sessions
                .lock()
                .map_err(|_| "long capture session lock poisoned")?;
            let session = guard
                .get(&session_id)
                .ok_or("Long capture session not found")?;
            if let Some(error) = &session.stitch_error {
                return Err(error.clone());
            }
            // The worker temporarily owns the aggregate. Retry rather than waiting on it.
            let Some(stitcher) = session.incremental_stitcher.as_ref() else {
                return Ok(None);
            };
            let current = stitcher.merged_frames();
            if revision == Some(current) {
                return Ok(None);
            }
            let (image, width, height) = stitcher.preview_rgba();
            (image, width, height, current)
        };
        // Encoding is outside the session lock and bounded to 320 x 640 pixels.
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgba8(image)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .map_err(|error| error.to_string())?;
        Ok(Some(LongCapturePreviewResponse {
            revision: current_revision,
            width,
            height,
            data_url: format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ),
        }))
    })
    .await
    .map_err(|error| error.to_string())?
}
