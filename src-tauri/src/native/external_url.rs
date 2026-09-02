// Opens explicitly requested HTTPS links through the system browser.

fn normalize_external_https_url(value: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 8 * 1024
        || value.chars().any(|character| {
            character.is_control() || character.is_whitespace() || character == '\\'
        })
    {
        return Err("External URL is invalid".to_owned());
    }
    let parsed = reqwest::Url::parse(value).map_err(|_| "External URL is invalid".to_owned())?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Only credential-free HTTPS URLs can be opened".to_owned());
    }
    Ok(parsed.to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn open_external_https_url(url: String) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;

    let normalized = normalize_external_https_url(&url)?;
    let verb = std::ffi::OsStr::new("open")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = std::ffi::OsStr::new(&normalized)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(target.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL,
        )
    };
    if result.0 as isize <= 32 {
        return Err("The system browser could not open this URL".to_owned());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn open_external_https_url(url: String) -> Result<(), String> {
    let _ = normalize_external_https_url(&url)?;
    Err("External URL opening is only supported on Windows".to_owned())
}

#[cfg(test)]
mod external_url_tests {
    use super::normalize_external_https_url;

    #[test]
    fn normalizes_only_credential_free_https_urls() {
        assert_eq!(
            normalize_external_https_url("https://example.com/path").unwrap(),
            "https://example.com/path"
        );
        assert!(normalize_external_https_url("http://example.com").is_err());
        assert!(normalize_external_https_url("https://user@example.com").is_err());
        assert!(normalize_external_https_url("javascript:alert(1)").is_err());
    }
}
