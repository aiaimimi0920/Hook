// Owns shared capture, keyboard, pointer, drag, and emergency-exit input state.

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
enum OverlayKeyboardHookEvent {
    Escape,
    Delete,
    Copy,
    Paste,
    // A sticker-selected DOM shortcut (Tab, Shift+1, Alt+4, ...) captured while
    // the webview lacks OS keyboard focus, forwarded so the frontend can run it
    // without the overlay having to steal foreground focus from video below.
    Shortcut {
        key: String,
        ctrl: bool,
        shift: bool,
        alt: bool,
        meta: bool,
    },
}

// Serialized payload for the `overlay/global_shortcut` event. Field names match
// the DOM KeyboardEvent init the frontend reconstructs.
#[cfg(target_os = "windows")]
#[derive(Clone, serde::Serialize)]
struct ForwardedShortcutPayload {
    key: String,
    #[serde(rename = "ctrlKey")]
    ctrl_key: bool,
    #[serde(rename = "shiftKey")]
    shift_key: bool,
    #[serde(rename = "altKey")]
    alt_key: bool,
    #[serde(rename = "metaKey")]
    meta_key: bool,
}

#[cfg(target_os = "windows")]
static CAPTURE_MOUSE_EVENT_QUEUE: OnceLock<Arc<CaptureMouseEventQueue>> = OnceLock::new();
static DESKTOP_COLOR_PICKER_ACTIVE: AtomicBool = AtomicBool::new(false);
static PROCESS_EXIT_CLEANUP_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_KEYBOARD_EVENT_SENDER: OnceLock<mpsc::SyncSender<OverlayKeyboardHookEvent>> =
    OnceLock::new();
#[cfg(target_os = "windows")]
static CAPTURE_MOUSE_HOOK_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static CAPTURE_MOUSE_HOOK_BUTTON_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_KEYBOARD_CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_SHIFT_KEY_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static CAPTURE_SYSTEM_CURSOR_OVERRIDDEN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HIT_MAP: OnceLock<Arc<std::sync::Mutex<Vec<mouse_monitor::Rect>>>> =
    OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HIT_MAP_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_POINTER_STATE: AtomicU8 = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HOOK_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_HOOK_HOVER_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static NATIVE_FILE_DIALOG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static NATIVE_FILE_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static MAIN_UI_THREAD_ID: OnceLock<std::thread::ThreadId> = OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_CLICK_THROUGH_ACTIVE: AtomicBool = AtomicBool::new(true);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_ACTIVATE_WNDPROC_INSTALLED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_MOUSE_ACTIVATE_WNDPROC_PREVIOUS: OnceLock<isize> = OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_INPUT_SHIELD_HWND: OnceLock<isize> = OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_INPUT_SHIELD_WNDPROC_PREVIOUS: OnceLock<isize> = OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_INPUT_SHIELD_ALT_PASSTHROUGH: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
fn select_overlay_mouse_move_emit_interval(drag_active: bool) -> Duration {
    if drag_active {
        OVERLAY_MOUSE_DRAG_MOVE_EMIT_INTERVAL
    } else {
        OVERLAY_MOUSE_MOVE_EMIT_INTERVAL
    }
}

#[cfg(target_os = "windows")]
fn overlay_sticker_drag_active() -> bool {
    OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.load(Ordering::SeqCst)
}
#[cfg(target_os = "windows")]
static OVERLAY_MAIN_HWND: OnceLock<isize> = OnceLock::new();
#[cfg(target_os = "windows")]
static OVERLAY_TOPMOST_MAINTENANCE_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_VISUALLY_OCCLUDED_BY_FULLSCREEN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_FULLSCREEN_OCCLUSION_PASSTHROUGH_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static OVERLAY_FULLSCREEN_OCCLUSION_PREVIOUS_CLICK_THROUGH: AtomicBool = AtomicBool::new(true);
#[cfg(target_os = "windows")]
const OVERLAY_TOPMOST_MAINTENANCE_INTERVAL_MS: u64 = 250;
#[cfg(target_os = "windows")]
const OVERLAY_FULLSCREEN_COVERAGE_TOLERANCE_PX: i32 = 8;
#[cfg(target_os = "windows")]
static OVERLAY_HWND_RETRY_THREAD_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
const OVERLAY_HWND_RETRY_INTERVAL_MS: u64 = 250;
#[cfg(target_os = "windows")]
const OVERLAY_HWND_RETRY_ATTEMPTS: usize = 80;
static UIACCESS_OVERLAY_STARTUP_STAGED: AtomicBool = AtomicBool::new(false);
static UIACCESS_FRONTEND_MOUNTED: AtomicBool = AtomicBool::new(false);
static UIACCESS_PENDING_OVERLAY_CLICK_THROUGH: AtomicBool = AtomicBool::new(true);

#[cfg(target_os = "windows")]
const EMERGENCY_ESCAPE_WINDOW: Duration = Duration::from_millis(400);
#[cfg(target_os = "windows")]
static ESCAPE_KEY_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static EMERGENCY_ESCAPE_TRACKER: OnceLock<Mutex<EmergencyEscapeTracker>> = OnceLock::new();
#[cfg(target_os = "windows")]
static RDEV_ESCAPE_KEY_DOWN: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static RDEV_EMERGENCY_ESCAPE_TRACKER: OnceLock<Mutex<EmergencyEscapeTracker>> = OnceLock::new();

#[cfg(target_os = "windows")]
#[derive(Default)]
struct EmergencyEscapeTracker {
    last_press: Option<Instant>,
    consecutive_presses: u8,
}

#[cfg(target_os = "windows")]
impl EmergencyEscapeTracker {
    fn record_press(&mut self, now: Instant) -> bool {
        let continues_sequence = self
            .last_press
            .map(|last_press| now.duration_since(last_press) < EMERGENCY_ESCAPE_WINDOW)
            .unwrap_or(false);
        self.consecutive_presses = if continues_sequence {
            self.consecutive_presses.saturating_add(1)
        } else {
            1
        };
        self.last_press = Some(now);
        if self.consecutive_presses < 3 {
            return false;
        }
        self.consecutive_presses = 0;
        self.last_press = None;
        true
    }
}

fn uiaccess_build_enabled() -> bool {
    cfg!(target_os = "windows") && option_env!("HOOK_WINDOWS_UIACCESS_BUILD").is_some()
}

#[cfg(target_os = "windows")]
fn queue_capture_mouse_hook_event(event: CaptureMouseHookEvent) {
    if matches!(event, CaptureMouseHookEvent::Wheel { .. }) {
        return;
    }

    if let Some(queue) = CAPTURE_MOUSE_EVENT_QUEUE.get() {
        let _ = queue.enqueue(event);
    }
}

#[cfg(target_os = "windows")]
fn log_capture_mouse_queue_diagnostics_if_due(
    queue: &CaptureMouseEventQueue,
    last_log: &mut Instant,
    last_diagnostics: &mut CaptureMouseEventQueueDiagnostics,
) {
    let diagnostics = queue.diagnostics();
    let critical_overflow_changed =
        diagnostics.critical_overflows != last_diagnostics.critical_overflows;
    if !critical_overflow_changed && last_log.elapsed() < CAPTURE_MOUSE_QUEUE_DIAGNOSTIC_INTERVAL {
        return;
    }

    let pressure_changed = diagnostics.coalesced_moves != last_diagnostics.coalesced_moves
        || diagnostics.evicted_moves != last_diagnostics.evicted_moves
        || diagnostics.dropped_moves != last_diagnostics.dropped_moves
        || diagnostics.critical_overflows != last_diagnostics.critical_overflows;
    if pressure_changed {
        append_runtime_log_line(&format!(
            "capture_mouse_queue :: depth={} max_depth={} coalesced_moves={} evicted_moves={} dropped_moves={} critical_overflows={} enqueued_edges={}",
            diagnostics.current_depth,
            diagnostics.max_depth,
            diagnostics.coalesced_moves,
            diagnostics.evicted_moves,
            diagnostics.dropped_moves,
            diagnostics.critical_overflows,
            diagnostics.enqueued_edges,
        ));
    }
    *last_diagnostics = diagnostics;
    *last_log = Instant::now();
}

#[cfg(target_os = "windows")]
fn claim_capture_button_transition(state: &AtomicBool, pressed: bool) -> bool {
    if pressed {
        !state.swap(true, Ordering::SeqCst)
    } else {
        state.swap(false, Ordering::SeqCst)
    }
}

#[cfg(target_os = "windows")]
fn claim_overlay_pointer_down(
    state: &AtomicU8,
    source: OverlayPointerSource,
) -> OverlayPointerDownTransition {
    loop {
        let current = state.load(Ordering::SeqCst);
        if current == source.down_state() {
            return OverlayPointerDownTransition::IgnoredDuplicate;
        }
        let pending_release = current == OverlayPointerSource::LowLevelHook.up_pending_state()
            || current == OverlayPointerSource::InputShield.up_pending_state();
        if current != OVERLAY_POINTER_STATE_NONE && !pending_release {
            return OverlayPointerDownTransition::IgnoredForeignOwner;
        }

        let transition = if pending_release {
            OverlayPointerDownTransition::Continued
        } else {
            OverlayPointerDownTransition::Started
        };
        if state
            .compare_exchange(
                current,
                source.down_state(),
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
        {
            return transition;
        }
    }
}

#[cfg(target_os = "windows")]
fn claim_overlay_pointer_up(
    state: &AtomicU8,
    source: OverlayPointerSource,
) -> OverlayPointerUpTransition {
    loop {
        let current = state.load(Ordering::SeqCst);
        if current == OVERLAY_POINTER_STATE_NONE {
            return OverlayPointerUpTransition::IgnoredUnpaired;
        }
        if current == source.up_pending_state() {
            return OverlayPointerUpTransition::IgnoredDuplicate;
        }
        if current != source.down_state() {
            return OverlayPointerUpTransition::IgnoredForeignOwner;
        }

        if state
            .compare_exchange(
                current,
                source.up_pending_state(),
                Ordering::SeqCst,
                Ordering::SeqCst,
            )
            .is_ok()
        {
            return OverlayPointerUpTransition::Candidate;
        }
    }
}

#[cfg(target_os = "windows")]
fn resolve_overlay_pointer_release(
    state: &AtomicU8,
    source: OverlayPointerSource,
    primary_button_physically_down: bool,
) -> OverlayPointerReleaseResult {
    if primary_button_physically_down {
        return match state.compare_exchange(
            source.up_pending_state(),
            source.down_state(),
            Ordering::SeqCst,
            Ordering::SeqCst,
        ) {
            Ok(_) => OverlayPointerReleaseResult::SuppressedPhysicalDown,
            Err(current) if current == source.down_state() => {
                OverlayPointerReleaseResult::SuppressedPhysicalDown
            }
            Err(_) => OverlayPointerReleaseResult::Superseded,
        };
    }

    match state.compare_exchange(
        source.up_pending_state(),
        OVERLAY_POINTER_STATE_NONE,
        Ordering::SeqCst,
        Ordering::SeqCst,
    ) {
        Ok(_) => OverlayPointerReleaseResult::Released,
        Err(_) => OverlayPointerReleaseResult::Superseded,
    }
}

#[cfg(target_os = "windows")]
fn overlay_pointer_source_owns_session(source: OverlayPointerSource) -> bool {
    matches!(
        OVERLAY_POINTER_STATE.load(Ordering::SeqCst),
        current if current == source.down_state() || current == source.up_pending_state()
    )
}

#[cfg(target_os = "windows")]
fn reset_overlay_pointer_session() {
    OVERLAY_POINTER_STATE.store(OVERLAY_POINTER_STATE_NONE, Ordering::SeqCst);
    OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(false, Ordering::SeqCst);
    OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.store(false, Ordering::SeqCst);
    OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.store(false, Ordering::SeqCst);
    OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.store(false, Ordering::SeqCst);
}

#[cfg(target_os = "windows")]
fn overlay_primary_button_physically_down() -> bool {
    (unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) }) < 0
}

#[cfg(target_os = "windows")]
fn handle_emergency_escape_transition_with(
    key_down: &AtomicBool,
    tracker: &OnceLock<Mutex<EmergencyEscapeTracker>>,
    pressed: bool,
    source: &str,
) -> bool {
    if !pressed {
        key_down.store(false, Ordering::SeqCst);
        return false;
    }

    if key_down.swap(true, Ordering::SeqCst) {
        return false;
    }

    let should_exit = tracker
        .get_or_init(|| Mutex::new(EmergencyEscapeTracker::default()))
        .lock()
        .map(|mut tracker| tracker.record_press(Instant::now()))
        .unwrap_or(false);
    append_runtime_log_line(&format!("emergency_escape_press :: source={}", source));
    if should_exit {
        append_runtime_log_line_sync(&format!(
            "[{}] emergency_triple_escape_exit :: source={}",
            runtime_log_timestamp(),
            source
        ));
        prepare_for_hook_process_exit("triple_escape");
        std::process::exit(0);
    }
    true
}

#[cfg(target_os = "windows")]
fn handle_emergency_escape_transition(pressed: bool, source: &str) -> bool {
    handle_emergency_escape_transition_with(
        &ESCAPE_KEY_DOWN,
        &EMERGENCY_ESCAPE_TRACKER,
        pressed,
        source,
    )
}

#[cfg(target_os = "windows")]
fn handle_rdev_emergency_escape_transition(pressed: bool) -> bool {
    handle_emergency_escape_transition_with(
        &RDEV_ESCAPE_KEY_DOWN,
        &RDEV_EMERGENCY_ESCAPE_TRACKER,
        pressed,
        "rdev",
    )
}

#[cfg(target_os = "windows")]
fn queue_overlay_keyboard_hook_event(event: OverlayKeyboardHookEvent) {
    if let Some(sender) = OVERLAY_KEYBOARD_EVENT_SENDER.get() {
        let _ = sender.try_send(event);
    }
}

#[cfg(target_os = "windows")]
fn try_begin_capture_input_runtime() -> bool {
    if CAPTURE_MOUSE_HOOK_ACTIVE.swap(true, Ordering::SeqCst) {
        return false;
    }

    CAPTURE_MOUSE_HOOK_BUTTON_DOWN.store(false, Ordering::SeqCst);
    append_runtime_log_line("capture_mouse_hook_active :: true");
    set_capture_cursor_crosshair();
    true
}

#[cfg(not(target_os = "windows"))]
fn try_begin_capture_input_runtime() -> bool {
    set_capture_input_runtime_active(true);
    true
}

#[cfg(target_os = "windows")]
fn is_main_ui_thread() -> bool {
    MAIN_UI_THREAD_ID
        .get()
        .map(|thread_id| *thread_id == std::thread::current().id())
        .unwrap_or(false)
}
