// Verifies rdev application-scoped shortcut dispatch policy.

#[cfg(all(test, target_os = "windows"))]
mod rdev_app_scoped_shortcut_tests {
    use super::{rdev_should_dispatch_app_scoped_shortcut, RdevAppScopedShortcut};

    #[test]
    fn delete_requires_hook_foreground_focus() {
        assert!(rdev_should_dispatch_app_scoped_shortcut(
            RdevAppScopedShortcut::Delete,
            true,
            false,
        ));
        assert!(!rdev_should_dispatch_app_scoped_shortcut(
            RdevAppScopedShortcut::Delete,
            false,
            false,
        ));
    }

    #[test]
    fn escape_requires_focus_unless_capture_is_active() {
        assert!(rdev_should_dispatch_app_scoped_shortcut(
            RdevAppScopedShortcut::Escape,
            true,
            false,
        ));
        assert!(rdev_should_dispatch_app_scoped_shortcut(
            RdevAppScopedShortcut::Escape,
            false,
            true,
        ));
        assert!(!rdev_should_dispatch_app_scoped_shortcut(
            RdevAppScopedShortcut::Escape,
            false,
            false,
        ));
    }
}

