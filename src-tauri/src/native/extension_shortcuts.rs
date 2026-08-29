// Owns plugin-declared shortcut registration without knowing plugin command IDs.

const MAX_EXTENSION_SHORTCUTS: usize = 128;

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExtensionShortcutRegistration {
    id: String,
    key: String,
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
    global: bool,
}

#[derive(Clone)]
struct RegisteredExtensionShortcut {
    definition: ExtensionShortcutRegistration,
    shortcut: Shortcut,
}

fn registered_extension_shortcuts() -> &'static Mutex<Vec<RegisteredExtensionShortcut>> {
    static SHORTCUTS: OnceLock<Mutex<Vec<RegisteredExtensionShortcut>>> = OnceLock::new();
    SHORTCUTS.get_or_init(|| Mutex::new(Vec::new()))
}

fn extension_shortcut_modifiers(value: &ExtensionShortcutRegistration) -> Modifiers {
    let mut modifiers = Modifiers::empty();
    if value.ctrl {
        modifiers |= Modifiers::CONTROL;
    }
    if value.alt {
        modifiers |= Modifiers::ALT;
    }
    if value.shift {
        modifiers |= Modifiers::SHIFT;
    }
    if value.meta {
        modifiers |= Modifiers::SUPER;
    }
    modifiers
}

fn build_extension_shortcuts(
    definitions: Vec<ExtensionShortcutRegistration>,
) -> Result<Vec<RegisteredExtensionShortcut>, String> {
    if definitions.len() > MAX_EXTENSION_SHORTCUTS {
        return Err("extension shortcut count exceeds the native budget".to_owned());
    }
    let voice_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
    let mut ids = std::collections::HashSet::new();
    let mut chords = std::collections::HashSet::new();
    let mut registered = Vec::with_capacity(definitions.len());
    for definition in definitions {
        if definition.id.is_empty()
            || definition.id.len() > 384
            || definition.id.chars().any(char::is_control)
        {
            return Err("extension shortcut id is invalid".to_owned());
        }
        if !ids.insert(definition.id.clone()) {
            return Err("extension shortcut ids must be unique".to_owned());
        }
        let code = shortcut_code_for_key(&definition.key)
            .ok_or_else(|| format!("unsupported extension shortcut key: {}", definition.key))?;
        let modifiers = extension_shortcut_modifiers(&definition);
        let shortcut = Shortcut::new((!modifiers.is_empty()).then_some(modifiers), code);
        if shortcut.id() == voice_shortcut.id() {
            return Err("extension shortcut conflicts with the emergency voice control".to_owned());
        }
        if !chords.insert(shortcut.id()) {
            return Err("extension shortcut chords must be unique".to_owned());
        }
        registered.push(RegisteredExtensionShortcut {
            definition,
            shortcut,
        });
    }
    Ok(registered)
}

fn extension_shortcut_payload(shortcut: &Shortcut) -> Option<serde_json::Value> {
    let shortcuts = registered_extension_shortcuts().lock().ok()?;
    let value = shortcuts
        .iter()
        .find(|entry| entry.definition.global && entry.shortcut.id() == shortcut.id())?;
    Some(serde_json::json!({
        "key": value.definition.key,
        "ctrlKey": value.definition.ctrl,
        "altKey": value.definition.alt,
        "shiftKey": value.definition.shift,
        "metaKey": value.definition.meta,
    }))
}

#[cfg(target_os = "windows")]
fn extension_forwarded_shortcut(
    vk_code: u32,
    modifiers: ModifierSnapshot,
) -> Option<ForwardedShortcut> {
    let shortcuts = registered_extension_shortcuts().lock().ok()?;
    let value = shortcuts.iter().find(|entry| {
        !entry.definition.global
            && shortcut_config::vk_code_for_key(&entry.definition.key) == Some(vk_code)
            && entry.definition.ctrl == modifiers.ctrl_pressed
            && entry.definition.alt == modifiers.alt_pressed
            && entry.definition.shift == modifiers.shift_pressed
            && entry.definition.meta == modifiers.meta_pressed
    })?;
    Some(ForwardedShortcut {
        key: value.definition.key.clone(),
        ctrl: value.definition.ctrl,
        alt: value.definition.alt,
        shift: value.definition.shift,
        meta: value.definition.meta,
    })
}

#[cfg(target_os = "windows")]
fn extension_global_shortcut_is_registered(
    vk_code: u32,
    modifiers: shortcut_config::Modifiers,
) -> bool {
    registered_extension_shortcuts()
        .lock()
        .map(|shortcuts| {
            shortcuts.iter().any(|entry| {
                entry.definition.global
                    && shortcut_config::vk_code_for_key(&entry.definition.key) == Some(vk_code)
                    && entry.definition.ctrl == modifiers.ctrl
                    && entry.definition.alt == modifiers.alt
                    && entry.definition.shift == modifiers.shift
                    && entry.definition.meta == modifiers.meta
            })
        })
        .unwrap_or(false)
}

#[tauri::command]
fn set_extension_shortcuts(
    app: tauri::AppHandle,
    shortcuts: Vec<ExtensionShortcutRegistration>,
) -> Result<(), String> {
    let desired = build_extension_shortcuts(shortcuts)?;
    let configured = configured_global_shortcuts()
        .lock()
        .map_err(|_| "lock configured global shortcuts".to_owned())?;
    if desired.iter().filter(|entry| entry.definition.global).any(|entry| {
        configured
            .iter()
            .any(|core| core.id() == entry.shortcut.id())
    }) {
        return Err("extension shortcut conflicts with a configured core shortcut".to_owned());
    }
    drop(configured);

    let mut current = registered_extension_shortcuts()
        .lock()
        .map_err(|_| "lock extension shortcuts".to_owned())?;
    let additions = desired
        .iter()
        .filter(|entry| {
            entry.definition.global
                && !current.iter().any(|old| {
                    old.definition.global && old.shortcut.id() == entry.shortcut.id()
                })
        })
        .cloned()
        .collect::<Vec<_>>();
    let removals = current
        .iter()
        .filter(|entry| {
            entry.definition.global
                && !desired.iter().any(|next| {
                    next.definition.global && next.shortcut.id() == entry.shortcut.id()
                })
        })
        .cloned()
        .collect::<Vec<_>>();

    let mut added = Vec::new();
    for entry in additions {
        if let Err(error) = app.global_shortcut().register(entry.shortcut) {
            for rollback in added {
                let _ = app.global_shortcut().unregister(rollback);
            }
            return Err(format!("register extension shortcut: {error}"));
        }
        added.push(entry.shortcut);
    }
    let mut removed = Vec::new();
    for entry in removals {
        if let Err(error) = app.global_shortcut().unregister(entry.shortcut) {
            for rollback in removed {
                let _ = app.global_shortcut().register(rollback);
            }
            for rollback in added {
                let _ = app.global_shortcut().unregister(rollback);
            }
            return Err(format!("unregister extension shortcut: {error}"));
        }
        removed.push(entry.shortcut);
    }
    *current = desired;
    Ok(())
}

#[cfg(test)]
mod extension_shortcut_tests {
    use super::*;

    fn shortcut(id: &str, key: &str, ctrl: bool, alt: bool) -> ExtensionShortcutRegistration {
        ExtensionShortcutRegistration {
            id: id.to_owned(),
            key: key.to_owned(),
            ctrl,
            alt,
            shift: false,
            meta: false,
            global: true,
        }
    }

    #[test]
    fn validates_generic_shortcuts_without_ocr_ids() {
        let values = build_extension_shortcuts(vec![shortcut("publisher/tool.run", "2", true, false)])
            .expect("valid shortcut");
        assert_eq!(values.len(), 1);
        assert_eq!(values[0].definition.key, "2");
    }

    #[test]
    fn rejects_duplicate_chords_and_fixed_voice_control() {
        assert!(build_extension_shortcuts(vec![
            shortcut("publisher/a", "2", true, false),
            shortcut("publisher/b", "2", true, false),
        ])
        .is_err());
        assert!(build_extension_shortcuts(vec![shortcut("publisher/a", " ", true, true)])
            .is_err());
    }
}
