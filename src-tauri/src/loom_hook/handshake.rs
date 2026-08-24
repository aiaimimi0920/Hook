// Owns Tauri handshake orchestration and the blocking websocket handshake exchange.
// =========================================================================
// 3. Tauri Commands
// =========================================================================

#[tauri::command]
pub async fn loom_hook_handshake(
    app_handle: AppHandle,
    state: tauri::State<'_, LoomHook>,
    request: HandshakeRequest,
) -> Result<LoomHookHandshake, String> {
    if !try_reserve_loom_worker_slot(&ACTIVE_LOOM_HANDSHAKES, MAX_CONCURRENT_LOOM_HANDSHAKES) {
        return Err("Loom Hook handshake is already in progress".to_owned());
    }
    let _handshake_permit = LoomWorkerPermit {
        counter: &ACTIVE_LOOM_HANDSHAKES,
    };
    console_line!(
        "Loom Hook handshake request: protocol={} client={} platform={}",
        diagnostic_field(&request.protocol_version),
        sanitize_untrusted_message(&request.client_id, "unknown"),
        sanitize_untrusted_message(&request.platform, "unknown")
    );
    let response =
        tauri::async_runtime::spawn_blocking(move || perform_loom_hook_handshake(request))
            .await
            .map_err(|error| format!("Loom Hook handshake task failed: {error}"))??;

    {
        let mut loaded = state
            .loaded_arts
            .lock()
            .map_err(|error| error.to_string())?;
        *loaded = response.capabilities.art_definitions.clone();
    }
    {
        let mut current = state.state.lock().map_err(|error| error.to_string())?;
        current.session_id.clone_from(&response.session_id);
        current.negotiated_transport = response.transport.clone();
    }
    ensure_loom_hook_listener(&app_handle, state.inner())?;
    Ok(response)
}

fn perform_loom_hook_handshake(request: HandshakeRequest) -> Result<LoomHookHandshake, String> {
    use tungstenite::{connect, Message};
    validate_loom_hook_handshake_request(&request)?;
    let requested_transports = request.transports.clone();
    let ws_url = loom_hook_ws_url();
    let (mut socket, _) = connect(ws_url.as_str())
        .map_err(|_| "connect Loom Hook protocol failed".to_owned())?;
    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
        tcp.set_read_timeout(Some(Duration::from_secs(10)))
            .map_err(|error| format!("set Loom Hook handshake timeout: {error}"))?;
    }
    socket
        .send(Message::Text(
            serde_json::json!({
                "method": "loom.hook.handshake",
                "params": request,
            })
            .to_string()
            .into(),
        ))
        .map_err(|error| format!("send Loom Hook handshake: {error}"))?;
    let response = loop {
        match socket
            .read()
            .map_err(|error| format!("read Loom Hook handshake: {error}"))?
        {
            Message::Text(text) => {
                if text.len() > MAX_LOOM_HANDSHAKE_RESPONSE_BYTES {
                    return Err("Loom Hook handshake response exceeds the size limit".to_owned());
                }
                let envelope: serde_json::Value = serde_json::from_str(&text)
                    .map_err(|error| format!("decode Loom Hook handshake envelope: {error}"))?;
                if envelope.get("method").is_some() {
                    continue;
                }
                if envelope.get("error").is_some_and(|error| !error.is_null()) {
                    return Err("Loom Hook handshake returned an error".to_owned());
                }
                let candidate = serde_json::from_str::<LoomHookHandshake>(&text)
                    .map_err(|error| format!("decode Loom Hook handshake: {error}"))?;
                validate_loom_hook_handshake_response(&candidate, &requested_transports)?;
                break candidate;
            }
            Message::Close(_) => return Err("Loom Hook closed before handshake".to_owned()),
            _ => {}
        }
    };
    let _ = socket.close(None);

    Ok(response)
}

const MAX_LOOM_HANDSHAKE_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_LOOM_HANDSHAKE_TEXT_BYTES: usize = 256;
const MAX_CONCURRENT_LOOM_HANDSHAKES: usize = 1;
const MAX_LOOM_HANDSHAKE_LIST_ITEMS: usize = 512;
static ACTIVE_LOOM_HANDSHAKES: AtomicUsize = AtomicUsize::new(0);

fn validate_handshake_text(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= MAX_LOOM_HANDSHAKE_TEXT_BYTES
        && !value.chars().any(char::is_control)
}

fn validate_loom_hook_handshake_request(request: &HandshakeRequest) -> Result<(), String> {
    if request.protocol_version != "loom.hook.v1"
        || !request
            .supported_protocol_versions
            .iter()
            .any(|version| version == "loom.hook.v1")
    {
        return Err("Hook requested an unsupported Loom protocol version".to_owned());
    }
    if request.transports.is_empty() {
        return Err("Hook handshake must offer at least one transport".to_owned());
    }
    if request.supported_protocol_versions.len() > 8 || request.transports.len() > 8 {
        return Err("Hook handshake offers too many protocol options".to_owned());
    }
    if !validate_handshake_text(&request.client_id)
        || !validate_handshake_text(&request.client_version)
        || !validate_handshake_text(&request.platform)
    {
        return Err("Hook handshake identity is invalid".to_owned());
    }
    Ok(())
}

fn validate_loom_hook_handshake_response(
    candidate: &LoomHookHandshake,
    requested_transports: &[TransportMode],
) -> Result<(), String> {
    if candidate.protocol_version != "loom.hook.v1" {
        return Err("unexpected Loom Hook protocol version".to_owned());
    }
    if !requested_transports.contains(&candidate.transport) {
        return Err("Loom Hook selected a transport that was not offered".to_owned());
    }
    if !validate_handshake_text(&candidate.server_name)
        || !validate_handshake_text(&candidate.server_version)
        || !validate_handshake_text(&candidate.session_id)
    {
        return Err("Loom Hook handshake identity is invalid".to_owned());
    }
    let surface = &candidate.capabilities.surface;
    if candidate.capabilities.art_definitions.len() > MAX_LOOM_HANDSHAKE_LIST_ITEMS
        || candidate.capabilities.operations.len() > MAX_LOOM_HANDSHAKE_LIST_ITEMS
        || surface.runtimes.len() > MAX_LOOM_HANDSHAKE_LIST_ITEMS
        || surface.nodes.len() > MAX_LOOM_HANDSHAKE_LIST_ITEMS
        || surface.transports.len() > MAX_LOOM_HANDSHAKE_LIST_ITEMS
        || surface.capabilities.len() > MAX_LOOM_HANDSHAKE_LIST_ITEMS
    {
        return Err("Loom Hook handshake capabilities exceed the item limit".to_owned());
    }
    Ok(())
}
