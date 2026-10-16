// Defines the bounded native mouse-event queue and its diagnostics.

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
enum CaptureMouseHookEvent {
    Move {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
    Down {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
    Up {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
    Wheel {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
    OverlayDown {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        native_drag_preflight: bool,
        source: OverlayPointerSource,
        continuation: bool,
    },
    OverlayMove {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        native_drag_preflight: bool,
    },
    OverlayUp {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
        native_drag_preflight: bool,
        source: OverlayPointerSource,
    },
    OverlayWheel {
        x: f64,
        y: f64,
        delta_y: f64,
        modifiers: ModifierSnapshot,
    },
    OverlayContextMenu {
        x: f64,
        y: f64,
        modifiers: ModifierSnapshot,
    },
}

#[cfg(target_os = "windows")]
impl CaptureMouseHookEvent {
    fn is_move_sample(&self) -> bool {
        matches!(self, Self::Move { .. } | Self::OverlayMove { .. })
    }

    fn can_replace_move_sample(&self, previous: &Self) -> bool {
        match (previous, self) {
            (Self::Move { .. }, Self::Move { .. }) => true,
            (
                Self::OverlayMove {
                    native_drag_preflight: previous_preflight,
                    ..
                },
                Self::OverlayMove {
                    native_drag_preflight: next_preflight,
                    ..
                },
            ) => previous_preflight == next_preflight,
            _ => false,
        }
    }
}

#[cfg(target_os = "windows")]
const CAPTURE_MOUSE_EVENT_QUEUE_CAPACITY: usize = 2048;
#[cfg(target_os = "windows")]
const CAPTURE_MOUSE_EVENT_EDGE_RESERVE: usize = 64;
#[cfg(target_os = "windows")]
const CAPTURE_MOUSE_QUEUE_DIAGNOSTIC_INTERVAL: Duration = Duration::from_secs(5);

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct CaptureMouseEventQueueDiagnostics {
    current_depth: usize,
    max_depth: usize,
    coalesced_moves: u64,
    evicted_moves: u64,
    dropped_moves: u64,
    critical_overflows: u64,
    enqueued_edges: u64,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CaptureMouseEventEnqueueResult {
    Enqueued,
    CoalescedMove,
    EnqueuedAfterEvictingMove,
    DroppedMove,
    CriticalOverflow,
}

#[cfg(target_os = "windows")]
struct CaptureMouseEventQueueState {
    events: VecDeque<CaptureMouseHookEvent>,
    diagnostics: CaptureMouseEventQueueDiagnostics,
}

#[cfg(target_os = "windows")]
struct CaptureMouseEventQueue {
    capacity: usize,
    move_capacity: usize,
    state: Mutex<CaptureMouseEventQueueState>,
    event_available: Condvar,
}

#[cfg(target_os = "windows")]
impl CaptureMouseEventQueue {
    fn new(capacity: usize, edge_reserve: usize) -> Self {
        assert!(
            capacity > 0,
            "capture mouse queue capacity must be positive"
        );
        Self {
            capacity,
            move_capacity: capacity.saturating_sub(edge_reserve.min(capacity)),
            state: Mutex::new(CaptureMouseEventQueueState {
                events: VecDeque::with_capacity(capacity),
                diagnostics: CaptureMouseEventQueueDiagnostics::default(),
            }),
            event_available: Condvar::new(),
        }
    }

    fn enqueue(&self, event: CaptureMouseHookEvent) -> CaptureMouseEventEnqueueResult {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if event.is_move_sample() {
            if let Some(previous) = state.events.back_mut() {
                if event.can_replace_move_sample(previous) {
                    *previous = event;
                    state.diagnostics.coalesced_moves += 1;
                    return CaptureMouseEventEnqueueResult::CoalescedMove;
                }
            }

            let evicted_move = if state.events.len() >= self.move_capacity {
                if let Some(index) = state
                    .events
                    .iter()
                    .position(CaptureMouseHookEvent::is_move_sample)
                {
                    state.events.remove(index);
                    state.diagnostics.evicted_moves += 1;
                    true
                } else {
                    state.diagnostics.dropped_moves += 1;
                    return CaptureMouseEventEnqueueResult::DroppedMove;
                }
            } else {
                false
            };

            state.events.push_back(event);
            state.diagnostics.current_depth = state.events.len();
            state.diagnostics.max_depth = state
                .diagnostics
                .max_depth
                .max(state.diagnostics.current_depth);
            self.event_available.notify_one();
            return if evicted_move {
                CaptureMouseEventEnqueueResult::EnqueuedAfterEvictingMove
            } else {
                CaptureMouseEventEnqueueResult::Enqueued
            };
        }

        let evicted_move = if state.events.len() >= self.capacity {
            if let Some(index) = state
                .events
                .iter()
                .position(CaptureMouseHookEvent::is_move_sample)
            {
                state.events.remove(index);
                state.diagnostics.evicted_moves += 1;
                true
            } else {
                state.diagnostics.critical_overflows += 1;
                return CaptureMouseEventEnqueueResult::CriticalOverflow;
            }
        } else {
            false
        };

        state.events.push_back(event);
        state.diagnostics.enqueued_edges += 1;
        state.diagnostics.current_depth = state.events.len();
        state.diagnostics.max_depth = state
            .diagnostics
            .max_depth
            .max(state.diagnostics.current_depth);
        self.event_available.notify_one();
        if evicted_move {
            CaptureMouseEventEnqueueResult::EnqueuedAfterEvictingMove
        } else {
            CaptureMouseEventEnqueueResult::Enqueued
        }
    }

    fn pop_front_locked(state: &mut CaptureMouseEventQueueState) -> Option<CaptureMouseHookEvent> {
        let event = state.events.pop_front();
        state.diagnostics.current_depth = state.events.len();
        event
    }

    fn diagnostics(&self) -> CaptureMouseEventQueueDiagnostics {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .diagnostics
    }
}
