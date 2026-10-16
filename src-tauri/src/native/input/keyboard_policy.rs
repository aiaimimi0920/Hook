// Maps semantic overlay key transitions while respecting WebView focus.

#[cfg(target_os = "windows")]
fn update_overlay_modifier_key_state(vk_code: u32, pressed: bool) {
    if vk_code == VK_SHIFT.0 as u32
        || vk_code == VK_LSHIFT.0 as u32
        || vk_code == VK_RSHIFT.0 as u32
    {
        OVERLAY_SHIFT_KEY_DOWN.store(pressed, Ordering::SeqCst);
    }
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_hook_event_for_keydown(
    vk_code: u32,
    modifiers: ModifierSnapshot,
) -> Option<OverlayKeyboardHookEvent> {
    let runtime_modifiers = shortcut_config::Modifiers {
        ctrl: modifiers.ctrl_pressed,
        alt: modifiers.alt_pressed,
        shift: modifiers.shift_pressed,
        meta: modifiers.meta_pressed,
    };
    if shortcut_config::action_matches("cancel", vk_code, runtime_modifiers) {
        return Some(OverlayKeyboardHookEvent::Escape);
    }
    if shortcut_config::action_matches("delete_unit", vk_code, runtime_modifiers) {
        return Some(OverlayKeyboardHookEvent::Delete);
    }
    if shortcut_config::action_matches("copy_unit", vk_code, runtime_modifiers) {
        return Some(OverlayKeyboardHookEvent::Copy);
    }
    if shortcut_config::action_matches("paste_unit", vk_code, runtime_modifiers) {
        return Some(OverlayKeyboardHookEvent::Paste);
    }
    None
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_hook_should_consume_keyup(vk_code: u32, modifiers: ModifierSnapshot) -> bool {
    let runtime_modifiers = shortcut_config::Modifiers {
        ctrl: modifiers.ctrl_pressed,
        alt: modifiers.alt_pressed,
        shift: modifiers.shift_pressed,
        meta: modifiers.meta_pressed,
    };
    ["cancel", "delete_unit", "copy_unit", "paste_unit"]
        .into_iter()
        .any(|action| shortcut_config::action_matches(action, vk_code, runtime_modifiers))
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_hook_should_capture_semantic_keydown(
    vk_code: u32,
    modifiers: ModifierSnapshot,
    webview_has_focus: bool,
) -> Option<OverlayKeyboardHookEvent> {
    if webview_has_focus {
        return None;
    }
    overlay_keyboard_hook_event_for_keydown(vk_code, modifiers)
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_hook_should_capture_semantic_keyup(
    vk_code: u32,
    modifiers: ModifierSnapshot,
    webview_has_focus: bool,
) -> bool {
    !webview_has_focus && overlay_keyboard_hook_should_consume_keyup(vk_code, modifiers)
}
