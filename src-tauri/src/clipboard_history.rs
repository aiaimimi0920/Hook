//! Read-only Windows clipboard history. Content stays in memory, never in logs or caches.
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

// Reopening menus cannot accumulate blocking workers if a clipboard producer stalls.
static READING: AtomicBool = AtomicBool::new(false);
static LISTENING: AtomicBool = AtomicBool::new(false);
struct ReadPermit;
impl Drop for ReadPermit {
    fn drop(&mut self) {
        READING.store(false, Ordering::Release);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardHistoryEntry {
    id: String,
    kind: &'static str,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
}

#[derive(Serialize)]
pub struct ClipboardHistorySnapshot {
    status: &'static str,
    monitoring: bool,
    entries: Vec<ClipboardHistoryEntry>,
}

#[tauri::command]
pub async fn read_system_clipboard_history(
    window: tauri::WebviewWindow,
) -> Result<ClipboardHistorySnapshot, String> {
    if window.label() != "main" {
        return Err("Clipboard history requires the main window".to_owned());
    }
    if READING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("Clipboard history read in progress".to_owned());
    }
    let permit = ReadPermit;
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        std::thread::Builder::new()
            .name("clipboard-history-sta".into())
            .spawn(platform::read)
            .map_err(|_| {
                windows::core::Error::from_hresult(windows::core::HRESULT(0x80004005u32 as i32))
            })?
            .join()
            .map_err(|_| {
                windows::core::Error::from_hresult(windows::core::HRESULT(0x80004005u32 as i32))
            })?
    })
    .await
    .map_err(|_| "Clipboard history worker failed".to_owned())?
    .map_err(|_| "Clipboard history unavailable".to_owned());
    #[cfg(not(target_os = "windows"))]
    {
        let _permit = permit;
        Ok(ClipboardHistorySnapshot {
            status: "unsupported",
            monitoring: false,
            entries: vec![],
        })
    }
}

#[cfg(target_os = "windows")]
pub use platform::listen;

pub fn shutdown(app: &tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        if let Some(listener) = app.try_state::<platform::ClipboardListener>() {
            listener.stop();
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use base64::Engine;
    use tauri::Emitter;
    use windows::ApplicationModel::DataTransfer::{
        Clipboard, ClipboardHistoryItemsResultStatus, DataPackageView, StandardDataFormats,
    };
    use windows::Foundation::EventHandler;
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_SINGLETHREADED};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
    };

    // Clipboard is STA-only. Pump its messages and bound every async wait by the read deadline.
    macro_rules! wait_winrt {
        ($operation:expr, $deadline:expr) => {{
            let operation = $operation;
            while operation.Status()?.0 == 0 {
                if std::time::Instant::now() >= $deadline {
                    let _ = operation.Cancel();
                    return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                        0x800705B4u32 as i32,
                    )));
                }
                unsafe {
                    let mut message = MSG::default();
                    for _ in 0..32 {
                        if !PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                            break;
                        }
                        let _ = TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            operation.GetResults()?
        }};
    }

    const MAX_ITEM_BYTES: usize = 4 * 1024 * 1024;
    const MAX_TOTAL_BYTES: usize = 16 * 1024 * 1024;

    // Tokens own subscriptions; dropping app state releases both system callbacks.
    pub struct ClipboardListener {
        tokens: std::sync::Mutex<Option<(i64, i64)>>,
    }
    impl ClipboardListener {
        pub fn stop(&self) {
            if let Ok(mut tokens) = self.tokens.lock() {
                if let Some((content, history)) = tokens.take() {
                    LISTENING.store(false, Ordering::Release);
                    let _ = Clipboard::RemoveContentChanged(content);
                    let _ = Clipboard::RemoveHistoryChanged(history);
                }
            }
        }
    }
    impl Drop for ClipboardListener {
        fn drop(&mut self) {
            self.stop();
        }
    }
    pub fn listen(app: tauri::AppHandle) -> windows::core::Result<ClipboardListener> {
        let changed = app.clone();
        let content = Clipboard::ContentChanged(&EventHandler::new(move |_, _| {
            let _ = changed.emit("system-clipboard-changed", ());
            Ok(())
        }))?;
        let history = Clipboard::HistoryChanged(&EventHandler::new(move |_, _| {
            let _ = app.emit("system-clipboard-changed", ());
            Ok(())
        }));
        match history {
            Ok(history) => {
                LISTENING.store(true, Ordering::Release);
                Ok(ClipboardListener {
                    tokens: std::sync::Mutex::new(Some((content, history))),
                })
            }
            Err(error) => {
                let _ = Clipboard::RemoveContentChanged(content);
                Err(error)
            }
        }
    }

    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                RoUninitialize();
            }
        }
    }

    pub fn read() -> windows::core::Result<ClipboardHistorySnapshot> {
        // WinRT waits and bitmap reads never run on the UI thread.
        unsafe {
            RoInitialize(RO_INIT_SINGLETHREADED)?;
        }
        let _apartment = Apartment;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let result = wait_winrt!(Clipboard::GetHistoryItemsAsync()?, deadline);
        let status = result.Status()?;
        if status != ClipboardHistoryItemsResultStatus::Success {
            return Ok(ClipboardHistorySnapshot {
                status: if status == ClipboardHistoryItemsResultStatus::ClipboardHistoryDisabled {
                    "disabled"
                } else {
                    "denied"
                },
                entries: vec![],
                monitoring: LISTENING.load(Ordering::Acquire),
            });
        }
        let items = result.Items()?;
        let mut entries = Vec::new();
        let mut bytes = 0;
        for index in 0..items.Size()?.min(25) {
            if std::time::Instant::now() >= deadline {
                break;
            }
            let item = items.GetAt(index)?;
            // Unsupported or expired items do not hide the remaining usable history.
            if let Ok(Some(entry)) = item
                .Content()
                .and_then(|content| decode(item.Id()?.to_string(), content, deadline))
            {
                bytes += entry.content.len();
                if bytes > MAX_TOTAL_BYTES {
                    break;
                }
                entries.push(entry);
            }
        }
        Ok(ClipboardHistorySnapshot {
            status: "ready",
            entries,
            monitoring: LISTENING.load(Ordering::Acquire),
        })
    }

    fn decode(
        id: String,
        content: DataPackageView,
        deadline: std::time::Instant,
    ) -> windows::core::Result<Option<ClipboardHistoryEntry>> {
        // Bitmap takes precedence when a producer advertises both formats. No file/HTML fallback.
        if content.Contains(&StandardDataFormats::Bitmap()?)? {
            let bitmap = wait_winrt!(content.GetBitmapAsync()?, deadline);
            let stream = wait_winrt!(bitmap.OpenReadAsync()?, deadline);
            let size = stream.Size()?;
            if size == 0 || size > MAX_ITEM_BYTES as u64 {
                return Ok(None);
            }
            let reader = DataReader::CreateDataReader(&stream.GetInputStreamAt(0)?)?;
            let loaded = wait_winrt!(reader.LoadAsync(size as u32)?, deadline);
            if loaded != size as u32 {
                return Ok(None);
            }
            let mut data = vec![0; loaded as usize];
            reader.ReadBytes(&mut data)?;
            // Validate dimensions before decoding to bound decompression and renderer memory.
            let mut image_reader = image::ImageReader::new(std::io::Cursor::new(&data));
            let Ok(format_reader) = image_reader.with_guessed_format() else {
                return Ok(None);
            };
            image_reader = format_reader;
            let mut limits = image::Limits::default();
            limits.max_image_width = Some(8192);
            limits.max_image_height = Some(8192);
            limits.max_alloc = Some(64 * 1024 * 1024);
            image_reader.limits(limits);
            let Ok(image) = image_reader.decode() else {
                return Ok(None);
            };
            let mut png = std::io::Cursor::new(Vec::new());
            if image.write_to(&mut png, image::ImageFormat::Png).is_err()
                || png.get_ref().len() > MAX_ITEM_BYTES
            {
                return Ok(None);
            }
            let encoded = base64::engine::general_purpose::STANDARD.encode(png.into_inner());
            // The list decodes small previews, not 25 full-resolution bitmap payloads.
            let mut thumbnail = std::io::Cursor::new(Vec::new());
            if image
                .thumbnail(224, 72)
                .write_to(&mut thumbnail, image::ImageFormat::Png)
                .is_err()
            {
                return Ok(None);
            }
            let preview = base64::engine::general_purpose::STANDARD.encode(thumbnail.into_inner());
            return Ok(Some(ClipboardHistoryEntry {
                id,
                kind: "image",
                content: format!("data:image/png;base64,{encoded}"),
                preview: Some(format!("data:image/png;base64,{preview}")),
            }));
        }
        if content.Contains(&StandardDataFormats::Text()?)? {
            let text = wait_winrt!(content.GetTextAsync()?, deadline).to_string();
            if !text.trim().is_empty() && text.len() <= 64 * 1024 && text.lines().count() <= 256 {
                return Ok(Some(ClipboardHistoryEntry {
                    id,
                    kind: "text",
                    content: text,
                    preview: None,
                }));
            }
        }
        Ok(None)
    }

    #[cfg(test)]
    mod tests {
        #[test]
        fn filters_text_without_touching_system_clipboard() {
            use windows::ApplicationModel::DataTransfer::DataPackage;
            unsafe {
                super::RoInitialize(super::RO_INIT_SINGLETHREADED).unwrap();
            }
            let _apartment = super::Apartment;
            let package = DataPackage::new().unwrap();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            assert!(
                super::decode("empty".into(), package.GetView().unwrap(), deadline)
                    .unwrap()
                    .is_none()
            );
            package
                .SetText(&windows::core::HSTRING::from("hello <b>text</b>\n第二行"))
                .unwrap();
            let entry = super::decode("text".into(), package.GetView().unwrap(), deadline)
                .unwrap()
                .unwrap();
            assert_eq!(entry.kind, "text");
            assert_eq!(entry.content, "hello <b>text</b>\n第二行");
            package
                .SetText(&windows::core::HSTRING::from("x".repeat(65537)))
                .unwrap();
            assert!(
                super::decode("large".into(), package.GetView().unwrap(), deadline)
                    .unwrap()
                    .is_none()
            );
        }

        #[test]
        #[ignore = "Read-only probe of the interactive Windows clipboard; run explicitly"]
        fn system_history_read_only_probe() {
            let snapshot = super::read().expect("Windows clipboard history API failed");
            assert!(matches!(snapshot.status, "ready" | "disabled" | "denied"));
            assert!(snapshot.entries.len() <= 25);
            assert!(snapshot
                .entries
                .iter()
                .all(|entry| matches!(entry.kind, "image" | "text")));
            assert!(
                snapshot
                    .entries
                    .iter()
                    .map(|entry| entry.content.len())
                    .sum::<usize>()
                    <= super::MAX_TOTAL_BYTES
            );
            // Never print private content, entry IDs, or counts from the user's clipboard.
            println!("Windows clipboard history status: {}", snapshot.status);
            unsafe {
                super::RoInitialize(super::RO_INIT_SINGLETHREADED).unwrap();
            }
            let _apartment = super::Apartment;
            let changed = super::EventHandler::new(|_, _| Ok(()));
            let content = super::Clipboard::ContentChanged(&changed)
                .expect("ContentChanged registration failed");
            super::Clipboard::RemoveContentChanged(content).unwrap();
            let history =
                super::Clipboard::HistoryChanged(&super::EventHandler::new(|_, _| Ok(())))
                    .expect("HistoryChanged registration failed");
            super::Clipboard::RemoveHistoryChanged(history).unwrap();
        }
    }
}
