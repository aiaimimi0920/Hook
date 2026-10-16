// A user claim lasts only until foreground ownership changes again.
#[derive(Default)]
struct OverlayDialogPolicy {
    foreground: isize,
    claimed: bool,
}

impl OverlayDialogPolicy {
    fn update_with_intent(
        &mut self,
        foreground: isize,
        dialog: bool,
        user_active: bool,
        intent: u8,
    ) -> bool {
        if intent == 2 {
            self.yield_to_foreground();
        }
        self.update(
            foreground,
            dialog,
            (intent == 1 || user_active) && intent != 2,
        )
    }
    fn update(&mut self, foreground: isize, dialog: bool, user_active: bool) -> bool {
        if foreground != self.foreground {
            self.foreground = foreground;
            self.claimed = false;
        }
        self.claimed |= user_active;
        dialog && !self.claimed
    }

    fn claim(&mut self) {
        self.claimed = true;
    }

    fn yield_to_foreground(&mut self) {
        self.claimed = false;
    }
}

#[cfg(test)]
mod overlay_dialog_policy_tests {
    use super::*;

    #[test]
    fn later_dialog_wins_until_user_explicitly_uses_overlay() {
        let mut policy = OverlayDialogPolicy::default();
        assert!(!policy.update(1, false, false));
        assert!(policy.update(2, true, false));
        assert!(policy.update(2, true, false));
        policy.claim();
        assert!(!policy.update(2, true, false));
        assert!(!policy.update(2, true, false));
        policy.yield_to_foreground();
        assert!(policy.update(2, true, false));
        assert!(policy.update(3, true, false));
    }

    #[test]
    fn capture_can_cover_existing_dialog_without_bouncing_after_capture() {
        let mut policy = OverlayDialogPolicy::default();
        assert!(policy.update(2, true, false));
        assert!(!policy.update(2, true, true));
        assert!(!policy.update(2, true, false));
        assert!(!policy.update(1, false, false));
        assert!(policy.update(2, true, false));
    }

    #[test]
    fn latest_pointer_intent_wins_over_stale_activity() {
        let mut policy = OverlayDialogPolicy::default();
        assert!(!policy.update_with_intent(2, true, false, 1));
        assert!(policy.update_with_intent(2, true, true, 2));
        assert!(!policy.update_with_intent(2, true, false, 1));
    }
}
