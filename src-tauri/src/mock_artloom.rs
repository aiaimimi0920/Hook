use crate::process_utils::configure_child_no_window;
use base64::Engine as _;
use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use shared_memory::ShmemConf;
use std::collections::{BTreeMap, HashMap, VecDeque};
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

// Deserialize a string field tolerating an explicit JSON `null` (which serde's
// `#[serde(default)]` alone does NOT handle — default only covers a *missing*
// field). Loom's art JSON sends `icon: null` for tools without an icon.
fn null_tolerant_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt: Option<String> = Option::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}

fn null_tolerant_vec<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    let opt: Option<Vec<T>> = Option::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}

fn default_art_enabled() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArtDefinition {
    #[serde(default)]
    pub id: String, // e.g. "core.image.pixelate"
    #[serde(default, deserialize_with = "null_tolerant_string")]
    pub label: String,
    #[serde(default, deserialize_with = "null_tolerant_string")]
    pub description: String,
    #[serde(default, deserialize_with = "null_tolerant_string")]
    pub icon: String,
    #[serde(default, deserialize_with = "null_tolerant_vec")]
    pub params: Vec<ArtParameter>,
    #[serde(default, alias = "autoProcess")]
    pub auto_process: bool,
    #[serde(default = "default_art_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub defaults: HashMap<String, serde_json::Value>,

    #[serde(
        default,
        alias = "executionType",
        skip_serializing_if = "Option::is_none"
    )]
    pub execution_type: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution: Option<serde_json::Value>,

    #[serde(default, deserialize_with = "null_tolerant_vec")]
    pub inputs: Vec<ArtInputDefinition>,

    #[serde(default, deserialize_with = "null_tolerant_vec")]
    pub outputs: Vec<ArtOutputDefinition>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<serde_json::Value>,

    #[serde(default, alias = "supportedTransports")]
    pub supported_transports: Vec<String>,

    #[serde(default, rename = "defaultVisibility", alias = "default_visibility")]
    pub default_visibility: HashMap<String, bool>,

    // Legacy fields - made optional for compatibility
    #[serde(default)]
    pub input_schema: Option<HashMap<String, String>>,
    #[serde(default)]
    pub output_schema: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArtParameter {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default, rename = "widget")] // ArtLoom uses "widget", matches JSON
    pub param_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    #[serde(default, alias = "minimum")]
    pub min: Option<f64>,
    #[serde(default, alias = "maximum")]
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
    pub data_type: Option<String>, // Added to match ArtLoom JSON schema
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
    #[serde(default, rename = "defaultVisible", alias = "default_visible")]
    pub default_visible: Option<bool>,
    #[serde(default, rename = "exposePort", alias = "expose_port")]
    pub expose_port: Option<bool>,
    #[serde(default, alias = "executionType")]
    pub execution_type: Option<String>,
    #[serde(default, alias = "dataType")]
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
    #[serde(default, rename = "defaultVisible", alias = "default_visible")]
    pub default_visible: Option<bool>,
    #[serde(default, alias = "executionType")]
    pub execution_type: Option<String>,
    #[serde(default, alias = "dataType")]
    pub data_type: Option<String>,
    #[serde(default)]
    pub widget: Option<String>,
    #[serde(default)]
    pub required: bool,
}

impl ArtDefinition {
    fn qualified_id(&self) -> Option<String> {
        let metadata = self.metadata.as_ref()?;
        for pointer in [
            "/art/qualifiedId",
            "/art/qualified_id",
            "/artPackage/qualifiedId",
            "/artPackage/qualified_id",
        ] {
            if let Some(value) = metadata
                .pointer(pointer)
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(value.to_string());
            }
        }

        let publisher = metadata
            .pointer("/packageSecurity/publisher/id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())?;
        (!self.id.trim().is_empty()).then(|| format!("{publisher}/{}", self.id.trim()))
    }

    fn identity_key(&self) -> String {
        self.qualified_id().unwrap_or_else(|| self.id.clone())
    }

    fn matches_runtime_id(&self, id: &str) -> bool {
        self.id == id || self.qualified_id().as_deref() == Some(id)
    }

    fn effective_execution_type(&self) -> Option<&str> {
        self.execution_type
            .as_deref()
            .or_else(|| self.execution.as_ref()?.get("type")?.as_str())
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LoomMcpServerConfig {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
    #[serde(default = "default_mcp_server_enabled")]
    enabled: bool,
}

fn default_mcp_server_enabled() -> bool {
    true
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
        #[serde(default)]
        input_images: Option<HashMap<String, String>>,
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

// Wrapper for Shmem so it can be moved into the state that crosses threads.
// Only `Send` is claimed: the segment is always accessed behind the state's
// `Arc<Mutex<…>>`, so shared cross-thread access (which `Sync` would assert) is
// never relied upon. Keeping `Send` alone lets the compiler still catch any
// accidental unsynchronized sharing of the raw shmem pointer.
#[allow(dead_code)]
pub struct SafeShmem(pub shared_memory::Shmem);
unsafe impl Send for SafeShmem {}

// Upper bound on retained shared-memory segments. Each processed image is
// stored so the frontend can open it by handle after `art/ready`; without a cap
// the store grows forever (one OS shared-memory segment leaked per edit). We
// keep the most recent N and drop the oldest, which is safe because a segment is
// only needed briefly, between `art/ready` and the frontend reading it.
const MAX_SHMEM_ENTRIES: usize = 12;

// Read timeout for the forward-to-ArtLoom WebSocket. Bounds how long a worker
// thread will block waiting for a processed image before giving up, so a hung
// backend cannot leak threads/sockets indefinitely.
const ARTLOOM_WS_READ_TIMEOUT_SECS: u64 = 30;

pub struct MockArtLoomState {
    pub session_id: String,
    pub active_nodes: HashMap<String, HashMap<String, serde_json::Value>>, // node_id -> { param -> value }
    // We must keep Shmem alive or it gets dropped and handle becomes invalid
    pub shmem_store: HashMap<String, SafeShmem>,
    // Insertion order of shmem_store keys, used to evict the oldest segment once
    // the store exceeds MAX_SHMEM_ENTRIES.
    pub shmem_order: VecDeque<String>,
    pub listener_started: bool,
    pub backend_connected: bool,
    pub app_handle: Option<AppHandle>,
}

impl MockArtLoomState {
    // Insert a shared-memory segment, evicting the oldest segments so the store
    // never exceeds MAX_SHMEM_ENTRIES. Dropping an evicted SafeShmem unmaps it.
    fn store_shmem(&mut self, handle: String, shmem: SafeShmem) {
        if self.shmem_store.insert(handle.clone(), shmem).is_none() {
            self.shmem_order.push_back(handle);
        }
        while self.shmem_store.len() > MAX_SHMEM_ENTRIES {
            match self.shmem_order.pop_front() {
                Some(oldest) => {
                    self.shmem_store.remove(&oldest);
                }
                None => break,
            }
        }
    }

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
                shmem_order: VecDeque::new(),
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

fn parse_local_mcp_servers_json(body: &str) -> Option<Vec<LoomMcpServerConfig>> {
    serde_json::from_str::<Vec<LoomMcpServerConfig>>(body).ok()
}

fn load_mcp_servers_from_disk() -> Vec<LoomMcpServerConfig> {
    let Some(config_dir) = dirs::config_dir() else {
        return Vec::new();
    };
    let path = config_dir.join("ArtNexus").join("mcp_servers.json");
    let Some(content) = std::fs::read_to_string(path).ok() else {
        return Vec::new();
    };
    parse_local_mcp_servers_json(&content).unwrap_or_default()
}

// Map a Loom `/v1/artloom-compat/arts` response body into Hook art definitions.
// Each art that fails to deserialize is skipped (defensive) rather than failing
// the whole list. Separated from the network call so it can be unit-tested.
fn parse_art_definition_value(mut value: serde_json::Value) -> Option<ArtDefinition> {
    let object = value.as_object_mut()?;
    if !object.contains_key("id") {
        if let Some(id) = object
            .get("art_id")
            .or_else(|| object.get("artId"))
            .cloned()
        {
            object.insert("id".to_string(), id);
        }
    }
    if !object.contains_key("label") {
        if let Some(label) = object.get("name").cloned() {
            object.insert("label".to_string(), label);
        }
    }

    let art = serde_json::from_value::<ArtDefinition>(value).ok()?;
    (!art.id.trim().is_empty()).then_some(art)
}

fn map_loom_arts_response(body: &str) -> Option<Vec<ArtDefinition>> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let arts = value.get("arts")?.as_array()?;
    let mapped: Vec<ArtDefinition> = arts
        .iter()
        .filter_map(|art| parse_art_definition_value(art.clone()))
        .collect();
    Some(mapped)
}

// Fetch the Art node list from the Loom daemon's tool registry over HTTP
// (GET {base}/v1/artloom-compat/arts). Returns None if Loom isn't discoverable
// or unreachable, so the caller can fall back to the local arts file.
async fn load_arts_from_loom() -> Option<Vec<ArtDefinition>> {
    let manifest = crate::loom_connector::read_default_loom_manifest().ok()?;
    let base = manifest.transport.base_url.trim_end_matches('/');
    let endpoint = format!("{base}/v1/artloom-compat/arts");

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(2000))
        .build()
        .ok()?;
    let mut request = client.get(&endpoint);
    if manifest
        .transport
        .auth
        .as_deref()
        .unwrap_or("none")
        .eq_ignore_ascii_case("bearer")
    {
        if let Some(token) = manifest
            .transport
            .auth_token
            .as_deref()
            .map(str::trim)
            .filter(|token| !token.is_empty())
        {
            request = request.bearer_auth(token);
        }
    }

    let response = request.send().await.ok()?;
    if !response.status().is_success() {
        println!("Loom arts endpoint returned {}", response.status());
        return None;
    }
    let body = response.text().await.ok()?;
    let arts = map_loom_arts_response(&body)?;
    println!("Loaded {} arts from Loom.", arts.len());
    Some(arts)
}

async fn sync_mcp_servers_to_loom(local: &[LoomMcpServerConfig]) {
    if local.is_empty() {
        return;
    }

    let Ok(manifest) = crate::loom_connector::read_default_loom_manifest() else {
        return;
    };
    let base = manifest
        .transport
        .base_url
        .trim_end_matches('/')
        .to_string();

    let client = match reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(3000))
        .build()
    {
        Ok(client) => client,
        Err(_) => return,
    };

    for server in local {
        let endpoint = format!("{base}/v1/mcp/servers/{}", server.id);
        let mut request = client.put(&endpoint).json(server);
        if manifest
            .transport
            .auth
            .as_deref()
            .unwrap_or("none")
            .eq_ignore_ascii_case("bearer")
        {
            if let Some(token) = manifest
                .transport
                .auth_token
                .as_deref()
                .map(str::trim)
                .filter(|token| !token.is_empty())
            {
                request = request.bearer_auth(token);
            }
        }

        match request.send().await {
            Ok(response) if response.status().is_success() => {
                println!(
                    "Synced MCP server '{}' to Loom (status {}).",
                    server.id,
                    response.status()
                );
            }
            Ok(response) => {
                let status = response.status();
                let body = response
                    .text()
                    .await
                    .unwrap_or_else(|_| "<body unavailable>".to_string());
                println!(
                    "Sync MCP server '{}' to Loom failed with status {}: {}",
                    server.id, status, body
                );
            }
            Err(error) => {
                println!("Sync MCP server '{}' to Loom failed: {}", server.id, error);
            }
        }
    }
}

fn normalize_path_for_match(value: &str) -> String {
    value.replace('\\', "/").to_ascii_lowercase()
}

fn loom_control_plane_arts_prefix() -> Option<String> {
    let root = dirs::config_dir()?
        .join("Loom")
        .join("control-plane")
        .join("arts");
    Some(normalize_path_for_match(&root.to_string_lossy()))
}

fn is_loom_control_plane_art(art: &ArtDefinition) -> bool {
    if art
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.pointer("/artPackage/dir"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .is_some_and(|path| !path.is_empty())
    {
        return true;
    }

    let Some(path) = art
        .execution
        .as_ref()
        .and_then(|execution| execution.get("artPath"))
        .and_then(serde_json::Value::as_str)
    else {
        return false;
    };

    let normalized = normalize_path_for_match(path);
    if let Some(prefix) = loom_control_plane_arts_prefix() {
        normalized.starts_with(&prefix)
    } else {
        normalized.contains("/loom/control-plane/arts/")
    }
}

// Merge local arts with the arts already registered in Loom. Local arts keep
// priority by default, but a Loom-installed control-plane Art is allowed to
// replace a colliding legacy local definition so Hook uses the currently
// installed publisher-qualified package payload.
fn merge_arts_by_id(local: &[ArtDefinition], existing: &[ArtDefinition]) -> Vec<ArtDefinition> {
    let mut merged: Vec<ArtDefinition> = local.to_vec();
    for art in existing {
        let identity = art.identity_key();
        if let Some(index) = merged
            .iter()
            .position(|candidate| candidate.identity_key() == identity)
        {
            if is_loom_control_plane_art(art) {
                merged[index] = art.clone();
            }
            continue;
        }

        let legacy_matches = merged
            .iter()
            .enumerate()
            .filter(|(_, candidate)| candidate.qualified_id().is_none() && candidate.id == art.id)
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        if is_loom_control_plane_art(art) && legacy_matches.len() == 1 {
            merged[legacy_matches[0]] = art.clone();
            continue;
        }

        merged.push(art.clone());
    }
    merged
}

// Register Hook's local arts into Loom's tool registry via the artloom-compat
// sync endpoint, so Loom can resolve/execute them when Hook forwards art/process.
// Merges with Loom's existing compat tools first so the full-replace sync keeps
// previously wrapped tools. Best-effort: silently no-ops if Loom is unreachable.
async fn sync_arts_to_loom(local: &[ArtDefinition]) {
    if local.is_empty() {
        return;
    }

    let Ok(manifest) = crate::loom_connector::read_default_loom_manifest() else {
        return;
    };
    let base = manifest
        .transport
        .base_url
        .trim_end_matches('/')
        .to_string();

    let existing = load_arts_from_loom().await.unwrap_or_default();
    let merged = merge_arts_by_id(local, &existing);

    let client = match reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(3000))
        .build()
    {
        Ok(client) => client,
        Err(_) => return,
    };
    let mut request = client
        .post(format!("{base}/v1/artloom-compat/arts/sync"))
        .json(&serde_json::json!({ "arts": merged }));
    if manifest
        .transport
        .auth
        .as_deref()
        .unwrap_or("none")
        .eq_ignore_ascii_case("bearer")
    {
        if let Some(token) = manifest
            .transport
            .auth_token
            .as_deref()
            .map(str::trim)
            .filter(|token| !token.is_empty())
        {
            request = request.bearer_auth(token);
        }
    }
    match request.send().await {
        Ok(response) => println!(
            "Synced {} arts to Loom (status {}).",
            merged.len(),
            response.status()
        ),
        Err(error) => println!("Sync arts to Loom failed: {error}"),
    }
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

fn extract_artloom_image_search_delivery(json: &serde_json::Value) -> Option<serde_json::Value> {
    json.get("data")
        .and_then(|data| data.get("loomMetadata"))
        .and_then(|metadata| metadata.get("imageSearch"))
        .or_else(|| {
            json.get("loomMetadata")
                .and_then(|metadata| metadata.get("imageSearch"))
        })
        .or_else(|| {
            json.get("result")
                .and_then(|result| result.get("loomMetadata"))
                .and_then(|metadata| metadata.get("imageSearch"))
        })
        .filter(|metadata| metadata.is_object())
        .cloned()
}

fn attach_image_search_delivery(
    payload: &mut serde_json::Value,
    image_search: Option<&serde_json::Value>,
) {
    let Some(image_search) = image_search else {
        return;
    };
    let Some(delivery) = payload
        .get_mut("delivery")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return;
    };
    delivery.insert("imageSearch".to_owned(), image_search.clone());
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

fn emit_art_error_with_image_search(
    app_handle: &AppHandle,
    node_id: &str,
    error: impl AsRef<str>,
    image_search: Option<&serde_json::Value>,
) {
    let message = error.as_ref().trim();
    let message = if message.is_empty() {
        "Art execution failed"
    } else {
        message
    };
    let mut payload = serde_json::json!({
        "art_id": node_id,
        "status": 500,
        "error": message,
        "delivery": {
            "type": "base64"
        }
    });
    attach_image_search_delivery(&mut payload, image_search);

    let _ = app_handle.emit("art/ready", payload);
}

fn emit_art_error(app_handle: &AppHandle, node_id: &str, error: impl AsRef<str>) {
    emit_art_error_with_image_search(app_handle, node_id, error, None);
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

    // Load the local arts file (the built-in art nodes).
    let local_arts = load_arts_from_disk().unwrap_or_else(|| {
        println!("No arts found on disk.");
        vec![]
    });
    let local_mcp_servers = load_mcp_servers_from_disk();

    // Legacy ArtNexus MCP arts often reference UUID-based server ids stored in
    // ArtNexus/mcp_servers.json. Sync those server definitions first so Loom
    // can resolve the just-synced MCP arts immediately.
    sync_mcp_servers_to_loom(&local_mcp_servers).await;

    // Register the local arts into Loom's tool registry so Loom can resolve and
    // execute them when Hook forwards art/process (best-effort; no-op if Loom is
    // down). Merges with Loom's existing compat tools to avoid clobbering them.
    sync_arts_to_loom(&local_arts).await;

    // Build the display list with the same precedence rules used for sync:
    // local arts win by default, but a Loom-installed control-plane Art can
    // replace a colliding legacy local entry.
    let mut arts = local_arts;
    if let Some(loom_arts) = load_arts_from_loom().await {
        arts = merge_arts_by_id(&arts, &loom_arts);
    }

    // Cache loaded arts for prefetch_shader
    {
        let mut loaded = state.loaded_arts.lock().map_err(|e| e.to_string())?;
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
            input_images,
            ..
        } => {
            crate::append_runtime_log_line(&format!(
                "artloom_dispatch_action_update_node_param :: node_id={} param_key={} art_id={} has_input_image={} aux_keys={}",
                node_id,
                param_key,
                art_id.as_deref().unwrap_or(""),
                input_image.as_ref().map(|value| !value.trim().is_empty()).unwrap_or(false),
                input_images
                    .as_ref()
                    .map(|images| {
                        let mut keys = images.keys().cloned().collect::<Vec<_>>();
                        keys.sort();
                        if keys.is_empty() { "none".to_string() } else { keys.join(",") }
                    })
                    .unwrap_or_else(|| "none".to_string())
            ));
            println!(
                "AHRP Action: UpdateNodeParam node_id={}, param_key={}, art_id={:?}, has_image={}, aux_images={}",
                node_id,
                param_key,
                art_id,
                input_image.is_some(),
                input_images.as_ref().map(|images| images.len()).unwrap_or(0)
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
            input_images,
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
            let _input_images = input_images.clone();
            let loaded_arts = state.loaded_arts.lock().map_err(|e| e.to_string())?.clone();
            let _params = {
                let s = state.state.lock().map_err(|e| e.to_string())?;
                s.active_nodes.get(&node_id).cloned().unwrap_or_default()
            };

            thread::spawn(move || {
                // Simulate processing time
                thread::sleep(Duration::from_millis(200));

                println!(
                    "Processing Art Node: {} with params: {:?}",
                    _node_id, _params
                );

                let mut img = if input_image.is_some() {
                    load_input_rgba_image(input_image.as_ref())
                        .unwrap_or_else(|| RgbaImage::new(512, 512))
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
                let mut image_search_delivery: Option<serde_json::Value> = None;

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

                    let art_def = loaded_arts
                        .iter()
                        .find(|art| art.matches_runtime_id(art_type))
                        .cloned();

                    if let Some(def) = art_def {
                        let et = def.effective_execution_type().unwrap_or("unknown");
                        if def.enabled {
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

                            let mut resolved_input_images = _input_images.unwrap_or_default();
                            for (k, value) in resolved_input_images.iter_mut() {
                                if value.len() == 36 && value.matches('-').count() == 4 {
                                    if let Some(path) = resolve_image_path(value) {
                                        println!(
                                            "[MOCK_ARTLOOM] Auto-resolved input image '{}' (UUID) to: {}",
                                            k, path
                                        );
                                        *value = path;
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
                                    "input_images": resolved_input_images,
                                    "disabled_params": _disabled_params.clone().unwrap_or_default()
                                }
                            });

                            crate::append_runtime_log_line(&format!(
                                "mock_artloom_forward_art_process :: art_id={} request_id={} input_type=base64 has_reference_input_image={} param_keys={}",
                                art_type,
                                request_id,
                                resolved_input_images.contains_key("reference"),
                                {
                                    let mut keys = resolved_params.keys().cloned().collect::<Vec<_>>();
                                    keys.sort();
                                    if keys.is_empty() { "none".to_string() } else { keys.join(",") }
                                }
                            ));

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

                                    // Bound the wait for a response. Without a read
                                    // timeout a hung/non-responding backend leaves this
                                    // worker thread (and its socket) blocked forever; a
                                    // fast param drag can pile up many such zombies.
                                    if let tungstenite::stream::MaybeTlsStream::Plain(tcp) =
                                        socket.get_ref()
                                    {
                                        let _ = tcp.set_read_timeout(Some(Duration::from_secs(
                                            ARTLOOM_WS_READ_TIMEOUT_SECS,
                                        )));
                                    }

                                    // Send request
                                    let msg = match serde_json::to_string(&ahrp_request) {
                                        Ok(m) => m,
                                        Err(e) => {
                                            let message =
                                                format!("Failed to encode ArtLoom request: {}", e);
                                            println!("[MOCK_ARTLOOM] {}", message);
                                            emit_art_error(&app_handle, &_node_id, message);
                                            let _ = socket.close(None);
                                            return;
                                        }
                                    };
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
                                                            image_search_delivery =
                                                                extract_artloom_image_search_delivery(
                                                                    &json,
                                                                );
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
                                                                    // Index with `.get()` not `output[key]`: a
                                                                    // serde_json::Map panics ("no entry found for
                                                                    // key") on a missing key via the Index impl,
                                                                    // unlike Value. cloud_api (e.g. RemoveBG) returns
                                                                    // a base64 output object with NO `handle` field,
                                                                    // so `output["handle"]` aborted the whole app.
                                                                    if let Some(handle) = output
                                                                        .get("handle")
                                                                        .and_then(|v| v.as_str())
                                                                    {
                                                                        let mut payload = serde_json::json!({
                                                                            "art_id": _node_id,
                                                                            "status": 200,
                                                                            "delivery": {
                                                                                "type": "shared_memory",
                                                                                "handle": handle,
                                                                                "size": output.get("size").and_then(|v| v.as_u64()).unwrap_or(0),
                                                                                "width": output.get("width").and_then(|v| v.as_u64()).unwrap_or(0),
                                                                                "height": output.get("height").and_then(|v| v.as_u64()).unwrap_or(0)
                                                                            }
                                                                        });
                                                                        attach_image_search_delivery(
                                                                            &mut payload,
                                                                            image_search_delivery
                                                                                .as_ref(),
                                                                        );
                                                                        app_handle
                                                                            .emit(
                                                                                "art/ready",
                                                                                payload,
                                                                            )
                                                                            .ok();
                                                                        println!("[MOCK_ARTLOOM] Passed through shared memory: {}", handle);
                                                                        return;
                                                                    }

                                                                    if let Some(img_data) = output
                                                                        .get("data")
                                                                        .and_then(|v| v.as_str())
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
                                                                    if !received_processed_output {
                                                                        if let Some(path) = [
                                                                            "path",
                                                                            "filePath",
                                                                            "file_path",
                                                                        ]
                                                                        .into_iter()
                                                                        .find_map(|key| {
                                                                            output
                                                                                .get(key)
                                                                                .and_then(|value| {
                                                                                    value.as_str()
                                                                                })
                                                                        }) {
                                                                            if let Ok(decoded) =
                                                                                image::open(path)
                                                                            {
                                                                                img = decoded
                                                                                    .to_rgba8();
                                                                                received_processed_output = true;
                                                                                println!("[MOCK_ARTLOOM] Successfully loaded file-path output from Loom");
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
                                                                        if !received_processed_output {
                                                                            if let Some(path) = [
                                                                                "path",
                                                                                "filePath",
                                                                                "file_path",
                                                                            ]
                                                                            .into_iter()
                                                                            .find_map(|key| {
                                                                                first
                                                                                    .get(key)
                                                                                    .and_then(|value| value.as_str())
                                                                            })
                                                                            {
                                                                                if let Ok(decoded) = image::open(path) {
                                                                                    img = decoded.to_rgba8();
                                                                                    received_processed_output = true;
                                                                                    println!("[MOCK_ARTLOOM] Successfully loaded file-path array output from Loom");
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
                                                                emit_art_error_with_image_search(
                                                                    &app_handle,
                                                                    &_node_id,
                                                                    message,
                                                                    image_search_delivery.as_ref(),
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
                                            emit_art_error_with_image_search(
                                                &app_handle,
                                                &_node_id,
                                                "ArtLoom did not return an image output",
                                                image_search_delivery.as_ref(),
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
                        } else {
                            println!(
                                "[MOCK_ARTLOOM] Art '{}' is disabled; skipping Loom execution.",
                                art_type
                            );
                            emit_art_error(
                                &app_handle,
                                &_node_id,
                                format!("Art '{}' is disabled", art_type),
                            );
                            return;
                        }
                    } else {
                        println!("[MOCK_ARTLOOM] Art definition not found in loaded arts cache, passing through.");
                    }
                }

                // 2. Use Raw RGBA (Compatible with lib.rs expectations)
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
                        s.store_shmem(shmem_id.clone(), SafeShmem(shmem));
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
                let mut payload = payload;
                attach_image_search_delivery(&mut payload, image_search_delivery.as_ref());

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
            config_dir.join("com.yamiyu.hook").join("images"),
            config_dir
                .join("io.github.aiaimimi0920.hook")
                .join("images"),
            config_dir.join("com.vmjcv.hook").join("images"),
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
            .map(|n| n.starts_with("artloom_shader_"))
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
                    "input" => "artloom_shader_input",
                    "reference" => "artloom_shader_reference",
                    _ => "artloom_shader_image",
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

fn try_prefetch_shader_via_loom(
    art_id: &str,
    art_path: &std::path::Path,
    input_path: Option<&str>,
    reference_path: Option<&str>,
) -> Result<Option<serde_json::Value>, String> {
    let manifest = match crate::loom_connector::read_default_loom_manifest() {
        Ok(manifest) => manifest,
        Err(_) => return Ok(None),
    };
    let base = manifest.transport.base_url.trim_end_matches('/');
    if base.is_empty() {
        return Ok(None);
    }

    let art_path = art_path.to_string_lossy().to_string();
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Failed to create Loom shader prefetch client: {error}"))?;

    let endpoint = format!("{base}/v1/python-arts/shader/prefetch");
    let body = serde_json::json!({
        "artId": art_id,
        "artPath": art_path,
        "params": {
            "output_mode": "shader",
            "input_path": input_path.unwrap_or(""),
            "reference_path": reference_path.unwrap_or(""),
        }
    });

    let mut request = client.post(&endpoint).json(&body);
    if manifest
        .transport
        .auth
        .as_deref()
        .unwrap_or("none")
        .eq_ignore_ascii_case("bearer")
    {
        if let Some(token) = manifest
            .transport
            .auth_token
            .as_deref()
            .map(str::trim)
            .filter(|token| !token.is_empty())
        {
            request = request.bearer_auth(token);
        }
    }

    let response = match request.send() {
        Ok(response) => response,
        Err(error) => {
            println!("[MockArtLoom] Loom shader prefetch unavailable: {}", error);
            return Ok(None);
        }
    };

    let status = response.status();
    let text = response
        .text()
        .map_err(|error| format!("Failed to read Loom shader prefetch response: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Loom shader prefetch failed ({}): {}",
            status,
            utf8_snippet(&text, 400)
        ));
    }

    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("Failed to parse Loom shader prefetch response: {error}"))?;
    Ok(Some(
        value
            .get("result")
            .cloned()
            .unwrap_or_else(|| value.clone()),
    ))
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

    // 1. Find the configured plugin root path.
    let art_path_str = if let Some(path) = art_path {
        path
    } else {
        // Look up in loaded arts
        let art = loaded_arts
            .iter()
            .find(|art| art.matches_runtime_id(&art_id))
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

    println!("[MockArtLoom] Configured Art Path: {}", art_path_str);
    let mut plugin_path = PathBuf::from(&art_path_str);
    if !plugin_path.exists() {
        if let Some(repaired) = repair_artloom_art_path(&plugin_path) {
            println!(
                "[MockArtLoom] Repaired art path from {:?} to {:?}",
                plugin_path, repaired
            );
            plugin_path = repaired;
        }
    }
    if plugin_path.is_file() {
        plugin_path = plugin_path
            .parent()
            .map(std::path::Path::to_path_buf)
            .ok_or_else(|| format!("Art path has no parent directory: {:?}", plugin_path))?;
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

    // Prefer the Loom python_art runtime when it is available, so installable
    // framework-managed shader Arts use the same packaged runtime as the daemon.
    if let Some(result) = try_prefetch_shader_via_loom(
        &art_id,
        &plugin_path,
        resolved_input_path.as_deref(),
        resolved_reference_path.as_deref(),
    )? {
        println!("[MockArtLoom] Loom shader prefetch succeeded.");
        return Ok(result);
    }

    println!("[MockArtLoom] Falling back to local Python shader prefetch.");

    // 3. Resolve the local script path for fallback execution.
    let mut script_path = plugin_path;
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
        let art = loaded_arts
            .iter()
            .find(|art| art.matches_runtime_id(&art_id));

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

    // 4. Prepare JSON arguments with resolved paths for LUT generation
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

    // 5. Find Python Executable
    // Try 'python' first.
    let python_cmd = "python";

    println!(
        "[MockArtLoom] Executing: {} {:?} '{}'",
        python_cmd, script_path, params_str
    );

    // 6. Validate script path is a file
    if !script_path.is_file() {
        return Err(format!("Script path is not a file: {:?}", script_path));
    }

    // 7. Execute
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

    // 8. Parse Output (Expect JSON)
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

#[cfg(test)]
mod loom_arts_mapping {
    use super::*;

    #[test]
    fn maps_loom_arts_response_into_definitions() {
        // Mirrors Loom's /v1/artloom-compat/arts shape: { arts: [ artloom_compat_art_json ] }
        let body = r#"{
          "compatCommand": "list_arts",
          "count": 1,
          "arts": [
            {
              "id": "hook-wf-abc",
              "label": "链 工具",
              "description": "由 Hook 截图工作流封装的 Loom 工具。",
              "icon": null,
              "enabled": true,
              "auto_process": false,
              "params": [
                {"id": "input", "label": "输入图像", "widget": "image_link", "default": ""},
                {"id": "a_width", "label": "A / 宽度", "widget": "number", "default": "512"}
              ],
              "defaults": {},
              "inputs": [],
              "outputs": []
            }
          ]
        }"#;
        let arts = map_loom_arts_response(body).expect("map arts");
        assert_eq!(arts.len(), 1);
        assert_eq!(arts[0].id, "hook-wf-abc");
        assert_eq!(arts[0].label, "链 工具");
        assert_eq!(arts[0].params.len(), 2);
        assert_eq!(arts[0].params[0].id, "input");
        assert_eq!(arts[0].params[0].param_type, "image_link");
        assert_eq!(arts[0].params[1].id, "a_width");
        assert_eq!(arts[0].inputs.len(), 0);
        assert_eq!(arts[0].outputs.len(), 0);
    }

    #[test]
    fn preserves_image_inputs_and_outputs_from_loom_art_responses() {
        let body = r#"{
          "arts": [
            {
              "id": "custom-image-blend-script",
              "label": "图片混合",
              "description": "script blend",
              "icon": null,
              "enabled": true,
              "auto_process": false,
              "params": [
                {"id": "reference", "label": "参考图", "widget": "image_link", "default": ""},
                {"id": "mix_ratio", "label": "混合比例", "widget": "slider", "default": 50}
              ],
              "defaults": {},
              "inputs": [
                {"name": "input", "label": "源图", "type": "image", "execution_type": "image_buffer"},
                {"name": "reference", "label": "参考图", "type": "image", "execution_type": "image_buffer", "exposePort": true}
              ],
              "outputs": [
                {"name": "output", "label": "结果", "type": "image", "execution_type": "image_buffer"}
              ]
            }
          ]
        }"#;

        let arts = map_loom_arts_response(body).expect("map arts");
        assert_eq!(arts.len(), 1);
        assert_eq!(arts[0].inputs.len(), 2);
        assert_eq!(arts[0].inputs[0].name, "input");
        assert_eq!(arts[0].inputs[0].r#type, "image");
        assert_eq!(arts[0].inputs[1].name, "reference");
        assert_eq!(arts[0].inputs[1].expose_port, Some(true));
        assert_eq!(arts[0].outputs.len(), 1);
        assert_eq!(arts[0].outputs[0].name, "output");
        assert_eq!(arts[0].outputs[0].r#type, "image");
    }

    #[test]
    fn keeps_parameterless_arts_and_defaults_optional_fields() {
        let body = r#"{
          "arts": [
            {"id": "bad", "label": "no params"},
            {"id": "good", "label": "ok", "params": [{"id":"p","label":"P","widget":"text","default":""}]}
          ]
        }"#;
        let arts = map_loom_arts_response(body).expect("map");
        assert_eq!(arts.len(), 2);
        assert_eq!(arts[0].id, "bad");
        assert!(arts[0].params.is_empty());
        assert!(arts[0].enabled);
        assert_eq!(arts[1].id, "good");
    }

    #[test]
    fn preserves_current_loom_framework_art_schema() {
        let body = r#"{
          "arts": [
            {
              "id": "custom-layout-form-stress-test",
              "name": "属性布局测试",
              "enabled": true,
              "execution": {"type": "framework_art", "framework": "process"},
              "params": [
                {
                  "id": "render_mode",
                  "label": "渲染模式",
                  "widget": "select",
                  "required": true,
                  "default": "preview",
                  "options": [
                    {"value": "preview", "label": "预览"},
                    {"value": "quality", "label": "质量"}
                  ],
                  "data_type": "enum",
                  "group": "基础"
                }
              ],
              "outputs": [
                {
                  "name": "output",
                  "label": "测试结果",
                  "type": "image",
                  "executionType": "image_buffer"
                }
              ],
              "metadata": {
                "art": {
                  "qualifiedId": "neuro.official/custom-layout-form-stress-test"
                },
                "artPackage": {
                  "dir": "C:\\\\Users\\\\test\\\\Loom\\\\control-plane\\\\arts\\\\layout"
                }
              }
            }
          ]
        }"#;

        let arts = map_loom_arts_response(body).expect("map current Loom Art");
        assert_eq!(arts.len(), 1);
        let art = &arts[0];
        assert_eq!(art.label, "属性布局测试");
        assert_eq!(
            art.qualified_id().as_deref(),
            Some("neuro.official/custom-layout-form-stress-test")
        );
        assert_eq!(art.effective_execution_type(), Some("framework_art"));
        assert_eq!(art.params[0].param_type, "select");
        assert_eq!(art.params[0].options.as_ref().map(Vec::len), Some(2));
        assert!(art.params[0].required);
        assert_eq!(art.params[0].group.as_deref(), Some("基础"));
        assert_eq!(
            art.outputs[0].execution_type.as_deref(),
            Some("image_buffer")
        );
    }
}

#[cfg(test)]
mod mcp_servers_mapping {
    use super::*;

    #[test]
    fn parses_local_artnexus_mcp_servers() {
        let body = r#"[
          {
            "id": "479008f0-bd4f-483e-8598-39fbae54a117",
            "name": "Brave Search",
            "description": "Web search capabilities via Brave",
            "command": "npx",
            "args": ["-y", "github:brave/brave-search-mcp-server"],
            "env": { "BRAVE_API_KEY": "test-key" },
            "enabled": true
          }
        ]"#;

        let servers = parse_local_mcp_servers_json(body).expect("parse mcp servers");
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].id, "479008f0-bd4f-483e-8598-39fbae54a117");
        assert_eq!(servers[0].name, "Brave Search");
        assert_eq!(servers[0].args[1], "github:brave/brave-search-mcp-server");
        assert_eq!(
            servers[0].env.get("BRAVE_API_KEY").map(String::as_str),
            Some("test-key")
        );
        assert!(servers[0].enabled);
    }

    #[test]
    fn rejects_non_array_mcp_server_payloads() {
        assert!(parse_local_mcp_servers_json(r#"{"servers":[]}"#).is_none());
    }
}

#[cfg(test)]
mod mcp_server_sync {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{mpsc, Mutex};
    use std::thread;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn request_header_end(buffer: &[u8]) -> Option<usize> {
        buffer.windows(4).position(|window| window == b"\r\n\r\n")
    }

    fn request_content_length(headers: &str) -> usize {
        headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                if name.eq_ignore_ascii_case("content-length") {
                    value.trim().parse::<usize>().ok()
                } else {
                    None
                }
            })
            .unwrap_or(0)
    }

    #[test]
    fn syncs_mcp_servers_to_loom_via_put_requests() {
        let _guard = ENV_LOCK.lock().expect("env lock");
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind listener");
        listener
            .set_nonblocking(true)
            .expect("set listener nonblocking");
        let port = listener.local_addr().expect("listener addr").port();
        let (tx, rx) = mpsc::channel();

        let server_handle = thread::spawn(move || {
            let started = std::time::Instant::now();
            let (mut stream, _) = loop {
                match listener.accept() {
                    Ok(connection) => break connection,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if started.elapsed() > Duration::from_secs(10) {
                            tx.send(None).expect("send timeout result");
                            return;
                        }
                        thread::sleep(Duration::from_millis(20));
                    }
                    Err(error) => panic!("accept request: {error}"),
                }
            };
            // Windows can inherit FIONBIO from the nonblocking listener.
            stream
                .set_nonblocking(false)
                .expect("set accepted stream blocking");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("set read timeout");

            let mut buffer = Vec::new();
            let mut chunk = [0_u8; 1024];
            let mut total_len = None;
            let read_started = std::time::Instant::now();
            loop {
                let read = match stream.read(&mut chunk) {
                    Ok(read) => read,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && read_started.elapsed() < Duration::from_secs(5) =>
                    {
                        thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(error) => panic!("read request: {error}"),
                };
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
                if total_len.is_none() {
                    if let Some(header_end) = request_header_end(&buffer) {
                        let headers = String::from_utf8_lossy(&buffer[..header_end + 4]);
                        let content_length = request_content_length(&headers);
                        total_len = Some(header_end + 4 + content_length);
                    }
                }
                if let Some(expected_len) = total_len {
                    if buffer.len() >= expected_len {
                        break;
                    }
                }
            }

            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                )
                .expect("write response");

            tx.send(Some(String::from_utf8(buffer).expect("utf8 request")))
                .expect("send request");
        });

        let temp_dir =
            std::env::temp_dir().join(format!("hook-mcp-sync-manifest-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let manifest_path = temp_dir.join("loom.json");
        let manifest = serde_json::json!({
            "schemaVersion": 1,
            "appId": "loom",
            "displayName": "Loom",
            "version": "test",
            "pid": 1234,
            "transport": {
                "type": "http",
                "baseUrl": format!("http://127.0.0.1:{port}"),
                "auth": "none"
            },
            "capabilities": ["brain.plan"],
            "startedAt": 1
        });
        std::fs::write(&manifest_path, manifest.to_string()).expect("write manifest");
        std::env::set_var("LOOM_MANIFEST_PATH", &manifest_path);
        let loaded_manifest =
            crate::loom_connector::read_default_loom_manifest().expect("read test manifest");
        assert_eq!(
            loaded_manifest.transport.base_url,
            format!("http://127.0.0.1:{port}")
        );

        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
        let server = LoomMcpServerConfig {
            id: "479008f0-bd4f-483e-8598-39fbae54a117".to_string(),
            name: "Brave Search".to_string(),
            description: "Web search capabilities via Brave".to_string(),
            command: "npx".to_string(),
            args: vec![
                "-y".to_string(),
                "github:brave/brave-search-mcp-server".to_string(),
            ],
            env: BTreeMap::from([("BRAVE_API_KEY".to_string(), "test-key".to_string())]),
            enabled: true,
        };

        runtime.block_on(sync_mcp_servers_to_loom(&[server]));

        let request = rx
            .recv_timeout(Duration::from_secs(15))
            .expect("receive request")
            .expect("sync_mcp_servers_to_loom should issue a PUT request");
        server_handle.join().expect("join server");
        assert!(request
            .starts_with("PUT /v1/mcp/servers/479008f0-bd4f-483e-8598-39fbae54a117 HTTP/1.1"));
        assert!(request.contains("\"id\":\"479008f0-bd4f-483e-8598-39fbae54a117\""));
        assert!(request.contains("\"command\":\"npx\""));
        assert!(request.contains("\"BRAVE_API_KEY\":\"test-key\""));

        std::env::remove_var("LOOM_MANIFEST_PATH");
        let _ = std::fs::remove_dir_all(temp_dir);
    }
}

#[cfg(test)]
mod arts_merge {
    use super::*;

    fn art(id: &str, label: &str) -> ArtDefinition {
        ArtDefinition {
            id: id.to_string(),
            label: label.to_string(),
            description: String::new(),
            icon: String::new(),
            params: vec![],
            auto_process: false,
            enabled: true,
            defaults: HashMap::new(),
            execution_type: None,
            execution: None,
            inputs: vec![],
            outputs: vec![],
            metadata: None,
            capabilities: None,
            supported_transports: vec![],
            default_visibility: HashMap::new(),
            input_schema: None,
            output_schema: None,
        }
    }

    #[test]
    fn merge_prefers_local_and_appends_unique_existing() {
        let local = vec![art("custom-1", "本地A"), art("custom-2", "本地B")];
        let existing = vec![
            art("custom-1", "Loom覆盖版"), // dup id → local wins, existing dropped
            art("hook-wf-x", "封装工具"),  // unique → kept
        ];
        let merged = merge_arts_by_id(&local, &existing);
        let ids: Vec<&str> = merged.iter().map(|a| a.id.as_str()).collect();
        assert_eq!(ids, vec!["custom-1", "custom-2", "hook-wf-x"]);
        // local wins on the conflicting id
        assert_eq!(merged[0].label, "本地A");
    }

    #[test]
    fn merge_with_empty_existing_returns_local() {
        let local = vec![art("a", "A")];
        let merged = merge_arts_by_id(&local, &[]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].id, "a");
    }

    #[test]
    fn merge_prefers_loom_control_plane_art_over_legacy_local_collision() {
        let mut local_art = art("custom-1770131241684", "本地旧版");
        local_art.execution = Some(serde_json::json!({
            "artPath": "\\\\192.168.15.200\\home\\project\\project\\ArtNexus\\ArtLoom\\python\\Arts\\Art_ColorTransfer"
        }));

        let loom_art_path = dirs::config_dir()
            .expect("config dir")
            .join("Loom")
            .join("control-plane")
            .join("arts")
            .join("custom-1770131241684")
            .join("python")
            .join("Arts")
            .join("Art_ColorTransfer");
        let loom_art_path = loom_art_path.to_string_lossy().into_owned();

        let mut loom_art = art("custom-1770131241684", "Loom安装版");
        loom_art.execution = Some(serde_json::json!({
            "artPath": loom_art_path.clone()
        }));

        let merged = merge_arts_by_id(&[local_art], &[loom_art.clone()]);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].label, "Loom安装版");
        assert_eq!(
            merged[0]
                .execution
                .as_ref()
                .and_then(|execution| execution.get("artPath"))
                .and_then(serde_json::Value::as_str),
            Some(loom_art_path.as_str())
        );
    }

    #[test]
    fn merge_recognizes_current_art_package_metadata_and_preserves_qualified_identity() {
        let local_art = art("shared-art", "本地旧版");
        let mut loom_art = art("shared-art", "Loom 安装版");
        loom_art.execution_type = Some("framework_art".to_string());
        loom_art.execution = Some(serde_json::json!({
            "type": "framework_art",
            "framework": "process"
        }));
        loom_art.metadata = Some(serde_json::json!({
            "art": { "qualifiedId": "publisher.alpha/shared-art" },
            "artPackage": {
                "qualifiedId": "publisher.alpha/shared-art",
                "dir": "C:\\Users\\test\\Loom\\control-plane\\arts\\publisher.alpha\\shared-art"
            }
        }));

        let merged = merge_arts_by_id(&[local_art], &[loom_art]);

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].label, "Loom 安装版");
        assert_eq!(
            merged[0].qualified_id().as_deref(),
            Some("publisher.alpha/shared-art")
        );
        assert!(merged[0].matches_runtime_id("publisher.alpha/shared-art"));
    }

    #[test]
    fn merge_keeps_same_local_id_from_different_publishers() {
        let mut alpha = art("shared-art", "Alpha");
        alpha.metadata = Some(serde_json::json!({
            "art": { "qualifiedId": "publisher.alpha/shared-art" },
            "artPackage": { "dir": "C:\\alpha" }
        }));
        let mut beta = art("shared-art", "Beta");
        beta.metadata = Some(serde_json::json!({
            "art": { "qualifiedId": "publisher.beta/shared-art" },
            "artPackage": { "dir": "C:\\beta" }
        }));

        let merged = merge_arts_by_id(&[], &[alpha, beta]);
        let identities = merged
            .iter()
            .map(ArtDefinition::identity_key)
            .collect::<Vec<_>>();

        assert_eq!(
            identities,
            vec![
                "publisher.alpha/shared-art".to_string(),
                "publisher.beta/shared-art".to_string()
            ]
        );
    }
}

#[cfg(test)]
mod input_image_resolution {
    use super::*;

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
            std::env::temp_dir().join(format!("mock-artloom-input-{}.png", Uuid::new_v4()));
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
            "mock-artloom-materialize-asset-{}.png",
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
            "mock-artloom-materialize-file-url-{}.png",
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
            std::env::temp_dir().join(format!("mock-artloom-path-input-{}.png", Uuid::new_v4()));
        write_test_png(&temp_path, 2, 4, [90, 80, 70, 255]);

        let img = load_input_rgba_image(Some(&temp_path.to_string_lossy().to_string()))
            .expect("load file path input");

        assert_eq!((img.width(), img.height()), (2, 4));
        assert_eq!(img.get_pixel(1, 3).0, [90, 80, 70, 255]);

        let _ = std::fs::remove_file(temp_path);
    }
}

#[cfg(test)]
mod artloom_image_search_delivery {
    use super::*;

    #[test]
    fn extracts_ahrp_image_search_metadata_from_success_responses() {
        let response = serde_json::json!({
            "request_id": "req-1",
            "status": "Success",
            "data": {
                "type": "result",
                "output": {
                    "type": "base64",
                    "data": "data:image/png;base64,AAA",
                    "width": 1,
                    "height": 1
                },
                "loomMetadata": {
                    "imageSearch": {
                        "selectedIndex": 1,
                        "candidates": [
                            {
                                "index": 0,
                                "title": "结果 1",
                                "imageUrl": "https://example.com/a.png"
                            },
                            {
                                "index": 1,
                                "title": "结果 2",
                                "imageUrl": "https://example.com/b.png"
                            }
                        ]
                    }
                }
            }
        });

        let metadata =
            extract_artloom_image_search_delivery(&response).expect("image search metadata");
        assert_eq!(metadata["selectedIndex"], 1);
        assert_eq!(metadata["candidates"].as_array().map(Vec::len), Some(2));
        assert_eq!(
            metadata["candidates"][1]["imageUrl"],
            "https://example.com/b.png"
        );
    }
}
