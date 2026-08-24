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
