// Owns sticker image save and save-as commands with configured file naming.

#[tauri::command]
fn save_sticker_image(
    app: tauri::AppHandle,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    let image_data = decode_base64_image_data(&base64_image)?;
    let (width, height) = image_dimensions_from_bytes(&image_data)?;

    // 1. Resolve a user-writable destination. Writing next to the executable
    //    fails when Hook is installed under Program Files (read-only) and is
    //    poor practice; persist user data under the app data dir instead.
    let app_dir = effective_app_data_dir(&app)?;
    let saved_dir = app_dir.join("saved");
    fs::create_dir_all(&saved_dir).map_err(|e| format!("Failed to create save dir: {}", e))?;

    let context =
        prepare_file_naming_context(file_naming_context, "sticker", "image", width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::StickerSave, context)?;
    let (file, file_path) = create_unique_file(&saved_dir, &stem, Some("png"))?;
    write_allocated_bytes(file, &file_path, &image_data, "write saved sticker")?;

    console_line!("Saved sticker to: {:?}", file_path);
    Ok(file_path.to_string_lossy().to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn save_sticker_image_as(
    app: tauri::AppHandle,
    base64_image: String,
    dialog_center_x: f64,
    dialog_center_y: f64,
    file_naming_context: Option<FileNamingContext>,
) -> Result<Option<String>, String> {
    let image_data = decode_base64_image_data(&base64_image)?;
    let (width, height) = image_dimensions_from_bytes(&image_data)?;
    let context =
        prepare_file_naming_context(file_naming_context, "sticker", "image", width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::StickerSave, context)?;
    let default_filename = format!("{stem}.png");
    let Some(file_path) =
        select_sticker_save_path(&app, dialog_center_x, dialog_center_y, &default_filename)?
    else {
        return Ok(None);
    };

    let mut file = File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&image_data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    let path_string = file_path.to_string_lossy().to_string();
    console_line!("Saved sticker via save-as dialog to: {}", path_string);
    Ok(Some(path_string))
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn save_sticker_image_as(
    app: tauri::AppHandle,
    base64_image: String,
    _dialog_center_x: f64,
    _dialog_center_y: f64,
    file_naming_context: Option<FileNamingContext>,
) -> Result<Option<String>, String> {
    save_sticker_image(app, base64_image, file_naming_context).map(Some)
}
