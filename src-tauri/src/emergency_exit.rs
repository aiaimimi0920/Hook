//! Shared emergency chord state machine for event-driven input and watchdog polling.
use std::time::{Duration, Instant};

pub(crate) const EMERGENCY_CHORD_WINDOW: Duration = Duration::from_millis(400);

#[derive(Clone, Copy)]
pub(crate) enum EmergencyExitKey {
    Escape,
    Delete,
}

#[derive(Default)]
pub(crate) struct EmergencyExitTracker {
    escape_down: bool,
    delete_down: bool,
    chord_latched: bool,
    last_press: Option<Instant>,
    consecutive_presses: u8,
}

impl EmergencyExitTracker {
    pub(crate) fn record_key(
        &mut self,
        key: EmergencyExitKey,
        pressed: bool,
        now: Instant,
    ) -> Option<u8> {
        let (escape, delete) = match key {
            EmergencyExitKey::Escape => (pressed, self.delete_down),
            EmergencyExitKey::Delete => (self.escape_down, pressed),
        };
        self.record_state(escape, delete, now)
    }

    pub(crate) fn record_state(
        &mut self,
        escape_down: bool,
        delete_down: bool,
        now: Instant,
    ) -> Option<u8> {
        self.escape_down = escape_down;
        self.delete_down = delete_down;
        if !escape_down && !delete_down {
            self.chord_latched = false;
        }
        if !escape_down || !delete_down || self.chord_latched {
            return None;
        }
        // Both keys must return to up before another chord can count. Autorepeat,
        // polling, or tapping one key while holding the other cannot advance it.
        self.chord_latched = true;
        let continues = self
            .last_press
            .map(|last| now.saturating_duration_since(last) < EMERGENCY_CHORD_WINDOW)
            .unwrap_or(false);
        self.consecutive_presses = if continues {
            self.consecutive_presses.saturating_add(1)
        } else {
            1
        };
        self.last_press = Some(now);
        let count = self.consecutive_presses;
        if count == 3 {
            self.consecutive_presses = 0;
            self.last_press = None;
        }
        Some(count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn three_overlapping_chords_require_full_release_in_either_key_order() {
        let now = Instant::now();
        let mut tracker = EmergencyExitTracker::default();
        for (index, first) in [
            EmergencyExitKey::Escape,
            EmergencyExitKey::Delete,
            EmergencyExitKey::Escape,
        ]
        .into_iter()
        .enumerate()
        {
            let at = now + Duration::from_millis(index as u64 * 150);
            let second = match first {
                EmergencyExitKey::Escape => EmergencyExitKey::Delete,
                EmergencyExitKey::Delete => EmergencyExitKey::Escape,
            };
            assert_eq!(tracker.record_key(first, true, at), None);
            assert_eq!(tracker.record_key(second, true, at), Some(index as u8 + 1));
            assert_eq!(tracker.record_key(first, false, at), None);
            assert_eq!(tracker.record_key(second, false, at), None);
        }
    }

    #[test]
    fn escape_alone_delete_alone_and_nonoverlapping_keys_never_count() {
        let now = Instant::now();
        let mut tracker = EmergencyExitTracker::default();
        for _ in 0..20 {
            for key in [EmergencyExitKey::Escape, EmergencyExitKey::Delete] {
                assert_eq!(tracker.record_key(key, true, now), None);
                assert_eq!(tracker.record_key(key, false, now), None);
            }
        }
    }

    #[test]
    fn repeated_keydowns_and_partial_releases_cannot_advance_a_chord() {
        let now = Instant::now();
        for held_key in [EmergencyExitKey::Escape, EmergencyExitKey::Delete] {
            let tapped_key = match held_key {
                EmergencyExitKey::Escape => EmergencyExitKey::Delete,
                EmergencyExitKey::Delete => EmergencyExitKey::Escape,
            };
            let mut tracker = EmergencyExitTracker::default();
            assert_eq!(tracker.record_state(true, true, now), Some(1));
            for _ in 0..20 {
                assert_eq!(tracker.record_key(held_key, true, now), None);
                assert_eq!(tracker.record_key(tapped_key, true, now), None);
                assert_eq!(tracker.record_key(tapped_key, false, now), None);
                assert_eq!(tracker.record_key(tapped_key, true, now), None);
            }
            assert_eq!(tracker.record_state(false, false, now), None);
            assert_eq!(tracker.record_state(true, true, now), Some(2));
        }
    }

    #[test]
    fn an_expired_sequence_restarts_and_400ms_is_not_inside_the_window() {
        let now = Instant::now();
        let mut tracker = EmergencyExitTracker::default();
        assert_eq!(tracker.record_state(true, true, now), Some(1));
        tracker.record_state(false, false, now);
        assert_eq!(
            tracker.record_state(true, true, now + EMERGENCY_CHORD_WINDOW),
            Some(1)
        );
        tracker.record_state(false, false, now + EMERGENCY_CHORD_WINDOW);
        assert_eq!(
            tracker.record_state(true, true, now + EMERGENCY_CHORD_WINDOW * 2),
            Some(1)
        );
    }

    #[test]
    fn a_completed_sequence_resets_and_polling_only_counts_each_overlap_once() {
        let now = Instant::now();
        let mut tracker = EmergencyExitTracker::default();
        for expected in [1, 2, 3, 1] {
            assert_eq!(tracker.record_state(true, true, now), Some(expected));
            for _ in 0..50 {
                assert_eq!(tracker.record_state(true, true, now), None);
            }
            tracker.record_state(false, true, now);
            assert_eq!(tracker.record_state(true, true, now), None);
            tracker.record_state(false, false, now);
        }
    }
}
