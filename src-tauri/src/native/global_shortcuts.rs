// Owns Loom-configured global shortcut registration and settings commands.

fn configured_global_shortcuts() -> &'static Mutex<Vec<Shortcut>> {
    static SHORTCUTS: OnceLock<Mutex<Vec<Shortcut>>> = OnceLock::new();
    SHORTCUTS.get_or_init(|| Mutex::new(Vec::new()))
}

fn shortcut_code_for_key(key: &str) -> Option<Code> {
    match shortcut_config::vk_code_for_key(key)? {
        0x09 => Some(Code::Tab),
        0x20 => Some(Code::Space),
        0x70 => Some(Code::F1),
        0x71 => Some(Code::F2),
        0x72 => Some(Code::F3),
        0x73 => Some(Code::F4),
        0x74 => Some(Code::F5),
        0x75 => Some(Code::F6),
        0x76 => Some(Code::F7),
        0x77 => Some(Code::F8),
        0x78 => Some(Code::F9),
        0x79 => Some(Code::F10),
        0x7A => Some(Code::F11),
        0x7B => Some(Code::F12),
        value if (b'0' as u32..=b'9' as u32).contains(&value) => Some(match value {
            v if v == b'0' as u32 => Code::Digit0,
            v if v == b'1' as u32 => Code::Digit1,
            v if v == b'2' as u32 => Code::Digit2,
            v if v == b'3' as u32 => Code::Digit3,
            v if v == b'4' as u32 => Code::Digit4,
            v if v == b'5' as u32 => Code::Digit5,
            v if v == b'6' as u32 => Code::Digit6,
            v if v == b'7' as u32 => Code::Digit7,
            v if v == b'8' as u32 => Code::Digit8,
            _ => Code::Digit9,
        }),
        value if (b'A' as u32..=b'Z' as u32).contains(&value) => Some(match value {
            v if v == b'A' as u32 => Code::KeyA,
            v if v == b'B' as u32 => Code::KeyB,
            v if v == b'C' as u32 => Code::KeyC,
            v if v == b'D' as u32 => Code::KeyD,
            v if v == b'E' as u32 => Code::KeyE,
            v if v == b'F' as u32 => Code::KeyF,
            v if v == b'G' as u32 => Code::KeyG,
            v if v == b'H' as u32 => Code::KeyH,
            v if v == b'I' as u32 => Code::KeyI,
            v if v == b'J' as u32 => Code::KeyJ,
            v if v == b'K' as u32 => Code::KeyK,
            v if v == b'L' as u32 => Code::KeyL,
            v if v == b'M' as u32 => Code::KeyM,
            v if v == b'N' as u32 => Code::KeyN,
            v if v == b'O' as u32 => Code::KeyO,
            v if v == b'P' as u32 => Code::KeyP,
            v if v == b'Q' as u32 => Code::KeyQ,
            v if v == b'R' as u32 => Code::KeyR,
            v if v == b'S' as u32 => Code::KeyS,
            v if v == b'T' as u32 => Code::KeyT,
            v if v == b'U' as u32 => Code::KeyU,
            v if v == b'V' as u32 => Code::KeyV,
            v if v == b'W' as u32 => Code::KeyW,
            v if v == b'X' as u32 => Code::KeyX,
            v if v == b'Y' as u32 => Code::KeyY,
            _ => Code::KeyZ,
        }),
        _ => None,
    }
}

fn tauri_shortcut_from_chord(chord: &shortcut_config::Chord) -> Option<Shortcut> {
    let mut modifiers = Modifiers::empty();
    if chord.modifiers.ctrl {
        modifiers |= Modifiers::CONTROL;
    }
    if chord.modifiers.alt {
        modifiers |= Modifiers::ALT;
    }
    if chord.modifiers.shift {
        modifiers |= Modifiers::SHIFT;
    }
    if chord.modifiers.meta {
        modifiers |= Modifiers::SUPER;
    }
    Some(Shortcut::new(
        (!modifiers.is_empty()).then_some(modifiers),
        shortcut_code_for_key(&chord.key)?,
    ))
}

fn configured_global_action_for_shortcut(shortcut: &Shortcut) -> Option<&'static str> {
    ["capture", "long_capture", "toggle_sticker_toolbar"]
        .into_iter()
        .find(|action| {
            shortcut_config::chords_for_action(action)
                .iter()
                .filter_map(tauri_shortcut_from_chord)
                .any(|candidate| candidate.id() == shortcut.id())
        })
}

fn configured_global_shortcut_is_registered(
    vk_code: u32,
    modifiers: shortcut_config::Modifiers,
) -> bool {
    let Some(action) = shortcut_config::global_action(vk_code, modifiers) else {
        return false;
    };
    let Some(candidate) = shortcut_config::chords_for_action(action)
        .iter()
        .find(|chord| {
            shortcut_config::vk_code_for_key(&chord.key) == Some(vk_code)
                && chord.modifiers == modifiers
        })
        .and_then(tauri_shortcut_from_chord)
    else {
        return false;
    };
    configured_global_shortcuts()
        .lock()
        .map(|shortcuts| {
            shortcuts
                .iter()
                .any(|shortcut| shortcut.id() == candidate.id())
        })
        .unwrap_or(false)
}

fn refresh_configured_global_shortcuts(app: &tauri::AppHandle) -> Result<(), String> {
    let mut desired = ["capture", "long_capture", "toggle_sticker_toolbar"]
        .into_iter()
        .flat_map(shortcut_config::chords_for_action)
        .filter_map(|chord| tauri_shortcut_from_chord(&chord))
        .collect::<Vec<_>>();
    desired.sort_by_key(Shortcut::id);
    desired.dedup_by_key(|shortcut| shortcut.id());

    let mut registered = configured_global_shortcuts()
        .lock()
        .map_err(|_| "lock configured global shortcuts".to_owned())?;
    let mut newly_registered = Vec::new();
    for shortcut in &desired {
        if registered
            .iter()
            .any(|current| current.id() == shortcut.id())
        {
            continue;
        }
        if let Err(error) = app.global_shortcut().register(*shortcut) {
            for rollback in newly_registered {
                let _ = app.global_shortcut().unregister(rollback);
            }
            for previous in registered.drain(..) {
                let _ = app.global_shortcut().unregister(previous);
            }
            return Err(format!("register configured global shortcut: {error}"));
        }
        newly_registered.push(*shortcut);
    }
    for shortcut in registered.iter() {
        if !desired.iter().any(|next| next.id() == shortcut.id()) {
            app.global_shortcut()
                .unregister(*shortcut)
                .map_err(|error| format!("unregister previous global shortcut: {error}"))?;
        }
    }
    *registered = desired;
    Ok(())
}

pub(crate) fn apply_loom_shortcut_settings(
    app: &tauri::AppHandle,
    settings: &serde_json::Value,
) -> Result<(), String> {
    shortcut_config::apply_settings(settings)?;
    if let Err(error) = refresh_configured_global_shortcuts(app) {
        append_runtime_log_line(&format!(
            "refresh_configured_global_shortcuts_failed :: {error}"
        ));
    }
    Ok(())
}

#[tauri::command]
fn get_loom_shortcut_settings() -> Option<serde_json::Value> {
    shortcut_config::current_settings()
}
