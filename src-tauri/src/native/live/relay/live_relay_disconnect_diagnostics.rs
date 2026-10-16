// Acceptance-only, bounded disconnect evidence; never persist peer text or transport credentials.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LiveRelayDisconnectReason {
    Stopped,
    Requested,
    Ping(LiveRelaySocketErrorClass),
    Pong(LiveRelaySocketErrorClass),
    Read(LiveRelaySocketErrorClass),
    InvalidFrame,
    InvalidMessage,
    PeerClose(Option<u16>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LiveRelaySocketErrorClass {
    Io(std::io::ErrorKind, Option<i32>),
    Closed,
    Protocol,
    Capacity,
    Tls,
    Other,
}

fn live_relay_socket_error_class(error: &tungstenite::Error) -> LiveRelaySocketErrorClass {
    use LiveRelaySocketErrorClass as Class;
    match error {
        tungstenite::Error::Io(error) => Class::Io(error.kind(), error.raw_os_error()),
        tungstenite::Error::ConnectionClosed | tungstenite::Error::AlreadyClosed => Class::Closed,
        tungstenite::Error::Protocol(_) => Class::Protocol,
        tungstenite::Error::Capacity(_) | tungstenite::Error::WriteBufferFull(_) => Class::Capacity,
        tungstenite::Error::Tls(_) => Class::Tls,
        _ => Class::Other,
    }
}

struct LiveRelayDisconnectDiagnostics {
    remaining: u8,
}

fn live_relay_disconnect_counters(state: &Mutex<LiveRelayRuntimeState>) -> Option<(u64, u64, u64)> {
    state
        .try_lock()
        .ok()
        .map(|state| (state.epoch, state.last_frame_id, state.reconnect_count))
}

impl LiveRelayDisconnectDiagnostics {
    fn new(enabled: bool) -> Self {
        Self {
            remaining: if enabled { 32 } else { 0 },
        }
    }

    fn line(
        &mut self,
        reason: LiveRelayDisconnectReason,
        connected_for: Duration,
        counters: Option<(u64, u64, u64)>,
        stop_requested: bool,
    ) -> Option<String> {
        if self.remaining == 0 {
            return None;
        }
        self.remaining -= 1;
        Some(format!(
            "live_relay_viewer_disconnect :: reason={reason:?} connected_ms={} epoch_frame_reconnect={counters:?} stop_requested={stop_requested} remaining_budget={}",
            connected_for.as_millis(), self.remaining
        ))
    }

    fn record(
        &mut self,
        relay: &LiveRelaySession,
        reason: LiveRelayDisconnectReason,
        age: Duration,
    ) {
        if self.remaining == 0 {
            return;
        }
        let counters = live_relay_disconnect_counters(&relay.state);
        // The state guard is gone before the existing nonblocking, bounded log queue is used.
        if let Some(line) = self.line(reason, age, counters, relay.stop.load(Ordering::SeqCst)) {
            append_runtime_log_line(&line);
        }
    }
}

#[cfg(test)]
mod live_relay_disconnect_diagnostics_tests {
    use super::*;

    #[test]
    fn disabled_diagnostics_never_produce_records() {
        let mut log = LiveRelayDisconnectDiagnostics::new(false);
        assert!(log
            .line(
                LiveRelayDisconnectReason::Stopped,
                Duration::ZERO,
                None,
                true
            )
            .is_none());
    }

    #[test]
    fn diagnostics_do_not_wait_for_busy_state() {
        let state = Mutex::new(LiveRelayRuntimeState::starting(1, Vec::new(), None));
        let guard = state.lock().unwrap();
        assert_eq!(live_relay_disconnect_counters(&state), None);
        drop(guard);
        assert_eq!(live_relay_disconnect_counters(&state), Some((1, 0, 0)));
    }

    #[test]
    fn acceptance_records_are_bounded_per_worker() {
        let mut log = LiveRelayDisconnectDiagnostics::new(true);
        for index in 0..32 {
            let line = log
                .line(
                    LiveRelayDisconnectReason::Requested,
                    Duration::from_millis(17),
                    Some((1, 7, index)),
                    false,
                )
                .unwrap();
            assert!(line.contains("connected_ms=17"));
            assert!(line.len() < 256);
        }
        assert!(log
            .line(
                LiveRelayDisconnectReason::Stopped,
                Duration::ZERO,
                None,
                true
            )
            .is_none());
    }

    #[test]
    fn io_error_evidence_excludes_untrusted_message() {
        let error = tungstenite::Error::Io(std::io::Error::new(
            std::io::ErrorKind::ConnectionReset,
            "Bearer secret\nforged_event",
        ));
        let class = live_relay_socket_error_class(&error);
        assert_eq!(
            class,
            LiveRelaySocketErrorClass::Io(std::io::ErrorKind::ConnectionReset, None)
        );
        let line = LiveRelayDisconnectDiagnostics::new(true)
            .line(
                LiveRelayDisconnectReason::Read(class),
                Duration::ZERO,
                None,
                false,
            )
            .unwrap();
        assert!(!line.contains("secret") && !line.contains('\n'));
        assert!(line.contains("ConnectionReset"));
    }

    #[test]
    fn close_code_and_stop_are_independent_evidence() {
        let line = LiveRelayDisconnectDiagnostics::new(true)
            .line(
                LiveRelayDisconnectReason::PeerClose(Some(1008)),
                Duration::ZERO,
                Some((2, 9, 1)),
                true,
            )
            .unwrap();
        assert!(line.contains("PeerClose(Some(1008))"));
        assert!(line.contains("stop_requested=true"));
    }

    #[test]
    fn full_write_buffer_payload_is_not_logged() {
        let error =
            tungstenite::Error::WriteBufferFull(tungstenite::Message::Text("secret".into()));
        assert_eq!(
            live_relay_socket_error_class(&error),
            LiveRelaySocketErrorClass::Capacity
        );
        assert_eq!(
            live_relay_socket_error_class(&tungstenite::Error::ConnectionClosed),
            LiveRelaySocketErrorClass::Closed
        );
    }
}
