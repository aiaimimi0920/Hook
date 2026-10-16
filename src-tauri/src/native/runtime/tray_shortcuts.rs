// Display-only shortcuts: native tab columns align labels without registering
// a second accelerator that could compete with the existing input dispatcher.
struct TrayShortcutItems(Vec<(MenuItem<tauri::Wry>, &'static str, &'static str)>);

fn tray_shortcut_label(label: &str, action: &str) -> String {
    format_tray_shortcut_label(label, &shortcut_config::chords_for_action(action))
}

fn format_tray_shortcut_label(label: &str, chords: &[shortcut_config::Chord]) -> String {
    let shortcuts = chords
        .iter()
        .map(|chord| {
            let mut parts = Vec::new();
            if chord.modifiers.ctrl {
                parts.push("Ctrl");
            }
            if chord.modifiers.alt {
                parts.push("Alt");
            }
            if chord.modifiers.shift {
                parts.push("Shift");
            }
            if chord.modifiers.meta {
                parts.push("Win");
            }
            parts.push(chord.key.as_str());
            parts.join("+")
        })
        .collect::<Vec<_>>()
        .join(" / ");
    if shortcuts.is_empty() {
        label.to_owned()
    } else {
        format!("{label}\t{shortcuts}")
    }
}

fn refresh_tray_shortcut_labels(app: &tauri::AppHandle) {
    if let Some(items) = app.try_state::<TrayShortcutItems>() {
        for (item, label, action) in &items.0 {
            if let Err(error) = item.set_text(tray_shortcut_label(label, action)) {
                append_runtime_log_line(&format!("tray_shortcut_label_failed :: {error}"));
            }
        }
    }
}

#[cfg(test)]
mod tray_shortcut_tests {
    use super::*;

    #[test]
    fn shortcut_columns_follow_configured_chords_and_omit_disabled_keys() {
        let chord = shortcut_config::Chord {
            key: "F8".to_owned(),
            modifiers: shortcut_config::Modifiers {
                ctrl: true,
                shift: true,
                ..Default::default()
            },
        };
        assert_eq!(
            format_tray_shortcut_label("截图", &[chord]),
            "截图\tCtrl+Shift+F8"
        );
        assert_eq!(format_tray_shortcut_label("截图", &[]), "截图");
    }
}
