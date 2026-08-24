// Owns native sticker file drag staging, UI-thread dispatch, and platform stubs.

#[cfg(target_os = "windows")]
fn start_native_file_drag_on_ui_thread(
    window: tauri::WebviewWindow,
    file_path: PathBuf,
    hit_map: SharedHitMap,
) -> Result<(), String> {
    reset_overlay_pointer_session();
    OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(false, Ordering::SeqCst);
    NATIVE_FILE_DRAG_ACTIVE.store(true, Ordering::SeqCst);
    hide_overlay_input_shield_window();
    let _ = window.set_ignore_cursor_events(true);
    set_overlay_transparent_style(&window, true);
    OVERLAY_CLICK_THROUGH_ACTIVE.store(true, Ordering::SeqCst);
    apply_overlay_no_activate(&window);
    append_runtime_log_line("native_drag_overlay_clickthrough :: true");
    append_runtime_log_line(&format!(
        "native_drag_start :: path={}",
        cache_file_name_for_log(&file_path)
    ));
    let drag_outcome = Arc::new(std::sync::Mutex::new(None));
    let drag_outcome_slot = Arc::clone(&drag_outcome);
    let drag_result = drag::start_drag(
        &window,
        drag::DragItem::Files(vec![file_path.clone()]),
        drag::Image::File(file_path),
        move |outcome| {
            if let Ok(mut guard) = drag_outcome_slot.lock() {
                *guard = Some(outcome);
            }
        },
        drag::Options {
            mode: drag::DragMode::Copy,
            ..Default::default()
        },
    )
    .map_err(|error| format!("Failed to start native drag: {}", error));
    NATIVE_FILE_DRAG_ACTIVE.store(false, Ordering::SeqCst);
    refresh_overlay_interactivity_for_current_cursor(&window, &hit_map);
    sync_overlay_input_shield_from_runtime_state(&window);
    append_runtime_log_line("native_drag_overlay_restored");
    drag_result?;
    if let Ok(guard) = drag_outcome.lock() {
        if let Some(drag_outcome) = *guard {
            append_runtime_log_line(&format!(
                "native_drag_result :: result={:?} effect={} hresult={} cursor_x={} cursor_y={}",
                drag_outcome.result,
                drag_outcome.performed_effect.unwrap_or(0),
                drag_outcome.platform_status.unwrap_or(0),
                drag_outcome.cursor_position.x,
                drag_outcome.cursor_position.y
            ));
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn start_native_file_drag(
    window: tauri::WebviewWindow,
    file_path: PathBuf,
    hit_map: &SharedHitMap,
) -> Result<(), String> {
    if is_main_ui_thread() {
        return start_native_file_drag_on_ui_thread(window, file_path, hit_map.clone());
    }

    append_runtime_log_line(&format!(
        "native_drag_main_thread_dispatch :: current={:?} main={:?}",
        std::thread::current().id(),
        MAIN_UI_THREAD_ID.get()
    ));

    let (drag_completion_sender, drag_completion_receiver) =
        mpsc::sync_channel::<Result<(), String>>(1);
    let window_for_main = window.clone();
    let file_path_for_main = file_path.clone();
    let hit_map_for_main = hit_map.clone();

    window
        .run_on_main_thread(move || {
            let result = start_native_file_drag_on_ui_thread(
                window_for_main,
                file_path_for_main,
                hit_map_for_main,
            );
            let _ = drag_completion_sender.send(result);
        })
        .map_err(|error| format!("Failed to dispatch native drag to main thread: {}", error))?;

    drag_completion_receiver
        .recv()
        .map_err(|_| "Main-thread native drag completion channel closed".to_string())?
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn begin_sticker_native_file_drag(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    hit_map: tauri::State<'_, SharedHitMap>,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    let image_data = decode_base64_image_data(&base64_image)?;
    let (width, height) = image_dimensions_from_bytes(&image_data)?;
    let cache_dir = ensure_clipboard_cache_dir()?;
    let context = prepare_drag_export_context(file_naming_context, None, width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::DragExport, context)?;
    let (file, file_path) = create_unique_file(&cache_dir, &stem, Some("png"))?;
    write_allocated_bytes(file, &file_path, &image_data, "write native drag file")?;

    let staged_drag_file = stage_drag_out_file_copy(&file_path, Some(&stem))?;
    let drag_result = start_native_file_drag(window, staged_drag_file.clone(), hit_map.inner());
    cleanup_staged_drag_file(&staged_drag_file);
    drag_result?;
    Ok(file_path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn begin_sticker_native_file_drag_from_path(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    hit_map: tauri::State<'_, SharedHitMap>,
    path: String,
    file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    let file_path = PathBuf::from(path.clone());
    let metadata =
        fs::metadata(&file_path).map_err(|e| format!("Failed to stat drag source file: {}", e))?;
    if !metadata.is_file() {
        return Err("Drag source path is not a regular file".to_string());
    }
    // Restrict direct path drag-out to files Hook itself staged in the clipboard
    // cache. The frontend falls back to a freshly rendered cache drag for any
    // external file path instead of widening this command to arbitrary disk files.
    if !path_is_within(&file_path, &clipboard_cache_dir()) {
        return Err("Drag source must be inside Hook's clipboard cache".to_string());
    }
    let (width, height) = image::image_dimensions(&file_path)
        .map_err(|e| format!("Failed to read native drag image dimensions: {}", e))?;
    let context = prepare_drag_export_context(file_naming_context, Some(&file_path), width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::DragExport, context)?;
    let staged_drag_file = stage_drag_out_file_copy(&file_path, Some(&stem))?;
    let drag_result = start_native_file_drag(window, staged_drag_file.clone(), hit_map.inner());
    cleanup_staged_drag_file(&staged_drag_file);
    drag_result?;
    Ok(path)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn begin_sticker_native_file_drag(
    _window: tauri::WebviewWindow,
    _hit_map: tauri::State<'_, SharedHitMap>,
    _base64_image: String,
    _file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    Err("Native sticker file drag is only supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn begin_sticker_native_file_drag_from_path(
    _window: tauri::WebviewWindow,
    _hit_map: tauri::State<'_, SharedHitMap>,
    _path: String,
    _file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    Err("Native sticker file drag from path is only supported on Windows".to_string())
}
