// Debounces native shortcut callbacks without holding the mutex across work.

fn should_accept_tauri_shortcut_trigger(
    last_trigger: &Arc<std::sync::Mutex<std::time::Instant>>,
    duplicate_log_event: &str,
) -> bool {
    let mut guard = match last_trigger.lock() {
        Ok(guard) => guard,
        Err(_) => return false,
    };

    if guard.elapsed() <= std::time::Duration::from_millis(500) {
        append_runtime_log_line(duplicate_log_event);
        return false;
    }

    *guard = std::time::Instant::now();
    true
}
