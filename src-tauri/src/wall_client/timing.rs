use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WallSceneReport {
    revision: u64,
    prepared: bool,
    applied_at_ms: Option<u64>,
    clock_uncertainty_ms: Option<u32>,
}
