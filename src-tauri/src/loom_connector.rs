//! Public Loom connector facade; implementation owners live in loom_connector/.

mod discovery;
mod invoke;
mod manifest;
mod sanitize;
mod types;

pub use discovery::read_default_loom_manifest;
pub use invoke::{build_brain_plan_envelope, invoke_brain_plan, invoke_brain_plan_with_manifest};
pub use manifest::{
    classify_loom_base_url, is_loopback_base_url, validate_loom_manifest,
    validate_loom_manifest_value,
};
pub use types::*;
