// Owns capture and overlay mouse-up debounce timing.

#[cfg(target_os = "windows")]
const CAPTURE_MOUSE_UP_BOUNCE_WINDOW: Duration = Duration::from_millis(35);
#[cfg(target_os = "windows")]
const OVERLAY_MOUSE_UP_BOUNCE_WINDOW: Duration = Duration::from_millis(35);
#[cfg(target_os = "windows")]
const CAPTURE_MOUSE_MOVE_EMIT_INTERVAL: Duration = Duration::from_millis(8);
#[cfg(target_os = "windows")]
const OVERLAY_MOUSE_MOVE_EMIT_INTERVAL: Duration = Duration::from_millis(8);
#[cfg(target_os = "windows")]
const OVERLAY_MOUSE_DRAG_MOVE_EMIT_INTERVAL: Duration = Duration::from_millis(2);

#[cfg(target_os = "windows")]
const OVERLAY_POINTER_STATE_NONE: u8 = 0;

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
enum OverlayPointerSource {
    LowLevelHook = 1,
    InputShield = 2,
}

#[cfg(target_os = "windows")]
impl OverlayPointerSource {
    fn down_state(self) -> u8 {
        match self {
            Self::LowLevelHook => 1,
            Self::InputShield => 3,
        }
    }

    fn up_pending_state(self) -> u8 {
        match self {
            Self::LowLevelHook => 2,
            Self::InputShield => 4,
        }
    }

    fn log_name(self) -> &'static str {
        match self {
            Self::LowLevelHook => "low_level_hook",
            Self::InputShield => "input_shield",
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverlayPointerDownTransition {
    Started,
    Continued,
    IgnoredDuplicate,
    IgnoredForeignOwner,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverlayPointerUpTransition {
    Candidate,
    IgnoredDuplicate,
    IgnoredUnpaired,
    IgnoredForeignOwner,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OverlayPointerReleaseResult {
    Released,
    SuppressedPhysicalDown,
    Superseded,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
enum CaptureMouseUpDebounceResult {
    Release {
        deferred_event: Option<CaptureMouseHookEvent>,
    },
    Continue {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
    Disconnected,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
enum OverlayMouseUpDebounceResult {
    Release {
        deferred_event: Option<CaptureMouseHookEvent>,
        latest_move: Option<OverlayMouseMoveSnapshot>,
    },
    Continue {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        native_drag_preflight: bool,
    },
    Disconnected,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
struct OverlayMouseMoveSnapshot {
    x: f64,
    y: f64,
    modifiers: ModifierSnapshot,
    native_drag_preflight: bool,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
enum CaptureMouseMoveCoalesceResult {
    Ready {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        deferred_event: Option<CaptureMouseHookEvent>,
    },
    Disconnected,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
enum OverlayMouseMoveCoalesceResult {
    Ready {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        native_drag_preflight: bool,
        deferred_event: Option<CaptureMouseHookEvent>,
    },
    Disconnected,
}

#[cfg(target_os = "windows")]
fn wait_for_capture_mouse_up_debounce<R: CaptureMouseEventReceiver + ?Sized>(
    receiver: &R,
    timeout: Duration,
) -> CaptureMouseUpDebounceResult {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(CaptureMouseHookEvent::Down { x, y, modifiers }) => {
                return CaptureMouseUpDebounceResult::Continue { x, y, modifiers };
            }
            Ok(CaptureMouseHookEvent::Move { .. })
            | Ok(CaptureMouseHookEvent::Up { .. })
            | Ok(CaptureMouseHookEvent::Wheel { .. }) => {
                // Moves after a candidate Up do not alter its final coordinates.
                // A Down inside the bounce window is the only event that turns
                // this release into a continuation of the current drag.
            }
            Ok(other) => {
                return CaptureMouseUpDebounceResult::Release {
                    deferred_event: Some(other),
                };
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return CaptureMouseUpDebounceResult::Release {
                    deferred_event: None,
                };
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return CaptureMouseUpDebounceResult::Disconnected;
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn wait_for_overlay_mouse_up_debounce<R: CaptureMouseEventReceiver + ?Sized>(
    receiver: &R,
    source: OverlayPointerSource,
    timeout: Duration,
) -> OverlayMouseUpDebounceResult {
    let deadline = Instant::now() + timeout;
    let mut latest_move = None;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(CaptureMouseHookEvent::OverlayDown {
                x,
                y,
                modifiers,
                native_drag_preflight,
                source: down_source,
                continuation: true,
            }) if down_source == source => {
                return OverlayMouseUpDebounceResult::Continue {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight,
                };
            }
            Ok(CaptureMouseHookEvent::OverlayMove {
                x,
                y,
                modifiers,
                native_drag_preflight,
            }) => {
                latest_move = Some(OverlayMouseMoveSnapshot {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight,
                });
                // Keep the shield and drag session alive while the candidate Up
                // settles. A matching recovery Down, or the physical button
                // state checked by the worker, decides whether this is release.
            }
            Ok(other) => {
                return OverlayMouseUpDebounceResult::Release {
                    deferred_event: Some(other),
                    latest_move,
                };
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                return OverlayMouseUpDebounceResult::Release {
                    deferred_event: None,
                    latest_move,
                };
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return OverlayMouseUpDebounceResult::Disconnected;
            }
        }
    }
}
