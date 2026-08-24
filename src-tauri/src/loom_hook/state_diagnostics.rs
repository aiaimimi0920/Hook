// Owns Hook-side connector state, listener claiming, transport selection, and bounded diagnostics.
// =========================================================================
// 2. Mock State
// =========================================================================

// Wrapper for Shmem so it can be moved into the state that crosses threads.
// Only `Send` is claimed: the segment is always accessed behind the state's
// `Arc<Mutex<…>>`, so shared cross-thread access (which `Sync` would assert) is
// never relied upon. Keeping `Send` alone lets the compiler still catch any
// accidental unsynchronized sharing of the raw shmem pointer.
#[allow(dead_code)]
pub struct SafeShmem(pub shared_memory::Shmem);
unsafe impl Send for SafeShmem {}

const SHARED_MEMORY_ART_INPUT_MIN_BYTES: usize = 256 * 1024;

// `/v1/surfaces/stream` 的应答自带协议标识，Hook 此前完全不读它，于是任何一侧改了流
// 协议在运行期都察觉不到。Hook 不依赖 loom_protocol crate（两个仓库各自独立），所以这里
// 保留一份同名字面量；改动线上取值必须两边同时改。
const SURFACE_STREAM_PROTOCOL_VERSION: &str = "loom.surface-stream.v1";
const REMOTE_SURFACE_IDLE_POLL_DELAY: Duration = Duration::from_millis(100);
const MAX_LOOM_JSON_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_LOOM_DIAGNOSTIC_CHARS: usize = 256;
const MAX_LOOM_CONTROL_WS_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_LOOM_ART_WS_MESSAGE_BYTES: usize = MAX_HOOK_BASE64_CHARS + 1024 * 1024;
const MAX_LOOM_SHADER_WS_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_SURFACE_STREAM_MESSAGES: usize = 512;

pub struct LoomHookState {
    pub session_id: String,
    pub listener_started: bool,
    pub backend_connected: bool,
    pub app_handle: Option<AppHandle>,
    pub negotiated_transport: TransportMode,
}

impl LoomHookState {
    fn set_app_handle(&mut self, app: AppHandle) {
        self.app_handle = Some(app);
    }
}

pub struct LoomHook {
    pub state: Arc<Mutex<LoomHookState>>,
    pub loaded_arts: Mutex<Vec<ArtDefinition>>,
}

impl LoomHook {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(LoomHookState {
                session_id: Uuid::new_v4().to_string(),
                listener_started: false,
                backend_connected: false,
                app_handle: None,
                negotiated_transport: TransportMode::Websocket,
            })),
            loaded_arts: Mutex::new(Vec::new()),
        }
    }
}

fn claim_loom_hook_listener_start(state: &mut LoomHookState) -> bool {
    if state.listener_started {
        return false;
    }
    state.listener_started = true;
    true
}

pub fn ensure_loom_hook_listener(app_handle: &AppHandle, state: &LoomHook) -> Result<bool, String> {
    let should_start = {
        let mut state_guard = state.state.lock().map_err(|error| error.to_string())?;
        state_guard.set_app_handle(app_handle.clone());
        claim_loom_hook_listener_start(&mut state_guard)
    };
    if should_start {
        // A loopback-only compatibility build omits the remote poll listener entirely.
        #[cfg(feature = "remote-surface")]
        let remote_surface = crate::loom_connector::read_default_loom_manifest()
            .ok()
            .is_some_and(|manifest| !loom_base_url_is_loopback(&manifest.transport.base_url));
        #[cfg(not(feature = "remote-surface"))]
        let remote_surface = false;

        if remote_surface {
            #[cfg(feature = "remote-surface")]
            start_remote_surface_poll_listener(app_handle.clone(), state.state.clone());
        } else {
            start_listener(app_handle.clone(), state.state.clone());
        }
    }
    Ok(should_start)
}

/// The local listener is valid only for Loom's origin-only HTTP loopback transport.
#[cfg(feature = "remote-surface")]
fn loom_base_url_is_loopback(base_url: &str) -> bool {
    crate::loom_connector::is_loopback_base_url(base_url)
}

fn loom_hook_ws_url() -> String {
    std::env::var("LOOM_HOOK_WS_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ws://127.0.0.1:19820".to_string())
}

fn prefer_shared_memory_art_input(negotiated_transport: &TransportMode) -> bool {
    matches!(negotiated_transport, TransportMode::SharedMemory)
}

fn record_backend_connection_state(
    state: &Arc<Mutex<LoomHookState>>,
    connected: bool,
) -> bool {
    let Ok(mut guard) = state.lock() else {
        return false;
    };
    if guard.backend_connected == connected {
        return false;
    }
    guard.backend_connected = connected;
    true
}

fn emit_backend_connection_state(
    app: &AppHandle,
    state: &Arc<Mutex<LoomHookState>>,
    connected: bool,
) {
    if record_backend_connection_state(state, connected) {
        let _ = app.emit(
            "art/loom_connection_state",
            serde_json::json!({ "connected": connected }),
        );
    }
}

fn sanitize_untrusted_message(value: &str, fallback: &str) -> String {
    let mut output = String::with_capacity(value.len().min(MAX_LOOM_DIAGNOSTIC_CHARS));
    for token in value.split_whitespace() {
        let lower = token.to_ascii_lowercase();
        let sensitive = ["authorization", "password", "secret", "token", "api_key", "apikey", "cookie"]
            .iter()
            .any(|marker| lower.contains(marker));
        let location = token.contains("://")
            || token.contains('\\')
            || (token.starts_with('/') && token.len() > 1);
        let safe_token = if sensitive {
            "[REDACTED_SECRET]"
        } else if location {
            "[REDACTED_LOCATION]"
        } else {
            token
        };
        let separator = usize::from(!output.is_empty());
        if output
            .chars()
            .count()
            .saturating_add(separator)
            .saturating_add(safe_token.chars().count())
            > MAX_LOOM_DIAGNOSTIC_CHARS
        {
            break;
        }
        if separator == 1 {
            output.push(' ');
        }
        output.push_str(safe_token);
    }
    if output.trim().is_empty() {
        fallback.to_owned()
    } else {
        output
    }
}

struct JsonBudgetWriter {
    written: usize,
    max_bytes: usize,
}

impl std::io::Write for JsonBudgetWriter {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let next = self
            .written
            .checked_add(buffer.len())
            .ok_or_else(|| std::io::Error::other("JSON size overflow"))?;
        if next > self.max_bytes {
            return Err(std::io::Error::other("JSON budget exceeded"));
        }
        self.written = next;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn validate_json_payload_size(
    value: &impl Serialize,
    label: &str,
    max_bytes: usize,
) -> Result<(), String> {
    let mut writer = JsonBudgetWriter {
        written: 0,
        max_bytes,
    };
    serde_json::to_writer(&mut writer, value)
        .map_err(|_| format!("{label} exceeds the Hook JSON budget"))
}

fn validate_protocol_field(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.len() > MAX_LOOM_DIAGNOSTIC_CHARS
        || value.chars().any(char::is_control)
    {
        return Err(format!("Loom {label} is invalid"));
    }
    Ok(())
}

fn diagnostic_field(value: &str) -> String {
    sanitize_untrusted_message(value, "invalid")
}

fn json_diagnostic_field(value: &serde_json::Value, pointer: &str) -> String {
    value
        .pointer(pointer)
        .and_then(serde_json::Value::as_str)
        .map(diagnostic_field)
        .unwrap_or_else(|| "invalid".to_owned())
}

async fn read_bounded_loom_json_body(
    mut response: reqwest::Response,
    context: &str,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_LOOM_JSON_RESPONSE_BYTES as u64)
    {
        return Err(format!("{context} exceeds the Hook response budget"));
    }
    let mut body = Vec::with_capacity(
        response
            .content_length()
            .and_then(|size| usize::try_from(size).ok())
            .unwrap_or_default(),
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| {
            format!(
                "{context} could not be read: {}",
                sanitize_untrusted_message(&error.to_string(), "transport error")
            )
        })?
    {
        let next_len = body
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| format!("{context} size overflow"))?;
        if next_len > MAX_LOOM_JSON_RESPONSE_BYTES {
            return Err(format!("{context} exceeds the Hook response budget"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn validate_surface_identifier<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 160
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
        })
    {
        return Err(format!("Surface {label} is invalid"));
    }
    Ok(value)
}

fn surface_instance_endpoint(
    base: &str,
    instance_id: &str,
    operation: &str,
) -> Result<reqwest::Url, String> {
    let instance_id = validate_surface_identifier(instance_id, "instance id")?;
    let mut url = reqwest::Url::parse(base)
        .map_err(|_| "Surface base URL is invalid".to_owned())?;
    url.path_segments_mut()
        .map_err(|_| "Surface base URL cannot carry path segments".to_owned())?
        .extend(["v1", "surfaces", "instances"])
        .push(instance_id)
        .push(operation);
    Ok(url)
}

fn utf8_snippet(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }

    let mut end = max_bytes.min(value.len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }

    &value[..end]
}

fn emit_art_error(app_handle: &AppHandle, node_id: &str, request_id: &str, error: impl AsRef<str>) {
    let message = sanitize_untrusted_message(error.as_ref(), "Art execution failed");
    let payload = serde_json::json!({
        "art_id": node_id,
        "request_id": request_id,
        "status": 500,
        "error": &message,
        "delivery": {
            "type": "base64"
        }
    });
    crate::append_runtime_log_line(&format!(
        "loom_hook_art_ready_error :: node_id={} request_id={} error={}",
        node_id,
        request_id,
        utf8_snippet(&message, 200)
    ));
    let _ = app_handle.emit("art/ready", payload);
}
