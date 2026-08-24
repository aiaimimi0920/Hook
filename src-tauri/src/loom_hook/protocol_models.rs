// Owns the stable Loom Hook and Surface protocol DTOs and serde field contracts.
// =========================================================================
// 1. Hook host protocol definitions
// =========================================================================

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq)]
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
