use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct Modifiers {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Chord {
    pub key: String,
    pub modifiers: Modifiers,
}

#[derive(Clone, Debug, Deserialize)]
struct LoomShortcut {
    #[serde(default)]
    keys: String,
    #[serde(default = "enabled_by_default")]
    enabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
struct LoomQuickBinding {
    #[serde(default)]
    art: String,
    #[serde(default)]
    key: String,
}

#[derive(Clone, Debug, Deserialize)]
struct LoomHookGeneral {
    #[serde(default = "enabled_by_default")]
    close_to_tray: bool,
}

impl Default for LoomHookGeneral {
    fn default() -> Self {
        Self {
            close_to_tray: true,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
struct LoomSettings {
    #[serde(default)]
    hook_general: LoomHookGeneral,
    #[serde(default)]
    shortcuts: HashMap<String, LoomShortcut>,
    #[serde(default)]
    quick_bindings: Vec<LoomQuickBinding>,
}

#[derive(Clone, Debug, Default)]
pub struct RuntimeShortcutConfig {
    actions: HashMap<String, Vec<Chord>>,
    quick_bindings: Vec<(String, Vec<Chord>)>,
    close_to_tray: bool,
}

const FRONTEND_ACTIONS: &[&str] = &[
    "open_image",
    "save_image",
    "toggle_clean_view",
    "toggle_history",
    "toggle_actions",
    "toggle_params",
    "undo_edit",
    "redo_edit",
    "transform_select",
    "transform_move",
    "transform_rotate",
    "transform_scale",
];

fn enabled_by_default() -> bool {
    true
}

fn default_actions() -> HashMap<String, Vec<Chord>> {
    [
        ("capture", "Ctrl+1"),
        ("long_capture", "Ctrl+3"),
        ("open_image", "Ctrl+O"),
        ("save_image", "Ctrl+S"),
        ("toggle_clean_view", "Ctrl+4"),
        ("toggle_history", "Ctrl+H"),
        ("cancel", "Escape / Delete / Backspace"),
        ("toggle_actions", "Shift+1"),
        ("toggle_params", "Tab"),
        ("copy_unit", "Ctrl+C"),
        ("paste_unit", "Ctrl+V"),
        ("delete_unit", "Escape / Delete / Backspace"),
        ("toggle_sticker_toolbar", "Ctrl+E"),
        ("undo_edit", "Ctrl+Z"),
        ("redo_edit", "Ctrl+Y"),
        ("transform_select", "Q"),
        ("transform_move", "W"),
        ("transform_rotate", "E"),
        ("transform_scale", "R"),
        ("drag_alignment", "Alt+拖动"),
        ("drag_out", "Shift+拖动"),
        ("drag_cascade", "Ctrl+拖动"),
    ]
    .into_iter()
    .map(|(id, keys)| (id.to_owned(), parse_chords(keys)))
    .collect()
}

fn runtime_config() -> &'static RwLock<RuntimeShortcutConfig> {
    static CONFIG: OnceLock<RwLock<RuntimeShortcutConfig>> = OnceLock::new();
    CONFIG.get_or_init(|| {
        RwLock::new(RuntimeShortcutConfig {
            actions: default_actions(),
            quick_bindings: Vec::new(),
            close_to_tray: true,
        })
    })
}

fn runtime_settings() -> &'static RwLock<Option<Value>> {
    static SETTINGS: OnceLock<RwLock<Option<Value>>> = OnceLock::new();
    SETTINGS.get_or_init(|| RwLock::new(None))
}

pub fn apply_settings(settings: &Value) -> Result<(), String> {
    let next = config_from_settings(settings)?;
    *runtime_config()
        .write()
        .map_err(|_| "lock runtime shortcut config".to_owned())? = next;
    *runtime_settings()
        .write()
        .map_err(|_| "lock runtime Loom settings".to_owned())? = Some(settings.clone());
    Ok(())
}

pub fn current_settings() -> Option<Value> {
    runtime_settings()
        .read()
        .ok()
        .and_then(|value| value.clone())
}

fn config_from_settings(settings: &Value) -> Result<RuntimeShortcutConfig, String> {
    let parsed: LoomSettings = serde_json::from_value(settings.clone())
        .map_err(|error| format!("invalid Loom shortcut settings: {error}"))?;
    let mut actions = default_actions();
    for (id, shortcut) in parsed.shortcuts {
        let chords = if shortcut.enabled {
            parse_chords(&shortcut.keys)
        } else {
            Vec::new()
        };
        actions.insert(id, chords);
    }
    let quick_bindings = parsed
        .quick_bindings
        .into_iter()
        .filter_map(|binding| {
            let art = binding.art.trim().to_owned();
            let chords = parse_chords(&binding.key);
            (!art.is_empty() && !chords.is_empty()).then_some((art, chords))
        })
        .collect();
    Ok(RuntimeShortcutConfig {
        actions,
        quick_bindings,
        close_to_tray: parsed.hook_general.close_to_tray,
    })
}

pub fn close_to_tray_enabled() -> bool {
    runtime_config()
        .read()
        .map(|config| config.close_to_tray)
        .unwrap_or(true)
}

pub fn action_matches(action: &str, vk_code: u32, modifiers: Modifiers) -> bool {
    runtime_config()
        .read()
        .ok()
        .and_then(|config| config.actions.get(action).cloned())
        .unwrap_or_default()
        .iter()
        .any(|chord| chord_matches_vk(chord, vk_code, modifiers))
}

pub fn frontend_shortcut(vk_code: u32, modifiers: Modifiers) -> Option<Chord> {
    let config = runtime_config().read().ok()?;
    for action in FRONTEND_ACTIONS {
        if let Some(chord) = config.actions.get(*action).and_then(|chords| {
            chords
                .iter()
                .find(|chord| chord_matches_vk(chord, vk_code, modifiers))
        }) {
            return Some(chord.clone());
        }
    }
    for (_, chords) in &config.quick_bindings {
        if let Some(chord) = chords
            .iter()
            .find(|chord| chord_matches_vk(chord, vk_code, modifiers))
        {
            return Some(chord.clone());
        }
    }
    None
}

pub fn global_action(vk_code: u32, modifiers: Modifiers) -> Option<&'static str> {
    ["capture", "long_capture", "toggle_sticker_toolbar"]
        .into_iter()
        .find(|action| action_matches(action, vk_code, modifiers))
}

pub fn chords_for_action(action: &str) -> Vec<Chord> {
    runtime_config()
        .read()
        .ok()
        .and_then(|config| config.actions.get(action).cloned())
        .unwrap_or_default()
}

pub fn gesture_matches(action: &str, modifiers: Modifiers) -> bool {
    runtime_config()
        .read()
        .ok()
        .and_then(|config| config.actions.get(action).cloned())
        .unwrap_or_default()
        .iter()
        .any(|chord| chord.modifiers == modifiers)
}

pub fn parse_chords(value: &str) -> Vec<Chord> {
    value
        .split('/')
        .filter_map(|candidate| parse_chord(candidate.trim()))
        .collect()
}

fn parse_chord(value: &str) -> Option<Chord> {
    if value.is_empty() || value.contains('×') {
        return None;
    }
    let mut modifiers = Modifiers::default();
    let mut key = None;
    for part in value
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => modifiers.ctrl = true,
            "alt" => modifiers.alt = true,
            "shift" => modifiers.shift = true,
            "meta" | "cmd" | "command" | "win" => modifiers.meta = true,
            _ => key = Some(normalize_key(part)),
        }
    }
    key.map(|key| Chord { key, modifiers })
}

fn normalize_key(value: &str) -> String {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    if let Some(number) = lower
        .strip_prefix('f')
        .and_then(|value| value.parse::<u8>().ok())
    {
        if (1..=12).contains(&number) {
            return format!("F{number}");
        }
    }
    match lower.as_str() {
        "esc" | "escape" => "Escape".to_owned(),
        "del" | "delete" => "Delete".to_owned(),
        "backspace" => "Backspace".to_owned(),
        "tab" => "Tab".to_owned(),
        "space" | "spacebar" => " ".to_owned(),
        key if key.len() == 1 => key.to_owned(),
        _ => trimmed.to_owned(),
    }
}

fn chord_matches_vk(chord: &Chord, vk_code: u32, modifiers: Modifiers) -> bool {
    chord.modifiers == modifiers
        && vk_code_for_key(&chord.key)
            .map(|expected| expected == vk_code)
            .unwrap_or(false)
}

pub fn vk_code_for_key(key: &str) -> Option<u32> {
    match normalize_key(key).as_str() {
        "Escape" => Some(0x1B),
        "Delete" => Some(0x2E),
        "Backspace" => Some(0x08),
        "Tab" => Some(0x09),
        " " => Some(0x20),
        "F1" => Some(0x70),
        "F2" => Some(0x71),
        "F3" => Some(0x72),
        "F4" => Some(0x73),
        "F5" => Some(0x74),
        "F6" => Some(0x75),
        "F7" => Some(0x76),
        "F8" => Some(0x77),
        "F9" => Some(0x78),
        "F10" => Some(0x79),
        "F11" => Some(0x7A),
        "F12" => Some(0x7B),
        value if value.len() == 1 => {
            let byte = value.as_bytes()[0];
            (byte.is_ascii_alphanumeric()).then_some(byte.to_ascii_uppercase() as u32)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_ordered_alternatives_and_exact_modifiers() {
        let chords = parse_chords("Escape / Ctrl+Delete / Shift+1");
        assert_eq!(chords.len(), 3);
        assert_eq!(chords[0].key, "Escape");
        assert!(chords[1].modifiers.ctrl);
        assert_eq!(chords[2].key, "1");
        assert!(chords[2].modifiers.shift);
    }

    #[test]
    fn settings_replace_runtime_actions_without_touching_emergency_escape() {
        let config = config_from_settings(&json!({
            "shortcuts": {
                "capture": { "keys": "Alt+9", "enabled": true },
                "cancel": { "keys": "F8", "enabled": true }
            },
            "quick_bindings": []
        }))
        .expect("settings parse");
        let capture = config.actions.get("capture").expect("capture action");
        assert!(capture.iter().any(|chord| chord_matches_vk(
            chord,
            b'9' as u32,
            Modifiers {
                alt: true,
                ..Modifiers::default()
            }
        )));
        assert!(!capture.iter().any(|chord| chord_matches_vk(
            chord,
            b'1' as u32,
            Modifiers {
                ctrl: true,
                ..Modifiers::default()
            }
        )));
        // Emergency triple Escape is intentionally implemented outside this table.
        assert!(!config
            .actions
            .get("cancel")
            .expect("cancel action")
            .iter()
            .any(|chord| chord_matches_vk(chord, 0x1B, Modifiers::default())));
    }

    #[test]
    fn settings_control_close_to_tray_without_changing_the_safe_default() {
        let disabled = config_from_settings(&json!({
            "hook_general": { "close_to_tray": false }
        }))
        .expect("settings parse");
        assert!(!disabled.close_to_tray);

        let defaults = config_from_settings(&json!({})).expect("default settings parse");
        assert!(defaults.close_to_tray);
    }

    #[test]
    fn ocr_and_translation_shortcuts_are_not_core_defaults() {
        let defaults = default_actions();
        assert!(!defaults.contains_key("toggle_ocr"));
        assert!(!defaults.contains_key("toggle_translation"));
    }
}
