// Owns drag-export naming, file writes, shell notifications, and commands.

#[cfg(target_os = "windows")]
fn prepare_drag_export_context(
    file_naming_context: Option<FileNamingContext>,
    source_path: Option<&Path>,
    width: u32,
    height: u32,
) -> FileNamingContext {
    let fallback_label = source_path
        .and_then(|path| path.file_stem())
        .and_then(|stem| stem.to_str())
        .unwrap_or("image");
    prepare_file_naming_context(
        file_naming_context,
        "sticker",
        fallback_label,
        width,
        height,
    )
}

#[cfg(target_os = "windows")]
fn notify_shell_path_changed(path: &Path) {
    use std::os::windows::ffi::OsStrExt;

    let notify_path = |event, target: &Path| {
        let wide_path: Vec<u16> = target
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            SHChangeNotify(
                event,
                SHCNF_PATHW | SHCNF_FLUSHNOWAIT,
                Some(wide_path.as_ptr() as *const core::ffi::c_void),
                None,
            );
        }
    };

    notify_path(SHCNE_UPDATEITEM, path);
    if let Some(parent) = path.parent() {
        notify_path(SHCNE_UPDATEDIR, parent);
    }
}

#[cfg(target_os = "windows")]
fn write_drag_export_bytes(
    app: &tauri::AppHandle,
    image_data: &[u8],
    file_naming_context: Option<FileNamingContext>,
    global_x: f64,
    global_y: f64,
) -> Result<String, String> {
    let target_dir = resolve_drag_export_target_dir(global_x, global_y)?;
    let (width, height) = image_dimensions_from_bytes(image_data)?;
    let context = prepare_drag_export_context(file_naming_context, None, width, height);
    let stem = render_user_file_stem(app, FileNamingPatternKind::DragExport, context)?;
    let (file, target_path) = create_unique_file(&target_dir, &stem, Some("png"))?;
    write_allocated_bytes(file, &target_path, image_data, "write drag export file")?;
    let path_string = target_path.to_string_lossy().to_string();
    append_runtime_log_line(&format!(
        "sticker_drag_export_saved :: file={}",
        cache_file_name_for_log(&target_path)
    ));
    notify_shell_path_changed(&target_path);
    Ok(path_string)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn save_sticker_drag_export(
    app: tauri::AppHandle,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
    global_x: f64,
    global_y: f64,
) -> Result<String, String> {
    let image_data = decode_base64_image_data(&base64_image)?;
    write_drag_export_bytes(&app, &image_data, file_naming_context, global_x, global_y)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn save_sticker_drag_export(
    app: tauri::AppHandle,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
    _global_x: f64,
    _global_y: f64,
) -> Result<String, String> {
    save_sticker_image(app, base64_image, file_naming_context)
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn save_sticker_drag_export_from_path(
    app: tauri::AppHandle,
    path: String,
    file_naming_context: Option<FileNamingContext>,
    global_x: f64,
    global_y: f64,
) -> Result<String, String> {
    let source_path = PathBuf::from(&path);
    if !source_path.is_file() {
        return Err(format!(
            "Sticker drag export source is not a file: {}",
            path
        ));
    }
    let target_dir = resolve_drag_export_target_dir(global_x, global_y)?;
    let (width, height) = image::image_dimensions(&source_path)
        .map_err(|e| format!("Failed to read drag export image dimensions: {}", e))?;
    let context =
        prepare_drag_export_context(file_naming_context, Some(&source_path), width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::DragExport, context)?;
    let extension = source_path
        .extension()
        .and_then(|extension| extension.to_str());
    let (mut target_file, target_path) = create_unique_file(&target_dir, &stem, extension)?;
    if let Err(error) = copy_file_with_limit(
        &source_path,
        &mut target_file,
        MAX_BASE64_IMAGE_ENCODED_BYTES as u64,
        "drag export file",
    ) {
        drop(target_file);
        let _ = fs::remove_file(&target_path);
        return Err(error);
    }
    let path_string = target_path.to_string_lossy().to_string();
    append_runtime_log_line(&format!(
        "sticker_drag_export_copied :: source={} target={}",
        cache_file_name_for_log(&source_path),
        cache_file_name_for_log(&target_path)
    ));
    notify_shell_path_changed(&target_path);
    Ok(path_string)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn save_sticker_drag_export_from_path(
    path: String,
    _file_naming_context: Option<FileNamingContext>,
    _global_x: f64,
    _global_y: f64,
) -> Result<String, String> {
    Ok(path)
}
