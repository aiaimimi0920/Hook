// Owns bounded runtime logging, panic diagnostics, and their local path policy.
fn runtime_log_dir() -> PathBuf {
    std::env::var("HOOK_LOG_DIR")
        .ok()
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(default_runtime_log_dir)
}

fn default_runtime_log_dir() -> PathBuf {
    std::env::var("LOCALAPPDATA")
        .ok()
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(std::env::temp_dir)
        .join("Hook")
        .join("logs")
}

const RUNTIME_LOG_QUEUE_CAPACITY: usize = 512;
static RUNTIME_LOG_SENDER: OnceLock<mpsc::SyncSender<String>> = OnceLock::new();
static RUNTIME_LOG_LEVEL: AtomicU8 = AtomicU8::new(3);

fn runtime_log_message_level(message: &str) -> u8 {
    let message = message.to_ascii_lowercase();
    if message.contains("failed")
        || message.contains("error")
        || message.contains("panic")
        || message.contains("fatal")
    {
        1
    } else if message.contains("warn")
        || message.contains("unavailable")
        || message.contains("ignored")
        || message.contains("missing")
    {
        2
    } else if message.contains("debug") {
        4
    } else {
        3
    }
}

pub(crate) fn configure_runtime_log_level_from_loom(settings: &serde_json::Value) {
    let value = settings
        .get("system")
        .and_then(|system| {
            system
                .get("hook_log_level")
                .or_else(|| system.get("hookLogLevel"))
        })
        .and_then(serde_json::Value::as_str)
        .unwrap_or("info");
    let level = match value {
        "error" => 1,
        "warn" => 2,
        "debug" => 4,
        _ => 3,
    };
    RUNTIME_LOG_LEVEL.store(level, Ordering::Relaxed);
}

fn append_runtime_log_line_sync(line: &str) {
    let dir = runtime_log_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }

    let path = dir.join("hook-runtime.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{}", sanitize_runtime_log_message(line));
    }
}

fn runtime_log_sender() -> &'static mpsc::SyncSender<String> {
    RUNTIME_LOG_SENDER.get_or_init(|| {
        let (sender, receiver) = mpsc::sync_channel::<String>(RUNTIME_LOG_QUEUE_CAPACITY);
        let _ = std::thread::Builder::new()
            .name("hook-runtime-log".to_string())
            .spawn(move || {
                while let Ok(line) = receiver.recv() {
                    append_runtime_log_line_sync(&line);
                }
            });
        sender
    })
}

pub(crate) fn append_runtime_log_line(message: &str) {
    if runtime_log_message_level(message) > RUNTIME_LOG_LEVEL.load(Ordering::Relaxed) {
        return;
    }
    let timestamp = runtime_log_timestamp();
    let line = format!("[{}] {}", timestamp, sanitize_runtime_log_message(message));
    let _ = runtime_log_sender().try_send(line);
}

// Install a process-wide panic hook that records the panic message, location,
// and thread name to the runtime log BEFORE the runtime aborts. The release
// profile is `panic = "abort"` with `strip = true` and no symbols, so a panic
// (on the UI thread or any Loom Hook worker)
// otherwise vanishes as a bare Windows fast-fail (0xc0000409) with no message.
// Writing synchronously here — not via the async runtime-log channel — is
// essential: the channel's background thread may never drain before abort.
fn install_panic_logger() {
    let _ = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        prepare_for_hook_process_exit("panic");
        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "<unknown location>".to_string());
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            sanitize_runtime_log_message(s)
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            sanitize_runtime_log_message(s)
        } else {
            "<non-string panic payload>".to_string()
        };
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("<unnamed>").to_string();
        let line = format!(
            "[{}] PANIC in thread '{}' at {}: {}",
            runtime_log_timestamp(),
            thread_name,
            location,
            message
        );
        // Synchronous write so the record survives the imminent abort.
        append_runtime_log_line_sync(&line);
        console_error_line!("{line}");
    }));
}

fn unix_timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn runtime_log_timestamp() -> String {
    unix_timestamp_millis().to_string()
}
