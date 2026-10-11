//! Resolve Otter environment names without losing explicitly configured legacy values.
use std::env::VarError;
use std::ffi::{OsStr, OsString};

fn canonical_name(name: &OsStr) -> Option<OsString> {
    let name = name.to_str()?;
    if name.starts_with("HOOK_") || name.starts_with("LOOM_HOOK_") {
        Some(name.replace("HOOK", "OTTER").into())
    } else {
        None
    }
}

fn lookup(name: &OsStr, read: impl Fn(&OsStr) -> Option<OsString>) -> Option<OsString> {
    // A present canonical value, including an empty value, wins. Never resurrect
    // legacy credentials or an opt-in after an explicit canonical override.
    canonical_name(name)
        .and_then(|canonical| read(&canonical))
        .or_else(|| read(name))
}

pub fn var_os(name: impl AsRef<OsStr>) -> Option<OsString> {
    lookup(name.as_ref(), |key| std::env::var_os(key))
}

pub fn var(name: impl AsRef<OsStr>) -> Result<String, VarError> {
    var_os(name)
        .ok_or(VarError::NotPresent)?
        .into_string()
        .map_err(VarError::NotUnicode)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_override_wins_and_legacy_remains_supported() {
        let values = [
            ("OTTER_ENABLE_LOOM_OTTER", "0"),
            ("HOOK_ENABLE_LOOM_HOOK", "1"),
            ("HOOK_APPDATA_DIR", "old-user-data"),
            ("PATH", "unchanged"),
        ];
        let read = |key: &OsStr| {
            values
                .iter()
                .find(|(name, _)| key == OsStr::new(name))
                .map(|(_, value)| OsString::from(value))
        };
        assert_eq!(
            lookup(OsStr::new("HOOK_ENABLE_LOOM_HOOK"), read),
            Some("0".into())
        );
        assert_eq!(
            lookup(OsStr::new("HOOK_APPDATA_DIR"), read),
            Some("old-user-data".into())
        );
        assert_eq!(lookup(OsStr::new("PATH"), read), Some("unchanged".into()));
    }

    #[test]
    fn empty_canonical_value_does_not_fall_back_to_legacy() {
        let read = |key: &OsStr| match key.to_str() {
            Some("LOOM_OTTER_BRIDGE_URL") => Some(OsString::new()),
            Some("LOOM_HOOK_BRIDGE_URL") => Some("legacy".into()),
            _ => None,
        };
        assert_eq!(
            lookup(OsStr::new("LOOM_HOOK_BRIDGE_URL"), read),
            Some(OsString::new())
        );
    }
}
