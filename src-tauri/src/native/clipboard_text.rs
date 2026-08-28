// Owns native Unicode text clipboard publication for OCR and other text actions.

const MAX_CLIPBOARD_TEXT_BYTES: usize = 16 * 1024 * 1024;
const CLIPBOARD_WRITE_ATTEMPTS: usize = 3;

fn validate_clipboard_text(text: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Err("Clipboard text must not be empty".to_owned());
    }
    if text.len() > MAX_CLIPBOARD_TEXT_BYTES {
        return Err(format!(
            "Clipboard text exceeds the {MAX_CLIPBOARD_TEXT_BYTES}-byte limit"
        ));
    }
    Ok(())
}

/// Writes text through the desktop clipboard instead of relying on WebView
/// `navigator.clipboard` permissions. A short retry covers transient ownership
/// by another Windows process without blocking the UI for an unbounded time.
#[tauri::command]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    validate_clipboard_text(&text)?;

    let mut last_error = String::from("unknown clipboard error");
    for attempt in 0..CLIPBOARD_WRITE_ATTEMPTS {
        match arboard::Clipboard::new().and_then(|mut clipboard| clipboard.set_text(text.as_str()))
        {
            Ok(()) => {
                console_line!("Text copied to system clipboard");
                return Ok(());
            }
            Err(error) => {
                last_error = error.to_string();
                if attempt + 1 < CLIPBOARD_WRITE_ATTEMPTS {
                    std::thread::sleep(std::time::Duration::from_millis(15));
                }
            }
        }
    }

    Err(format!("Clipboard text write failed: {last_error}"))
}

#[cfg(test)]
mod tests {
    use super::{validate_clipboard_text, MAX_CLIPBOARD_TEXT_BYTES};

    #[test]
    fn rejects_empty_and_unbounded_text_before_clipboard_access() {
        assert!(validate_clipboard_text("  \n").is_err());
        assert!(validate_clipboard_text(&"x".repeat(MAX_CLIPBOARD_TEXT_BYTES + 1)).is_err());
        assert!(validate_clipboard_text("hello OCR").is_ok());
    }
}
