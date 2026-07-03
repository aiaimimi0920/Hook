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
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };
    use windows_sys::Win32::System::Ole::CF_UNICODETEXT;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_CONTROL, VK_V,
    };

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

                let locked = GlobalLock(handle as HGLOBAL) as *const u16;
                if locked.is_null() {
                    return Err(last_error("GlobalLock(clipboard text)"));
                }

                let mut len = 0usize;
                while *locked.add(len) != 0 {
                    len += 1;
                }
                let slice = std::slice::from_raw_parts(locked, len);
                let text = String::from_utf16(slice).map_err(|error| {
                    VoiceError::Insert(format!("clipboard text is not valid UTF-16: {error}"))
                })?;
                let _ = GlobalUnlock(handle as HGLOBAL);
                Some(text)
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
        let byte_len = wide.len() * mem::size_of::<u16>();
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dry_run_inserter_reports_success_without_touching_clipboard() {
        let inserter = DryRunInserter::default();
        let outcome = inserter.insert_text("hello neuro").expect("dry run insert");

        assert_eq!(
            outcome,
            InsertOutcome::Inserted {
                method: InsertMethod::DryRun
            }
        );
        assert_eq!(inserter.last_text().as_deref(), Some("hello neuro"));
    }

    #[test]
    fn clipboard_paste_inserter_writes_text_sends_paste_and_restores_original_clipboard() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let clipboard =
            RecordingClipboard::new(Some("before clipboard".to_string()), calls.clone());
        let paste = RecordingPasteShortcut::new(calls.clone());
        let inserter = ClipboardPasteInserter::new(
            clipboard.clone(),
            paste,
            ClipboardRestorePolicy::RestoreOriginal,
        );

        let outcome = inserter
            .insert_text("hello clipboard")
            .expect("clipboard paste insert");

        assert_eq!(
            outcome,
            InsertOutcome::Inserted {
                method: InsertMethod::ClipboardPaste
            }
        );
        assert_eq!(
            clipboard.current_text(),
            Some("before clipboard".to_string())
        );
        assert_eq!(
            recorded_calls(&calls),
            vec![
                "capture",
                "write:hello clipboard",
                "paste_shortcut",
                "restore:before clipboard"
            ]
        );
    }

    #[test]
    fn clipboard_paste_inserter_can_leave_inserted_text_when_restore_is_disabled() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let clipboard =
            RecordingClipboard::new(Some("before clipboard".to_string()), calls.clone());
        let paste = RecordingPasteShortcut::new(calls.clone());
        let inserter = ClipboardPasteInserter::new(
            clipboard.clone(),
            paste,
            ClipboardRestorePolicy::LeaveInsertedText,
        );

        let outcome = inserter
            .insert_text("hello clipboard")
            .expect("clipboard paste insert");

        assert_eq!(
            outcome,
            InsertOutcome::Inserted {
                method: InsertMethod::ClipboardPaste
            }
        );
        assert_eq!(
            clipboard.current_text(),
            Some("hello clipboard".to_string())
        );
        assert_eq!(
            recorded_calls(&calls),
            vec!["write:hello clipboard", "paste_shortcut"]
        );
    }

    #[test]
    fn clipboard_paste_inserter_refuses_empty_text_before_clipboard_or_keyboard_side_effects() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let clipboard =
            RecordingClipboard::new(Some("before clipboard".to_string()), calls.clone());
        let paste = RecordingPasteShortcut::new(calls.clone());
        let inserter =
            ClipboardPasteInserter::new(clipboard, paste, ClipboardRestorePolicy::RestoreOriginal);

        let error = inserter
            .insert_text("")
            .expect_err("empty text must be rejected");

        assert_eq!(
            error,
            VoiceError::Insert("refusing to insert empty text".to_string())
        );
        assert!(recorded_calls(&calls).is_empty());
    }

    #[test]
    fn clipboard_paste_inserter_restores_original_clipboard_when_paste_shortcut_fails() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let clipboard =
            RecordingClipboard::new(Some("before clipboard".to_string()), calls.clone());
        let paste = FailingPasteShortcut::new(calls.clone());
        let inserter = ClipboardPasteInserter::new(
            clipboard.clone(),
            paste,
            ClipboardRestorePolicy::RestoreOriginal,
        );

        let error = inserter
            .insert_text("hello clipboard")
            .expect_err("paste shortcut failure must be surfaced");

        assert_eq!(
            error,
            VoiceError::Insert("paste shortcut failed".to_string())
        );
        assert_eq!(
            clipboard.current_text(),
            Some("before clipboard".to_string())
        );
        assert_eq!(
            recorded_calls(&calls),
            vec![
                "capture",
                "write:hello clipboard",
                "paste_shortcut_failed",
                "restore:before clipboard"
            ]
        );
    }

    #[test]
    fn windows_paste_shortcut_can_be_disabled_before_native_keyboard_side_effects() {
        let previous = std::env::var_os("HOOK_DISABLE_NATIVE_CLIPBOARD");
        std::env::set_var("HOOK_DISABLE_NATIVE_CLIPBOARD", "1");

        let result = WindowsPasteShortcut.send_paste();

        match previous {
            Some(value) => std::env::set_var("HOOK_DISABLE_NATIVE_CLIPBOARD", value),
            None => std::env::remove_var("HOOK_DISABLE_NATIVE_CLIPBOARD"),
        }

        let error = result.expect_err("disabled native shortcut must fail");
        assert!(
            error.to_string().contains("HOOK_DISABLE_NATIVE_CLIPBOARD"),
            "error={error}"
        );
    }

    #[derive(Debug, Clone)]
    struct RecordingClipboard {
        text: Arc<Mutex<Option<String>>>,
        calls: Arc<Mutex<Vec<String>>>,
    }

    impl RecordingClipboard {
        fn new(text: Option<String>, calls: Arc<Mutex<Vec<String>>>) -> Self {
            Self {
                text: Arc::new(Mutex::new(text)),
                calls,
            }
        }

        fn current_text(&self) -> Option<String> {
            self.text
                .lock()
                .expect("recording clipboard mutex poisoned")
                .clone()
        }
    }

    impl ClipboardBackend for RecordingClipboard {
        type Snapshot = Option<String>;

        fn capture(&self) -> Result<Self::Snapshot, VoiceError> {
            self.calls
                .lock()
                .expect("calls mutex poisoned")
                .push("capture".to_string());
            Ok(self.current_text())
        }

        fn write_text(&self, text: &str) -> Result<(), VoiceError> {
            self.calls
                .lock()
                .expect("calls mutex poisoned")
                .push(format!("write:{text}"));
            *self.text.lock().expect("clipboard mutex poisoned") = Some(text.to_string());
            Ok(())
        }

        fn restore(&self, snapshot: Self::Snapshot) -> Result<(), VoiceError> {
            let label = snapshot.as_deref().unwrap_or("<empty>");
            self.calls
                .lock()
                .expect("calls mutex poisoned")
                .push(format!("restore:{label}"));
            *self.text.lock().expect("clipboard mutex poisoned") = snapshot;
            Ok(())
        }
    }

    #[derive(Debug, Clone)]
    struct RecordingPasteShortcut {
        calls: Arc<Mutex<Vec<String>>>,
    }

    impl RecordingPasteShortcut {
        fn new(calls: Arc<Mutex<Vec<String>>>) -> Self {
            Self { calls }
        }
    }

    impl PasteShortcut for RecordingPasteShortcut {
        fn send_paste(&self) -> Result<(), VoiceError> {
            self.calls
                .lock()
                .expect("calls mutex poisoned")
                .push("paste_shortcut".to_string());
            Ok(())
        }
    }

    #[derive(Debug, Clone)]
    struct FailingPasteShortcut {
        calls: Arc<Mutex<Vec<String>>>,
    }

    impl FailingPasteShortcut {
        fn new(calls: Arc<Mutex<Vec<String>>>) -> Self {
            Self { calls }
        }
    }

    impl PasteShortcut for FailingPasteShortcut {
        fn send_paste(&self) -> Result<(), VoiceError> {
            self.calls
                .lock()
                .expect("calls mutex poisoned")
                .push("paste_shortcut_failed".to_string());
            Err(VoiceError::Insert("paste shortcut failed".to_string()))
        }
    }

    fn recorded_calls(calls: &Arc<Mutex<Vec<String>>>) -> Vec<String> {
        calls.lock().expect("calls mutex poisoned").clone()
    }
}
