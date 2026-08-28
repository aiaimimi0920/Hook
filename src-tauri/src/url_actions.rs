//! Validated external URL actions. Barcode recognition itself never performs
//! this side effect; the UI must request it after an explicit user click.

use reqwest::Url;

fn validate_http_url(value: &str) -> Result<String, String> {
    let candidate = value.trim();
    let (_, authority_and_path) = candidate
        .split_once("://")
        .ok_or_else(|| "Only absolute HTTP(S) URLs can be opened".to_owned())?;
    let authority = authority_and_path
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    if authority.is_empty() {
        return Err("URL is missing a host".to_owned());
    }
    let parsed = Url::parse(candidate).map_err(|_| "URL is not valid".to_owned())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Only absolute HTTP(S) URLs can be opened".to_owned());
    }
    Ok(candidate.to_owned())
}

#[tauri::command]
pub fn open_http_url(url: String) -> Result<(), String> {
    let url = validate_http_url(&url)?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("Unable to open URL: {error}"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        Err("Opening URLs is only supported by the Windows desktop runtime".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::validate_http_url;

    #[test]
    fn rejects_non_http_schemes_and_missing_hosts() {
        assert!(validate_http_url("ftp://example.com/file").is_err());
        assert!(validate_http_url("https:///missing-host").is_err());
    }

    #[test]
    fn trims_and_accepts_absolute_http_url() {
        assert_eq!(
            validate_http_url(" https://example.com/a ").expect("valid URL"),
            "https://example.com/a"
        );
    }
}
