use base64::Engine as _;
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use shared_memory::ShmemConf;
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use uuid::Uuid; // Import Engine trait for encode/decode methods

// =========================================================================
// 1. Hook host protocol definitions
// =========================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum TransportMode {
    Websocket,
    SharedMemory,
    CloudflareRelay,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoomHookHandshake {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: String,
    #[serde(rename = "serverName")]
    pub server_name: String,
    #[serde(rename = "serverVersion")]
    pub server_version: String,
    #[serde(rename = "sessionId")]
    pub session_id: String,
    #[serde(rename = "transport")]
    pub transport: TransportMode,
    pub capabilities: LoomHookCapabilities,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoomHookCapabilities {
    #[serde(rename = "artDefinitions")]
    pub art_definitions: Vec<ArtDefinition>,
    pub surface: SurfaceHostCapabilities,
    pub operations: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceHostCapabilities {
    pub api_version: String,
    pub runtimes: Vec<String>,
    pub nodes: Vec<String>,
    pub transports: Vec<String>,
    pub capabilities: Vec<String>,
    pub input: SurfaceInputCapabilities,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SurfaceInputCapabilities {
    pub pointer: bool,
    pub hover: bool,
    pub touch: bool,
    pub keyboard: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArtDefinition {
    pub id: String,
    pub label: String,
    pub description: String,
    #[serde(rename = "parameters")]
    pub params: Vec<ArtParameter>,
    #[serde(rename = "autoProcess")]
    pub auto_process: bool,
    pub enabled: bool,
    pub defaults: HashMap<String, serde_json::Value>,

    pub execution: serde_json::Value,

    pub inputs: Vec<ArtInputDefinition>,

    pub outputs: Vec<ArtOutputDefinition>,

    pub metadata: serde_json::Value,

    #[serde(rename = "supportedTransports")]
    pub supported_transports: Vec<String>,

    #[serde(rename = "defaultVisibility")]
    pub default_visibility: HashMap<String, bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArtParameter {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default, rename = "widget")]
    pub param_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    #[serde(default)]
    pub step: Option<f64>,
    #[serde(default)]
    pub options: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    pub multiline: Option<bool>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub data_type: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub secret: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArtInputDefinition {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    #[serde(default, rename = "defaultVisible")]
    pub default_visible: Option<bool>,
    #[serde(default, rename = "exposePort")]
    pub expose_port: Option<bool>,
    #[serde(default)]
    pub execution_type: Option<String>,
    #[serde(default)]
    pub data_type: Option<String>,
    #[serde(default)]
    pub widget: Option<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArtOutputDefinition {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default, rename = "defaultVisible")]
    pub default_visible: Option<bool>,
    #[serde(default)]
    pub execution_type: Option<String>,
    #[serde(default)]
    pub data_type: Option<String>,
    #[serde(default)]
    pub widget: Option<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeRequest {
    pub protocol_version: String,
    #[serde(default)]
    pub supported_protocol_versions: Vec<String>,
    pub client_id: String,
    pub client_version: String,
    pub platform: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_id: Option<String>,
    #[serde(default)]
    pub transports: Vec<TransportMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<SurfaceHostCapabilities>,
}

// Actions (Frontend -> Backend)
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action", content = "payload")]
pub enum LoomHookAction {
    #[serde(rename = "execute_art")]
    ExecuteArt {
        node_id: String,
        request_id: String,
        generation: u64,
        art_id: String,
        #[serde(default)]
        inputs: HashMap<String, String>,
        #[serde(default)]
        parameters: HashMap<String, serde_json::Value>,
        #[serde(default)]
        disabled_parameters: Vec<String>,
    },
    #[serde(rename = "cancel_art")]
    CancelArt {
        node_id: String,
        request_id: String,
        generation: u64,
    },
    #[serde(rename = "update_workflow_node")]
    UpdateWorkflowNode {
        request_id: String,
        workflow_id: String,
        node_id: String,
        parameter_id: String,
        #[serde(default)]
        value: serde_json::Value,
    },

    #[serde(rename = "sync_workflow")]
    SyncWorkflow {
        workflow_id: String,
        snapshot: serde_json::Value, // Full JSON of the workflow (nodes + edges)
    },
    #[serde(rename = "surface_event")]
    SurfaceEvent { event: serde_json::Value },
    #[serde(rename = "surface_lifecycle")]
    SurfaceLifecycle { event: serde_json::Value },
    #[serde(rename = "surface_confirmation")]
    SurfaceConfirmation { decision: serde_json::Value },
    #[serde(rename = "surface_cancel")]
    SurfaceCancel { request: serde_json::Value },
    #[serde(rename = "surface_resource")]
    SurfaceResource { lease: serde_json::Value },
    #[serde(rename = "surface_attach")]
    SurfaceAttach {
        art_id: String,
        hook_node_id: String,
        #[serde(default)]
        device_id: Option<String>,
        capabilities: serde_json::Value,
    },
    #[serde(rename = "surface_remount")]
    SurfaceRemount {
        instance_id: String,
        attachment_id: String,
        hook_node_id: String,
    },
    // Future: ConnectNodes, specific functionality
}

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
        let remote_surface = crate::loom_connector::read_default_loom_manifest()
            .ok()
            .is_some_and(|manifest| !loom_base_url_is_loopback(&manifest.transport.base_url));
        if remote_surface {
            start_remote_surface_poll_listener(app_handle.clone(), state.state.clone());
        } else {
            start_listener(app_handle.clone(), state.state.clone());
        }
    }
    Ok(should_start)
}

fn loom_base_url_is_loopback(base_url: &str) -> bool {
    let lower = base_url.trim().to_ascii_lowercase();
    lower.starts_with("http://127.0.0.1:")
        || lower.starts_with("https://127.0.0.1:")
        || lower.starts_with("http://localhost:")
        || lower.starts_with("https://localhost:")
        || matches!(
            lower.as_str(),
            "http://127.0.0.1" | "https://127.0.0.1" | "http://localhost" | "https://localhost"
        )
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
    let message = error.as_ref().trim();
    let message = if message.is_empty() {
        "Art execution failed"
    } else {
        message
    };
    let payload = serde_json::json!({
        "art_id": node_id,
        "request_id": request_id,
        "status": 500,
        "error": message,
        "delivery": {
            "type": "base64"
        }
    });
    crate::append_runtime_log_line(&format!(
        "loom_hook_art_ready_error :: node_id={} request_id={} error={}",
        node_id,
        request_id,
        utf8_snippet(message, 200)
    ));
    let _ = app_handle.emit("art/ready", payload);
}

fn formal_hook_input_value(
    image: &RgbaImage,
    prefer_shared_memory: bool,
) -> Result<(serde_json::Value, Option<SafeShmem>), String> {
    let prepared = prepare_hook_input(image, prefer_shared_memory)?;
    Ok((prepared.descriptor, prepared.shmem_guard))
}

fn formal_hook_port_delivery(value: &serde_json::Value) -> Result<serde_json::Value, String> {
    let kind = value["kind"]
        .as_str()
        .ok_or_else(|| "formal value is missing kind".to_owned())?;
    match kind {
        "shared_memory" => {
            let handle = value["handle"]
                .as_str()
                .filter(|handle| handle.starts_with("Loom_Buffer_") && handle.len() > 12)
                .ok_or_else(|| "shared-memory formal value is missing handle".to_owned())?;
            let size = value["size"]
                .as_u64()
                .filter(|size| *size > 0)
                .ok_or_else(|| "shared-memory formal value has invalid size".to_owned())?;
            let width = value["width"]
                .as_u64()
                .filter(|width| *width > 0)
                .ok_or_else(|| "shared-memory formal value has invalid width".to_owned())?;
            let height = value["height"]
                .as_u64()
                .filter(|height| *height > 0)
                .ok_or_else(|| "shared-memory formal value has invalid height".to_owned())?;
            if value["format"].as_str() != Some("rgba8") {
                return Err("shared-memory formal value must use rgba8".to_owned());
            }
            Ok(serde_json::json!({
                "type": "shared_memory",
                "handle": handle,
                "size": size,
                "width": width,
                "height": height,
                "format": "rgba8"
            }))
        }
        "inline_resource" => {
            let mime = value["mime"]
                .as_str()
                .filter(|mime| !mime.is_empty())
                .ok_or_else(|| "inline formal value is missing mime".to_owned())?;
            let data = value["dataBase64"]
                .as_str()
                .filter(|data| !data.is_empty() && !data.starts_with("data:"))
                .ok_or_else(|| {
                    "inline formal value must contain non-empty bare dataBase64".to_owned()
                })?;
            base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|error| format!("inline formal value has invalid dataBase64: {error}"))?;
            Ok(serde_json::json!({
                "type": "base64",
                "data": format!("data:{mime};base64,{data}"),
                "width": value["width"].clone(),
                "height": value["height"].clone()
            }))
        }
        "value" => {
            let formal_value = value
                .get("value")
                .ok_or_else(|| "value formal value is missing value".to_owned())?;
            Ok(serde_json::json!({
                "type": "value",
                "value": formal_value
            }))
        }
        "resource" => {
            Err("broker resource outputs are not supported on the native Hook Art path".to_owned())
        }
        other => Err(format!("unsupported formal value kind `{other}`")),
    }
}

fn formal_hook_commit_revision(
    value: &serde_json::Value,
    node_id: &str,
    request_id: &str,
    generation: u64,
    revision_field: &str,
) -> Result<u64, String> {
    if value["protocolVersion"].as_str() != Some("loom.hook.v1")
        || value["requestId"].as_str() != Some(request_id)
        || value["nodeId"].as_str() != Some(node_id)
        || value["generation"].as_u64() != Some(generation)
    {
        return Err("Loom Hook Art commit identity does not match the active request".to_owned());
    }
    value[revision_field]
        .as_u64()
        .filter(|revision| *revision > 0)
        .ok_or_else(|| format!("Loom Hook Art commit has invalid {revision_field}"))
}

fn emit_formal_hook_port_value(
    app_handle: &AppHandle,
    node_id: &str,
    request_id: &str,
    generation: u64,
    revision: u64,
    phase: &str,
    value: &serde_json::Value,
    candidates: Option<&serde_json::Value>,
) -> bool {
    let Ok(delivery) = formal_hook_port_delivery(value) else {
        return false;
    };
    let mut payload = serde_json::json!({
        "art_id": node_id,
        "request_id": request_id,
        "generation": generation,
        "phase": phase,
        "status": 200,
        "delivery": delivery
    });
    if let Some(object) = payload.as_object_mut() {
        object.insert(
            if phase == "preview" {
                "preview_revision".to_owned()
            } else {
                "result_revision".to_owned()
            },
            serde_json::json!(revision),
        );
    }
    if let Some(candidates) = candidates {
        if let Some(delivery) = payload
            .get_mut("delivery")
            .and_then(serde_json::Value::as_object_mut)
        {
            delivery.insert("candidates".to_owned(), candidates.clone());
        }
    }
    app_handle.emit("art/ready", payload).is_ok()
}

fn emit_formal_hook_failure(
    app_handle: &AppHandle,
    node_id: &str,
    request_id: &str,
    message: &str,
) {
    emit_art_error(app_handle, node_id, request_id, message);
}

fn hook_art_cancel_response<'a>(
    json: &'a serde_json::Value,
    request_id: &str,
) -> Option<&'a serde_json::Value> {
    (json["protocolVersion"].as_str() == Some("loom.hook.v1")
        && json["requestId"].as_str() == Some(request_id)
        && json["method"].is_null()
        && json["status"].as_str().is_some())
    .then_some(json)
}

fn hook_art_resource_release_request(
    node_id: &str,
    execution_request_id: &str,
    generation: u64,
    handles: &[String],
) -> (String, serde_json::Value) {
    let release_request_id = format!("release:{}", Uuid::new_v4());
    let request = serde_json::json!({
        "method": "loom.hook.art.resources.release",
        "params": {
            "protocolVersion": "loom.hook.v1",
            "requestId": release_request_id,
            "executionRequestId": execution_request_id,
            "nodeId": node_id,
            "generation": generation,
            "deviceId": "device:local",
            "handles": handles,
        }
    });
    (release_request_id, request)
}

pub(crate) fn release_hook_art_resources(
    node_id: &str,
    execution_request_id: &str,
    generation: u64,
    handles: &[String],
) {
    if handles.is_empty() {
        return;
    }
    use tungstenite::{connect, Message as WsMessage};
    let (release_request_id, request) =
        hook_art_resource_release_request(node_id, execution_request_id, generation, handles);
    let Ok((mut socket, _)) = connect(loom_hook_ws_url().as_str()) else {
        return;
    };
    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
        let _ = tcp.set_read_timeout(Some(Duration::from_secs(5)));
    }
    if socket
        .send(WsMessage::Text(request.to_string().into()))
        .is_err()
    {
        return;
    }
    loop {
        match socket.read() {
            Ok(WsMessage::Text(text)) => {
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                if hook_art_cancel_response(&json, &release_request_id).is_some() {
                    break;
                }
            }
            Ok(WsMessage::Close(_)) | Err(_) => break,
            _ => {}
        }
    }
    let _ = socket.close(None);
}

fn forward_hook_art_cancel(node_id: &str, request_id: &str, generation: u64) {
    use tungstenite::{connect, Message as WsMessage};
    let request = serde_json::json!({
        "method": "loom.hook.art.cancel",
        "params": {
            "protocolVersion": "loom.hook.v1",
            "requestId": request_id,
            "nodeId": node_id,
            "generation": generation,
            "deviceId": "device:local"
        }
    });
    let ws_url = loom_hook_ws_url();
    let Ok((mut socket, _)) = connect(ws_url.as_str()) else {
        crate::append_runtime_log_line(&format!(
            "hook_art_cancel_connect_failed :: request_id={request_id} node_id={node_id}"
        ));
        return;
    };
    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
        let _ = tcp.set_read_timeout(Some(Duration::from_secs(5)));
    }
    if socket
        .send(WsMessage::Text(request.to_string().into()))
        .is_err()
    {
        crate::append_runtime_log_line(&format!(
            "hook_art_cancel_send_failed :: request_id={request_id} node_id={node_id}"
        ));
        return;
    }
    loop {
        match socket.read() {
            Ok(WsMessage::Text(text)) => {
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                let Some(response) = hook_art_cancel_response(&json, request_id) else {
                    continue;
                };
                if response["status"].as_str() == Some("failed")
                    && response["error"]["code"].as_str() != Some("request_not_found")
                {
                    crate::append_runtime_log_line(&format!(
                        "hook_art_cancel_failed :: request_id={request_id} code={} message={}",
                        response["error"]["code"].as_str().unwrap_or("unknown"),
                        response["error"]["message"].as_str().unwrap_or("unknown")
                    ));
                }
                break;
            }
            Ok(WsMessage::Close(_)) => break,
            Err(error) => {
                crate::append_runtime_log_line(&format!(
                    "hook_art_cancel_read_failed :: request_id={request_id} error={error}"
                ));
                break;
            }
            _ => {}
        }
    }
    let _ = socket.close(None);
}

fn send_hook_control_request(
    app: &AppHandle,
    message: serde_json::Value,
    timeout: Duration,
    error_event: &str,
) {
    use tungstenite::{connect, Message as WsMessage};
    let ws_url = loom_hook_ws_url();
    match connect(ws_url.as_str()) {
        Ok((mut socket, _)) => {
            if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
                let _ = tcp.set_read_timeout(Some(timeout));
            }
            if let Err(error) = socket.send(WsMessage::Text(message.to_string().into())) {
                let _ = app.emit(
                    error_event,
                    serde_json::json!({ "error": error.to_string() }),
                );
                return;
            }
            match socket.read() {
                Ok(WsMessage::Text(text)) => {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                        if json["status"].as_str() == Some("failed") {
                            let _ = app.emit(error_event, json);
                        }
                    }
                }
                Err(error) => {
                    crate::append_runtime_log_line(&format!(
                        "hook_control_request_read_failed :: error={error}"
                    ));
                }
                _ => {}
            }
            let _ = socket.close(None);
        }
        Err(error) => {
            let _ = app.emit(
                error_event,
                serde_json::json!({ "error": error.to_string() }),
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn forward_hook_art_execute(
    app_handle: &AppHandle,
    node_id: &str,
    art_id: &str,
    request_id: &str,
    generation: u64,
    input_sources: &HashMap<String, String>,
    params: &HashMap<String, serde_json::Value>,
    disabled_parameters: &[String],
    prefer_shared_memory: bool,
) {
    let mut inputs = serde_json::Map::new();
    let mut input_guards = Vec::new();
    for (name, source) in input_sources {
        let Some(image) = load_input_rgba_image(Some(source)) else {
            emit_formal_hook_failure(
                app_handle,
                node_id,
                request_id,
                &format!("image input `{name}` could not be decoded"),
            );
            return;
        };
        match formal_hook_input_value(&image, prefer_shared_memory) {
            Ok((value, guard)) => {
                inputs.insert(name.clone(), value);
                if let Some(guard) = guard {
                    input_guards.push(guard);
                }
            }
            Err(error) => {
                emit_formal_hook_failure(app_handle, node_id, request_id, &error);
                return;
            }
        }
    }
    let request = serde_json::json!({
        "method": "loom.hook.art.execute",
        "params": {
            "protocolVersion": "loom.hook.v1",
            "requestId": request_id,
            "nodeId": node_id,
            "artId": art_id,
            "generation": generation,
            "deviceId": "device:local",
            "outputTransports": ["shared_memory", "websocket"],
            "inputs": inputs,
            "parameters": params,
            "disabledParameters": disabled_parameters
        }
    });
    use tungstenite::{connect, Message as WsMessage};
    let ws_url = loom_hook_ws_url();
    let Ok((mut socket, _)) = connect(ws_url.as_str()) else {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            "Loom Hook protocol connection failed",
        );
        return;
    };
    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
        if let Err(error) = tcp.set_read_timeout(Some(Duration::from_secs(150))) {
            emit_formal_hook_failure(app_handle, node_id, request_id, &error.to_string());
            return;
        }
    }
    if socket
        .send(WsMessage::Text(request.to_string().into()))
        .is_err()
    {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            "Loom Hook protocol send failed",
        );
        return;
    }
    let _guards = input_guards;
    loop {
        match socket.read() {
            Ok(WsMessage::Text(text)) => {
                let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                if json["protocolVersion"].as_str() != Some("loom.hook.v1") {
                    continue;
                }
                if json["requestId"].as_str() != Some(request_id)
                    && json["params"]["requestId"].as_str() != Some(request_id)
                {
                    continue;
                }
                if let Some(method) = json["method"].as_str() {
                    let params = &json["params"];
                    match method {
                        "loom.hook.art.progress" => {
                            let _ = app_handle.emit(
                                "art/progress",
                                serde_json::json!({
                                    "art_id": node_id,
                                    "request_id": request_id,
                                    "value": params["value"].as_f64().unwrap_or(0.0)
                                }),
                            );
                        }
                        "loom.hook.art.preview" => {
                            let Ok(preview_revision) = formal_hook_commit_revision(
                                params,
                                node_id,
                                request_id,
                                generation,
                                "previewRevision",
                            ) else {
                                continue;
                            };
                            if !emit_formal_hook_port_value(
                                app_handle,
                                node_id,
                                request_id,
                                generation,
                                preview_revision,
                                "preview",
                                &params["value"],
                                None,
                            ) {
                                emit_formal_hook_failure(
                                    app_handle,
                                    node_id,
                                    request_id,
                                    formal_hook_port_delivery(&params["value"])
                                        .err()
                                        .unwrap_or_else(|| {
                                            "unsupported formal preview value".to_owned()
                                        })
                                        .as_str(),
                                );
                            }
                        }
                        "loom.hook.art.result" => {
                            let Ok(result_revision) = formal_hook_commit_revision(
                                params,
                                node_id,
                                request_id,
                                generation,
                                "resultRevision",
                            ) else {
                                emit_formal_hook_failure(
                                    app_handle,
                                    node_id,
                                    request_id,
                                    "Loom Hook returned an invalid Art result commit",
                                );
                                return;
                            };
                            emit_formal_hook_outputs(
                                app_handle,
                                node_id,
                                request_id,
                                generation,
                                result_revision,
                                "final",
                                &params["outputs"],
                                params.get("candidates"),
                            );
                            return;
                        }
                        "loom.hook.art.failure" => {
                            emit_formal_hook_failure(
                                app_handle,
                                node_id,
                                request_id,
                                params["error"]["message"]
                                    .as_str()
                                    .unwrap_or("Art execution failed"),
                            );
                            return;
                        }
                        _ => {}
                    }
                    continue;
                }
                match json["status"].as_str() {
                    Some("failed") | Some("cancelled") => {
                        emit_formal_hook_failure(
                            app_handle,
                            node_id,
                            request_id,
                            json["error"]["message"]
                                .as_str()
                                .unwrap_or("Art execution failed"),
                        );
                        return;
                    }
                    Some("succeeded") => {
                        let Ok(result_revision) = formal_hook_commit_revision(
                            &json["data"],
                            node_id,
                            request_id,
                            generation,
                            "resultRevision",
                        ) else {
                            emit_formal_hook_failure(
                                app_handle,
                                node_id,
                                request_id,
                                "Loom Hook returned an invalid Art result commit",
                            );
                            return;
                        };
                        emit_formal_hook_outputs(
                            app_handle,
                            node_id,
                            request_id,
                            generation,
                            result_revision,
                            "final",
                            &json["data"]["outputs"],
                            json["data"].get("candidates"),
                        );
                        return;
                    }
                    _ => {}
                }
            }
            Ok(WsMessage::Close(_)) | Err(_) => {
                emit_formal_hook_failure(
                    app_handle,
                    node_id,
                    request_id,
                    "Loom Hook protocol closed before final result",
                );
                return;
            }
            _ => {}
        }
    }
}

fn loom_hook_listener_subscription_message() -> String {
    serde_json::json!({
        "method": "loom.hook.subscribe",
        "params": {
            "requestId": format!("subscribe:{}", Uuid::new_v4()),
            "events": [
                "loom.hook.workflow.instantiated",
                "loom.hook.capabilities.updated",
                "loom.hook.cache.control",
                "loom.hook.settings.updated",
                "loom.surface.snapshot",
                "loom.surface.patch",
                "loom.surface.generation",
                "loom.surface.action.ack",
                "loom.surface.confirmation.request",
                "loom.surface.action.progress",
                "loom.surface.preview",
                "loom.surface.result",
                "loom.surface.failure",
                "loom.surface.lifecycle",
                "loom.surface.dispose"
            ]
        }
    })
    .to_string()
}

fn preferred_formal_output<'a>(
    outputs: &'a serde_json::Map<String, serde_json::Value>,
) -> Option<(&'a str, &'a serde_json::Value)> {
    for name in ["output_image", "output", "image"] {
        if let Some(value) = outputs.get(name) {
            return Some((name, value));
        }
    }
    outputs
        .iter()
        .next()
        .map(|(name, value)| (name.as_str(), value))
}

fn formal_output_map_value(value: &serde_json::Value) -> Result<serde_json::Value, String> {
    match value["kind"].as_str() {
        Some("value") => value
            .get("value")
            .cloned()
            .ok_or_else(|| "value formal value is missing value".to_owned()),
        Some("inline_resource") => {
            let mime = value["mime"]
                .as_str()
                .filter(|mime| !mime.is_empty())
                .ok_or_else(|| "inline formal value is missing mime".to_owned())?;
            let data = value["dataBase64"]
                .as_str()
                .filter(|data| !data.is_empty() && !data.starts_with("data:"))
                .ok_or_else(|| {
                    "inline formal value must contain non-empty bare dataBase64".to_owned()
                })?;
            base64::engine::general_purpose::STANDARD
                .decode(data)
                .map_err(|error| format!("inline formal value has invalid dataBase64: {error}"))?;
            Ok(serde_json::Value::String(format!(
                "data:{mime};base64,{data}"
            )))
        }
        Some("shared_memory") => formal_hook_port_delivery(value),
        Some("resource") => {
            Err("broker resource outputs are not supported on the native Hook Art path".to_owned())
        }
        Some(other) => Err(format!("unsupported formal value kind `{other}`")),
        None => Err("formal value is missing kind".to_owned()),
    }
}

fn emit_formal_hook_outputs(
    app_handle: &AppHandle,
    node_id: &str,
    request_id: &str,
    generation: u64,
    result_revision: u64,
    phase: &str,
    outputs: &serde_json::Value,
    candidates: Option<&serde_json::Value>,
) {
    let Some(map) = outputs.as_object() else {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            "Art execution returned no output",
        );
        return;
    };
    if map.is_empty() {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            "Art execution returned no output",
        );
        return;
    }
    let mut decoded = serde_json::Map::new();
    for (name, value) in map {
        match formal_output_map_value(value) {
            Ok(decoded_value) => {
                decoded.insert(name.clone(), decoded_value);
            }
            Err(error) => {
                emit_formal_hook_failure(app_handle, node_id, request_id, &error);
                return;
            }
        }
    }
    let Some((_, primary_value)) = preferred_formal_output(map) else {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            "Art execution returned no output",
        );
        return;
    };
    let Ok(mut delivery) = formal_hook_port_delivery(primary_value) else {
        emit_formal_hook_failure(
            app_handle,
            node_id,
            request_id,
            formal_hook_port_delivery(primary_value)
                .err()
                .unwrap_or_else(|| "unsupported formal value kind".to_owned())
                .as_str(),
        );
        return;
    };
    if let Some(object) = delivery.as_object_mut() {
        object.insert("outputs".to_owned(), serde_json::Value::Object(decoded));
        if let Some(candidates) = candidates {
            object.insert("candidates".to_owned(), candidates.clone());
        }
    }
    let _ = app_handle.emit(
        "art/ready",
        serde_json::json!({
            "art_id": node_id,
            "request_id": request_id,
            "generation": generation,
            "result_revision": result_revision,
            "phase": phase,
            "status": 200,
            "delivery": delivery
        }),
    );
}

fn hook_cache_settings_event(settings: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "recycleBinMaxEntries": settings.get("recycleBinMaxEntries").cloned().unwrap_or(serde_json::Value::Null),
        "recycleBinRetentionDays": settings.get("recycleBinRetentionDays").cloned().unwrap_or(serde_json::Value::Null),
        "tempCacheMaxBytes": settings.get("tempCacheMaxBytes").cloned().unwrap_or(serde_json::Value::Null),
        "tempCacheRetentionDays": settings.get("tempCacheRetentionDays").cloned().unwrap_or(serde_json::Value::Null),
    })
}

fn apply_hook_settings(app: &AppHandle, settings: &serde_json::Value) {
    if let Err(error) = crate::network_proxy::apply_loom_settings(settings) {
        crate::append_runtime_log_line(&format!("hook_proxy_settings_apply_failed :: {error}"));
    }
    crate::configure_runtime_log_level_from_loom(settings);
    match crate::apply_loom_shortcut_settings(app, settings) {
        Ok(()) => {
            let _ = app.emit(
                "hook/settings_updated",
                serde_json::json!({ "settings": settings }),
            );
        }
        Err(error) => {
            crate::append_runtime_log_line(&format!("hook_settings_apply_failed :: {error}"))
        }
    }
}

// Background Listener Function
fn start_listener(app: AppHandle, state: Arc<Mutex<LoomHookState>>) {
    thread::spawn(move || {
        println!("[LoomHook] Start Listener Thread...");
        loop {
            // Reconnection Loop
            use tungstenite::{connect, Message};
            let ws_url = loom_hook_ws_url();

            match connect(ws_url.as_str()) {
                Ok((mut socket, _)) => {
                    println!("[LoomHook] Listener connected to Loom.");
                    if let Err(error) =
                        socket.send(Message::Text(loom_hook_listener_subscription_message()))
                    {
                        eprintln!("[LoomHook] Failed to subscribe listener: {error}");
                        thread::sleep(Duration::from_secs(2));
                        continue;
                    }
                    let settings_request_id = format!("settings:{}", Uuid::new_v4());
                    if let Err(error) = socket.send(Message::Text(
                        serde_json::json!({
                            "method": "loom.hook.settings.get",
                            "params": { "requestId": settings_request_id }
                        })
                        .to_string()
                        .into(),
                    )) {
                        eprintln!("[LoomHook] Failed to request settings: {error}");
                        thread::sleep(Duration::from_secs(2));
                        continue;
                    }
                    if let Ok(mut guard) = state.lock() {
                        guard.backend_connected = true;
                    }
                    let _ = app.emit(
                        "art/loom_connection_state",
                        serde_json::json!({ "connected": true }),
                    );

                    // Main Read Loop
                    loop {
                        match socket.read() {
                            Ok(Message::Text(text)) => {
                                // Parse formal Loom Hook events.
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                                    if let Some(method) = json["method"].as_str() {
                                        if method == "loom.hook.workflow.instantiated" {
                                            println!("[LoomHook] Received Instantiate Command!");
                                            let _ = app.emit("art/instantiate", &json["params"]);
                                        } else if method == "loom.hook.capabilities.updated" {
                                            println!(
                                                "[LoomHook] Received Arts Updated Notification!"
                                            );
                                            let _ = app
                                                .emit("art/capabilities_updated", &json["params"]);
                                        } else if method == "loom.hook.cache.control" {
                                            let mut params = json["params"].clone();
                                            let mut emitted = false;
                                            if params["action"].as_str() == Some("settings") {
                                                params["settings"] =
                                                    hook_cache_settings_event(&params["settings"]);
                                            } else if let Some(
                                                action @ ("clearRecycleBin"
                                                | "clearReferenceLibrary"),
                                            ) = params["action"].as_str()
                                            {
                                                let _ =
                                                    app.emit("hook/cache_control", params.clone());
                                                emitted = true;
                                                // Apply the in-memory clear before committing the
                                                // same change to the session file. A concurrent
                                                // workflow sync will then also observe empty data.
                                                thread::sleep(Duration::from_millis(120));
                                                if let Err(error) =
                                                    crate::clear_persisted_session_library(
                                                        &app, action,
                                                    )
                                                {
                                                    crate::append_runtime_log_line(&format!(
                                                        "hook_cache_control_persist_failed :: action={} error={}",
                                                        action, error
                                                    ));
                                                }
                                            }
                                            if !emitted {
                                                let _ = app.emit("hook/cache_control", params);
                                            }
                                        } else if method == "loom.hook.settings.updated" {
                                            if json["params"]["settings"].is_object() {
                                                apply_hook_settings(
                                                    &app,
                                                    &json["params"]["settings"],
                                                );
                                            }
                                        } else if method.starts_with("loom.surface.") {
                                            emit_surface_push(&app, method, &json["params"]);
                                        }
                                    } else if json["protocolVersion"].as_str()
                                        == Some("loom.hook.v1")
                                        && json["requestId"].as_str()
                                            == Some(settings_request_id.as_str())
                                    {
                                        if json["data"].is_object() {
                                            apply_hook_settings(&app, &json["data"]);
                                        }
                                        if json["data"]["hookCache"].is_object() {
                                            let _ = app.emit(
                                                "hook/cache_control",
                                                serde_json::json!({
                                                    "action": "settings",
                                                    "settings": hook_cache_settings_event(&json["data"]["hookCache"]),
                                                }),
                                            );
                                        }
                                    }
                                }
                            }
                            Ok(Message::Close(_)) => {
                                break;
                            }
                            Err(_) => {
                                break;
                            }
                            _ => {}
                        }
                    }
                    if let Ok(mut guard) = state.lock() {
                        guard.backend_connected = false;
                    }
                    let _ = app.emit(
                        "art/loom_connection_state",
                        serde_json::json!({ "connected": false }),
                    );
                    println!("[LoomHook] Listener disconnected. Retrying in 5s...");
                }
                Err(_e) => {
                    if let Ok(mut guard) = state.lock() {
                        guard.backend_connected = false;
                    }
                    println!("[LoomHook] Connection failed to {}. Retrying...", ws_url);
                }
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

fn start_remote_surface_poll_listener(app: AppHandle, state: Arc<Mutex<LoomHookState>>) {
    thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                crate::append_runtime_log_line(&format!(
                    "surface_remote_poll_runtime_failed :: error={error}"
                ));
                return;
            }
        };
        runtime.block_on(async move {
            let mut cursor = 0_u64;
            loop {
                let result = poll_remote_surface_once(&app, cursor).await;
                match result {
                    Ok((next, messages)) => {
                        cursor = next;
                        if let Ok(mut guard) = state.lock() {
                            guard.backend_connected = true;
                        }
                        let _ = app.emit(
                            "art/loom_connection_state",
                            serde_json::json!({ "connected": true }),
                        );
                        for message in messages {
                            if let Some(method) =
                                message.get("method").and_then(serde_json::Value::as_str)
                            {
                                emit_surface_push(&app, method, &message["params"]);
                            }
                        }
                    }
                    Err(error) => {
                        if let Ok(mut guard) = state.lock() {
                            guard.backend_connected = false;
                        }
                        let _ = app.emit(
                            "art/loom_connection_state",
                            serde_json::json!({ "connected": false }),
                        );
                        crate::append_runtime_log_line(&format!(
                            "surface_remote_poll_failed :: error={error}"
                        ));
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                }
            }
        });
    });
}

async fn poll_remote_surface_once(
    app: &AppHandle,
    cursor: u64,
) -> Result<(u64, Vec<serde_json::Value>), String> {
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface stream: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let authorization = crate::device_session::authorize_surface_request(app, base).await?;
    let client = crate::network_proxy::apply_to_url(reqwest::Client::builder(), base)
        .map_err(|error| format!("configure Surface stream client: {error}"))?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("build Surface stream client: {error}"))?;
    let response = authorization
        .apply(client.get(format!(
            "{base}/v1/surfaces/stream?after={cursor}&timeoutMs=20000"
        )))
        .send()
        .await
        .map_err(|error| format!("poll Loom Surface stream: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("read Loom Surface stream: {error}"))?;
    if !status.is_success() {
        if status.as_u16() == 401 {
            crate::device_session::invalidate_surface_sessions(base);
        }
        return Err(format!("Loom Surface stream returned {status}: {body}"));
    }
    let response: serde_json::Value = serde_json::from_str(&body)
        .map_err(|error| format!("parse Loom Surface stream: {error}"))?;
    let next = response
        .get("next")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(cursor);
    let messages = response
        .get("messages")
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok((next, messages))
}

fn emit_surface_push(app: &AppHandle, method: &str, params: &serde_json::Value) {
    let local_event = match method {
        "loom.surface.snapshot" => "surface/snapshot",
        "loom.surface.patch" => "surface/patch",
        "loom.surface.generation" => "surface/generation",
        "loom.surface.action.ack" => "surface/action_ack",
        "loom.surface.confirmation.request" => "surface/confirmation",
        "loom.surface.action.progress" => "surface/progress",
        "loom.surface.preview" => "surface/preview",
        "loom.surface.result" => "surface/result",
        "loom.surface.failure" => "surface/failure",
        "loom.surface.lifecycle" => "surface/lifecycle",
        "loom.surface.dispose" => "surface/dispose",
        _ => return,
    };
    let _ = app.emit(local_event, params);
}

#[cfg(test)]
mod loom_hook_listener_subscription_tests {
    use super::*;

    #[test]
    fn cache_settings_event_reads_canonical_camel_case_only() {
        let event = hook_cache_settings_event(&serde_json::json!({
            "recycleBinMaxEntries": 15,
            "recycle_bin_max_entries": 99,
            "recycleBinRetentionDays": 7,
            "tempCacheMaxBytes": 1024,
            "tempCacheRetentionDays": 3
        }));
        assert_eq!(event["recycleBinMaxEntries"], 15);
        assert_eq!(event["recycleBinRetentionDays"], 7);
        assert_eq!(event["tempCacheMaxBytes"], 1024);
        assert_eq!(event["tempCacheRetentionDays"], 3);
    }

    #[test]
    fn formal_hook_port_delivery_validates_and_preserves_canonical_values() {
        let value = formal_hook_port_delivery(&serde_json::json!({
            "kind": "value",
            "value": { "ok": true }
        }))
        .expect("value delivery");
        assert_eq!(
            value,
            serde_json::json!({
                "type": "value",
                "value": { "ok": true }
            })
        );

        let inline = formal_hook_port_delivery(&serde_json::json!({
            "kind": "inline_resource",
            "mime": "image/png",
            "dataBase64": "QQ==",
            "width": 1,
            "height": 1
        }))
        .expect("inline delivery");
        assert_eq!(
            inline,
            serde_json::json!({
                "type": "base64",
                "data": "data:image/png;base64,QQ==",
                "width": 1,
                "height": 1
            })
        );

        let shared = formal_hook_port_delivery(&serde_json::json!({
            "kind": "shared_memory",
            "handle": "Loom_Buffer_1",
            "size": 8,
            "width": 2,
            "height": 1,
            "format": "rgba8"
        }))
        .expect("shared-memory delivery");
        assert_eq!(
            shared,
            serde_json::json!({
                "type": "shared_memory",
                "handle": "Loom_Buffer_1",
                "size": 8,
                "width": 2,
                "height": 1,
                "format": "rgba8"
            })
        );
    }

    #[test]
    fn formal_hook_port_delivery_rejects_malformed_unknown_and_resource_kinds() {
        for malformed in [
            serde_json::json!({
                "kind": "inline_resource",
                "mime": "",
                "dataBase64": "QQ=="
            }),
            serde_json::json!({
                "kind": "inline_resource",
                "mime": "image/png",
                "dataBase64": "data:image/png;base64,QQ=="
            }),
            serde_json::json!({
                "kind": "inline_resource",
                "mime": "image/png",
                "dataBase64": "not base64!"
            }),
            serde_json::json!({
                "kind": "value"
            }),
            serde_json::json!({
                "kind": "shared_memory",
                "handle": "loom-buffer-1",
                "size": 8,
                "width": 2,
                "height": 1,
                "format": "rgba8"
            }),
            serde_json::json!({
                "kind": "shared_memory",
                "handle": "Loom_Buffer_1",
                "size": 8,
                "width": 2,
                "height": 1
            }),
            serde_json::json!({
                "kind": "shared_memory",
                "handle": "Loom_Buffer_1",
                "size": 8,
                "width": 2,
                "height": 1,
                "format": "bgra8"
            }),
        ] {
            assert!(
                formal_hook_port_delivery(&malformed).is_err(),
                "{malformed}"
            );
        }
        assert!(formal_hook_port_delivery(&serde_json::json!({
            "kind": "resource",
            "resource": { "id": "res:1" }
        }))
        .is_err());
        assert!(formal_hook_port_delivery(&serde_json::json!({
            "kind": "mystery"
        }))
        .is_err());
        assert!(formal_output_map_value(&serde_json::json!({
            "kind": "value"
        }))
        .is_err());
    }

    #[test]
    fn cancel_response_requires_protocol_and_request_identity() {
        let response = serde_json::json!({
            "protocolVersion": "loom.hook.v1",
            "requestId": "request:expected",
            "status": "cancel_requested",
            "data": { "nodeId": "node:one", "generation": 2 }
        });
        assert!(hook_art_cancel_response(&response, "request:expected").is_some());
        assert!(hook_art_cancel_response(&response, "request:other").is_none());
        assert!(hook_art_cancel_response(
            &serde_json::json!({
                "protocolVersion": "loom.hook.v1",
                "method": "loom.hook.art.progress",
                "params": { "requestId": "request:expected" }
            }),
            "request:expected"
        )
        .is_none());
        assert!(hook_art_cancel_response(
            &serde_json::json!({
                "protocolVersion": "loom.hook.v0",
                "requestId": "request:expected",
                "status": "cancel_requested"
            }),
            "request:expected"
        )
        .is_none());
    }

    #[test]
    fn resource_release_uses_fresh_command_and_explicit_execution_identity() {
        let handles = vec!["Loom_Buffer_1".to_owned()];
        let (first_request_id, first) =
            hook_art_resource_release_request("node:one", "execution:one", 4, &handles);
        let (second_request_id, _) =
            hook_art_resource_release_request("node:one", "execution:one", 4, &handles);
        assert_ne!(first_request_id, second_request_id);
        assert_eq!(first["method"], "loom.hook.art.resources.release");
        assert_eq!(first["params"]["requestId"], first_request_id);
        assert_eq!(first["params"]["executionRequestId"], "execution:one");
        assert_eq!(first["params"]["nodeId"], "node:one");
        assert_eq!(first["params"]["generation"], 4);
        assert_eq!(first["params"]["deviceId"], "device:local");
        assert_eq!(first["params"]["handles"][0], "Loom_Buffer_1");
    }

    #[test]
    fn preferred_formal_output_prefers_canonical_port_names() {
        let outputs = serde_json::json!({
            "alpha": { "kind": "value", "value": 1 },
            "output": { "kind": "value", "value": 2 },
            "output_image": { "kind": "inline_resource", "mime": "image/png", "dataBase64": "QQ==" }
        });
        let map = outputs.as_object().expect("output map");
        assert_eq!(
            preferred_formal_output(map).map(|(name, _)| name),
            Some("output_image")
        );
        assert_eq!(
            formal_output_map_value(&map["alpha"]).expect("decode alpha"),
            serde_json::json!(1)
        );
        assert_eq!(
            formal_output_map_value(&map["output_image"]).expect("decode image"),
            serde_json::json!("data:image/png;base64,QQ==")
        );
    }

    #[test]
    fn cancel_art_action_deserializes_from_frontend_payload() {
        let action = serde_json::from_value::<LoomHookAction>(serde_json::json!({
            "action": "cancel_art",
            "payload": {
                "node_id": "node-1",
                "request_id": "req-old",
                "generation": 3
            }
        }))
        .expect("deserialize cancel_art");
        assert!(matches!(
            action,
            LoomHookAction::CancelArt {
                node_id,
                request_id,
                generation
            } if node_id == "node-1" && request_id == "req-old" && generation == 3
        ));
    }

    #[test]
    fn native_listener_subscribes_to_art_and_surface_updates() {
        let message: serde_json::Value =
            serde_json::from_str(&loom_hook_listener_subscription_message())
                .expect("subscription message");
        assert_eq!(message["method"], "loom.hook.subscribe");
        assert_eq!(
            message["params"]["events"],
            serde_json::json!([
                "loom.hook.workflow.instantiated",
                "loom.hook.capabilities.updated",
                "loom.hook.cache.control",
                "loom.hook.settings.updated",
                "loom.surface.snapshot",
                "loom.surface.patch",
                "loom.surface.generation",
                "loom.surface.action.ack",
                "loom.surface.confirmation.request",
                "loom.surface.action.progress",
                "loom.surface.preview",
                "loom.surface.result",
                "loom.surface.failure",
                "loom.surface.lifecycle",
                "loom.surface.dispose"
            ])
        );
    }

    #[test]
    fn surface_attach_action_preserves_host_capabilities() {
        let action = serde_json::from_value::<LoomHookAction>(serde_json::json!({
            "action": "surface_attach",
            "payload": {
                "art_id": "neuro.official/stock",
                "hook_node_id": "hook-node:stock",
                "capabilities": {
                    "apiVersion": "1.0",
                    "runtimes": ["declarative"],
                    "nodes": ["column", "text"],
                    "transports": [],
                    "capabilities": [],
                    "input": {
                        "pointer": true,
                        "hover": true,
                        "touch": true,
                        "keyboard": true
                    }
                }
            }
        }))
        .expect("deserialize Surface attach action");
        assert!(matches!(
            action,
            LoomHookAction::SurfaceAttach {
                art_id,
                hook_node_id,
                ..
            } if art_id == "neuro.official/stock" && hook_node_id == "hook-node:stock"
        ));
    }

    #[test]
    fn surface_remount_action_preserves_recovery_identity() {
        let action = serde_json::from_value::<LoomHookAction>(serde_json::json!({
            "action": "surface_remount",
            "payload": {
                "instance_id": "instance:stock",
                "attachment_id": "attachment:hook-stock",
                "hook_node_id": "hook-node:stock"
            }
        }))
        .expect("deserialize Surface remount action");
        assert!(matches!(
            action,
            LoomHookAction::SurfaceRemount {
                instance_id,
                attachment_id,
                hook_node_id,
            } if instance_id == "instance:stock"
                && attachment_id == "attachment:hook-stock"
                && hook_node_id == "hook-node:stock"
        ));
    }

    #[test]
    fn native_listener_start_claim_is_idempotent() {
        let loom_hook = LoomHook::new();
        let mut state = loom_hook.state.lock().expect("lock Loom Hook state");

        assert!(claim_loom_hook_listener_start(&mut state));
        assert!(!claim_loom_hook_listener_start(&mut state));
    }
}

// =========================================================================
// 3. Tauri Commands
// =========================================================================

#[tauri::command]
pub async fn loom_hook_handshake(
    app_handle: AppHandle,
    state: tauri::State<'_, LoomHook>,
    request: HandshakeRequest,
) -> Result<LoomHookHandshake, String> {
    println!("Loom Hook handshake request: {:?}", request);
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
    let ws_url = loom_hook_ws_url();
    let (mut socket, _) = connect(ws_url.as_str())
        .map_err(|error| format!("connect Loom Hook protocol at {ws_url}: {error}"))?;
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
                let candidate = serde_json::from_str::<LoomHookHandshake>(&text)
                    .map_err(|error| format!("decode Loom Hook handshake: {error}"))?;
                if candidate.protocol_version != "loom.hook.v1" {
                    return Err(format!(
                        "unexpected Loom Hook protocol `{}`",
                        candidate.protocol_version
                    ));
                }
                break candidate;
            }
            Message::Close(_) => return Err("Loom Hook closed before handshake".to_owned()),
            _ => {}
        }
    };
    let _ = socket.close(None);

    Ok(response)
}

#[tauri::command]
pub async fn loom_hook_dispatch_action(
    app: AppHandle,
    state: tauri::State<'_, LoomHook>,
    action: LoomHookAction,
) -> Result<(), String> {
    // Log action type without full data
    match &action {
        LoomHookAction::ExecuteArt {
            node_id,
            request_id,
            art_id,
            inputs,
            ..
        } => {
            crate::append_runtime_log_line(&format!(
                "loom_hook_dispatch_execute_art :: node_id={} request_id={} art_id={} input_keys={}",
                node_id,
                request_id,
                art_id,
                {
                    let mut keys = inputs.keys().cloned().collect::<Vec<_>>();
                    keys.sort();
                    if keys.is_empty() { "none".to_string() } else { keys.join(",") }
                }
            ));
        }
        LoomHookAction::CancelArt {
            node_id,
            request_id,
            generation,
        } => {
            crate::append_runtime_log_line(&format!(
                "loom_hook_dispatch_cancel_art :: node_id={node_id} request_id={request_id} generation={generation}"
            ));
        }
        LoomHookAction::UpdateWorkflowNode {
            workflow_id,
            node_id,
            parameter_id,
            ..
        } => {
            crate::append_runtime_log_line(&format!(
                "loom_hook_dispatch_workflow_node_update :: workflow_id={} node_id={} parameter_id={}",
                workflow_id, node_id, parameter_id
            ));
        }
        LoomHookAction::SyncWorkflow { workflow_id, .. } => {
            println!("Hook workflow action: SyncWorkflow id={}", workflow_id);
        }
        LoomHookAction::SurfaceEvent { event } => {
            crate::append_runtime_log_line(&format!(
                "loom_hook_dispatch_surface_event :: instance_id={} attachment_id={} event_id={} node_id={} action={}",
                event
                    .get("instanceId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
                event
                    .get("attachmentId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
                event
                    .get("eventId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
                event
                    .get("nodeId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
                event
                    .get("action")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
            ));
        }
        LoomHookAction::SurfaceLifecycle { event } => {
            crate::append_runtime_log_line(&format!(
                "loom_hook_dispatch_surface_lifecycle :: instance_id={} attachment_id={} state={} revision={}",
                event
                    .get("instanceId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
                event
                    .get("attachmentId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
                event
                    .get("state")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
                event
                    .get("revision")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or_default(),
            ));
        }
        LoomHookAction::SurfaceConfirmation { decision } => {
            crate::append_runtime_log_line(&format!(
                "loom_hook_dispatch_surface_confirmation :: confirmation_id={} instance_id={} approved={}",
                decision
                    .get("confirmationId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
                decision
                    .get("instanceId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
                decision
                    .get("approved")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
            ));
        }
        LoomHookAction::SurfaceCancel { request } => {
            crate::append_runtime_log_line(&format!(
                "loom_hook_dispatch_surface_cancel :: request_id={} instance_id={}",
                request
                    .get("requestId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
                request
                    .get("instanceId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
            ));
        }
        LoomHookAction::SurfaceResource { lease } => {
            crate::append_runtime_log_line(&format!(
                "loom_hook_dispatch_surface_resource :: resource_id={}",
                lease
                    .pointer("/resource/resourceId")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
            ));
        }
        LoomHookAction::SurfaceAttach {
            art_id,
            hook_node_id,
            device_id,
            ..
        } => {
            crate::append_runtime_log_line(&format!(
                "loom_hook_dispatch_surface_attach :: art_id={} hook_node_id={} device_id={}",
                art_id,
                hook_node_id,
                device_id.as_deref().unwrap_or("device-000-local")
            ));
        }
        LoomHookAction::SurfaceRemount {
            instance_id,
            attachment_id,
            hook_node_id,
        } => {
            crate::append_runtime_log_line(&format!(
                "loom_hook_dispatch_surface_remount :: instance_id={} attachment_id={} hook_node_id={}",
                instance_id, attachment_id, hook_node_id
            ));
        }
    }

    match action {
        LoomHookAction::ExecuteArt {
            node_id,
            request_id,
            art_id,
            inputs,
            parameters,
            disabled_parameters,
            generation,
        } => {
            let app_handle = app.clone();
            let prefer_shared_memory_input = state
                .state
                .lock()
                .map(|state| prefer_shared_memory_art_input(&state.negotiated_transport))
                .unwrap_or(false);
            thread::spawn(move || {
                forward_hook_art_execute(
                    &app_handle,
                    &node_id,
                    &art_id,
                    &request_id,
                    generation,
                    &inputs,
                    &parameters,
                    &disabled_parameters,
                    prefer_shared_memory_input,
                );
            });
        }
        LoomHookAction::CancelArt {
            node_id,
            request_id,
            generation,
        } => {
            thread::spawn(move || {
                forward_hook_art_cancel(&node_id, &request_id, generation);
            });
        }
        LoomHookAction::UpdateWorkflowNode {
            request_id,
            workflow_id,
            node_id,
            parameter_id,
            value,
        } => {
            let app_handle = app.clone();
            thread::spawn(move || {
                send_hook_control_request(
                    &app_handle,
                    serde_json::json!({
                        "method": "loom.hook.workflow.node.update",
                        "params": {
                            "requestId": request_id,
                            "workflowId": workflow_id,
                            "nodeId": node_id,
                            "parameterId": parameter_id,
                            "value": value
                        }
                    }),
                    Duration::from_secs(5),
                    "hook/sync_error",
                );
            });
        }
        LoomHookAction::SyncWorkflow {
            workflow_id,
            snapshot,
        } => {
            println!("Syncing Workflow Snapshot: {}", workflow_id);
            let app_handle = app.clone();
            thread::spawn(move || {
                send_hook_control_request(
                    &app_handle,
                    serde_json::json!({
                        "method": "loom.hook.workflow.sync",
                        "params": {
                            "requestId": format!("workflow-sync:{}", Uuid::new_v4()),
                            "workflowId": workflow_id,
                            "snapshot": snapshot
                        }
                    }),
                    Duration::from_secs(5),
                    "hook/sync_error",
                );
            });
        }
        LoomHookAction::SurfaceEvent { event } => {
            send_surface_event_to_loom(&app, event).await?;
        }
        LoomHookAction::SurfaceLifecycle { event } => {
            send_surface_lifecycle_to_loom(&app, event).await?;
        }
        LoomHookAction::SurfaceConfirmation { decision } => {
            send_surface_confirmation_to_loom(&app, decision).await?;
        }
        LoomHookAction::SurfaceCancel { request } => {
            send_surface_cancel_to_loom(&app, request).await?;
        }
        LoomHookAction::SurfaceResource { lease } => {
            fetch_surface_resource_from_loom(&app, &lease).await?;
        }
        LoomHookAction::SurfaceAttach {
            art_id,
            hook_node_id,
            device_id: _,
            capabilities,
        } => {
            attach_surface_via_loom(&app, &art_id, &hook_node_id, capabilities).await?;
        }
        LoomHookAction::SurfaceRemount {
            instance_id,
            attachment_id,
            hook_node_id,
        } => {
            remount_surface_via_loom(&app, &instance_id, &attachment_id, &hook_node_id).await?;
        }
    }

    Ok(())
}

async fn send_surface_event_to_loom(
    app: &AppHandle,
    event: serde_json::Value,
) -> Result<(), String> {
    let instance_id = event
        .get("instanceId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Surface event has no instance id".to_owned())?;
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface event: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::apply_to_url(reqwest::Client::builder(), base)
        .map_err(|error| format!("configure Surface event client: {error}"))?
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("build Surface event client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, base).await?;
    let response = authorization
        .apply(client.post(format!("{base}/v1/surfaces/instances/{instance_id}/events")))
        .json(&event)
        .send()
        .await
        .map_err(|error| format!("Surface event request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("read Surface event response: {error}"))?;
    if !status.is_success() {
        return Err(format!("Surface event request returned {status}: {body}"));
    }
    Ok(())
}

async fn attach_surface_via_loom(
    app: &AppHandle,
    art_id: &str,
    hook_node_id: &str,
    capabilities: serde_json::Value,
) -> Result<(), String> {
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface attach: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::apply_to_url(reqwest::Client::builder(), base)
        .map_err(|error| format!("configure Surface HTTP client: {error}"))?
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("build Surface HTTP client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, base).await?;
    let send_json = |request: reqwest::RequestBuilder| async {
        let response = request
            .send()
            .await
            .map_err(|error| format!("Surface request failed: {error}"))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| format!("read Surface response: {error}"))?;
        if !status.is_success() {
            return Err(format!("Surface request returned {status}: {body}"));
        }
        serde_json::from_str::<serde_json::Value>(&body)
            .map_err(|error| format!("parse Surface response: {error}"))
    };

    let mounted = send_json(
        authorization
            .apply(client.post(format!("{base}/v1/surfaces/attach")))
            .json(&serde_json::json!({
                "artId": art_id,
                "hookNodeId": hook_node_id,
                "deviceId": authorization.device_id,
                "capabilities": capabilities,
                "persistence": "persistent",
            })),
    )
    .await?;
    let instance_id = mounted
        .pointer("/instance/descriptor/instanceId")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Surface attach response has no instance id".to_owned())?;
    let attachments = mounted
        .pointer("/instance/attachments")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "Surface attach response has no attachments".to_owned())?;
    let (attachment_id, attachment) = attachments
        .iter()
        .find(|(_, attachment)| {
            attachment
                .pointer("/descriptor/hookNodeId")
                .and_then(serde_json::Value::as_str)
                == Some(hook_node_id)
        })
        .ok_or_else(|| "Surface attach response has no matching attachment".to_owned())?;
    let snapshot = mounted
        .pointer(&format!(
            "/instance/attachments/{}/snapshot",
            escape_json_pointer_token(attachment_id)
        ))
        .cloned()
        .ok_or_else(|| "Surface mount response has no snapshot".to_owned())?;
    let generation = mounted
        .pointer("/instance/descriptor/generation")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default();
    let lifecycle_revision = attachment
        .get("lifecycleRevision")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(1);
    app.emit(
        "surface/snapshot",
        serde_json::json!({
            "hookNodeId": hook_node_id,
            "snapshot": snapshot,
            "generation": generation,
        }),
    )
    .map_err(|error| format!("emit mounted Surface snapshot: {error}"))?;
    send_surface_lifecycle_to_loom(
        app,
        serde_json::json!({
            "protocolVersion": "loom.surface.v1",
            "instanceId": instance_id,
            "attachmentId": attachment_id,
            "state": "active",
            "revision": lifecycle_revision.saturating_add(1),
        }),
    )
    .await?;
    Ok(())
}

async fn remount_surface_via_loom(
    app: &AppHandle,
    instance_id: &str,
    attachment_id: &str,
    hook_node_id: &str,
) -> Result<(), String> {
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface remount: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::apply_to_url(reqwest::Client::builder(), base)
        .map_err(|error| format!("configure Surface remount client: {error}"))?
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("build Surface remount client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, base).await?;
    let mut mount_url = reqwest::Url::parse(base)
        .map_err(|error| format!("parse Surface remount base URL: {error}"))?;
    mount_url
        .path_segments_mut()
        .map_err(|_| "Surface remount base URL cannot carry path segments".to_owned())?
        .extend(["v1", "surfaces", "instances", instance_id, "mount"]);
    let response = authorization
        .apply(client.post(mount_url))
        .json(&serde_json::json!({ "attachmentId": attachment_id }))
        .send()
        .await
        .map_err(|error| format!("Surface remount request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("read Surface remount response: {error}"))?;
    if !status.is_success() {
        return Err(format!("Surface remount request returned {status}: {body}"));
    }
    let mounted = serde_json::from_str::<serde_json::Value>(&body)
        .map_err(|error| format!("parse Surface remount response: {error}"))?;
    let snapshot = mounted
        .pointer(&format!(
            "/instance/attachments/{}/snapshot",
            escape_json_pointer_token(attachment_id)
        ))
        .cloned()
        .ok_or_else(|| "Surface remount response has no snapshot".to_owned())?;
    let generation = mounted
        .pointer("/instance/descriptor/generation")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_default();
    app.emit(
        "surface/snapshot",
        serde_json::json!({
            "hookNodeId": hook_node_id,
            "snapshot": snapshot,
            "generation": generation,
        }),
    )
    .map_err(|error| format!("emit recovered Surface snapshot: {error}"))?;
    Ok(())
}

async fn send_surface_lifecycle_to_loom(
    app: &AppHandle,
    event: serde_json::Value,
) -> Result<(), String> {
    let instance_id = event
        .get("instanceId")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Surface lifecycle event has no instance id".to_owned())?;
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface lifecycle: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::apply_to_url(reqwest::Client::builder(), base)
        .map_err(|error| format!("configure Surface lifecycle client: {error}"))?
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("build Surface lifecycle client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, base).await?;
    let request = authorization
        .apply(client.post(format!(
            "{base}/v1/surfaces/instances/{instance_id}/lifecycle"
        )))
        .json(&event);
    let response = request
        .send()
        .await
        .map_err(|error| format!("Surface lifecycle request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("read Surface lifecycle response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Surface lifecycle request returned {status}: {body}"
        ));
    }
    Ok(())
}

async fn send_surface_confirmation_to_loom(
    app: &AppHandle,
    decision: serde_json::Value,
) -> Result<(), String> {
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface confirmation: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::apply_to_url(reqwest::Client::builder(), base)
        .map_err(|error| format!("configure Surface confirmation client: {error}"))?
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("build Surface confirmation client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, base).await?;
    let request = authorization
        .apply(client.post(format!("{base}/v1/surfaces/confirmations/decision")))
        .json(&decision);
    let response = request
        .send()
        .await
        .map_err(|error| format!("Surface confirmation request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("read Surface confirmation response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Surface confirmation request returned {status}: {body}"
        ));
    }
    Ok(())
}

async fn send_surface_cancel_to_loom(
    app: &AppHandle,
    mut request_body: serde_json::Value,
) -> Result<(), String> {
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface cancellation: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::apply_to_url(reqwest::Client::builder(), base)
        .map_err(|error| format!("configure Surface cancellation client: {error}"))?
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("build Surface cancellation client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, base).await?;
    request_body["deviceId"] = serde_json::Value::String(authorization.device_id.clone());
    let request = authorization
        .apply(client.post(format!("{base}/v1/surfaces/actions/cancel")))
        .json(&request_body);
    let response = request
        .send()
        .await
        .map_err(|error| format!("Surface cancellation request failed: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("read Surface cancellation response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Surface cancellation request returned {status}: {body}"
        ));
    }
    Ok(())
}

async fn fetch_surface_resource_from_loom(
    app: &AppHandle,
    lease: &serde_json::Value,
) -> Result<(), String> {
    use sha2::{Digest as _, Sha256};

    const MAX_SURFACE_RESOURCE_BYTES: usize = 16 * 1024 * 1024;
    let resource_id = lease
        .pointer("/resource/resourceId")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Surface resource lease has no resource id".to_owned())?;
    let lease_id = lease
        .get("leaseId")
        .and_then(serde_json::Value::as_str)
        .filter(|lease_id| {
            !lease_id.is_empty()
                && lease_id.len() <= 160
                && lease_id.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
                })
        })
        .ok_or_else(|| "Surface resource lease id is invalid".to_owned())?;
    let digest = resource_id
        .strip_prefix("sha256:")
        .filter(|digest| digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or_else(|| "Surface resource id is not a SHA-256 digest".to_owned())?;
    let expected_size = lease
        .pointer("/resource/size")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "Surface resource lease has no size".to_owned())?;
    if expected_size == 0 || expected_size > MAX_SURFACE_RESOURCE_BYTES as u64 {
        return Err("Surface resource size exceeds the Hook budget".to_owned());
    }
    let expires_at_ms = lease
        .get("expiresAtMs")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| "Surface resource lease has no expiry".to_owned())?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("read system clock for Surface resource: {error}"))?
        .as_millis() as u64;
    if expires_at_ms <= now_ms || expires_at_ms > now_ms.saturating_add(60 * 60 * 1_000) {
        return Err("Surface resource lease is expired or exceeds the lease budget".to_owned());
    }
    let mime = lease
        .pointer("/resource/mime")
        .and_then(serde_json::Value::as_str)
        .filter(|mime| !mime.trim().is_empty() && mime.len() <= 160 && mime.is_ascii())
        .ok_or_else(|| "Surface resource MIME type is invalid".to_owned())?;
    let transport_kind = lease
        .pointer("/transport/kind")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Surface resource transport is missing".to_owned())?;
    let verify_digest = |bytes: &[u8]| -> Result<(), String> {
        if bytes.len() as u64 != expected_size || bytes.len() > MAX_SURFACE_RESOURCE_BYTES {
            return Err("Surface resource size does not match its descriptor".to_owned());
        }
        let actual = Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        if !actual.eq_ignore_ascii_case(digest) {
            return Err("Surface resource failed digest validation".to_owned());
        }
        Ok(())
    };
    let to_data_url = |bytes: Vec<u8>| -> Result<String, String> {
        if mime != "application/x-neuro-rgba8" {
            return Ok(format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            ));
        }
        let width = lease
            .pointer("/resource/width")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| "Surface RGBA resource has no valid width".to_owned())?;
        let height = lease
            .pointer("/resource/height")
            .and_then(serde_json::Value::as_u64)
            .and_then(|value| u32::try_from(value).ok())
            .filter(|value| *value > 0)
            .ok_or_else(|| "Surface RGBA resource has no valid height".to_owned())?;
        let rgba_size = u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| "Surface RGBA dimensions overflow".to_owned())?;
        if rgba_size != bytes.len() as u64 {
            return Err("Surface RGBA dimensions do not match its payload".to_owned());
        }
        let image = RgbaImage::from_raw(width, height, bytes)
            .ok_or_else(|| "Surface RGBA payload is invalid".to_owned())?;
        let mut encoded = Cursor::new(Vec::new());
        image
            .write_to(&mut encoded, image::ImageFormat::Png)
            .map_err(|error| format!("encode Surface RGBA resource: {error}"))?;
        Ok(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(encoded.into_inner())
        ))
    };
    let emit_resource = |data_url: String| -> Result<(), String> {
        app.emit(
            "surface/resource",
            serde_json::json!({
                "leaseId": lease_id,
                "resourceId": resource_id,
                "dataUrl": data_url,
                "expiresAtMs": expires_at_ms,
            }),
        )
        .map_err(|error| format!("emit Surface resource: {error}"))
    };
    if transport_kind == "shared_memory" {
        if mime != "application/x-neuro-rgba8" {
            return Err("Surface shared memory uses an unsupported MIME type".to_owned());
        }
        let handle = lease
            .pointer("/transport/handle")
            .and_then(serde_json::Value::as_str)
            .filter(|handle| {
                !handle.is_empty()
                    && handle.len() <= 160
                    && handle.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric()
                            || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
                    })
            })
            .ok_or_else(|| "Surface shared-memory handle is invalid".to_owned())?;
        let memory = ShmemConf::new()
            .size(expected_size as usize)
            .os_id(handle)
            .open()
            .map_err(|error| format!("open Surface shared memory: {error}"))?;
        let bytes =
            unsafe { std::slice::from_raw_parts(memory.as_ptr(), expected_size as usize).to_vec() };
        verify_digest(&bytes)?;
        return emit_resource(to_data_url(bytes)?);
    }
    if transport_kind != "loom_resource" {
        return Err("Surface resource transport is not supported".to_owned());
    }
    let path = lease
        .pointer("/transport/path")
        .and_then(serde_json::Value::as_str)
        .filter(|path| {
            *path == format!("/v1/surfaces/resources/{digest}")
                && !path.contains('?')
                && !path.contains('#')
        })
        .ok_or_else(|| "Surface resource path is invalid".to_owned())?;
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|error| format!("read Loom manifest for Surface resource: {error}"))?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let client = crate::network_proxy::apply_to_url(reqwest::Client::builder(), base)
        .map_err(|error| format!("configure Surface resource client: {error}"))?
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("build Surface resource client: {error}"))?;
    let authorization = crate::device_session::authorize_surface_request(app, base).await?;
    let request = authorization
        .apply(client.get(format!("{base}{path}")))
        .header("X-Loom-Surface-Lease", lease_id);
    let response = request
        .send()
        .await
        .map_err(|error| format!("Surface resource request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Surface resource request returned {}",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_SURFACE_RESOURCE_BYTES as u64)
    {
        return Err("Surface resource response exceeds the Hook budget".to_owned());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("read Surface resource response: {error}"))?;
    verify_digest(&bytes)?;
    emit_resource(to_data_url(bytes.to_vec())?)
}

fn escape_json_pointer_token(value: &str) -> String {
    value.replace('~', "~0").replace('/', "~1")
}

/// Helper to resolve image path from UUID
fn resolve_image_path(uuid: &str) -> Option<String> {
    if let Some(config_dir) = dirs::config_dir() {
        let candidates = [config_dir.join("com.yamiyu.hook").join("images")];

        let extensions = vec!["png", "jpg", "jpeg", "webp"];

        for dir in candidates {
            if !dir.exists() {
                continue;
            }

            // 1. Try with extensions
            for ext in &extensions {
                let p = dir.join(format!("{}.{}", uuid, ext));
                if p.exists() {
                    return Some(p.to_string_lossy().to_string());
                }
            }
            // 2. Try exact match (no extension)
            let p = dir.join(uuid);
            if p.exists() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn decode_hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn percent_decode_lossy(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut decoded: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) = (
                decode_hex_nibble(bytes[index + 1]),
                decode_hex_nibble(bytes[index + 2]),
            ) {
                decoded.push((high << 4) | low);
                index += 3;
                continue;
            }
        }

        decoded.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&decoded).into_owned()
}

fn decode_asset_localhost_path(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw).ok()?;
    let is_asset_host = matches!(url.host_str(), Some("asset.localhost") | Some("localhost"));
    let is_asset_scheme = matches!(url.scheme(), "asset" | "http" | "https");
    if !is_asset_host || !is_asset_scheme {
        return None;
    }

    let encoded_path = url.path().trim_start_matches('/');
    if encoded_path.is_empty() {
        return None;
    }

    Some(percent_decode_lossy(encoded_path))
}

fn decode_file_url_path(raw: &str) -> Option<String> {
    let url = reqwest::Url::parse(raw).ok()?;
    if url.scheme() != "file" {
        return None;
    }
    let path = url.to_file_path().ok()?;
    Some(path.to_string_lossy().to_string())
}

fn load_rgba_image_from_path(path: &str) -> Option<RgbaImage> {
    let bytes = std::fs::read(path).ok()?;
    image::load_from_memory(&bytes)
        .ok()
        .map(|image| image.to_rgba8())
}

struct PreparedHookInput {
    descriptor: serde_json::Value,
    shmem_guard: Option<SafeShmem>,
}

fn prepare_inline_hook_input(image: &RgbaImage) -> Result<PreparedHookInput, String> {
    let mut png_buf = Cursor::new(Vec::new());
    image
        .write_to(&mut png_buf, image::ImageFormat::Png)
        .map_err(|error| format!("encode Art input PNG: {error}"))?;
    let data_base64 = base64::engine::general_purpose::STANDARD.encode(png_buf.into_inner());
    Ok(PreparedHookInput {
        descriptor: serde_json::json!({
            "kind": "inline_resource",
            "mime": "image/png",
            "dataBase64": data_base64,
            "width": image.width(),
            "height": image.height(),
        }),
        shmem_guard: None,
    })
}

fn prepare_hook_input(
    image: &RgbaImage,
    prefer_shared_memory: bool,
) -> Result<PreparedHookInput, String> {
    let raw = image.as_raw();
    if prefer_shared_memory && raw.len() >= SHARED_MEMORY_ART_INPUT_MIN_BYTES {
        let handle = format!("hook-art-input-{}", Uuid::new_v4());
        match ShmemConf::new().size(raw.len()).os_id(&handle).create() {
            Ok(shmem) => {
                unsafe {
                    std::ptr::copy_nonoverlapping(raw.as_ptr(), shmem.as_ptr(), raw.len());
                }
                return Ok(PreparedHookInput {
                    descriptor: serde_json::json!({
                        "kind": "shared_memory",
                        "handle": handle,
                        "size": raw.len(),
                        "width": image.width(),
                        "height": image.height(),
                        "format": "rgba8",
                    }),
                    shmem_guard: Some(SafeShmem(shmem)),
                });
            }
            Err(error) => {
                println!(
                    "[LOOM_HOOK] Shared-memory Art input allocation failed; falling back to Base64: {error}"
                );
            }
        }
    }

    prepare_inline_hook_input(image)
}

fn load_input_rgba_image(source: Option<&String>) -> Option<RgbaImage> {
    let raw = source?.trim();
    if raw.is_empty() {
        return None;
    }

    if raw.starts_with("data:") {
        let encoded = raw
            .split_once(',')
            .map(|(_, payload)| payload)
            .unwrap_or(raw);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .ok()?;
        return image::load_from_memory(&bytes)
            .ok()
            .map(|image| image.to_rgba8());
    }

    if raw.len() == 36 && raw.matches('-').count() == 4 {
        if let Some(path) = resolve_image_path(raw) {
            if let Some(image) = load_rgba_image_from_path(&path) {
                return Some(image);
            }
        }
    }

    if let Some(path) = decode_asset_localhost_path(raw).or_else(|| decode_file_url_path(raw)) {
        if let Some(image) = load_rgba_image_from_path(&path) {
            return Some(image);
        }
    }

    let file_path = std::path::Path::new(raw);
    if file_path.exists() {
        if let Some(image) = load_rgba_image_from_path(raw) {
            return Some(image);
        }
    }

    let bytes = base64::engine::general_purpose::STANDARD.decode(raw).ok()?;
    image::load_from_memory(&bytes)
        .ok()
        .map(|image| image.to_rgba8())
}

// Age-based sweep of materialized shader temp files in `dir`. Only files whose
// names start with the shader-input prefixes and are older than `max_age_secs`
// are removed, so an in-flight file (just written, being consumed downstream) is
// never deleted. Without this the temp dir accumulates one PNG per data-URI
// shader input forever.
fn cleanup_stale_shader_temp_files(dir: &std::path::Path, max_age_secs: u64) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    let now = std::time::SystemTime::now();
    let max_age = Duration::from_secs(max_age_secs);
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let is_shader_temp = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.starts_with("loom_hook_shader_"))
            .unwrap_or(false);
        if !is_shader_temp {
            continue;
        }
        let modified = match entry.metadata().and_then(|m| m.modified()) {
            Ok(modified) => modified,
            Err(_) => continue,
        };
        if now.duration_since(modified).unwrap_or_default() > max_age {
            let _ = std::fs::remove_file(&path);
        }
    }
}

fn materialize_shader_image_input(value: Option<&String>, label: &str) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }

    if let Some(path) = decode_asset_localhost_path(raw).or_else(|| decode_file_url_path(raw)) {
        return Some(path);
    }

    if raw.len() == 36 && raw.matches('-').count() == 4 {
        return resolve_image_path(raw).or_else(|| Some(raw.to_string()));
    }

    if raw.starts_with("data:") {
        let encoded = raw.split_once(',').map(|(_, data)| data).unwrap_or(raw);
        match base64::engine::general_purpose::STANDARD.decode(encoded) {
            Ok(bytes) => {
                let filename_prefix = match label {
                    "input" => "loom_hook_shader_input",
                    "reference" => "loom_hook_shader_reference",
                    _ => "loom_hook_shader_image",
                };
                // Age out previously materialized shader temp files so this
                // directory does not grow without bound. The freshly written file
                // is returned for downstream use, so we only drop stale ones.
                cleanup_stale_shader_temp_files(&std::env::temp_dir(), 3600);
                let path = std::env::temp_dir().join(format!(
                    "{}_{}.png",
                    filename_prefix,
                    Uuid::new_v4()
                ));
                match std::fs::write(&path, bytes) {
                    Ok(_) => {
                        return Some(path.to_string_lossy().to_string());
                    }
                    Err(error) => {
                        println!(
                            "[LoomHook] Failed to write materialized shader {} image: {}",
                            label, error
                        );
                        return None;
                    }
                }
            }
            Err(error) => {
                println!(
                    "[LoomHook] Failed to decode shader {} data URI: {}",
                    label, error
                );
                return None;
            }
        }
    }

    Some(raw.to_string())
}

fn try_prefetch_shader_via_loom(
    art_id: &str,
    input_path: Option<&str>,
    reference_path: Option<&str>,
) -> Result<serde_json::Value, String> {
    use tungstenite::{connect, Message as WsMessage};

    let request_id = format!("shader-prefetch:{}", Uuid::new_v4());
    let node_id = format!("shader-prefetch:{art_id}");
    let body = serde_json::json!({
        "method": "loom.hook.art.execute",
        "params": {
            "protocolVersion": "loom.hook.v1",
            "requestId": request_id,
            "nodeId": node_id,
            "artId": art_id,
            "generation": 1,
            "deviceId": "device:local",
            "outputTransports": ["websocket"],
            "inputs": {},
            "parameters": {
            "output_mode": "shader",
            "mode": "shader",
            "input_path": input_path.unwrap_or(""),
            "reference_path": reference_path.unwrap_or(""),
            },
            "disabledParameters": []
        }
    });
    let ws_url = loom_hook_ws_url();
    let (mut socket, _) = connect(ws_url.as_str())
        .map_err(|error| format!("Loom Hook protocol is unavailable at {ws_url}: {error}"))?;
    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) = socket.get_ref() {
        let _ = tcp.set_read_timeout(Some(Duration::from_secs(20)));
    }
    socket
        .send(WsMessage::Text(body.to_string().into()))
        .map_err(|error| format!("Failed to send shader execution request: {error}"))?;

    loop {
        let message = socket
            .read()
            .map_err(|error| format!("Failed to read shader execution result: {error}"))?;
        let WsMessage::Text(text) = message else {
            continue;
        };
        let response: serde_json::Value = serde_json::from_str(&text)
            .map_err(|error| format!("Failed to parse shader execution result: {error}"))?;
        if response["protocolVersion"].as_str() != Some("loom.hook.v1") {
            continue;
        }
        let response_request_id = response["requestId"]
            .as_str()
            .or_else(|| response["params"]["requestId"].as_str());
        if response_request_id != Some(request_id.as_str()) {
            continue;
        }
        if response["method"].as_str() == Some("loom.hook.art.failure")
            || matches!(response["status"].as_str(), Some("failed" | "cancelled"))
        {
            let message = response["params"]["error"]["message"]
                .as_str()
                .or_else(|| response["error"]["message"].as_str())
                .unwrap_or("Loom shader execution failed");
            return Err(message.to_owned());
        }
        let outputs = if response["method"].as_str() == Some("loom.hook.art.result") {
            &response["params"]["outputs"]
        } else if response["status"].as_str() == Some("succeeded") {
            &response["data"]["outputs"]
        } else {
            continue;
        };
        let Some(map) = outputs.as_object() else {
            return Err("Loom shader execution returned no output".to_owned());
        };
        let value = preferred_formal_output(map)
            .map(|(_, value)| value)
            .ok_or_else(|| "Loom shader execution returned no output".to_owned())?;
        if value["kind"].as_str() != Some("value") {
            return Err("Loom shader execution returned a non-value output".to_owned());
        }
        return unwrap_formal_shader_output(value["value"].clone());
    }
}

fn unwrap_formal_shader_output(value: serde_json::Value) -> Result<serde_json::Value, String> {
    if value.get("type").and_then(serde_json::Value::as_str) == Some("shader") {
        return Ok(value);
    }
    let text = value
        .get("content")
        .and_then(serde_json::Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("text"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Loom Art did not return a shader payload".to_owned())?;
    let parsed = serde_json::from_str::<serde_json::Value>(text)
        .map_err(|error| format!("Loom Art returned invalid shader JSON: {error}"))?;
    if parsed.get("type").and_then(serde_json::Value::as_str) != Some("shader") {
        return Err("Loom Art returned JSON that is not a shader payload".to_owned());
    }
    Ok(parsed)
}

/// Prefetch shader code from the installed Loom Art package.
#[tauri::command]
pub async fn prefetch_shader(
    art_id: String,
    input_path: Option<String>,
    reference_path: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        prefetch_shader_blocking(art_id, input_path, reference_path)
    })
    .await
    .map_err(|e| format!("Shader prefetch task failed: {}", e))?
}

fn prefetch_shader_blocking(
    art_id: String,
    input_path: Option<String>,
    reference_path: Option<String>,
) -> Result<serde_json::Value, String> {
    println!("[LoomHook] Prefetching shader for Art: {}", art_id);

    let resolved_input_path = materialize_shader_image_input(input_path.as_ref(), "input");
    let resolved_reference_path =
        materialize_shader_image_input(reference_path.as_ref(), "reference");

    println!(
        "[LoomHook] Resolved paths: input={}, reference={}",
        resolved_input_path.as_deref().unwrap_or("<none>"),
        resolved_reference_path.as_deref().unwrap_or("<none>")
    );

    let result = try_prefetch_shader_via_loom(
        &art_id,
        resolved_input_path.as_deref(),
        resolved_reference_path.as_deref(),
    )?;
    println!("[LoomHook] Loom shader prefetch succeeded.");
    Ok(result)
}

#[cfg(test)]
mod input_image_resolution {
    use super::*;
    use image::Rgba;
    use std::path::PathBuf;

    fn write_test_png(path: &std::path::Path, width: u32, height: u32, rgba: [u8; 4]) {
        let mut img = RgbaImage::new(width, height);
        for pixel in img.pixels_mut() {
            *pixel = Rgba(rgba);
        }
        img.save(path).expect("save test png");
    }

    fn asset_localhost_url_for(path: &std::path::Path) -> String {
        let raw = path.to_string_lossy().to_string();
        let encoded = raw
            .replace('%', "%25")
            .replace(':', "%3A")
            .replace('\\', "%5C")
            .replace(' ', "%20");
        format!("http://asset.localhost/{encoded}")
    }

    #[test]
    fn loads_asset_localhost_input_image_into_rgba_buffer() {
        let temp_path =
            std::env::temp_dir().join(format!("loom-hook-input-{}.png", Uuid::new_v4()));
        write_test_png(&temp_path, 3, 2, [12, 34, 56, 255]);

        let asset_url = asset_localhost_url_for(&temp_path);
        let img = load_input_rgba_image(Some(&asset_url)).expect("load asset input");

        assert_eq!((img.width(), img.height()), (3, 2));
        assert_eq!(img.get_pixel(0, 0).0, [12, 34, 56, 255]);

        let _ = std::fs::remove_file(temp_path);
    }

    #[test]
    fn materializes_asset_localhost_shader_input_back_to_local_path() {
        let temp_path = std::env::temp_dir().join(format!(
            "loom-hook-materialize-asset-{}.png",
            Uuid::new_v4()
        ));
        write_test_png(&temp_path, 4, 3, [44, 55, 66, 255]);

        let asset_url = asset_localhost_url_for(&temp_path);
        let materialized = materialize_shader_image_input(Some(&asset_url), "reference")
            .expect("materialize asset-localhost shader input");

        assert_eq!(PathBuf::from(materialized), temp_path);

        let _ = std::fs::remove_file(temp_path);
    }

    #[test]
    fn materializes_file_url_shader_input_back_to_local_path() {
        let temp_path = std::env::temp_dir().join(format!(
            "loom-hook-materialize-file-url-{}.png",
            Uuid::new_v4()
        ));
        write_test_png(&temp_path, 5, 1, [77, 88, 99, 255]);

        let file_url = reqwest::Url::from_file_path(&temp_path)
            .expect("file url")
            .to_string();
        let materialized = materialize_shader_image_input(Some(&file_url), "input")
            .expect("materialize file-url shader input");

        assert_eq!(PathBuf::from(materialized), temp_path);

        let _ = std::fs::remove_file(temp_path);
    }

    #[test]
    fn loads_plain_file_path_input_image_into_rgba_buffer() {
        let temp_path =
            std::env::temp_dir().join(format!("loom-hook-path-input-{}.png", Uuid::new_v4()));
        write_test_png(&temp_path, 2, 4, [90, 80, 70, 255]);

        let img = load_input_rgba_image(Some(&temp_path.to_string_lossy().to_string()))
            .expect("load file path input");

        assert_eq!((img.width(), img.height()), (2, 4));
        assert_eq!(img.get_pixel(1, 3).0, [90, 80, 70, 255]);

        let _ = std::fs::remove_file(temp_path);
    }

    #[test]
    fn large_local_art_input_prefers_shared_memory_when_negotiated() {
        let mut image = RgbaImage::new(256, 256);
        image.put_pixel(0, 0, Rgba([12, 34, 56, 78]));

        let prepared = prepare_hook_input(&image, true).expect("prepare shared input");

        assert_eq!(prepared.descriptor["kind"], "shared_memory");
        assert_eq!(
            prepared.descriptor["size"].as_u64(),
            Some((256 * 256 * 4) as u64)
        );
        let guard = prepared.shmem_guard.as_ref().expect("shared memory guard");
        let first_pixel = unsafe { std::slice::from_raw_parts(guard.0.as_ptr(), 4) };
        assert_eq!(first_pixel, [12, 34, 56, 78]);
    }

    #[test]
    fn art_input_keeps_inline_resource_fallback_for_small_or_non_shared_sessions() {
        let small = RgbaImage::from_pixel(1, 1, Rgba([1, 2, 3, 255]));
        let small_prepared = prepare_hook_input(&small, true).expect("prepare small input");
        assert_eq!(small_prepared.descriptor["kind"], "inline_resource");
        assert!(small_prepared.shmem_guard.is_none());

        let large = RgbaImage::from_pixel(256, 256, Rgba([4, 5, 6, 255]));
        let fallback = prepare_hook_input(&large, false).expect("prepare fallback input");
        assert_eq!(fallback.descriptor["kind"], "inline_resource");
        assert!(!fallback.descriptor["dataBase64"]
            .as_str()
            .expect("base64 payload")
            .starts_with("data:"));
        assert!(fallback.shmem_guard.is_none());
    }
}
