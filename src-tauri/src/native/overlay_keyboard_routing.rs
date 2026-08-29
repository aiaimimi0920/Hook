// Decides foreground, Alt-passthrough, and forwarded overlay shortcut routing.

#[cfg(target_os = "windows")]
fn rdev_should_dispatch_app_scoped_shortcut(
    shortcut: RdevAppScopedShortcut,
    app_has_focus: bool,
    capture_active: bool,
) -> bool {
    match shortcut {
        RdevAppScopedShortcut::Escape => app_has_focus || capture_active,
        RdevAppScopedShortcut::Delete => app_has_focus,
    }
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_capture_should_handle_current_cursor() -> bool {
    if NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst) {
        return false;
    }

    if !OVERLAY_KEYBOARD_CAPTURE_ACTIVE.load(Ordering::SeqCst) {
        return false;
    }

    let Some((x, y)) = current_cursor_position_physical() else {
        return false;
    };

    should_route_overlay_mouse_events(x, y)
}

#[cfg(target_os = "windows")]
fn overlay_webview_has_foreground_focus() -> bool {
    // If the HWND is unknown, assume focused so we do NOT intercept keys
    // (safe fallback: let the normal DOM path handle them).
    let Some(&main_hwnd) = OVERLAY_MAIN_HWND.get() else {
        return true;
    };
    let foreground = unsafe { GetForegroundWindow() };
    foreground.0 as isize == main_hwnd
}

#[cfg(target_os = "windows")]
fn hook_process_has_foreground_window() -> bool {
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0.is_null() {
        return false;
    }

    let mut foreground_pid = 0;
    unsafe { GetWindowThreadProcessId(foreground, Some(&mut foreground_pid)) };
    foreground_pid == std::process::id()
}

#[tauri::command]
fn hook_has_foreground_window() -> bool {
    #[cfg(target_os = "windows")]
    {
        return hook_process_has_foreground_window();
    }
    #[cfg(not(target_os = "windows"))]
    {
        true
    }
}

#[cfg(target_os = "windows")]
fn should_passthrough_foreign_alt_input(
    alt_pressed: bool,
    capture_active: bool,
    drag_active: bool,
    native_drag_preflight_active: bool,
    hook_has_foreground_window: bool,
) -> bool {
    alt_pressed
        && !capture_active
        && !drag_active
        && !native_drag_preflight_active
        && !hook_has_foreground_window
}

#[cfg(target_os = "windows")]
fn should_passthrough_foreign_alt_mouse_input(
    alt_pressed: bool,
    capture_active: bool,
    drag_active: bool,
    native_drag_preflight_active: bool,
    hook_has_foreground_window: bool,
    is_wheel_message: bool,
    should_route_overlay_mouse: bool,
) -> bool {
    let routed_overlay_wheel = is_wheel_message && should_route_overlay_mouse;
    should_passthrough_foreign_alt_input(
        alt_pressed,
        capture_active,
        drag_active,
        native_drag_preflight_active,
        hook_has_foreground_window,
    ) && !routed_overlay_wheel
}

// A sticker-selected DOM shortcut the native hook can forward. `key`/`ctrl`/
// `shift`/`alt` mirror the DOM KeyboardEvent the frontend reconstructs.
#[cfg(target_os = "windows")]
struct ForwardedShortcut {
    key: String,
    ctrl: bool,
    shift: bool,
    alt: bool,
    meta: bool,
}

#[cfg(target_os = "windows")]
fn overlay_keyboard_should_consume_forwarded_shortcut(shortcut: &ForwardedShortcut) -> bool {
    // Alt combinations must remain visible to the foreground application. Hook
    // can mirror Alt+2/Alt+3 into its unfocused WebView without suppressing the
    // original system key event.
    !shortcut.alt
}

// Maps a physical key + modifier state through the Loom-managed runtime table.
// Semantic Escape/Delete/Copy/Paste and true global shortcuts keep their native
// adapters; the remaining selected-sticker actions are forwarded to the DOM.
#[cfg(target_os = "windows")]
fn overlay_keyboard_forwardable_shortcut(
    vk_code: u32,
    modifiers: ModifierSnapshot,
) -> Option<ForwardedShortcut> {
    let runtime_modifiers = shortcut_config::Modifiers {
        ctrl: modifiers.ctrl_pressed,
        alt: modifiers.alt_pressed,
        shift: modifiers.shift_pressed,
        meta: modifiers.meta_pressed,
    };
    extension_forwarded_shortcut(vk_code, modifiers).or_else(|| shortcut_config::frontend_shortcut(vk_code, runtime_modifiers).map(|chord| ForwardedShortcut {
        key: chord.key,
        ctrl: chord.modifiers.ctrl,
        shift: chord.modifiers.shift,
        alt: chord.modifiers.alt,
        meta: chord.modifiers.meta,
    }))
}
