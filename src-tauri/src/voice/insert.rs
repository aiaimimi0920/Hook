use crate::voice::core::VoiceError;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InsertMethod {
    DryRun,
    ClipboardPaste,
    ClipboardFallback,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum InsertOutcome {
    Inserted { method: InsertMethod },
    FallbackClipboard { reason: String },
}

pub trait TextInserter {
    fn insert_text(&self, text: &str) -> Result<InsertOutcome, VoiceError>;
}

pub trait ClipboardBackend {
    type Snapshot;

    fn capture(&self) -> Result<Self::Snapshot, VoiceError>;
    fn write_text(&self, text: &str) -> Result<(), VoiceError>;
    fn restore(&self, snapshot: Self::Snapshot) -> Result<(), VoiceError>;
}

pub trait PasteShortcut {
    fn send_paste(&self) -> Result<(), VoiceError>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClipboardRestorePolicy {
    RestoreOriginal,
    LeaveInsertedText,
}

#[derive(Debug, Clone)]
pub struct ClipboardPasteInserter<C, P> {
    clipboard: C,
    paste_shortcut: P,
    restore_policy: ClipboardRestorePolicy,
}

impl<C, P> ClipboardPasteInserter<C, P> {
    pub fn new(clipboard: C, paste_shortcut: P, restore_policy: ClipboardRestorePolicy) -> Self {
        Self {
            clipboard,
            paste_shortcut,
            restore_policy,
        }
    }
}

impl<C, P> TextInserter for ClipboardPasteInserter<C, P>
where
    C: ClipboardBackend,
    P: PasteShortcut,
{
    fn insert_text(&self, text: &str) -> Result<InsertOutcome, VoiceError> {
        if text.is_empty() {
            return Err(VoiceError::Insert(
                "refusing to insert empty text".to_string(),
            ));
        }

        match self.restore_policy {
            ClipboardRestorePolicy::RestoreOriginal => {
                let snapshot = self.clipboard.capture()?;
                self.clipboard.write_text(text)?;
                let paste_result = self.paste_shortcut.send_paste();
                self.clipboard.restore(snapshot)?;
                paste_result?;
            }
            ClipboardRestorePolicy::LeaveInsertedText => {
                self.clipboard.write_text(text)?;
                self.paste_shortcut.send_paste()?;
            }
        }

        Ok(InsertOutcome::Inserted {
            method: InsertMethod::ClipboardPaste,
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct DryRunInserter {
    last_text: Arc<Mutex<Option<String>>>,
}

impl DryRunInserter {
    pub fn last_text(&self) -> Option<String> {
        self.last_text
            .lock()
            .expect("dry-run inserter mutex poisoned")
            .clone()
    }
}

impl TextInserter for DryRunInserter {
    fn insert_text(&self, text: &str) -> Result<InsertOutcome, VoiceError> {
        *self
            .last_text
            .lock()
            .map_err(|error| VoiceError::Insert(error.to_string()))? = Some(text.to_string());
        Ok(InsertOutcome::Inserted {
            method: InsertMethod::DryRun,
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct ClipboardFallbackInserter;

impl TextInserter for ClipboardFallbackInserter {
    fn insert_text(&self, text: &str) -> Result<InsertOutcome, VoiceError> {
        if text.is_empty() {
            return Err(VoiceError::Insert(
                "refusing to insert empty text".to_string(),
            ));
        }
        Ok(InsertOutcome::FallbackClipboard {
            reason: "native clipboard paste is not enabled in Hook voice MVP".to_string(),
        })
    }
}

#[cfg(windows)]
#[derive(Debug, Clone, Default)]
pub struct WindowsClipboardBackend;

#[cfg(windows)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowsClipboardSnapshot {
    text: Option<String>,
}

#[cfg(windows)]
impl ClipboardBackend for WindowsClipboardBackend {
    type Snapshot = WindowsClipboardSnapshot;

    fn capture(&self) -> Result<Self::Snapshot, VoiceError> {
        windows_native::capture_clipboard_text()
    }

    fn write_text(&self, text: &str) -> Result<(), VoiceError> {
        windows_native::write_clipboard_text(Some(text))
    }

    fn restore(&self, snapshot: Self::Snapshot) -> Result<(), VoiceError> {
        windows_native::write_clipboard_text(snapshot.text.as_deref())
    }
}

#[cfg(not(windows))]
#[derive(Debug, Clone, Default)]
pub struct WindowsClipboardBackend;

#[cfg(not(windows))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WindowsClipboardSnapshot;

#[cfg(not(windows))]
impl ClipboardBackend for WindowsClipboardBackend {
    type Snapshot = WindowsClipboardSnapshot;

    fn capture(&self) -> Result<Self::Snapshot, VoiceError> {
        Err(native_windows_unavailable())
    }

    fn write_text(&self, _text: &str) -> Result<(), VoiceError> {
        Err(native_windows_unavailable())
    }

    fn restore(&self, _snapshot: Self::Snapshot) -> Result<(), VoiceError> {
        Err(native_windows_unavailable())
    }
}

#[derive(Debug, Clone, Default)]
pub struct WindowsPasteShortcut;

impl PasteShortcut for WindowsPasteShortcut {
    fn send_paste(&self) -> Result<(), VoiceError> {
        if std::env::var_os("HOOK_DISABLE_NATIVE_CLIPBOARD").is_some() {
            return Err(VoiceError::Insert(
                "native_windows clipboard backend disabled by HOOK_DISABLE_NATIVE_CLIPBOARD"
                    .to_string(),
            ));
        }

        send_native_windows_paste_shortcut()
    }
}

#[cfg(windows)]
fn send_native_windows_paste_shortcut() -> Result<(), VoiceError> {
    windows_native::send_ctrl_v()
}

#[cfg(not(windows))]
fn send_native_windows_paste_shortcut() -> Result<(), VoiceError> {
    Err(native_windows_unavailable())
}

#[cfg(not(windows))]
fn native_windows_unavailable() -> VoiceError {
    VoiceError::Insert("native_windows clipboard backend is only available on Windows".to_string())
}

#[cfg(windows)]
mod windows_native {
    use super::WindowsClipboardSnapshot;
    use crate::voice::core::VoiceError;
    use std::mem;
    use std::ptr;
    use windows_sys::Win32::Foundation::{GetLastError, GlobalFree, HGLOBAL, HWND};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable,
        OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
    };

    const MAX_CLIPBOARD_TEXT_BYTES: usize = 16 * 1024 * 1024;

    fn checked_utf16_byte_len(code_units: usize) -> Result<usize, VoiceError> {
        let byte_len = code_units
            .checked_mul(mem::size_of::<u16>())
            .ok_or_else(|| VoiceError::Insert("clipboard text size overflow".to_string()))?;
        if byte_len > MAX_CLIPBOARD_TEXT_BYTES {
            return Err(VoiceError::Insert(format!(
                "clipboard text exceeds the {MAX_CLIPBOARD_TEXT_BYTES}-byte limit"
            )));
        }
        Ok(byte_len)
    }

    pub(super) fn capture_clipboard_text() -> Result<WindowsClipboardSnapshot, VoiceError> {
        let _guard = ClipboardOpenGuard::open()?;
        let text = unsafe {
            if IsClipboardFormatAvailable(CF_UNICODETEXT as u32) == 0 {
                None
            } else {
                let handle = GetClipboardData(CF_UNICODETEXT as u32);
                if handle.is_null() {
                    return Err(last_error("GetClipboardData(CF_UNICODETEXT)"));
                }
                let byte_len = GlobalSize(handle as HGLOBAL);
                if byte_len == 0 || byte_len > MAX_CLIPBOARD_TEXT_BYTES {
                    return Err(VoiceError::Insert(format!(
                        "clipboard text size {byte_len} is outside the supported limit"
                    )));
                }

                let locked = GlobalLock(handle as HGLOBAL) as *const u16;
                if locked.is_null() {
                    return Err(last_error("GlobalLock(clipboard text)"));
                }

                let available_units = byte_len / mem::size_of::<u16>();
                let available = std::slice::from_raw_parts(locked, available_units);
                let decoded = available
                    .iter()
                    .position(|unit| *unit == 0)
                    .ok_or_else(|| {
                        VoiceError::Insert("clipboard text is not NUL terminated".to_string())
                    })
                    .and_then(|len| {
                        String::from_utf16(&available[..len]).map_err(|error| {
                            VoiceError::Insert(format!(
                                "clipboard text is not valid UTF-16: {error}"
                            ))
                        })
                    });
                let _ = GlobalUnlock(handle as HGLOBAL);
                Some(decoded?)
            }
        };

        Ok(WindowsClipboardSnapshot { text })
    }

    pub(super) fn write_clipboard_text(text: Option<&str>) -> Result<(), VoiceError> {
        let _guard = ClipboardOpenGuard::open()?;
        unsafe {
            if EmptyClipboard() == 0 {
                return Err(last_error("EmptyClipboard"));
            }

            let Some(text) = text else {
                return Ok(());
            };

            let handle = wide_text_to_global_handle(text)?;
            if SetClipboardData(CF_UNICODETEXT as u32, handle).is_null() {
                let _ = GlobalFree(handle);
                return Err(last_error("SetClipboardData(CF_UNICODETEXT)"));
            }
        }
        Ok(())
    }

    pub(super) fn send_ctrl_v() -> Result<(), VoiceError> {
        let mut inputs = [
            keyboard_input(VK_CONTROL, 0),
            keyboard_input(VK_V, 0),
            keyboard_input(VK_V, KEYEVENTF_KEYUP),
            keyboard_input(VK_CONTROL, KEYEVENTF_KEYUP),
        ];
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_mut_ptr(),
                mem::size_of::<INPUT>() as i32,
            )
        };
        if sent != inputs.len() as u32 {
            return Err(last_error("SendInput(Ctrl+V)"));
        }
        Ok(())
    }

    unsafe fn wide_text_to_global_handle(text: &str) -> Result<HGLOBAL, VoiceError> {
        let mut wide = text.encode_utf16().collect::<Vec<_>>();
        wide.push(0);
        let byte_len = checked_utf16_byte_len(wide.len())?;
        let handle = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, byte_len);
        if handle.is_null() {
            return Err(last_error("GlobalAlloc(clipboard text)"));
        }

        let locked = GlobalLock(handle) as *mut u16;
        if locked.is_null() {
            let _ = GlobalFree(handle);
            return Err(last_error("GlobalLock(allocated clipboard text)"));
        }

        ptr::copy_nonoverlapping(wide.as_ptr(), locked, wide.len());
        let _ = GlobalUnlock(handle);
        Ok(handle)
    }

    fn keyboard_input(vk: u16, flags: u32) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    struct ClipboardOpenGuard;

    impl ClipboardOpenGuard {
        fn open() -> Result<Self, VoiceError> {
            let opened = unsafe { OpenClipboard(std::ptr::null_mut::<std::ffi::c_void>() as HWND) };
            if opened == 0 {
                return Err(last_error("OpenClipboard"));
            }
            Ok(Self)
        }
    }

    impl Drop for ClipboardOpenGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseClipboard();
            }
        }
    }

    fn last_error(operation: &str) -> VoiceError {
        let code = unsafe { GetLastError() };
        VoiceError::Insert(format!("{operation} failed with Windows error {code}"))
    }

    #[cfg(test)]
    mod tests {
        use super::{checked_utf16_byte_len, MAX_CLIPBOARD_TEXT_BYTES};

        #[test]
        fn clipboard_utf16_allocation_is_checked_and_bounded() {
            assert_eq!(checked_utf16_byte_len(4).unwrap(), 8);
            assert!(checked_utf16_byte_len((MAX_CLIPBOARD_TEXT_BYTES / 2) + 1).is_err());
            assert!(checked_utf16_byte_len(usize::MAX).is_err());
        }
    }
}

#[cfg(test)]
include!("insert/tests.rs");
