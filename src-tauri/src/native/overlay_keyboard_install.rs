// Installs the overlay keyboard hook and dispatches its normalized events.

#[cfg(target_os = "windows")]
fn install_overlay_keyboard_hook_thread(window: tauri::WebviewWindow) {
    let (sender, receiver) = mpsc::sync_channel::<OverlayKeyboardHookEvent>(256);
    if OVERLAY_KEYBOARD_EVENT_SENDER.set(sender).is_err() {
        append_runtime_log_line("overlay_keyboard_hook_sender_already_initialized");
        return;
    }

    let emit_window = window.clone();
    let _ = std::thread::Builder::new()
        .name("hook-overlay-keyboard-events".to_string())
        .spawn(move || {
            while let Ok(event) = receiver.recv() {
                match event {
                    OverlayKeyboardHookEvent::Shortcut {
                        key,
                        ctrl,
                        shift,
                        alt,
                        meta,
                    } => {
                        append_runtime_log_line(&format!(
                            "overlay_keyboard_hook_emit :: shortcut {}",
                            key
                        ));
                        let _ = emit_window.emit(
                            "overlay/global_shortcut",
                            ForwardedShortcutPayload {
                                key,
                                ctrl_key: ctrl,
                                shift_key: shift,
                                alt_key: alt,
                                meta_key: meta,
                            },
                        );
                    }
                    other => {
                        let event_name = match other {
                            OverlayKeyboardHookEvent::Escape => "trigger-escape",
                            OverlayKeyboardHookEvent::Delete => "trigger-delete",
                            OverlayKeyboardHookEvent::Copy => "trigger-copy",
                            OverlayKeyboardHookEvent::Paste => "trigger-paste",
                            OverlayKeyboardHookEvent::Shortcut { .. } => "",
                        };
                        append_runtime_log_line(&format!(
                            "overlay_keyboard_hook_emit :: {}",
                            event_name
                        ));
                        let _ = emit_window.emit(event_name, ());
                    }
                }
            }
        });

    let _ = std::thread::Builder::new()
        .name("hook-overlay-keyboard-hook".to_string())
        .spawn(move || {
            let hook = unsafe {
                SetWindowsHookExW(WH_KEYBOARD_LL, Some(overlay_keyboard_hook_proc), None, 0)
            };
            let Ok(hook) = hook else {
                append_runtime_log_line("overlay_keyboard_hook_install_failed");
                return;
            };

            append_runtime_log_line("overlay_keyboard_hook_installed");
            let mut msg = MSG::default();
            while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
                let _ = unsafe { TranslateMessage(&msg) };
                unsafe { DispatchMessageW(&msg) };
            }
            let _ = unsafe { UnhookWindowsHookEx(hook) };
            append_runtime_log_line("overlay_keyboard_hook_thread_exited");
        });
}

#[cfg(not(target_os = "windows"))]
fn install_overlay_keyboard_hook_thread(_window: tauri::WebviewWindow) {}
