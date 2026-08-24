// Routes low-level Windows keyboard messages into Hook's overlay input policy.

#[cfg(target_os = "windows")]
unsafe extern "system" fn overlay_keyboard_hook_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code != HC_ACTION as i32 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }
    if lparam.0 == 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let keyboard = unsafe { *(lparam.0 as *const KBDLLHOOKSTRUCT) };
    let vk_code = keyboard.vkCode;
    let message = wparam.0 as u32;
    let key_pressed = matches!(message, WM_KEYDOWN | WM_SYSKEYDOWN);
    let key_released = matches!(message, WM_KEYUP | WM_SYSKEYUP);
    match message {
        WM_KEYDOWN | WM_SYSKEYDOWN => {
            update_overlay_modifier_key_state(vk_code, true);
        }
        WM_KEYUP | WM_SYSKEYUP => {
            update_overlay_modifier_key_state(vk_code, false);
        }
        _ => {}
    }

    if vk_code == VK_ESCAPE.0 as u32 {
        if key_pressed {
            handle_emergency_escape_transition(true, "keyboard_hook");
        }
        if key_released {
            handle_emergency_escape_transition(false, "keyboard_hook");
        }
    }

    let capture_active = CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst);
    let drag_active = OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.load(Ordering::SeqCst);
    let native_drag_preflight_active =
        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
    let is_alt_key =
        vk_code == VK_MENU.0 as u32 || vk_code == VK_LMENU.0 as u32 || vk_code == VK_RMENU.0 as u32;
    if is_alt_key {
        let passthrough = key_pressed
            && should_passthrough_foreign_alt_input(
                true,
                capture_active,
                drag_active,
                native_drag_preflight_active,
                hook_process_has_foreground_window(),
            );
        set_overlay_input_shield_alt_passthrough(passthrough);
    }

    let modifiers = current_modifier_snapshot();
    if modifiers.alt_pressed
        && should_passthrough_foreign_alt_input(
            true,
            capture_active,
            drag_active,
            native_drag_preflight_active,
            hook_process_has_foreground_window(),
        )
    {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    if !overlay_keyboard_capture_should_handle_current_cursor() {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let webview_has_focus = overlay_webview_has_foreground_focus();
    match message {
        WM_KEYDOWN | WM_SYSKEYDOWN => {
            if let Some(event) = overlay_keyboard_hook_should_capture_semantic_keydown(
                vk_code,
                modifiers,
                webview_has_focus,
            ) {
                queue_overlay_keyboard_hook_event(event);
                return LRESULT(1);
            }
            // Forward sticker-selected DOM shortcuts (Tab, Shift+1, ...) only when
            // the webview lacks OS focus (so the DOM listener would miss them).
            // When focused we do nothing here: the real keydown reaches the DOM,
            // preserving normal text typing during sticker edit.
            if !webview_has_focus {
                if let Some(shortcut) = overlay_keyboard_forwardable_shortcut(vk_code, modifiers) {
                    let should_consume =
                        overlay_keyboard_should_consume_forwarded_shortcut(&shortcut);
                    queue_overlay_keyboard_hook_event(OverlayKeyboardHookEvent::Shortcut {
                        key: shortcut.key.to_string(),
                        ctrl: shortcut.ctrl,
                        shift: shortcut.shift,
                        alt: shortcut.alt,
                        meta: shortcut.meta,
                    });
                    if should_consume {
                        return LRESULT(1);
                    }
                }
            }
        }
        WM_KEYUP | WM_SYSKEYUP => {
            if overlay_keyboard_hook_should_capture_semantic_keyup(
                vk_code,
                modifiers,
                webview_has_focus,
            ) {
                return LRESULT(1);
            }
        }
        _ => {}
    }

    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}
