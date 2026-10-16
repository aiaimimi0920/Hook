// Dialog priority affects BOTH visual Z-order and synthetic mouse routing.
// Foreground discovery runs in maintenance; mouse callbacks read a cached rect.
#[cfg(target_os = "windows")]
mod overlay_dialog_priority {
    use super::*;
    include!("overlay_dialog_policy.rs");

    #[derive(Default)]
    struct State {
        policy: OverlayDialogPolicy,
        dialog: isize,
        bounds: RECT,
    }
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    pub(super) static DESKTOP_UNAVAILABLE: AtomicBool = AtomicBool::new(false);
    // Last physical button intent wins, including two clicks within one timer tick.
    static POINTER_INTENT: AtomicU8 = AtomicU8::new(0);

    fn state() -> &'static Mutex<State> {
        STATE.get_or_init(|| Mutex::new(State::default()))
    }

    fn is_dialog(hwnd: HWND) -> bool {
        use windows::Win32::UI::Input::KeyboardAndMouse::IsWindowEnabled;
        use windows::Win32::UI::WindowsAndMessaging::{GetWindow, GW_OWNER, WS_EX_DLGMODALFRAME};
        if hwnd.0.is_null() || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            return false;
        }
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        if pid == 0 || pid == std::process::id() {
            return false; // Otter's native dialogs already own an explicit passthrough scope.
        }
        let standard = overlay_window_class_name(hwnd).as_deref() == Some("#32770");
        let modal_frame =
            unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } & WS_EX_DLGMODALFRAME.0 as isize != 0;
        let disabled_owner = unsafe { GetWindow(hwnd, GW_OWNER) }
            .ok()
            .is_some_and(|owner| {
                !owner.0.is_null() && !unsafe { IsWindowEnabled(owner) }.as_bool()
            });
        standard || modal_frame || disabled_owner
    }

    pub(super) fn refresh() -> bool {
        // Fail closed for UAC/lock desktops. Never switch desktops or change UAC policy.
        let unavailable = ensure_live_input_desktop().is_err();
        let previous = DESKTOP_UNAVAILABLE.swap(unavailable, Ordering::SeqCst);
        if unavailable {
            POINTER_INTENT.store(0, Ordering::SeqCst);
            if let Ok(mut state) = state().lock() {
                *state = State::default();
            }
            return previous != unavailable;
        }
        let visible_foreground = OVERLAY_MAIN_HWND.get().and_then(|&main| {
            overlay_visible_hit::foreground_above(HWND(main as *mut core::ffi::c_void))
        });
        let foreground = visible_foreground.unwrap_or_else(|| unsafe { GetForegroundWindow() });
        let dialog = is_dialog(foreground) || visible_foreground.is_some();
        let intent = POINTER_INTENT.swap(0, Ordering::SeqCst);
        let active = CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst)
            || overlay_sticker_drag_active()
            || OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst)
            || OVERLAY_POINTER_STATE.load(Ordering::SeqCst) != OVERLAY_POINTER_STATE_NONE;
        let mut bounds = RECT::default();
        let dialog = dialog && unsafe { GetWindowRect(foreground, &mut bounds) }.is_ok();
        let Ok(mut state) = state().lock() else {
            return previous != unavailable;
        };
        let before = state.dialog;
        let policy_yields =
            state
                .policy
                .update_with_intent(foreground.0 as isize, dialog, active, intent);
        // A stale claim must never override a window that is actually above us.
        // Explicit capture/interaction may still attempt to reclaim normal Z-order.
        state.dialog = if policy_yields
            || (dialog && visible_foreground.is_some() && !active && intent != 1)
        {
            foreground.0 as isize
        } else {
            0
        };
        state.bounds = bounds;
        previous != unavailable || before != state.dialog
    }

    pub(super) fn claim() {
        POINTER_INTENT.store(1, Ordering::SeqCst);
        if let Ok(mut state) = state().lock() {
            state.policy.claim();
            state.dialog = 0;
        }
    }

    pub(super) fn request_claim() {
        POINTER_INTENT.store(1, Ordering::SeqCst);
    }

    pub(super) fn request_yield() {
        POINTER_INTENT.store(2, Ordering::SeqCst);
    }

    pub(super) fn blocks_keyboard() -> bool {
        DESKTOP_UNAVAILABLE.load(Ordering::SeqCst)
            || state()
                .try_lock()
                .map(|state| state.dialog != 0)
                .unwrap_or(true)
    }

    pub(super) fn insert_after() -> HWND {
        let dialog = state().lock().map(|state| state.dialog).unwrap_or(0);
        dialog_anchor(dialog)
    }

    fn dialog_anchor(dialog: isize) -> HWND {
        let hwnd = HWND(dialog as *mut core::ffi::c_void);
        if dialog != 0
            && unsafe { windows::Win32::UI::WindowsAndMessaging::IsWindow(Some(hwnd)) }.as_bool()
        {
            hwnd
        } else {
            HWND_TOPMOST
        }
    }

    pub(super) fn blocks_point(x: f64, y: f64) -> bool {
        if DESKTOP_UNAVAILABLE.load(Ordering::SeqCst) {
            return true;
        }
        // Do not wait behind maintenance in WH_MOUSE_LL. Contention yields input.
        let Ok(state) = state().try_lock() else {
            return true;
        };
        state.dialog != 0 && contains_point(state.bounds, x, y)
    }

    fn contains_point(bounds: RECT, x: f64, y: f64) -> bool {
        x >= bounds.left as f64
            && x < bounds.right as f64
            && y >= bounds.top as f64
            && y < bounds.bottom as f64
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        include!("../tests/overlay_dialog_priority_tests.rs");
    }
}
