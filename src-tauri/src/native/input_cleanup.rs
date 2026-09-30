// Restores input state and cursor resources during capture or process shutdown.

fn prepare_for_hook_process_exit(reason: &str) {
    if PROCESS_EXIT_CLEANUP_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        CAPTURE_MOUSE_HOOK_ACTIVE.store(false, Ordering::SeqCst);
        CAPTURE_MOUSE_HOOK_BUTTON_DOWN.store(false, Ordering::SeqCst);
        OVERLAY_KEYBOARD_CAPTURE_ACTIVE.store(false, Ordering::SeqCst);
        reset_overlay_pointer_session();
        OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(false, Ordering::SeqCst);
        set_overlay_input_shield_alt_passthrough(false);
        hide_overlay_input_shield_window();
    }
    restore_system_cursors_unconditionally();
    append_runtime_log_line_sync(&format!(
        "[{}] hook_process_exit_cleanup :: reason={}",
        runtime_log_timestamp(),
        reason
    ));
}

fn set_capture_input_runtime_active(active: bool) {
    #[cfg(target_os = "windows")]
    {
        CAPTURE_MOUSE_HOOK_ACTIVE.store(active, Ordering::SeqCst);
        if !active {
            CAPTURE_MOUSE_HOOK_BUTTON_DOWN.store(false, Ordering::SeqCst);
            reset_overlay_pointer_session();
        }
        append_runtime_log_line(&format!("capture_mouse_hook_active :: {}", active));
    }

    if active {
        set_capture_cursor_crosshair();
    } else {
        clear_capture_cursor_crosshair();
    }
}
