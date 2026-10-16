// Coalesces high-frequency capture and overlay pointer movement.

#[cfg(target_os = "windows")]
fn coalesce_capture_mouse_move_until_emit<R: CaptureMouseEventReceiver + ?Sized>(
    receiver: &R,
    mut x: f64,
    mut y: f64,
    mut modifiers: ModifierSnapshot,
    last_emit: Instant,
    interval: Duration,
) -> CaptureMouseMoveCoalesceResult {
    let deadline = last_emit + interval;

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(CaptureMouseHookEvent::Move {
                x: next_x,
                y: next_y,
                modifiers: next_modifiers,
            }) => {
                x = next_x;
                y = next_y;
                modifiers = next_modifiers;
            }
            Ok(other_event) => {
                return CaptureMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    deferred_event: Some(other_event),
                };
            }
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return CaptureMouseMoveCoalesceResult::Disconnected;
            }
        }
    }

    loop {
        match receiver.try_recv() {
            Ok(CaptureMouseHookEvent::Move {
                x: next_x,
                y: next_y,
                modifiers: next_modifiers,
            }) => {
                x = next_x;
                y = next_y;
                modifiers = next_modifiers;
            }
            Ok(other_event) => {
                return CaptureMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    deferred_event: Some(other_event),
                };
            }
            Err(mpsc::TryRecvError::Empty) => {
                return CaptureMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    deferred_event: None,
                };
            }
            Err(mpsc::TryRecvError::Disconnected) => {
                return CaptureMouseMoveCoalesceResult::Disconnected;
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn coalesce_overlay_mouse_move_until_emit<R: CaptureMouseEventReceiver + ?Sized>(
    receiver: &R,
    mut x: f64,
    mut y: f64,
    mut modifiers: ModifierSnapshot,
    native_drag_preflight: bool,
    last_emit: Instant,
    interval: Duration,
) -> OverlayMouseMoveCoalesceResult {
    let deadline = last_emit + interval;

    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok(CaptureMouseHookEvent::OverlayMove {
                x: next_x,
                y: next_y,
                modifiers: next_modifiers,
                native_drag_preflight: next_native_drag_preflight,
            }) if next_native_drag_preflight == native_drag_preflight => {
                x = next_x;
                y = next_y;
                modifiers = next_modifiers;
            }
            Ok(other_event) => {
                return OverlayMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight,
                    deferred_event: Some(other_event),
                };
            }
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return OverlayMouseMoveCoalesceResult::Disconnected;
            }
        }
    }

    loop {
        match receiver.try_recv() {
            Ok(CaptureMouseHookEvent::OverlayMove {
                x: next_x,
                y: next_y,
                modifiers: next_modifiers,
                native_drag_preflight: next_native_drag_preflight,
            }) if next_native_drag_preflight == native_drag_preflight => {
                x = next_x;
                y = next_y;
                modifiers = next_modifiers;
            }
            Ok(other_event) => {
                return OverlayMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight,
                    deferred_event: Some(other_event),
                };
            }
            Err(mpsc::TryRecvError::Empty) => {
                return OverlayMouseMoveCoalesceResult::Ready {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight,
                    deferred_event: None,
                };
            }
            Err(mpsc::TryRecvError::Disconnected) => {
                return OverlayMouseMoveCoalesceResult::Disconnected;
            }
        }
    }
}
