//! Locates and reads the active Loom capability manifest.

use super::manifest::validate_loom_manifest;
use super::types::{LoomConnectorError, LoomManifest, MAX_LOOM_MANIFEST_BYTES};
use std::io::Read;
use std::path::PathBuf;

pub fn read_default_loom_manifest() -> Result<LoomManifest, LoomConnectorError> {
    let path = default_loom_manifest_paths()
        .into_iter()
        .find(|candidate| candidate.exists())
        .ok_or(LoomConnectorError::ManifestNotFound)?;
    let file = std::fs::File::open(&path).map_err(|error| {
        LoomConnectorError::ManifestRead(format!("{}: {}", path.display(), error))
    })?;
    let mut raw = Vec::new();
    file.take((MAX_LOOM_MANIFEST_BYTES + 1) as u64)
        .read_to_end(&mut raw)
        .map_err(|error| {
            LoomConnectorError::ManifestRead(format!("{}: {}", path.display(), error))
        })?;
    if raw.len() > MAX_LOOM_MANIFEST_BYTES {
        return Err(LoomConnectorError::InvalidManifest(format!(
            "manifest exceeds the {MAX_LOOM_MANIFEST_BYTES}-byte limit"
        )));
    }
    let raw = String::from_utf8(raw).map_err(|_| {
        LoomConnectorError::ManifestParse("manifest must be valid UTF-8".to_string())
    })?;
    validate_loom_manifest(&raw)
}

fn default_loom_manifest_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(path) = std::env::var_os("LOOM_MANIFEST_PATH")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        paths.push(path);
    }

    for key in [
        "LOOM_MANIFEST_DIR",
        "LOOM_CAPABILITY_MANIFEST_DIR",
        "NEURO_CAPABILITIES_DIR",
    ] {
        if let Some(dir) = std::env::var_os(key)
            .map(PathBuf::from)
            .filter(|path| !path.as_os_str().is_empty())
        {
            paths.push(dir.join("loom.json"));
        }
    }

    if let Some(appdata) = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
    {
        paths.push(appdata.join("Neuro").join("capabilities").join("loom.json"));
    }

    paths.push(
        PathBuf::from(".runtime")
            .join("neuro")
            .join("capabilities")
            .join("loom.json"),
    );

    paths
}
