// Owns image/file clipboard commands and platform-specific clipboard publication.

#[cfg(target_os = "windows")]
#[tauri::command]
fn copy_node_image_to_clipboard(
    app: tauri::AppHandle,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    use clipboard_win::{formats, Clipboard, Setter};

    let image_data = decode_base64_image_data(&base64_image)?;
    let (width, height) = image_dimensions_from_bytes(&image_data)?;
    let cache_dir = ensure_clipboard_cache_dir()?;
    let context = prepare_file_naming_context(file_naming_context, "art", "art", width, height);
    let stem = render_user_file_stem(&app, FileNamingPatternKind::ClipboardFile, context)?;
    let (file, file_path) = create_unique_file(&cache_dir, &stem, Some("png"))?;
    write_allocated_bytes(file, &file_path, &image_data, "write Art clipboard file")?;

    let path_string = file_path.to_string_lossy().to_string();

    // 5. Write to Clipboard (CF_HDROP)
    let _clip = Clipboard::new_attempts(10).map_err(|e| format!("Clipboard open failed: {}", e))?;

    // formats::FileList expect a Vec<String>
    let paths = vec![path_string.clone()];

    formats::FileList
        .write_clipboard(&paths)
        .map_err(|e| format!("Clipboard write file list failed: {}", e))?;

    console_line!(
        "Copied file to clipboard cache: {}",
        cache_file_name_for_log(&file_path)
    );
    Ok(path_string)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn copy_node_image_to_clipboard(
    _base64_image: String,
    _file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    Err("File Copy not supported on non-Windows OS".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn copy_sticker_image_to_smart_clipboard(
    app: tauri::AppHandle,
    base64_image: String,
    file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    // Publish both clipboard representations from one command:
    // browsers/rich editors read the image formats, Explorer reads CF_HDROP.
    let image_data = decode_base64_image_data(&base64_image)?;

    let img =
        image::load_from_memory(&image_data).map_err(|e| format!("Image load failed: {}", e))?;

    let cache_dir = ensure_clipboard_cache_dir()?;

    let context = prepare_file_naming_context(
        file_naming_context,
        "sticker",
        "image",
        img.width(),
        img.height(),
    );
    let stem = render_user_file_stem(&app, FileNamingPatternKind::ClipboardFile, context)?;
    let (file, file_path) = create_unique_file(&cache_dir, &stem, Some("png"))?;
    write_allocated_bytes(
        file,
        &file_path,
        &image_data,
        "write sticker clipboard file",
    )?;

    let rgba = img.to_rgba8();
    let width = rgba.width() as usize;
    let height = rgba.height() as usize;
    let raw_bytes = rgba.into_raw();

    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard init failed: {}", e))?;
    let clipboard_image = arboard::ImageData {
        width,
        height,
        bytes: std::borrow::Cow::Owned(raw_bytes),
    };

    clipboard
        .set()
        .image(clipboard_image)
        .map_err(|e| format!("Clipboard image write failed: {}", e))?;
    clipboard
        .set()
        .file_list(&[file_path.as_path()])
        .map_err(|e| format!("Clipboard file-list write failed: {}", e))?;

    let path_string = file_path.to_string_lossy().to_string();
    console_line!(
        "Copied smart image/file clipboard cache payload: {}",
        cache_file_name_for_log(&file_path)
    );
    Ok(path_string)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn copy_sticker_image_to_smart_clipboard(
    base64_image: String,
    _file_naming_context: Option<FileNamingContext>,
) -> Result<String, String> {
    copy_to_clipboard(base64_image)?;
    Ok("image clipboard only; file-list paste is Windows-only".to_string())
}

#[tauri::command]
fn copy_to_clipboard(base64_image: String) -> Result<(), String> {
    let image_bytes = decode_base64_image_data(&base64_image)?;

    // 3. Load Image to identify format/dimensions
    let img =
        image::load_from_memory(&image_bytes).map_err(|e| format!("Image load failed: {}", e))?;

    let rgba = img.to_rgba8();
    let width = rgba.width() as usize;
    let height = rgba.height() as usize;
    let raw_bytes = rgba.into_raw();

    // 4. Write to Clipboard
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("Clipboard init failed: {}", e))?;

    let image_data = arboard::ImageData {
        width,
        height,
        bytes: std::borrow::Cow::Owned(raw_bytes),
    };

    clipboard
        .set_image(image_data)
        .map_err(|e| format!("Clipboard write failed: {}", e))?;

    console_line!("Image copied to system clipboard");
    Ok(())
}
