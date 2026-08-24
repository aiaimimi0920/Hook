// Defines the serialized Hook session document contract and revision metadata.

// --- Persistence ---

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")] // Match frontend naming convention
pub struct SimpleRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimplePoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StickerData {
    pub id: String,
    pub src: String, // Can be Base64 or File Path
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub minified: Option<bool>,
    pub saved_rect: Option<SimpleRect>,
    pub crop_offset: Option<SimplePoint>,
    pub opacity_normal: Option<f64>,
    pub opacity_mini: Option<f64>,
    #[serde(rename = "type")]
    pub node_type: Option<String>,
    #[serde(rename = "artId")]
    pub art_id: Option<String>,
    pub params: Option<serde_json::Value>, // Store params as JSON value
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    #[serde(rename = "previewSrc")]
    pub preview_src: Option<String>, // Processed image result
    #[serde(rename = "originWorkflowId")]
    pub origin_workflow_id: Option<String>,
    #[serde(rename = "originNodeId")]
    pub origin_node_id: Option<String>,
    #[serde(rename = "executionConfig")]
    pub execution_config: Option<serde_json::Value>,
    #[serde(rename = "annotationState")]
    pub annotation_state: Option<serde_json::Value>,
    #[serde(rename = "imageEditState")]
    pub image_edit_state: Option<serde_json::Value>,
    #[serde(rename = "stickerEditPropagation")]
    pub sticker_edit_propagation: Option<serde_json::Value>,
    #[serde(rename = "groupId")]
    pub group_id: Option<String>,
    #[serde(rename = "captureMeta")]
    pub capture_meta: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkData {
    pub id: String,
    pub from_unit_id: String,
    pub from_port_id: String,
    pub to_unit_id: String,
    pub to_port_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FrozenStickerEntry {
    pub entry_id: String,
    pub source_sticker_id: String,
    pub created_at: String,
    pub snapshot: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveNodeIndex {
    pub sticker_id: String,
    pub updated_at: String,
    pub src: Option<String>,
    pub preview_src: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveWorkflowIndex {
    pub updated_at: String,
    #[serde(default)]
    pub nodes: std::collections::BTreeMap<String, WorkflowAssetArchiveNodeIndex>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveIndex {
    pub version: u32,
    #[serde(default)]
    pub workflows: std::collections::BTreeMap<String, WorkflowAssetArchiveWorkflowIndex>,
}

impl Default for WorkflowAssetArchiveIndex {
    fn default() -> Self {
        Self {
            version: 1,
            workflows: std::collections::BTreeMap::new(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveNodeHint {
    pub sticker_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveWorkflowHint {
    #[serde(default)]
    pub nodes: std::collections::BTreeMap<String, WorkflowAssetArchiveNodeHint>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowAssetArchiveHints {
    #[serde(default)]
    pub workflows: std::collections::BTreeMap<String, WorkflowAssetArchiveWorkflowHint>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    #[serde(default)]
    pub document_schema_version: u32,
    #[serde(default)]
    pub document_revision: u64,
    pub stickers: Vec<StickerData>,
    pub links: Vec<LinkData>,
    #[serde(default)]
    pub groups: Vec<serde_json::Value>,
    #[serde(default)]
    pub recycle_bin: Vec<FrozenStickerEntry>,
    #[serde(default)]
    pub reference_library: Vec<FrozenStickerEntry>,
    #[serde(default)]
    pub workflow_asset_archive_index: WorkflowAssetArchiveIndex,
}

const SESSION_DOCUMENT_SCHEMA_VERSION: u32 = 1;
const SESSION_FILE_LOCK_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionSaveResult {
    document_revision: u64,
}
