use crate::process_utils::configure_child_no_window;
use base64::Engine as _;
use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use shared_memory::ShmemConf;
use std::collections::HashMap;
use std::io::Cursor;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use uuid::Uuid; // Import Engine trait for encode/decode methods

// =========================================================================
// 1. Protocol Definitions (AHNP & AHRP)
// =========================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum TransportMode {
    Websocket,
    SharedMemory,
    NamedPipe,
    CloudflareRelay,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArtLoomHandshake {
    pub server_name: String,
    pub protocol_version: String,
    pub session_id: String,
    #[serde(rename = "negotiated_transport")]
    pub transport: TransportMode,
    pub capabilities: ArtLoomCapabilities,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArtLoomCapabilities {
    pub supported_unit_types: Vec<String>, // "sticker", "link", "art"
    pub supported_interactions: Vec<String>, // "drag", "resize", "connect"
    pub art_definitions: Vec<ArtDefinition>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArtDefinition {
    pub id: String, // e.g. "core.image.pixelate"
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    pub params: Vec<ArtParameter>,
    #[serde(default)]
    pub auto_process: bool,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub defaults: HashMap<String, serde_json::Value>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_type: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution: Option<serde_json::Value>,

    // Legacy fields - made optional for compatibility
    #[serde(default)]
    pub input_schema: Option<HashMap<String, String>>,
    #[serde(default)]
    pub output_schema: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArtParameter {
    pub id: String,
    pub label: String,
    #[serde(rename = "widget")] // ArtLoom uses "widget", matches JSON
    pub param_type: String,
    pub default: serde_json::Value,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub options: Option<Vec<String>>,
    pub multiline: Option<bool>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub data_type: Option<String>, // Added to match ArtLoom JSON schema
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HandshakeRequest {
    pub client_version: String,
    pub preferred_transports: Vec<TransportMode>,
}

// Actions (Frontend -> Backend)
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action", content = "payload")]
pub enum ArtLoomAction {
    #[serde(rename = "update_node_param")]
    UpdateNodeParam {
        node_id: String,
        param_key: String,
        value: serde_json::Value,
        input_image: Option<String>,
        art_id: Option<String>, // Added art_id to identify effect type
        #[serde(default)]
        all_params: Option<HashMap<String, serde_json::Value>>, // All params for complete state
        #[serde(default)]
        disabled_params: Option<Vec<String>>, // Instance-level disabled params (from Hook)
        origin_workflow_id: Option<String>,
        #[serde(default)]
        origin_node_id: Option<String>,
    },

    #[serde(rename = "sync_workflow")]
    SyncWorkflow {
        workflow_id: String,
        snapshot: serde_json::Value, // Full JSON of the workflow (nodes + edges)
    },
    // Future: ConnectNodes, specific functionality
}

// =========================================================================
// 2. Mock State
// =========================================================================

// Wrapper for Shmem to allow sending across threads (Safe because we only store it)
#[allow(dead_code)]
pub struct SafeShmem(pub shared_memory::Shmem);
unsafe impl Send for SafeShmem {}
unsafe impl Sync for SafeShmem {}

pub struct MockArtLoomState {
    pub session_id: String,
    pub active_nodes: HashMap<String, HashMap<String, serde_json::Value>>, // node_id -> { param -> value }
    // We must keep Shmem alive or it gets dropped and handle becomes invalid
    pub shmem_store: HashMap<String, SafeShmem>,
    pub listener_started: bool,
    pub backend_connected: bool,
    pub app_handle: Option<AppHandle>,
}

impl MockArtLoomState {
    fn set_app_handle(&mut self, app: AppHandle) {
        self.app_handle = Some(app);
    }
}

pub struct MockArtLoom {
    pub state: Arc<Mutex<MockArtLoomState>>,
    pub loaded_arts: Mutex<Vec<ArtDefinition>>,
}

impl MockArtLoom {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(MockArtLoomState {
                session_id: Uuid::new_v4().to_string(),
                active_nodes: HashMap::new(),
                shmem_store: HashMap::new(),
                listener_started: false,
                backend_connected: false,
                app_handle: None,
            })),
            loaded_arts: Mutex::new(Vec::new()),
        }
    }
}

fn artloom_ws_url() -> String {
    std::env::var("ARTLOOM_WS_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ws://127.0.0.1:19820".to_string())
}

fn load_arts_from_disk() -> Option<Vec<ArtDefinition>> {
    let config_dir = dirs::config_dir()?;
    let app_dir = config_dir.join("ArtNexus");
    let yaml_path = app_dir.join("arts.yaml");
    let json_path = app_dir.join("arts.json");

    let loaded = if yaml_path.exists() {
        std::fs::read_to_string(yaml_path)
            .ok()
            .and_then(|content| serde_yaml::from_str::<Vec<ArtDefinition>>(&content).ok())
    } else if json_path.exists() {
        std::fs::read_to_string(json_path)
            .ok()
            .and_then(|content| serde_json::from_str::<Vec<ArtDefinition>>(&content).ok())
    } else {
        None
    };

    if let Some(arts) = loaded {
        println!("Loaded {} arts from disk.", arts.len());
        for art in &arts {
            println!("[DEBUG] Art '{}' (id: {}) params:", art.label, art.id);
            for p in &art.params {
                println!(
                    "  - {} (widget: {}, min: {:?}, max: {:?}, step: {:?})",
                    p.id, p.param_type, p.min, p.max, p.step
                );
            }
        }
        return Some(arts);
    }

    None
}

fn extract_artloom_error_message(json: &serde_json::Value) -> String {
    json["error"]
        .as_str()
        .or_else(|| json["message"].as_str())
        .or_else(|| json["data"]["error"].as_str())
        .map(|message| message.trim().to_string())
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| format!("ArtLoom execution failed: {}", json))
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

fn emit_art_error(app_handle: &AppHandle, node_id: &str, error: impl AsRef<str>) {
    let message = error.as_ref().trim();
    let message = if message.is_empty() {
        "Art execution failed"
    } else {
        message
    };

    let _ = app_handle.emit(
        "art/ready",
        serde_json::json!({
            "art_id": node_id,
            "status": 500,
            "error": message,
            "delivery": {
                "type": "base64"
            }
        }),
    );
}

// Background Listener Function
fn start_listener(app: AppHandle, state: Arc<Mutex<MockArtLoomState>>) {
    thread::spawn(move || {
        println!("[MockArtLoom] Start Listener Thread...");
        loop {
            // Reconnection Loop
            use tungstenite::{connect, Message};
            let ws_url = artloom_ws_url();

            match connect(ws_url.as_str()) {
                Ok((mut socket, _)) => {
                    println!("[MockArtLoom] Listener connected to ArtLoom.");
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
                                // Parse Message (looking for "art_hook/instantiate")
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                                    if let Some(method) = json["method"].as_str() {
                                        if method == "art_hook/instantiate" {
                                            println!("[MockArtLoom] Received Instantiate Command!");
                                            let _ = app.emit("art/instantiate", &json["params"]);
                                        } else if method == "art_loom/arts_updated" {
                                            println!(
                                                "[MockArtLoom] Received Arts Updated Notification!"
                                            );
                                            let _ = app
                                                .emit("art/capabilities_updated", &json["params"]);
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
                    println!("[MockArtLoom] Listener disconnected. Retrying in 5s...");
                }
                Err(_e) => {
                    if let Ok(mut guard) = state.lock() {
                        guard.backend_connected = false;
                    }
                    println!("[MockArtLoom] Connection failed to {}. Retrying...", ws_url);
                }
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

// =========================================================================
// 3. Tauri Commands
// =========================================================================

#[tauri::command]
pub async fn artloom_handshake(
    app_handle: AppHandle,
    state: tauri::State<'_, MockArtLoom>,
    request: HandshakeRequest,
) -> Result<ArtLoomHandshake, String> {
    println!("AHNP Handshake Request: {:?}", request);

    // Simulate negotiation
    let transport = request
        .preferred_transports
        .iter()
        .find(|t| matches!(t, TransportMode::SharedMemory)) // Prefer shared memory for local
        .cloned()
        .or_else(|| request.preferred_transports.first().cloned())
        .unwrap_or(TransportMode::SharedMemory);

    let session_id = {
        let s = state.state.lock().map_err(|e| e.to_string())?;
        s.session_id.clone()
    };

    // Try load real arts, fallback to empty
    let arts = load_arts_from_disk().unwrap_or_else(|| {
        println!("No arts found on disk, returning empty.");
        vec![]
    });

    // Cache loaded arts for prefetch_shader
    {
        let mut loaded = state.loaded_arts.lock().unwrap();
        *loaded = arts.clone();
    }

    // START LISTENER THREAD (Persistent connection for IPC)
    {
        let mut s = state.state.lock().map_err(|e| e.to_string())?;
        // Store AppHandle first
        s.set_app_handle(app_handle.clone());

        if !s.listener_started {
            s.listener_started = true;
            let state_arc = state.state.clone();
            start_listener(app_handle.clone(), state_arc);
        }
    }

    let backend_connected = {
        let s = state.state.lock().map_err(|e| e.to_string())?;
        s.backend_connected
    };

    Ok(ArtLoomHandshake {
        server_name: if backend_connected {
            "artloom-desktop".to_string()
        } else {
            "hook-standalone".to_string()
        },
        protocol_version: "1.0.0".to_string(),
        session_id,
        transport,
        capabilities: ArtLoomCapabilities {
            supported_unit_types: vec![
                "sticker".to_string(),
                "link".to_string(),
                "art".to_string(),
            ],
            supported_interactions: vec!["drag".to_string(), "resize".to_string()],
            art_definitions: arts,
        },
    })
}

#[tauri::command]
pub async fn artloom_dispatch_action(
    app: AppHandle,
    state: tauri::State<'_, MockArtLoom>,
    action: ArtLoomAction,
) -> Result<(), String> {
    // Log action type without full data
    match &action {
        ArtLoomAction::UpdateNodeParam {
            node_id,
            param_key,
            art_id,
            input_image,
            ..
        } => {
            println!(
                "AHRP Action: UpdateNodeParam node_id={}, param_key={}, art_id={:?}, has_image={}",
                node_id,
                param_key,
                art_id,
                input_image.is_some()
            );
        }
        ArtLoomAction::SyncWorkflow { workflow_id, .. } => {
            println!("AHRP Action: SyncWorkflow id={}", workflow_id);
        }
    }

    match action {
        ArtLoomAction::UpdateNodeParam {
            node_id,
            param_key,
            value,
            input_image,
            art_id,
            all_params,
            disabled_params,
            origin_workflow_id,
            origin_node_id,
        } => {
            // Scope for lock
            {
                let mut s = state.state.lock().map_err(|e| e.to_string())?;
                let node_params = s
                    .active_nodes
                    .entry(node_id.clone())
                    .or_insert_with(HashMap::new);

                // If all_params is provided (e.g., from Apply button), merge all params
                if let Some(all) = &all_params {
                    for (k, v) in all {
                        node_params.insert(k.clone(), v.clone());
                    }
                }
                // Always update the current param
                node_params.insert(param_key.clone(), value.clone());
            } // Lock released

            println!(
                "Updated Node [{}] Param [{}] (value length: {})",
                node_id,
                param_key,
                value.to_string().len()
            );
            if let Some(ref dp) = disabled_params {
                println!("Disabled params from Hook: {:?}", dp);
            }

            // --- SYNC TO ARTLOOM (Reference Mode) ---
            if let (Some(wf_id), Some(orig_node_id)) = (origin_workflow_id, origin_node_id) {
                println!(
                    "Syncing update to ArtLoom Workflow: {}/{}",
                    wf_id, orig_node_id
                );
                let sync_param = param_key.clone();
                let sync_val = value.clone();

                thread::spawn(move || {
                    use tungstenite::{connect, Message};
                    let msg = serde_json::json!({
                        "method": "art_loom/update_workflow_node",
                        "params": {
                            "workflow_id": wf_id,
                            "node_id": orig_node_id,
                            "param": sync_param,
                            "value": sync_val
                        }
                    });

                    let ws_url = artloom_ws_url();
                    match connect(ws_url.as_str()) {
                        Ok((mut socket, _)) => {
                            if let Err(e) = socket.send(Message::Text(msg.to_string())) {
                                println!("Failed to send sync update: {}", e);
                            }
                            // Close immediate
                            let _ = socket.close(None);
                        }
                        Err(e) => println!("Failed to connect to {} for sync: {}", ws_url, e),
                    }
                });
            }

            // Spawn Processing Thread
            let app_handle = app.clone();
            let _node_id = node_id.clone();
            let state_arc = state.state.clone();
            let _disabled_params = disabled_params.clone(); // Clone for thread
            let loaded_arts = state.loaded_arts.lock().map_err(|e| e.to_string())?.clone();
            let _params = {
                let s = state.state.lock().unwrap();
                s.active_nodes.get(&node_id).cloned().unwrap_or_default()
            };

            thread::spawn(move || {
                // Simulate processing time
                thread::sleep(Duration::from_millis(200));

                println!(
                    "Processing Art Node: {} with params: {:?}",
                    _node_id, _params
                );

                let mut img = if let Some(b64) = input_image {
                    // Decode Base64 Input
                    use base64::Engine as _;
                    let clean_b64 = b64.split(",").last().unwrap_or(&b64);
                    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(clean_b64) {
                        image::load_from_memory(&bytes)
                            .map(|i| i.to_rgba8())
                            .unwrap_or_else(|_| RgbaImage::new(512, 512))
                    } else {
                        RgbaImage::new(512, 512)
                    }
                } else {
                    // Fallback to checkerboard
                    let mut blank = RgbaImage::new(512, 512);
                    for (x, y, pixel) in blank.enumerate_pixels_mut() {
                        let is_white = ((x / 32) + (y / 32)) % 2 == 0;
                        if is_white {
                            *pixel = Rgba([200, 200, 200, 255]);
                        } else {
                            *pixel = Rgba([50, 50, 50, 255]);
                        }
                    }
                    blank
                };

                // Determine Art Type
                let art_type = art_id.as_deref().unwrap_or("unknown");
                let mut direct_delivery: Option<serde_json::Value> = None;

                if art_type == "core.image.pixelate" {
                    // Simulate Pixelate -> Add YELLOW tint based on strength
                    // Param: "pixel_size" (1-100)
                    let intensity = _params
                        .get("pixel_size")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(10.0);
                    let alpha = (intensity * 2.5) as u8; // Map 0-100 to 0-250

                    println!(
                        "Applying Pixelate (Red Tint) Strength: {}, Alpha: {}",
                        intensity, alpha
                    );
                    if img.width() > 0 && img.height() > 0 {
                        println!("DEBUG: Pixel(0,0) BEFORE: {:?}", img.get_pixel(0, 0));
                    }

                    for (_, _, pixel) in img.enumerate_pixels_mut() {
                        let Rgba([r, g, b, a]) = *pixel;
                        // Yellow = Red + Green
                        // Blend: new = old * (1 - alpha) + yellow * alpha
                        // Simplified: Just add tint
                        *pixel = Rgba([r.saturating_add(alpha), g, b, a]);
                    }
                    if img.width() > 0 && img.height() > 0 {
                        println!("DEBUG: Pixel(0,0) AFTER: {:?}", img.get_pixel(0, 0));
                    }
                } else if art_type == "core.image.blur" {
                    // Simulate Blur -> Add GREEN tint based on strength
                    // Param: "radius" (0-50)
                    let intensity = _params
                        .get("radius")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(5.0);
                    let alpha = (intensity * 5.0) as u8; // Map 0-50 to 0-250

                    println!(
                        "Applying Burn (Green Tint) Strength: {}, Alpha: {}",
                        intensity, alpha
                    );
                    if img.width() > 0 && img.height() > 0 {
                        println!("DEBUG: Burn Pixel(0,0) BEFORE: {:?}", img.get_pixel(0, 0));
                    }

                    for (_, _, pixel) in img.enumerate_pixels_mut() {
                        let Rgba([r, g, b, a]) = *pixel;
                        // Green tint
                        *pixel = Rgba([r, g.saturating_add(alpha), b, a]);
                    }
                    if img.width() > 0 && img.height() > 0 {
                        println!("DEBUG: Burn Pixel(0,0) AFTER: {:?}", img.get_pixel(0, 0));
                    }
                } else {
                    // Custom Art - Forward to ArtLoom Backend via HTTP
                    println!(
                        "[MOCK_ARTLOOM] Custom Art '{}' detected, forwarding to ArtLoom...",
                        art_type
                    );

                    let art_def = loaded_arts.iter().find(|a| a.id == art_type).cloned();

                    if let Some(def) = art_def {
                        let et = def.execution_type.as_deref().unwrap_or("");
                        if et == "cloud_api"
                            || et == "script"
                            || et == "python"
                            || et == "mcp"
                            || et == "workflow"
                        {
                            println!("[MOCK_ARTLOOM] Forwarding execution request ({}) to ArtLoom via WebSocket...", et);

                            // Get image dimensions
                            let width = img.width();
                            let height = img.height();

                            // Encode current image to base64
                            let mut png_buf = Cursor::new(Vec::new());
                            img.write_to(&mut png_buf, image::ImageFormat::Png).ok();
                            let b64_img = format!(
                                "data:image/png;base64,{}",
                                base64::engine::general_purpose::STANDARD
                                    .encode(png_buf.into_inner())
                            );

                            // Resolve UUID params to paths
                            let mut resolved_params = _params.clone();
                            // _params is HashMap, so we iterate directly
                            for (k, v) in resolved_params.iter_mut() {
                                if let Some(s) = v.as_str() {
                                    if s.len() == 36 && s.matches('-').count() == 4 {
                                        if let Some(path) = resolve_image_path(s) {
                                            println!("[MOCK_ARTLOOM] Auto-resolved param '{}' (UUID) to: {}", k, path);
                                            *v = serde_json::Value::String(path);
                                        }
                                    }
                                }
                            }

                            // Build AHRP Request - matching ArtLoom's InputData schema!
                            let request_id = uuid::Uuid::new_v4().to_string();
                            let ahrp_request = serde_json::json!({
                                "method": "art/process",
                                "params": {
                                    "request_id": request_id,
                                    "art_id": art_type,
                                    "input": {
                                        "type": "base64",
                                        "data": b64_img,
                                        "width": width,
                                        "height": height,
                                        "format": "rgba8"
                                    },
                                    "params": resolved_params,
                                    "disabled_params": _disabled_params.clone().unwrap_or_default()
                                }
                            });

                            println!(
                                "[MOCK_ARTLOOM] AHRP Request: art_id={}, request_id={}",
                                art_type, request_id
                            );

                            // Connect to ArtLoom WebSocket
                            use tungstenite::{connect, Message as WsMessage};
                            let ws_url = artloom_ws_url();
                            match connect(ws_url.as_str()) {
                                Ok((mut socket, _response)) => {
                                    println!("[MOCK_ARTLOOM] Connected to ArtLoom WebSocket");

                                    // Send request
                                    let msg = serde_json::to_string(&ahrp_request).unwrap();
                                    if let Err(e) = socket.send(WsMessage::Text(msg.into())) {
                                        let message =
                                            format!("Failed to send ArtLoom request: {}", e);
                                        println!("[MOCK_ARTLOOM] {}", message);
                                        emit_art_error(&app_handle, &_node_id, message);
                                        let _ = socket.close(None);
                                        return;
                                    } else {
                                        // Wait for response (with timeout)
                                        println!("[MOCK_ARTLOOM] Waiting for response...");

                                        // Read responses until we get our result
                                        let mut received_processed_output = false;
                                        let mut forward_error: Option<String> = None;
                                        loop {
                                            match socket.read() {
                                                Ok(WsMessage::Text(text)) => {
                                                    println!(
                                                        "[MOCK_ARTLOOM] Received: {}",
                                                        utf8_snippet(&text, 200)
                                                    );

                                                    if let Ok(json) =
                                                        serde_json::from_str::<serde_json::Value>(
                                                            &text,
                                                        )
                                                    {
                                                        // Check if this is our response
                                                        if json["request_id"].as_str()
                                                            == Some(&request_id)
                                                        {
                                                            let is_success = json["status"]
                                                                .as_u64()
                                                                == Some(200)
                                                                || json["status"].as_str()
                                                                    == Some("Success");
                                                            if is_success {
                                                                // 1. Try Shared Memory Pass-through (Preferred)
                                                                if let Some(output) = json["data"]
                                                                    ["output"]
                                                                    .as_object()
                                                                {
                                                                    if let Some(handle) =
                                                                        output["handle"].as_str()
                                                                    {
                                                                        app_handle.emit("art/ready", serde_json::json!({
                                                                               "art_id": _node_id,
                                                                               "status": 200,
                                                                               "delivery": {
                                                                                   "type": "shared_memory",
                                                                                   "handle": handle,
                                                                                   "size": output["size"].as_u64().unwrap_or(0),
                                                                                   "width": output["width"].as_u64().unwrap_or(0),
                                                                                   "height": output["height"].as_u64().unwrap_or(0)
                                                                               }
                                                                           })).ok();
                                                                        println!("[MOCK_ARTLOOM] Passed through shared memory: {}", handle);
                                                                        return;
                                                                    }

                                                                    if let Some(img_data) =
                                                                        output["data"].as_str()
                                                                    {
                                                                        let clean = img_data
                                                                            .split(",")
                                                                            .last()
                                                                            .unwrap_or(img_data);
                                                                        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(clean) {
                                                                            if let Ok(decoded) = image::load_from_memory(&bytes) {
                                                                                img = decoded.to_rgba8();
                                                                                received_processed_output = true;
                                                                                println!("[MOCK_ARTLOOM] Successfully received base64 output from ArtLoom");
                                                                            }
                                                                        }
                                                                    }
                                                                }

                                                                // 2. Try Standard Outputs Array (Base64)
                                                                if let Some(outputs) = json["data"]
                                                                    ["outputs"]
                                                                    .as_array()
                                                                {
                                                                    if let Some(first) =
                                                                        outputs.first()
                                                                    {
                                                                        if let Some(img_data) =
                                                                            first["data"].as_str()
                                                                        {
                                                                            let clean = img_data
                                                                                .split(",")
                                                                                .last()
                                                                                .unwrap_or(
                                                                                    img_data,
                                                                                );
                                                                            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(clean) {
                                                                                   if let Ok(decoded) = image::load_from_memory(&bytes) {
                                                                                       img = decoded.to_rgba8();
                                                                                       received_processed_output = true;
                                                                                       println!("[MOCK_ARTLOOM] Successfully received processed image from ArtLoom!");
                                                                                   }
                                                                               }
                                                                        }
                                                                    }
                                                                }
                                                            } else {
                                                                let message =
                                                                    extract_artloom_error_message(
                                                                        &json,
                                                                    );
                                                                println!(
                                                                    "[MOCK_ARTLOOM] ArtLoom returned error: {}",
                                                                    message
                                                                );
                                                                emit_art_error(
                                                                    &app_handle,
                                                                    &_node_id,
                                                                    message,
                                                                );
                                                                let _ = socket.close(None);
                                                                return;
                                                            }
                                                            break;
                                                        }
                                                    }
                                                }
                                                Ok(WsMessage::Close(_)) => {
                                                    println!("[MOCK_ARTLOOM] Connection closed");
                                                    forward_error = Some(
                                                        "ArtLoom connection closed before returning an image"
                                                            .to_string(),
                                                    );
                                                    break;
                                                }
                                                Err(e) => {
                                                    let message = format!(
                                                        "Failed to read ArtLoom response: {}",
                                                        e
                                                    );
                                                    println!("[MOCK_ARTLOOM] {}", message);
                                                    forward_error = Some(message);
                                                    break;
                                                }
                                                _ => {} // Ignore ping/pong/binary
                                            }
                                        }
                                        let _ = socket.close(None);
                                        if let Some(message) = forward_error {
                                            emit_art_error(&app_handle, &_node_id, message);
                                            return;
                                        }
                                        if !received_processed_output {
                                            emit_art_error(
                                                &app_handle,
                                                &_node_id,
                                                "ArtLoom did not return an image output",
                                            );
                                            return;
                                        }
                                    }
                                }
                                Err(e) => {
                                    let message = format!(
                                        "Failed to connect to ArtLoom WebSocket {}: {}",
                                        ws_url, e
                                    );
                                    println!("[MOCK_ARTLOOM] {}", message);
                                    emit_art_error(&app_handle, &_node_id, message);
                                    return;
                                }
                            }
                        } else if et == "cli_wrapper" || et == "cli" {
                            // === CLI WRAPPER: Execute locally via CliEngine ===
                            println!("[MOCK_ARTLOOM] CLI Wrapper Art detected, executing via CliEngine...");

                            // Get command and args from execution config
                            if let Some(exec) = &def.execution {
                                let command =
                                    exec.get("command").and_then(|v| v.as_str()).unwrap_or("");
                                let args = exec.get("args").and_then(|v| v.as_str()).unwrap_or("");

                                // Combine command and args as full template
                                let full_cmd = format!("{} {}", command, args);
                                println!("[MOCK_ARTLOOM] CLI Template: {}", full_cmd);

                                // Convert ArtParameter to serde_json::Value for CliEngine
                                let param_defs: Vec<serde_json::Value> = def
                                    .params
                                    .iter()
                                    .filter_map(|p| serde_json::to_value(p).ok())
                                    .collect();

                                // Convert DynamicImage to the expected format for CliEngine
                                let dyn_img = image::DynamicImage::ImageRgba8(img.clone());

                                // Execute via CliEngine
                                let engine = crate::cli_engine::CliEngine::new();
                                let result = engine.process_image(
                                    &dyn_img,
                                    &full_cmd,
                                    &_params,
                                    &param_defs,
                                );

                                if result.success {
                                    println!("[MOCK_ARTLOOM] CLI execution succeeded, loading output image...");
                                    // Decode output_base64 back to RgbaImage
                                    if let Some(b64_data) = &result.output_base64 {
                                        // Strip data URI prefix if present
                                        let clean = b64_data.split(",").last().unwrap_or(b64_data);
                                        if let Ok(bytes) =
                                            base64::engine::general_purpose::STANDARD.decode(clean)
                                        {
                                            if let Ok(decoded) = image::load_from_memory(&bytes) {
                                                img = decoded.to_rgba8();
                                                println!("[MOCK_ARTLOOM] CLI output image loaded successfully!");

                                                // OPTIMIZATION: If output path exists, use it directly (skip SHM re-encode)
                                                if let Some(path) = &result.output_path {
                                                    direct_delivery = Some(serde_json::json!({
                                                       "art_id": _node_id,
                                                       "status": 200,
                                                       "delivery": {
                                                            "type": "file_path",
                                                            "path": path,
                                                            "width": img.width(),
                                                            "height": img.height()
                                                       }
                                                    }));
                                                }
                                            } else {
                                                println!("[MOCK_ARTLOOM] Failed to decode CLI output as image");
                                            }
                                        } else {
                                            println!("[MOCK_ARTLOOM] Failed to decode base64 from CLI result");
                                        }
                                    } else {
                                        println!("[MOCK_ARTLOOM] CLI result missing output_base64");
                                    }
                                } else {
                                    println!(
                                        "[MOCK_ARTLOOM] CLI execution failed: {}",
                                        result.error.unwrap_or_default()
                                    );
                                }
                            } else {
                                println!(
                                    "[MOCK_ARTLOOM] CLI Art missing 'execution' config, skipping."
                                );
                            }
                        } else {
                            println!(
                                "[MOCK_ARTLOOM] Art execution_type '{}' unknown, passing through.",
                                et
                            );
                        }
                    } else {
                        println!("[MOCK_ARTLOOM] Art definition not found in loaded arts cache, passing through.");
                    }
                }

                // 2. CHECK DIRECT DELIVERY (Optimization)
                if let Some(payload) = direct_delivery {
                    let _ = app_handle.emit("art/ready", payload);
                    println!("Emitted art/ready via file_path for {}", _node_id);
                    return; // Skip Shared Memory
                }

                // 3. Use Raw RGBA (Compatible with lib.rs expectations)
                let width = img.width();
                let height = img.height();
                let buffer = img.into_raw();

                // 3. Create Shared Memory
                let shmem_id = format!("artloom-shm-{}", Uuid::new_v4());

                let shmem = match ShmemConf::new()
                    .size(buffer.len())
                    .os_id(&shmem_id)
                    .create()
                {
                    Ok(m) => m,
                    Err(e) => {
                        println!("Failed to create Shmem: {}", e);
                        return;
                    }
                };

                // 4. Write Data
                unsafe {
                    std::ptr::copy_nonoverlapping(buffer.as_ptr(), shmem.as_ptr(), buffer.len());
                }

                println!("Written {} bytes to Shmem [{}]", buffer.len(), shmem_id);

                // 5. Persist Shmem in State
                {
                    if let Ok(mut s) = state_arc.lock() {
                        s.shmem_store.insert(shmem_id.clone(), SafeShmem(shmem));
                    }
                }

                // 6. Emit Delivery Event
                let payload = serde_json::json!({
                    "art_id": _node_id,
                    "status": 200,
                    "delivery": {
                         "type": "shared_memory",
                         "handle": shmem_id,
                         "size": buffer.len(),
                         "width": width,
                         "height": height
                    }
                });

                let _ = app_handle.emit("art/ready", payload);
                println!("Emitted art/ready for {}", _node_id);
            });
        }
        ArtLoomAction::SyncWorkflow {
            workflow_id,
            snapshot,
        } => {
            println!("Syncing Workflow Snapshot: {}", workflow_id);

            thread::spawn(move || {
                use tungstenite::{connect, Message};
                let msg = serde_json::json!({
                    "method": "art_loom/overwrite_workflow",
                    "params": {
                        "workflow_id": workflow_id,
                        "snapshot": snapshot
                    }
                });

                let ws_url = artloom_ws_url();
                match connect(ws_url.as_str()) {
                    Ok((mut socket, _)) => {
                        if let Err(e) = socket.send(Message::Text(msg.to_string())) {
                            println!("Failed to send overwrite_workflow: {}", e);
                        }
                        let _ = socket.close(None);
                    }
                    Err(e) => println!(
                        "Failed to connect to {} for overwrite synchronization: {}",
                        ws_url, e
                    ),
                }
            });
        }
    }

    Ok(())
}

/// Helper to resolve image path from UUID
fn resolve_image_path(uuid: &str) -> Option<String> {
    if let Some(config_dir) = dirs::config_dir() {
        // Known Hook cache locations
        let candidates = vec![
            config_dir.join("com.vmjcv.hook-next").join("images"),
            config_dir.join("Hook").join("images"),
            config_dir.join("ArtNexus").join("images"),
        ];

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

fn artloom_suffix(path: &PathBuf) -> Option<PathBuf> {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let parts: Vec<&str> = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let artloom_index = parts
        .iter()
        .position(|part| part.eq_ignore_ascii_case("ArtLoom"))?;

    let mut suffix = PathBuf::new();
    for part in &parts[artloom_index..] {
        suffix.push(part);
    }
    Some(suffix)
}

fn artloom_search_roots() -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    let candidates = [std::env::current_exe().ok(), std::env::current_dir().ok()];

    for candidate in candidates.into_iter().flatten() {
        let start = if candidate.is_file() {
            candidate
                .parent()
                .map(|parent| parent.to_path_buf())
                .unwrap_or(candidate)
        } else {
            candidate
        };

        for ancestor in start.ancestors() {
            let root = ancestor.to_path_buf();
            if !roots.iter().any(|existing| existing == &root) {
                roots.push(root);
            }
        }
    }

    roots
}

fn repair_artloom_art_path(configured: &PathBuf) -> Option<PathBuf> {
    if configured.exists() {
        return Some(configured.clone());
    }

    let suffix = artloom_suffix(configured)?;
    for root in artloom_search_roots() {
        let candidate = root.join(&suffix);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    None
}

fn materialize_shader_image_input(value: Option<&String>, label: &str) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }

    if raw.len() == 36 && raw.matches('-').count() == 4 {
        return resolve_image_path(raw).or_else(|| Some(raw.to_string()));
    }

    if raw.starts_with("data:") {
        let encoded = raw.split_once(',').map(|(_, data)| data).unwrap_or(raw);
        match base64::engine::general_purpose::STANDARD.decode(encoded) {
            Ok(bytes) => {
                let filename_prefix = match label {
                    "input" => "artloom_shader_input",
                    "reference" => "artloom_shader_reference",
                    _ => "artloom_shader_image",
                };
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
                            "[MockArtLoom] Failed to write materialized shader {} image: {}",
                            label, error
                        );
                        return None;
                    }
                }
            }
            Err(error) => {
                println!(
                    "[MockArtLoom] Failed to decode shader {} data URI: {}",
                    label, error
                );
                return None;
            }
        }
    }

    Some(raw.to_string())
}

/// Prefetch shader code from a Python Art by executing it with output_mode='shader'
/// input_path and reference_path are optional paths to source and reference images for LUT generation
#[tauri::command]
pub async fn prefetch_shader(
    state: tauri::State<'_, MockArtLoom>,
    art_id: String,
    art_path: Option<String>,
    input_path: Option<String>,
    reference_path: Option<String>,
) -> Result<serde_json::Value, String> {
    let loaded_arts = state
        .inner()
        .loaded_arts
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    tauri::async_runtime::spawn_blocking(move || {
        prefetch_shader_blocking(loaded_arts, art_id, art_path, input_path, reference_path)
    })
    .await
    .map_err(|e| format!("Shader prefetch task failed: {}", e))?
}

fn prefetch_shader_blocking(
    loaded_arts: Vec<ArtDefinition>,
    art_id: String,
    art_path: Option<String>,
    input_path: Option<String>,
    reference_path: Option<String>,
) -> Result<serde_json::Value, String> {
    println!("[MockArtLoom] Prefetching shader for Art: {}", art_id);

    // 1. Find Art Definition to get script path.
    let script_path_str = if let Some(path) = art_path {
        path
    } else {
        // Look up in loaded arts
        let art = loaded_arts
            .iter()
            .find(|a| a.id == art_id)
            .ok_or_else(|| format!("Art not found: {}", art_id))?;

        let exec = art
            .execution
            .as_ref()
            .ok_or_else(|| "Art definition missing execution config".to_string())?;

        exec.get("artPath")
            .and_then(|v: &serde_json::Value| v.as_str())
            .map(|s: &str| s.to_string())
            .ok_or_else(|| "Art execution missing 'artPath'".to_string())?
    };

    println!("[MockArtLoom] Script Path: {}", script_path_str);
    // Correctly resolve script path
    let mut script_path = PathBuf::from(&script_path_str);
    if !script_path.exists() {
        if let Some(repaired) = repair_artloom_art_path(&script_path) {
            println!(
                "[MockArtLoom] Repaired script path from {:?} to {:?}",
                script_path, repaired
            );
            script_path = repaired;
        }
    }

    // If it's a directory, we need to find the entry point
    if script_path.is_dir() {
        // Try to get 'entry' from definition first
        let art = loaded_arts.iter().find(|a| a.id == art_id);

        let mut entry_file = "main.py".to_string(); // Default

        if let Some(a) = art {
            if let Some(exec) = &a.execution {
                if let Some(e) = exec.get("entry").and_then(|v| v.as_str()) {
                    entry_file = e.to_string();
                }
            }
        }

        script_path = script_path.join(entry_file);
        if !script_path.exists() {
            if let Some(repaired) = repair_artloom_art_path(&script_path) {
                println!(
                    "[MockArtLoom] Repaired entry script path from {:?} to {:?}",
                    script_path, repaired
                );
                script_path = repaired;
            }
        }
    }

    println!("[MockArtLoom] Resolved Script Path: {:?}", script_path);

    if !script_path.exists() {
        // Try verifying if maybe the original path was the file?
        // If not, error out.
        return Err(format!("Script file not found: {:?}", script_path));
    }

    // 2. Resolve UUID references and materialize data URI inputs to actual files.
    let resolved_input_path = materialize_shader_image_input(input_path.as_ref(), "input");
    let resolved_reference_path =
        materialize_shader_image_input(reference_path.as_ref(), "reference");

    println!(
        "[MockArtLoom] Resolved paths: input={}, reference={}",
        resolved_input_path.as_deref().unwrap_or("<none>"),
        resolved_reference_path.as_deref().unwrap_or("<none>")
    );

    // 3. Prepare JSON arguments with resolved paths for LUT generation
    let params = serde_json::json!({
        "output_mode": "shader",
        "input_path": resolved_input_path.as_ref().unwrap_or(&String::new()),
        "reference_path": resolved_reference_path.as_ref().unwrap_or(&String::new())
    });
    let params_str = params.to_string();

    println!(
        "[MockArtLoom] Params: input={}, reference={}",
        resolved_input_path.as_deref().unwrap_or("<none>"),
        resolved_reference_path.as_deref().unwrap_or("<none>")
    );

    // 3. Find Python Executable
    // Try 'python' first.
    let python_cmd = "python";

    println!(
        "[MockArtLoom] Executing: {} {:?} '{}'",
        python_cmd, script_path, params_str
    );

    // 4. Validate script path is a file
    if !script_path.is_file() {
        return Err(format!("Script path is not a file: {:?}", script_path));
    }

    // 5. Execute
    let mut command = Command::new(python_cmd);
    let output = configure_child_no_window(
        command
            .arg(&script_path)
            .arg(&params_str)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped()),
    )
    .output()
    .map_err(|e| format!("Failed to execute python: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !stderr.is_empty() {
        println!("[MockArtLoom] Python stderr: {}", stderr);
    }

    if !output.status.success() {
        return Err(format!(
            "Python execution failed ({}): {}",
            output.status, stderr
        ));
    }

    // 6. Parse Output (Expect JSON)
    let clean_stdout = stdout.trim();
    if clean_stdout.is_empty() {
        return Err("Python produced no output".to_string());
    }

    // Log the output snippet for debugging
    let snippet_len = std::cmp::min(200, clean_stdout.len());
    println!(
        "[MockArtLoom] Python Output Snippet: {}...",
        &clean_stdout[..snippet_len]
    );

    // Try to find the last separate JSON object if mixed with logs?
    // For now assuming clean output.
    let result: serde_json::Value = serde_json::from_str(clean_stdout).map_err(|e| {
        format!(
            "Failed to parse Python JSON output: {}. Raw: '{}'",
            e, clean_stdout
        )
    })?;

    println!("[MockArtLoom] Shader prefetch success");
    Ok(result)
}
