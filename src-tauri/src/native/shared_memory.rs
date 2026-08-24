// Owns bounded shared-memory reads and Art allocation release commands.

#[cfg(target_os = "windows")]
fn read_shm_winapi(name: &str, size: usize) -> Result<Vec<u8>, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    console_line!("Backend: Opening SHM via WinAPI: {}", name);

    // Convert string to wide string (UTF-16) + null terminator
    let wide_name: Vec<u16> = OsStr::new(name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        // 1. Open File Mapping
        let handle = OpenFileMappingW(
            FILE_MAP_READ.0, // Read access
            false,           // Inherit handle
            PCWSTR(wide_name.as_ptr()),
        )
        .map_err(|e| format!("OpenFileMappingW failed: {:?}", e))?;

        if handle.is_invalid() {
            return Err("Invalid handle returned from OpenFileMappingW".to_string());
        }

        // 2. Map View of File
        let ptr = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, size);

        if ptr.Value.is_null() {
            let _ = CloseHandle(handle);
            return Err("MapViewOfFile failed".to_string());
        }

        // 3. Copy Data
        let slice = std::slice::from_raw_parts(ptr.Value as *const u8, size);
        let data = slice.to_vec();

        // 4. Cleanup
        let _ = UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS { Value: ptr.Value });
        let _ = CloseHandle(handle);

        Ok(data)
    }
}

#[cfg(not(target_os = "windows"))]
fn read_shm_winapi(_name: &str, _size: usize) -> Result<Vec<u8>, String> {
    Err("Shared Memory (WinAPI) not supported on non-Windows OS".to_string())
}

#[tauri::command]
fn read_shared_memory(
    handle: String,
    size: usize,
    width: u32,
    height: u32,
) -> Result<String, String> {
    console_line!(
        "Backend: read_shared_memory called for '{}' with size {}, dims {}x{}",
        handle,
        size,
        width,
        height
    );

    // Validate dimensions and that `size` is consistent with the declared
    // RGBA buffer before mapping memory. A mismatched/oversized `size` would
    // otherwise drive an out-of-bounds slice read in `read_shm_winapi`.
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 {
        return Err("Invalid shared memory dimensions: width/height must be non-zero".to_string());
    }
    if pixels > MAX_IMAGE_PIXELS {
        return Err(format!(
            "Shared memory dimensions too large: {}x{} exceeds {} pixels",
            width, height, MAX_IMAGE_PIXELS
        ));
    }
    let expected = (pixels * 4) as usize;
    if size != expected {
        return Err(format!(
            "Shared memory size mismatch: got {} bytes, expected {} for {}x{} RGBA",
            size, expected, width, height
        ));
    }

    // Read raw RGBA bytes from shared memory
    let data = read_shm_winapi(&handle, size)?;

    console_line!("Backend: Read {} bytes from shared memory", data.len());

    // Convert RGBA raw bytes to PNG
    let img = image::RgbaImage::from_raw(width, height, data)
        .ok_or_else(|| "Failed to create image from raw RGBA data".to_string())?;

    let mut png_buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut png_buf, image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    // Encode as Base64 and return as data URL
    let b64 = base64::engine::general_purpose::STANDARD.encode(png_buf.into_inner());
    console_line!("Backend: Returning PNG base64 ({} chars)", b64.len());
    Ok(format!("data:image/png;base64,{}", b64))
}

#[tauri::command]
fn release_art_shared_memory(
    node_id: String,
    execution_request_id: String,
    generation: u64,
    handles: Vec<String>,
) {
    std::thread::spawn(move || {
        crate::loom_hook::release_hook_art_resources(
            &node_id,
            &execution_request_id,
            generation,
            &handles,
        );
    });
}
