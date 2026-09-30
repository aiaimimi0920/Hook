use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WallPresentationReport {
    revision: u64,
    outcome: WallPresentationOutcome,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum WallPresentationOutcome {
    Applied,
    FrameUnavailable,
}
