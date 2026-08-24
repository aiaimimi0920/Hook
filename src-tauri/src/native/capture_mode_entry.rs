// Enters standard or long capture mode and restores input state on failure.

fn enter_capture_mode(window: &tauri::WebviewWindow) {
    append_runtime_log_line("enter_capture_mode");
    if !try_begin_capture_input_runtime() {
        append_runtime_log_line("enter_capture_mode_ignored_active");
        return;
    }
    show_overlay_host_impl(window, true);

    console_line!("Overlay setup done. Emitting trigger-capture...");
    if let Err(e) = window.emit("trigger-capture", ()) {
        console_line!("Failed to emit trigger-capture: {}", e);
        append_runtime_log_line(&format!("enter_capture_mode emit_failed :: {}", e));
        set_capture_input_runtime_active(false);
    } else {
        append_runtime_log_line("enter_capture_mode emitted_trigger_capture");
    }
}

fn enter_long_capture_mode(window: &tauri::WebviewWindow) {
    append_runtime_log_line("enter_long_capture_mode");
    if !try_begin_capture_input_runtime() {
        append_runtime_log_line("enter_long_capture_mode_ignored_active");
        return;
    }
    show_overlay_host_impl(window, true);

    if let Err(e) = window.emit("trigger-long-capture", ()) {
        console_line!("Failed to emit trigger-long-capture: {}", e);
        append_runtime_log_line(&format!("enter_long_capture_mode emit_failed :: {}", e));
        set_capture_input_runtime_active(false);
    } else {
        append_runtime_log_line("enter_long_capture_mode emitted_trigger_long_capture");
    }
}
