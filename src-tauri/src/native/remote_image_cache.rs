// Owns remote-image cache identity, transport, and response decoding.

use futures_util::StreamExt;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};

struct ValidatedRemoteImageUrl {
    normalized: String,
    host: String,
    resolved: SocketAddr,
}

fn remote_ipv4_is_disallowed(address: Ipv4Addr) -> bool {
    let octets = address.octets();
    address.is_unspecified()
        || address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_multicast()
        || address.is_broadcast()
        || octets[0] == 0
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
}

fn remote_ipv6_is_disallowed(address: Ipv6Addr) -> bool {
    if let Some(mapped) = address.to_ipv4_mapped() {
        return remote_ipv4_is_disallowed(mapped);
    }
    let segments = address.segments();
    address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
}

fn remote_ip_is_disallowed(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => remote_ipv4_is_disallowed(address),
        IpAddr::V6(address) => remote_ipv6_is_disallowed(address),
    }
}

async fn validate_remote_image_url(value: &str) -> Result<ValidatedRemoteImageUrl, String> {
    let parsed = reqwest::Url::parse(value).map_err(|_| "Remote image URL is invalid".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only http/https remote image URLs are supported".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Remote image URL credentials are not supported".to_string());
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "Remote image URL host is required".to_string())?
        .to_string();
    let port = parsed
        .port_or_known_default()
        .ok_or_else(|| "Remote image URL port is invalid".to_string())?;
    let resolve_host = host.clone();
    let addresses = tokio::task::spawn_blocking(move || {
        (resolve_host.as_str(), port)
            .to_socket_addrs()
            .map(|addresses| addresses.collect::<Vec<_>>())
    })
    .await
    .map_err(|_| "Remote image DNS resolution task failed".to_string())?
    .map_err(|_| "Remote image host could not be resolved".to_string())?;
    if addresses.is_empty() || addresses.iter().any(|address| remote_ip_is_disallowed(address.ip())) {
        return Err("Remote image URL resolves to a disallowed network address".to_string());
    }

    Ok(ValidatedRemoteImageUrl {
        normalized: parsed.to_string(),
        host,
        resolved: addresses[0],
    })
}

fn ensure_image_search_cache_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cache_dir = effective_app_data_dir(app)?.join("image-search-cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create image-search cache dir: {}", e))?;
    Ok(cache_dir)
}

fn remote_image_cache_key(url: &str) -> String {
    session_image_asset_fingerprint(url.as_bytes())
}

fn find_cached_remote_image_path(cache_dir: &Path, url: &str) -> Result<Option<PathBuf>, String> {
    if !cache_dir.exists() {
        return Ok(None);
    }

    let prefix = format!("remote_{}.", remote_image_cache_key(url));
    for entry in fs::read_dir(cache_dir)
        .map_err(|e| format!("Failed to read image-search cache dir: {}", e))?
    {
        let entry =
            entry.map_err(|e| format!("Failed to inspect image-search cache entry: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.starts_with(&prefix)
            && fs::metadata(&path)
                .map(|metadata| metadata.len() > 0)
                .unwrap_or(false)
        {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

fn remote_image_cache_extension(
    url: &str,
    bytes: &[u8],
    content_type: Option<&str>,
) -> &'static str {
    if let Ok(format) = image::guess_format(bytes) {
        return match format {
            image::ImageFormat::Png => "png",
            image::ImageFormat::Jpeg => "jpg",
            image::ImageFormat::WebP => "webp",
            image::ImageFormat::Bmp => "bmp",
            image::ImageFormat::Gif => "gif",
            _ => "png",
        };
    }

    if let Some(content_type) = content_type {
        let normalized = content_type.to_ascii_lowercase();
        if normalized.contains("png") {
            return "png";
        }
        if normalized.contains("jpeg") || normalized.contains("jpg") {
            return "jpg";
        }
        if normalized.contains("webp") {
            return "webp";
        }
        if normalized.contains("bmp") {
            return "bmp";
        }
        if normalized.contains("gif") {
            return "gif";
        }
    }

    let path_part = url.split('?').next().unwrap_or(url);
    let path_part = path_part.split('#').next().unwrap_or(path_part);
    let lower = path_part.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "jpg"
    } else if lower.ends_with(".webp") {
        "webp"
    } else if lower.ends_with(".bmp") {
        "bmp"
    } else if lower.ends_with(".gif") {
        "gif"
    } else {
        "png"
    }
}

const IMAGE_SEARCH_FETCH_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const IMAGE_SEARCH_FETCH_ACCEPT: &str =
    "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
const IMAGE_SEARCH_FETCH_ACCEPT_LANGUAGE: &str = "zh-CN,zh;q=0.9,en;q=0.8";

async fn download_remote_image_bytes_with_reqwest(
    url: &ValidatedRemoteImageUrl,
    referer: Option<&str>,
) -> Result<(Option<String>, Vec<u8>), String> {
    let client = crate::network_proxy::apply_to_url(
        reqwest::Client::builder(),
        &url.normalized,
    )
    .map_err(|_| "Failed to configure remote image client".to_string())?
    .timeout(Duration::from_secs(20))
    .redirect(reqwest::redirect::Policy::none())
    .resolve(&url.host, url.resolved)
    .user_agent(IMAGE_SEARCH_FETCH_USER_AGENT)
    .build()
    .map_err(|_| "Failed to build remote image client".to_string())?;
    let mut request = client
        .get(&url.normalized)
        .header(reqwest::header::ACCEPT, IMAGE_SEARCH_FETCH_ACCEPT)
        .header(
            reqwest::header::ACCEPT_LANGUAGE,
            IMAGE_SEARCH_FETCH_ACCEPT_LANGUAGE,
        );
    if let Some(referer) = referer {
        request = request.header(reqwest::header::REFERER, referer);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Failed to download remote image".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Remote image download failed: HTTP {}",
            status.as_u16()
        ));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    if response
        .content_length()
        .is_some_and(|length| length > MAX_BASE64_IMAGE_ENCODED_BYTES as u64)
    {
        return Err("Remote image payload exceeds the encoded-byte limit".to_string());
    }
    let initial_capacity = response
        .content_length()
        .and_then(|length| usize::try_from(length).ok())
        .unwrap_or(0)
        .min(MAX_BASE64_IMAGE_ENCODED_BYTES);
    let mut bytes = Vec::with_capacity(initial_capacity);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Failed to read remote image response".to_string())?;
        if bytes.len().saturating_add(chunk.len()) > MAX_BASE64_IMAGE_ENCODED_BYTES {
            return Err("Remote image payload exceeds the encoded-byte limit".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((content_type, bytes))
}

#[cfg(target_os = "windows")]
fn download_remote_image_bytes_with_powershell_httpclient(
    url: &str,
    referer: Option<&str>,
) -> Result<(Option<String>, Vec<u8>), String> {
    let script = r#"
Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AllowAutoRedirect = $false
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(30)
$client.DefaultRequestHeaders.UserAgent.ParseAdd($env:HOOK_FETCH_USER_AGENT)
$client.DefaultRequestHeaders.Accept.ParseAdd($env:HOOK_FETCH_ACCEPT)
$client.DefaultRequestHeaders.AcceptLanguage.ParseAdd($env:HOOK_FETCH_ACCEPT_LANGUAGE)
if ($env:HOOK_FETCH_REFERER) {
  try {
    $client.DefaultRequestHeaders.Referrer = [Uri]$env:HOOK_FETCH_REFERER
  } catch {
  }
}
try {
  $maxBytes = [int64]$env:HOOK_FETCH_MAX_BYTES
  $resp = $client.GetAsync($env:HOOK_FETCH_URL, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  if (-not $resp.IsSuccessStatusCode) {
    exit 22
  }
  if ($resp.Content.Headers.ContentLength -and $resp.Content.Headers.ContentLength -gt $maxBytes) {
    exit 23
  }
  $stream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
  $memory = New-Object System.IO.MemoryStream
  $buffer = New-Object byte[] 81920
  try {
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      if (($memory.Length + $read) -gt $maxBytes) { exit 23 }
      $memory.Write($buffer, 0, $read)
    }
    $bytes = $memory.ToArray()
  } finally {
    $stream.Dispose()
    $memory.Dispose()
  }
  $contentType = ''
  if ($resp.Content.Headers.ContentType) {
    $contentType = $resp.Content.Headers.ContentType.MediaType
  }
  @{ contentType = $contentType; dataBase64 = [Convert]::ToBase64String($bytes) } | ConvertTo-Json -Compress
} finally {
  $client.Dispose()
  $handler.Dispose()
}
"#;

    let mut command = std::process::Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .env("HOOK_FETCH_URL", url)
        .env("HOOK_FETCH_USER_AGENT", IMAGE_SEARCH_FETCH_USER_AGENT)
        .env("HOOK_FETCH_ACCEPT", IMAGE_SEARCH_FETCH_ACCEPT)
        .env(
            "HOOK_FETCH_ACCEPT_LANGUAGE",
            IMAGE_SEARCH_FETCH_ACCEPT_LANGUAGE,
        )
        .env(
            "HOOK_FETCH_REFERER",
            referer.unwrap_or(""),
        )
        .env(
            "HOOK_FETCH_MAX_BYTES",
            MAX_BASE64_IMAGE_ENCODED_BYTES.to_string(),
        )
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command
        .output()
        .map_err(|e| format!("PowerShell remote image download failed: {}", e))?;
    if !output.status.success() {
        return Err("PowerShell remote image download failed".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if stdout.is_empty() {
        return Err("PowerShell remote image download returned empty stdout".to_string());
    }
    let response = serde_json::from_str::<serde_json::Value>(&stdout)
        .map_err(|e| format!("Failed to parse PowerShell remote image response: {}", e))?;
    let bytes = response
        .get("dataBase64")
        .and_then(serde_json::Value::as_str)
        .and_then(|base64| {
            base64::engine::general_purpose::STANDARD
                .decode(base64)
                .ok()
        })
        .ok_or_else(|| "PowerShell remote image response contained no bytes".to_string())?;
    let content_type = response
        .get("contentType")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    Ok((content_type, bytes))
}
