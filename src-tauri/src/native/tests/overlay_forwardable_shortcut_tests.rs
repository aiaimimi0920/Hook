// Verifies forwarded overlay shortcuts preserve configured physical-key semantics.

#[cfg(all(test, target_os = "windows"))]
mod overlay_forwardable_shortcut_tests {
    use super::{
        overlay_keyboard_forwardable_shortcut, overlay_keyboard_should_consume_forwarded_shortcut,
        ModifierSnapshot, VK_TAB,
    };

    fn mods(ctrl: bool, shift: bool, alt: bool) -> ModifierSnapshot {
        ModifierSnapshot {
            ctrl_pressed: ctrl,
            alt_pressed: alt,
            shift_pressed: shift,
            meta_pressed: false,
        }
    }

    #[test]
    fn forwards_tab_as_toggle_params() {
        let sc = overlay_keyboard_forwardable_shortcut(VK_TAB.0 as u32, mods(false, false, false))
            .expect("Tab should forward");
        assert_eq!(sc.key, "Tab");
        assert!(!sc.ctrl && !sc.shift && !sc.alt);
    }

    #[test]
    fn forwards_shift_1_using_configured_physical_key() {
        let sc = overlay_keyboard_forwardable_shortcut(b'1' as u32, mods(false, true, false))
            .expect("Shift+1 should forward");
        assert_eq!(sc.key, "1");
        assert!(sc.shift && !sc.ctrl && !sc.alt);
    }

    #[test]
    fn does_not_forward_removed_core_ocr_or_translation_shortcuts() {
        assert!(
            overlay_keyboard_forwardable_shortcut(b'2' as u32, mods(false, false, true)).is_none()
        );
        assert!(
            overlay_keyboard_forwardable_shortcut(b'3' as u32, mods(false, false, true)).is_none()
        );
    }

    #[test]
    fn still_consumes_non_alt_hook_shortcuts() {
        let tab = overlay_keyboard_forwardable_shortcut(VK_TAB.0 as u32, mods(false, false, false))
            .unwrap();
        assert!(overlay_keyboard_should_consume_forwarded_shortcut(&tab));
    }

    #[test]
    fn forwards_ctrl_shortcuts() {
        for (vk, expected) in [
            (b'S', "s"),
            (b'Z', "z"),
            (b'Y', "y"),
            (b'H', "h"),
            (b'O', "o"),
            (b'4', "4"),
        ] {
            let sc = overlay_keyboard_forwardable_shortcut(vk as u32, mods(true, false, false))
                .unwrap_or_else(|| panic!("Ctrl+{} should forward", expected));
            assert_eq!(sc.key, expected);
            assert!(sc.ctrl && !sc.shift && !sc.alt);
        }
    }

    #[test]
    fn forwards_bare_transform_letters() {
        for (vk, expected) in [(b'Q', "q"), (b'W', "w"), (b'E', "e"), (b'R', "r")] {
            assert_eq!(
                overlay_keyboard_forwardable_shortcut(vk as u32, mods(false, false, false))
                    .unwrap()
                    .key,
                expected
            );
        }
    }

    #[test]
    fn rejects_wrong_modifiers() {
        // Tab requires no modifiers.
        assert!(
            overlay_keyboard_forwardable_shortcut(VK_TAB.0 as u32, mods(true, false, false))
                .is_none()
        );
        // Ctrl+E is a GLOBAL shortcut, must not be forwarded as the bare-'e' transform.
        assert!(
            overlay_keyboard_forwardable_shortcut(b'E' as u32, mods(true, false, false)).is_none()
        );
        // A plain letter that is not a shortcut is not forwarded.
        assert!(
            overlay_keyboard_forwardable_shortcut(b'A' as u32, mods(false, false, false)).is_none()
        );
        // Shift+2 (=@) is not a shortcut.
        assert!(
            overlay_keyboard_forwardable_shortcut(b'2' as u32, mods(false, true, false)).is_none()
        );
    }
}
