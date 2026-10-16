// Selection owns pointer interception; long capture only retains Escape routing.
// Keep the latter independent of backend sessions, including frontend fallback.
#[derive(Clone)]
struct SharedCaptureInputState {
    active: std::sync::Arc<std::sync::Mutex<bool>>,
    long_capture_active: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl SharedCaptureInputState {
    fn new() -> Self {
        Self {
            active: std::sync::Arc::new(std::sync::Mutex::new(false)),
            long_capture_active: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    fn set_long_capture_scope(&self, selection_active: bool, long_capture: bool) {
        self.long_capture_active.store(
            !selection_active && long_capture,
            std::sync::atomic::Ordering::SeqCst,
        );
    }

    fn escape_capture_active(&self) -> bool {
        self.active.lock().map(|guard| *guard).unwrap_or(false)
            || self
                .long_capture_active
                .load(std::sync::atomic::Ordering::SeqCst)
    }
}

#[cfg(test)]
mod capture_input_scope_tests {
    use super::SharedCaptureInputState;

    fn transition(state: &SharedCaptureInputState, selection: bool, long_capture: bool) {
        let mut active = state.active.lock().unwrap();
        state.set_long_capture_scope(selection, long_capture);
        *active = selection;
    }

    #[test]
    fn long_capture_releases_pointer_scope_without_losing_escape() {
        let state = SharedCaptureInputState::new();
        assert!(!state.escape_capture_active());
        transition(&state, true, false);
        assert!(state.escape_capture_active());
        transition(&state, false, true);
        assert!(!*state.active.lock().unwrap());
        assert!(state.escape_capture_active());
        transition(&state, false, false);
        assert!(!state.escape_capture_active());
    }

    #[test]
    fn repeated_cleanup_and_selection_reentry_do_not_retain_long_capture_scope() {
        let state = SharedCaptureInputState::new();
        for _ in 0..2 {
            transition(&state, false, true);
            transition(&state, true, true);
            assert!(!state
                .long_capture_active
                .load(std::sync::atomic::Ordering::SeqCst));
            transition(&state, false, false);
            transition(&state, false, false);
            assert!(!state.escape_capture_active());
        }
    }
}
