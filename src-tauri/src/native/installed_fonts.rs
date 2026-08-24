// Enumerates installed font families and caches the normalized result.

#[cfg(target_os = "windows")]
fn wide_face_name_to_string(face_name: &[u16]) -> String {
    let end = face_name
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(face_name.len());
    String::from_utf16_lossy(&face_name[..end])
        .trim()
        .to_string()
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn collect_installed_font_family_callback(
    logfont: *const windows::Win32::Graphics::Gdi::LOGFONTW,
    _metric: *const windows::Win32::Graphics::Gdi::TEXTMETRICW,
    _font_type: u32,
    lparam: LPARAM,
) -> i32 {
    if logfont.is_null() || lparam.0 == 0 {
        return 1;
    }

    let families = unsafe { &mut *(lparam.0 as *mut BTreeSet<String>) };
    let family_name = wide_face_name_to_string(unsafe { &(*logfont).lfFaceName });
    if !family_name.is_empty() && !family_name.starts_with('@') {
        families.insert(family_name);
    }

    1
}

#[cfg(target_os = "windows")]
fn collect_installed_font_families_windows() -> Result<Vec<String>, String> {
    use windows::Win32::Graphics::Gdi::{
        EnumFontFamiliesExW, GetDC, ReleaseDC, DEFAULT_CHARSET, LOGFONTW,
    };

    let screen_dc = unsafe { GetDC(None) };
    if screen_dc.is_invalid() {
        return Err("screen device context unavailable for font enumeration".to_string());
    }

    let mut search_filter = LOGFONTW::default();
    search_filter.lfCharSet = DEFAULT_CHARSET;

    let mut families = BTreeSet::new();
    let _ = unsafe {
        EnumFontFamiliesExW(
            screen_dc,
            &search_filter,
            Some(collect_installed_font_family_callback),
            LPARAM((&mut families as *mut BTreeSet<String>) as isize),
            0,
        )
    };
    unsafe {
        ReleaseDC(None, screen_dc);
    }

    Ok(families.into_iter().collect())
}

fn installed_font_families() -> Result<&'static Vec<String>, String> {
    if let Some(fonts) = INSTALLED_FONT_FAMILIES.get() {
        return Ok(fonts);
    }

    #[cfg(target_os = "windows")]
    let fonts = collect_installed_font_families_windows()?;

    #[cfg(not(target_os = "windows"))]
    let fonts = Vec::new();

    let _ = INSTALLED_FONT_FAMILIES.set(fonts);
    Ok(INSTALLED_FONT_FAMILIES
        .get()
        .expect("installed fonts cache must be initialized before read"))
}

#[tauri::command]
fn get_installed_fonts() -> Result<Vec<String>, String> {
    installed_font_families().map(|fonts| fonts.clone())
}
