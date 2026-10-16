// Browser message handlers can activate late. Only explicit shell input mints a
// short-lived reclaim token; mouse motion and forwarded input never mint one.
static LIVE_SOURCE_RECLAIM_INTENT: Mutex<(u64, isize, u64)> = Mutex::new((0, 0, 0));
static LIVE_SOURCE_RECLAIM_CANCEL: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

fn live_source_reclaim_snapshot() -> (u64, isize) {
    // Never wait in a hook or worker; a contested/invalidated intent grants nothing.
    LIVE_SOURCE_RECLAIM_INTENT
        .try_lock()
        .ok()
        .filter(|intent| intent.2 == LIVE_SOURCE_RECLAIM_CANCEL.load(Ordering::Acquire))
        .map(|intent| (intent.0, intent.1))
        .unwrap_or_default()
}

fn live_source_reclaim_token() -> u64 {
    live_source_reclaim_snapshot().0
}

fn live_source_record_reclaim_intent() {
    let generation = LIVE_SOURCE_RECLAIM_CANCEL.load(Ordering::Acquire);
    let now = unsafe { windows::Win32::System::SystemInformation::GetTickCount64() };
    let foreground = unsafe { windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow() };
    if let Ok(mut intent) = LIVE_SOURCE_RECLAIM_INTENT.try_lock() {
        *intent = (
            now.max(intent.0.saturating_add(1)),
            foreground.0 as isize,
            generation,
        );
    }
}

fn live_source_cancel_reclaim_intent() {
    LIVE_SOURCE_RECLAIM_CANCEL.fetch_add(1, Ordering::AcqRel);
}

fn live_source_shell_mouse_down(x: i32, y: i32) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetClassNameW, WindowFromPoint, GA_ROOT,
    };
    let root = unsafe { GetAncestor(WindowFromPoint(POINT { x, y }), GA_ROOT) };
    let mut class = [0u16; 64];
    let length = unsafe { GetClassNameW(root, &mut class) };
    if length > 0 {
        let class = String::from_utf16_lossy(&class[..length as usize]);
        if matches!(
            class.as_ref(),
            "Shell_TrayWnd"
                | "Shell_SecondaryTrayWnd"
                | "TaskListThumbnailWnd"
                | "MultitaskingViewFrame"
                | "XamlExplorerHostIslandWindow"
        ) {
            live_source_record_reclaim_intent();
            return;
        }
    }
    live_source_cancel_reclaim_intent();
}

#[derive(Debug, Default)]
struct LiveSourceActivation {
    consumed_token: u64,
    foreground: isize,
}

impl LiveSourceActivation {
    fn new(token: u64, foreground: isize) -> Self {
        Self {
            consumed_token: token,
            foreground,
        }
    }

    fn observe(
        &mut self,
        foreground: isize,
        source: isize,
        iconic: bool,
        token: u64,
        origin: isize,
        now: u64,
    ) -> bool {
        // A taskbar click can minimize an already-foreground transparent source.
        // An iconic other source must not consume this global shell gesture.
        let transition = (iconic && origin == source)
            || (!iconic && foreground == source && self.foreground != source);
        self.foreground = foreground;
        if !transition || token == 0 || token == self.consumed_token {
            return false;
        }
        self.consumed_token = token;
        now.saturating_sub(token) <= 2000
    }
}

#[cfg(test)]
mod live_source_activation_tests {
    use super::*;
    #[test]
    fn expired_or_cancelled_shell_intent_never_reclaims() {
        let mut state = LiveSourceActivation::new(10, 2);
        assert!(!state.observe(1, 1, false, 20, 2, 3000));
        assert!(!state.observe(1, 1, true, 0, 1, 4001));
    }

    #[test]
    fn mouse_movement_before_delayed_browser_activation_is_not_reclaim_intent() {
        let mut state = LiveSourceActivation::new(10, 2);
        // Arbitrary system input changes do not mint a shell token.
        assert!(!state.observe(1, 1, false, 10, 2, 12));
        assert!(!state.observe(2, 1, false, 10, 2, 20));
        assert!(!state.observe(1, 1, false, 10, 2, 10000));
        assert!(!state.observe(1, 1, true, 10, 1, 10001));
    }

    #[test]
    fn explicit_shell_activation_and_taskbar_toggle_reclaim_once() {
        let mut state = LiveSourceActivation::new(10, 2);
        assert!(state.observe(1, 1, false, 20, 2, 30));
        assert!(!state.observe(1, 1, true, 20, 1, 31));
        assert!(state.observe(1, 1, true, 40, 1, 50));
    }

    #[test]
    fn shell_gesture_cannot_reclaim_an_unrelated_iconic_source() {
        let mut state = LiveSourceActivation::new(10, 2);
        assert!(!state.observe(2, 1, true, 20, 2, 30));
    }
}
