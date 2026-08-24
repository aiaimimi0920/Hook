// Owns image path resolution, URL decoding, Art input loading, and shared-memory preparation.
const MAX_HOOK_ENCODED_IMAGE_BYTES: usize = 64 * 1024 * 1024;
const MAX_HOOK_BASE64_CHARS: usize = ((MAX_HOOK_ENCODED_IMAGE_BYTES + 2) / 3) * 4;
const MAX_HOOK_IMAGE_DIMENSION: u32 = 32_768;
const MAX_HOOK_IMAGE_PIXELS: u64 = 64 * 1024 * 1024;
const MAX_HOOK_RGBA_BYTES: usize = MAX_HOOK_IMAGE_PIXELS as usize * 4;
const MAX_HOOK_ART_INPUT_COUNT: usize = 32;
const MAX_HOOK_ART_INPUT_SOURCE_CHARS: usize = MAX_HOOK_BASE64_CHARS * 2;
const MAX_HOOK_ART_INPUT_TOTAL_RGBA_BYTES: usize = 256 * 1024 * 1024;
const MAX_HOOK_LOCAL_PATH_CHARS: usize = 32 * 1024;

fn checked_hook_rgba_len(width: u32, height: u32) -> Result<usize, String> {
    if width == 0 || height == 0 {
        return Err("Hook image dimensions must be non-zero".to_owned());
    }
    if width > MAX_HOOK_IMAGE_DIMENSION || height > MAX_HOOK_IMAGE_DIMENSION {
        return Err("Hook image dimensions exceed the configured limit".to_owned());
    }
    let pixels = u64::from(width)
        .checked_mul(u64::from(height))
        .ok_or_else(|| "Hook image dimensions overflow".to_owned())?;
    if pixels > MAX_HOOK_IMAGE_PIXELS {
        return Err("Hook image pixel count exceeds the configured limit".to_owned());
    }
    pixels
        .checked_mul(4)
        .and_then(|bytes| usize::try_from(bytes).ok())
        .ok_or_else(|| "Hook image byte size overflows this platform".to_owned())
}

fn validate_hook_base64_char_count(encoded_len: usize) -> Result<(), String> {
    if encoded_len > MAX_HOOK_BASE64_CHARS {
        return Err("Hook Base64 payload exceeds the configured limit".to_owned());
    }
    Ok(())
}

fn validate_hook_base64_len(encoded: &str) -> Result<(), String> {
    validate_hook_base64_char_count(encoded.len())
}

fn decode_hook_image_bytes(bytes: &[u8]) -> Option<RgbaImage> {
    if bytes.is_empty() || bytes.len() > MAX_HOOK_ENCODED_IMAGE_BYTES {
        return None;
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_HOOK_IMAGE_DIMENSION);
    limits.max_image_height = Some(MAX_HOOK_IMAGE_DIMENSION);
    limits.max_alloc = Some(MAX_HOOK_RGBA_BYTES as u64);
    let mut reader = ImageReader::new(Cursor::new(bytes)).with_guessed_format().ok()?;
    reader.limits(limits);
    let decoded = reader.decode().ok()?;
    checked_hook_rgba_len(decoded.width(), decoded.height()).ok()?;
    Some(decoded.to_rgba8())
}

fn decode_hook_image_base64(encoded: &str) -> Option<RgbaImage> {
    validate_hook_base64_len(encoded).ok()?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    decode_hook_image_bytes(&bytes)
}

fn validate_hook_art_input_budget(input_count: usize, total_chars: usize) -> Result<(), String> {
    if input_count > MAX_HOOK_ART_INPUT_COUNT {
        return Err("Art input count exceeds the Hook budget".to_owned());
    }
    if total_chars > MAX_HOOK_ART_INPUT_SOURCE_CHARS {
        return Err("Art input sources exceed the Hook transfer budget".to_owned());
    }
    Ok(())
}

fn validate_hook_art_input_sources(input_sources: &HashMap<String, String>) -> Result<(), String> {
    let total_chars = input_sources.values().try_fold(0_usize, |total, source| {
        total
            .checked_add(source.len())
            .ok_or_else(|| "Art input source size overflows this platform".to_owned())
    })?;
    validate_hook_art_input_budget(input_sources.len(), total_chars)
}
fn escape_json_pointer_token(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

/// Helper to resolve image path from UUID
fn resolve_image_path(uuid: &str) -> Option<String> {
    if let Some(config_dir) = dirs::config_dir() {
        let candidates = [config_dir.join("com.yamiyu.hook").join("images")];

        let extensions = vec!["png", "jpg", "jpeg", "webp"];

        for dir in candidates {
            if !dir.exists() {
                continue;
            }

            // 1. Try with extensions
            for ext in &extensions {
                let p = dir.join(format!("{}.{}", uuid, ext));
                if p.exists() {
                    return Some(p.to_string_lossy().to_string());
                }
            }
            // 2. Try exact match (no extension)
            let p = dir.join(uuid);
            if p.exists() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn decode_hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn percent_decode_lossy(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (
                decode_hex_nibble(bytes[index + 1]),
                decode_hex_nibble(bytes[index + 2]),
            ) {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }

        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn decode_asset_localhost_path(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw).ok()?;
    let is_asset_host = matches!(url.host_str(), Some("asset.localhost") | Some("localhost"));
    let is_asset_scheme = matches!(url.scheme(), "asset" | "http" | "https");
    if !is_asset_host || !is_asset_scheme {
        return None;
    }

    let encoded_path = url.path().trim_start_matches('/');
    if encoded_path.is_empty() {
        return None;
    }

    Some(percent_decode_lossy(encoded_path))
}

fn decode_file_url_path(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw).ok()?;
    if url.scheme() != "file" {
        return None;
    }
    let path = url.to_file_path().ok()?;
    Some(path.to_string_lossy().to_string())
}

fn load_rgba_image_from_path(path: &str) -> Option<RgbaImage> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_HOOK_ENCODED_IMAGE_BYTES as u64 {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    decode_hook_image_bytes(&bytes)
}

struct PreparedHookInput {
    descriptor: serde_json::Value,
    shmem_guard: Option<SafeShmem>,
}

fn prepare_inline_hook_input(image: &RgbaImage) -> Result<PreparedHookInput, String> {
    let expected_len = checked_hook_rgba_len(image.width(), image.height())?;
    if image.as_raw().len() != expected_len {
        return Err("Art input dimensions do not match its RGBA payload".to_owned());
    }
    let mut png_buf = Cursor::new(Vec::new());
    image
        .write_to(&mut png_buf, image::ImageFormat::Png)
        .map_err(|error| format!("encode Art input PNG: {error}"))?;
    let png = png_buf.into_inner();
    if png.len() > MAX_HOOK_ENCODED_IMAGE_BYTES {
        return Err("encoded Art input exceeds the Hook transfer budget".to_owned());
    }
    let data_base64 = base64::engine::general_purpose::STANDARD.encode(png);
    Ok(PreparedHookInput {
        descriptor: serde_json::json!({
            "kind": "inline_resource",
            "mime": "image/png",
            "dataBase64": data_base64,
            "width": image.width(),
            "height": image.height(),
        }),
        shmem_guard: None,
    })
}

fn prepare_hook_input(
    image: &RgbaImage,
    prefer_shared_memory: bool,
) -> Result<PreparedHookInput, String> {
    let raw = image.as_raw();
    let expected_len = checked_hook_rgba_len(image.width(), image.height())?;
    if raw.len() != expected_len {
        return Err("Art input dimensions do not match its RGBA payload".to_owned());
    }
    if prefer_shared_memory && raw.len() >= SHARED_MEMORY_ART_INPUT_MIN_BYTES {
        let handle = format!("hook-art-input-{}", Uuid::new_v4());
        match ShmemConf::new().size(raw.len()).os_id(&handle).create() {
            Ok(shmem) => {
                unsafe {
                    std::ptr::copy_nonoverlapping(raw.as_ptr(), shmem.as_ptr(), raw.len());
                }
                return Ok(PreparedHookInput {
                    descriptor: serde_json::json!({
                        "kind": "shared_memory",
                        "handle": handle,
                        "size": raw.len(),
                        "width": image.width(),
                        "height": image.height(),
                        "format": "rgba8",
                    }),
                    shmem_guard: Some(SafeShmem(shmem)),
                });
            }
            Err(error) => {
                console_line!(
                    "[LOOM_HOOK] Shared-memory Art input allocation failed; falling back to Base64: {error}"
                );
            }
        }
    }

    prepare_inline_hook_input(image)
}

fn load_input_rgba_image(source: Option<&String>) -> Option<RgbaImage> {
    let raw = source?.trim();
    if raw.is_empty() {
        return None;
    }

    if raw.starts_with("data:") {
        let encoded = raw
            .split_once(',')
            .map(|(_, payload)| payload)
            .unwrap_or(raw);
        return decode_hook_image_base64(encoded);
    }

    if raw.len() == 36 && raw.matches('-').count() == 4 {
        if let Some(path) = resolve_image_path(raw) {
            if let Some(image) = load_rgba_image_from_path(&path) {
                return Some(image);
            }
        }
    }

    if raw.len() <= MAX_HOOK_LOCAL_PATH_CHARS {
        if let Some(path) = decode_asset_localhost_path(raw).or_else(|| decode_file_url_path(raw)) {
            if let Some(image) = load_rgba_image_from_path(&path) {
                return Some(image);
            }
        }

        let file_path = std::path::Path::new(raw);
        if file_path.exists() {
            if let Some(image) = load_rgba_image_from_path(raw) {
                return Some(image);
            }
        }
    }

    decode_hook_image_base64(raw)
}

// Age-based sweep of materialized shader temp files in `dir`. Only files whose
// names start with the shader-input prefixes and are older than `max_age_secs`
// are removed, so an in-flight file (just written, being consumed downstream) is
// never deleted. Without this the temp dir accumulates one PNG per data-URI
// shader input forever.
