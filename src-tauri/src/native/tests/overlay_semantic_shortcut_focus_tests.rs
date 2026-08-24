// Verifies semantic overlay shortcuts respect WebView focus.

#[cfg(all(test, target_os = "windows"))]
mod overlay_semantic_shortcut_focus_tests {
    use super::{
        overlay_keyboard_hook_should_capture_semantic_keydown,
        overlay_keyboard_hook_should_capture_semantic_keyup, ModifierSnapshot, VK_BACK, VK_DELETE,
        VK_ESCAPE,
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
    fn keeps_semantic_keys_in_dom_when_webview_is_focused() {
        let focused = true;
        for vk_code in [VK_BACK.0 as u32, VK_DELETE.0 as u32, VK_ESCAPE.0 as u32] {
            assert!(
                overlay_keyboard_hook_should_capture_semantic_keydown(
                    vk_code,
                    mods(false, false, false),
                    focused,
                )
                .is_none(),
                "focused DOM should keep vk_code={vk_code}",
            );
            assert!(
                !overlay_keyboard_hook_should_capture_semantic_keyup(
                    vk_code,
                    mods(false, false, false),
                    focused,
                ),
                "focused DOM should keep keyup for vk_code={vk_code}",
            );
        }
    }

    #[test]
    fn still_intercepts_semantic_keys_when_webview_is_unfocused() {
        let focused = false;
        for (vk_code, modifiers) in [
            (VK_BACK.0 as u32, mods(false, false, false)),
            (VK_DELETE.0 as u32, mods(false, false, false)),
            (VK_ESCAPE.0 as u32, mods(false, false, false)),
            (b'C' as u32, mods(true, false, false)),
            (b'V' as u32, mods(true, false, false)),
        ] {
            assert!(
                overlay_keyboard_hook_should_capture_semantic_keydown(vk_code, modifiers, focused,)
                    .is_some(),
                "unfocused overlay should intercept vk_code={vk_code}",
            );
            assert!(
                overlay_keyboard_hook_should_capture_semantic_keyup(vk_code, modifiers, focused,),
                "unfocused overlay should consume keyup for vk_code={vk_code}",
            );
        }
    }
}

