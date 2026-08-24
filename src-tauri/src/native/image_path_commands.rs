// Reads local images and downloads remote image-search assets into Hook's cache.

fn mime_from_image_format(format: image::ImageFormat) -> Option<&'static str> {
    match format {
        image::ImageFormat::Png => Some("image/png"),
        image::ImageFormat::Jpeg => Some("image/jpeg"),
        image::ImageFormat::WebP => Some("image/webp"),
        image::ImageFormat::Bmp => Some("image/bmp"),
        image::ImageFormat::Gif => Some("image/gif"),
        _ => None,
    }
}

fn mime_from_image_path(path: &Path, bytes: &[u8]) -> &'static str {
    if let Some(mime) = image::guess_format(bytes)
        .ok()
        .and_then(mime_from_image_format)
    {
        return mime;
    }

    if let Some(mime) = image::ImageFormat::from_path(path)
        .ok()
        .and_then(mime_from_image_format)
    {
        return mime;
    }

    let lower = path.to_string_lossy().to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".bmp") {
        "image/bmp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else {
        "image/png"
    }
}

#[tauri::command]
fn read_image_from_path(path: String) -> Result<String, String> {
    console_line!(
        "Backend: Reading image file: {}",
        cache_file_name_for_log(Path::new(&path))
    );

    // Bound the read: refuse files above the encoded-image limit before
    // loading them into memory. This keeps the command a bounded image reader
    // rather than an arbitrary file-read primitive.
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to stat file: {}", e))?;
    if !metadata.is_file() {
        return Err("Path is not a regular file".to_string());
    }
    if metadata.len() > MAX_BASE64_IMAGE_ENCODED_BYTES as u64 {
        return Err(format!(
            "Image file too large: {} bytes exceeds limit {}",
            metadata.len(),
            MAX_BASE64_IMAGE_ENCODED_BYTES
        ));
    }

    // 1. Read Bytes
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;

    // 2. Require the bytes to be a decodable image within pixel limits.
    //    Rejects non-image files so this cannot be used to exfiltrate
    //    arbitrary local content as base64.
    validate_image_data_limits(&bytes)?;

    // 3. Encode Base64
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    // 4. Determine MIME from the actual image bytes first, then fall back to the path.
    let mime = mime_from_image_path(Path::new(&path), &bytes);

    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
async fn cache_remote_image_asset(
    app: tauri::AppHandle,
    url: String,
    referer: Option<String>,
) -> Result<String, String> {
    let requested_url = url.trim();
    if requested_url.is_empty() {
        return Err("Remote image URL is required".to_string());
    }
    let validated_url = validate_remote_image_url(requested_url).await?;
    let normalized_url = validated_url.normalized.clone();

    let cache_dir = ensure_image_search_cache_dir(&app)?;
    if let Some(existing_path) = find_cached_remote_image_path(&cache_dir, &normalized_url)? {
        return Ok(existing_path.to_string_lossy().to_string());
    }

    let normalized_referer = if let Some(referer) = referer.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        validate_remote_image_url(referer)
            .await
            .ok()
            .map(|validated| validated.normalized)
    } else {
        None
    };
    let (content_type, bytes) = match download_remote_image_bytes_with_reqwest(
        &validated_url,
        normalized_referer.as_deref(),
    )
    .await
    {
        Ok(result) => result,
        Err(reqwest_error) => {
            #[cfg(target_os = "windows")]
            {
                append_runtime_log_line(&format!(
                    "image_search_cache_reqwest_failed :: host={} category=transport",
                    validated_url.host
                ));
                download_remote_image_bytes_with_powershell_httpclient(
                    &normalized_url,
                    normalized_referer.as_deref(),
                )
                .map_err(|powershell_error| {
                    let _ = (reqwest_error, powershell_error);
                    "Remote image download and fallback both failed".to_string()
                })?
            }
            #[cfg(not(target_os = "windows"))]
            {
                return Err(reqwest_error);
            }
        }
    };
    if bytes.len() > MAX_BASE64_IMAGE_ENCODED_BYTES {
        return Err(format!(
            "Remote image payload too large: {} bytes exceeds limit {}",
            bytes.len(),
            MAX_BASE64_IMAGE_ENCODED_BYTES
        ));
    }

    validate_image_data_limits(bytes.as_ref())?;

    let extension =
        remote_image_cache_extension(&normalized_url, bytes.as_ref(), content_type.as_deref());
    let target_path = cache_dir.join(format!(
        "remote_{}.{}",
        remote_image_cache_key(&normalized_url),
        extension
    ));
    fs::write(&target_path, bytes.as_slice())
        .map_err(|e| format!("Failed to write cached remote image: {}", e))?;
    append_runtime_log_line(&format!(
        "image_search_cache_saved :: file={} bytes={}",
        cache_file_name_for_log(&target_path),
        bytes.len()
    ));

    Ok(target_path.to_string_lossy().to_string())
}
