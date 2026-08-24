// Owns native image dialogs plus clipboard image import commands.

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
struct SaveDialogPlacement {
    target_x: i32,
    target_y: i32,
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
unsafe fn move_save_dialog_to_target(dialog_hwnd: HWND, placement: SaveDialogPlacement) {
    let parent_hwnd = GetParent(dialog_hwnd).unwrap_or(dialog_hwnd);
    let mut rect = RECT::default();
    if GetWindowRect(parent_hwnd, &mut rect).is_err() {
        return;
    }

    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    let x = placement.target_x - width / 2;
    let y = placement.target_y - height / 2;
    let _ = SetWindowPos(
        parent_hwnd,
        None,
        x,
        y,
        0,
        0,
        SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
    );
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn save_dialog_hook(
    dialog_hwnd: HWND,
    message: u32,
    _wparam: WPARAM,
    lparam: LPARAM,
) -> usize {
    if message != WM_NOTIFY {
        return 0;
    }

    let notification = lparam.0 as *const windows::Win32::UI::Controls::Dialogs::OFNOTIFYW;
    if notification.is_null() || (*notification).hdr.code != CDN_INITDONE {
        return 0;
    }

    let open_file_name = (*notification).lpOFN;
    if open_file_name.is_null() {
        return 0;
    }

    let placement = (*open_file_name).lCustData.0 as *const SaveDialogPlacement;
    if placement.is_null() {
        return 0;
    }

    move_save_dialog_to_target(dialog_hwnd, *placement);
    0
}

#[cfg(target_os = "windows")]
fn resolve_save_dialog_placement(
    app: &tauri::AppHandle,
    dialog_center_x: f64,
    dialog_center_y: f64,
) -> Result<(HWND, SaveDialogPlacement), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok((
            HWND(std::ptr::null_mut()),
            SaveDialogPlacement {
                target_x: dialog_center_x.round() as i32,
                target_y: dialog_center_y.round() as i32,
            },
        ));
    };

    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let origin = window
        .outer_position()
        .unwrap_or(PhysicalPosition { x: 0, y: 0 });
    let owner = window.hwnd().map_err(|e| e.to_string())?;
    let owner = HWND(owner.0);

    Ok((
        owner,
        SaveDialogPlacement {
            target_x: origin.x + (dialog_center_x * scale_factor).round() as i32,
            target_y: origin.y + (dialog_center_y * scale_factor).round() as i32,
        },
    ))
}

#[cfg(target_os = "windows")]
fn select_sticker_save_path(
    app: &tauri::AppHandle,
    dialog_center_x: f64,
    dialog_center_y: f64,
    default_filename: &str,
) -> Result<Option<PathBuf>, String> {
    let window = app.get_webview_window("main");
    let (owner, placement) = resolve_save_dialog_placement(app, dialog_center_x, dialog_center_y)?;

    let default_filename_wide = wide_null(default_filename);
    let filter_wide: Vec<u16> = "PNG Image (*.png)\0*.png\0All Files (*.*)\0*.*\0\0"
        .encode_utf16()
        .collect();
    let title_wide = wide_null("另存为贴图图片");
    let default_extension_wide = wide_null("png");
    let mut file_buffer = vec![0u16; 32768];
    let copy_len = default_filename_wide.len().min(file_buffer.len());
    file_buffer[..copy_len].copy_from_slice(&default_filename_wide[..copy_len]);

    let mut dialog = OPENFILENAMEW::default();
    dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    dialog.hwndOwner = owner;
    dialog.lpstrFilter = PCWSTR(filter_wide.as_ptr());
    dialog.lpstrFile = PWSTR(file_buffer.as_mut_ptr());
    dialog.nMaxFile = file_buffer.len() as u32;
    dialog.lpstrTitle = PCWSTR(title_wide.as_ptr());
    dialog.Flags =
        OFN_EXPLORER | OFN_ENABLEHOOK | OFN_NOCHANGEDIR | OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST;
    dialog.lpstrDefExt = PCWSTR(default_extension_wide.as_ptr());
    dialog.lCustData = LPARAM((&placement as *const SaveDialogPlacement) as isize);
    dialog.lpfnHook = Some(save_dialog_hook);

    run_with_native_file_dialog_input_passthrough(window.as_ref(), || {
        let accepted = unsafe { GetSaveFileNameW(&mut dialog).as_bool() };
        if !accepted {
            let error = unsafe { CommDlgExtendedError() };
            if error.0 == 0 {
                return Ok(None);
            }
            return Err(format!("Save dialog failed: {}", error.0));
        }

        let end = file_buffer
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(file_buffer.len());
        if end == 0 {
            return Ok(None);
        }

        let selected = String::from_utf16_lossy(&file_buffer[..end]);
        Ok(Some(PathBuf::from(selected)))
    })
}

#[cfg(target_os = "windows")]
fn select_image_open_path() -> Result<Option<PathBuf>, String> {
    let filter_wide: Vec<u16> =
        "图片文件 (*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.webp)\0*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.webp\0所有文件 (*.*)\0*.*\0\0"
            .encode_utf16()
            .collect();
    let title_wide = wide_null("打开图片进行编辑");
    let mut file_buffer = vec![0u16; 32768];

    let mut dialog = OPENFILENAMEW::default();
    dialog.lStructSize = std::mem::size_of::<OPENFILENAMEW>() as u32;
    dialog.lpstrFilter = PCWSTR(filter_wide.as_ptr());
    dialog.lpstrFile = PWSTR(file_buffer.as_mut_ptr());
    dialog.nMaxFile = file_buffer.len() as u32;
    dialog.lpstrTitle = PCWSTR(title_wide.as_ptr());
    dialog.Flags = OFN_EXPLORER | OFN_NOCHANGEDIR | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST;

    let accepted = unsafe { GetOpenFileNameW(&mut dialog).as_bool() };
    if !accepted {
        let error = unsafe { CommDlgExtendedError() };
        if error.0 == 0 {
            return Ok(None);
        }
        return Err(format!("Open dialog failed: {}", error.0));
    }

    let end = file_buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(file_buffer.len());
    if end == 0 {
        return Ok(None);
    }

    let selected = String::from_utf16_lossy(&file_buffer[..end]);
    Ok(Some(PathBuf::from(selected)))
}

/// Open a native file picker and return the chosen image decoded as a data URL.
/// The original file is read only (never modified), matching the "edit a copy"
/// behavior of capcap's Finder edit entry. Returns Ok(None) if the user cancels.
#[cfg(target_os = "windows")]
#[tauri::command]
fn open_image_for_edit() -> Result<Option<String>, String> {
    let Some(path) = select_image_open_path()? else {
        return Ok(None);
    };
    read_image_from_path(path.to_string_lossy().to_string()).map(Some)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn open_image_for_edit() -> Result<Option<String>, String> {
    Err("Open image dialog is only supported on Windows".to_string())
}

/// Try to read an image from the clipboard. Returns the image as a data URL if
/// available, or the first file path from the clipboard if the clipboard contains
/// a file list (CF_HDROP). Returns Ok(None) if no image or file is found.
#[cfg(target_os = "windows")]
#[tauri::command]
fn read_clipboard_image() -> Result<Option<String>, String> {
    use arboard::Clipboard;
    use clipboard_win::{formats, get_clipboard};

    // Try image first (arboard handles PNG/BMP/etc.)
    if let Ok(mut clipboard) = Clipboard::new() {
        if let Ok(image_data) = clipboard.get_image() {
            let (width, height) = validate_rgba_image_layout(
                image_data.width,
                image_data.height,
                image_data.bytes.len(),
            )?;
            let rgba = image_data.bytes.into_owned();

            let img = image::RgbaImage::from_raw(width, height, rgba)
                .ok_or_else(|| "Failed to construct image from clipboard RGBA data".to_string())?;

            let mut buf = Vec::new();
            img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
                .map_err(|e| format!("PNG encode failed: {}", e))?;

            let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
            return Ok(Some(format!("data:image/png;base64,{}", encoded)));
        }
    }

    // Try file list (CF_HDROP) via clipboard-win
    if let Ok(file_paths) = get_clipboard::<Vec<String>, _>(formats::FileList) {
        if let Some(first_path) = file_paths.into_iter().next() {
            let lower = first_path.to_lowercase();
            if lower.ends_with(".png")
                || lower.ends_with(".jpg")
                || lower.ends_with(".jpeg")
                || lower.ends_with(".bmp")
            {
                return read_image_from_path(first_path).map(Some);
            }
        }
    }

    Ok(None)
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn read_clipboard_image() -> Result<Option<String>, String> {
    Err("Clipboard image reading is only supported on Windows".to_string())
}
