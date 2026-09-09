//! Event-driven idle waits; queued frames and lease expiry retain their deadlines.
use super::{Duration, HashMap, Instant, Layout, Slot, LEASE};

const RETRY: Duration = Duration::from_millis(16);

pub(super) fn renew(slot: &mut Slot, layout: Option<Layout>, now: Instant) -> bool {
    let was_active = slot.layout.is_some()
        && slot.status.error.is_none()
        && now.saturating_duration_since(slot.renewed) < LEASE;
    let changed = slot.layout != layout;
    if changed {
        slot.status.presenting = false;
    }
    slot.layout = layout;
    slot.renewed = now;
    // Same-layout renewal does not create compositor work. Reactivation does:
    // the previous lease may have removed the surface, including for static UI.
    changed || (!was_active && layout.is_some() && slot.status.error.is_none())
}

pub(super) fn next_wait(slots: &HashMap<String, Slot>, now: Instant) -> Duration {
    slots
        .values()
        .filter(|slot| slot.layout.is_some() && slot.status.error.is_none())
        .filter_map(|slot| {
            let remaining = LEASE.checked_sub(now.saturating_duration_since(slot.renewed))?;
            if remaining.is_zero() {
                return None;
            }
            let pending =
                slot.latest.is_some() || (!slot.status.presenting && slot.spare.is_some());
            Some(frame_wait(remaining, pending))
        })
        .min()
        .unwrap_or(LEASE)
}

fn frame_wait(remaining: Duration, pending: bool) -> Duration {
    if pending {
        remaining.min(RETRY)
    } else {
        remaining
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> Layout {
        Layout {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            inset: 2.0,
        }
    }

    #[test]
    fn unchanged_heartbeat_renews_without_waking_but_expired_static_surface_wakes() {
        let now = Instant::now();
        let mut slot = Slot::new();
        assert!(renew(&mut slot, Some(layout()), now));
        slot.status.presenting = true;
        assert!(!renew(
            &mut slot,
            Some(layout()),
            now + Duration::from_millis(160)
        ));
        assert!(slot.status.presenting);
        assert_eq!(slot.renewed, now + Duration::from_millis(160));
        assert!(renew(
            &mut slot,
            Some(layout()),
            now + Duration::from_millis(510)
        ));
        assert!(renew(&mut slot, None, now + Duration::from_millis(520)));
        assert!(!slot.status.presenting);
    }

    #[test]
    fn earliest_lease_wins_and_disabled_or_faulted_slots_do_not_spin() {
        let now = Instant::now();
        let mut slots = HashMap::new();
        for (id, age) in [("older", 300), ("newer", 100)] {
            let mut slot = Slot::new();
            renew(&mut slot, Some(layout()), now - Duration::from_millis(age));
            slot.status.presenting = true;
            slots.insert(id.to_string(), slot);
        }
        assert_eq!(next_wait(&slots, now), Duration::from_millis(50));
        slots.get_mut("older").unwrap().layout = None;
        assert_eq!(next_wait(&slots, now), Duration::from_millis(250));
        slots.get_mut("newer").unwrap().status.error = Some("device lost".into());
        assert_eq!(next_wait(&slots, now), LEASE);
        slots.clear();
        assert_eq!(next_wait(&slots, now), LEASE);
    }

    #[test]
    fn busy_present_retries_without_extending_lease() {
        assert_eq!(frame_wait(LEASE, true), RETRY);
        assert_eq!(
            frame_wait(Duration::from_millis(3), true),
            Duration::from_millis(3)
        );
        assert_eq!(frame_wait(LEASE, false), LEASE);
    }

    #[test]
    fn static_mirrors_need_at_most_four_deadline_checks_per_second() {
        let now = Instant::now();
        let mut slot = Slot::new();
        renew(&mut slot, Some(layout()), now);
        slot.status.presenting = true;
        let mut slots = HashMap::from([("static".to_string(), slot)]);
        let mut elapsed = Duration::ZERO;
        let mut heartbeat = Duration::from_millis(160);
        let mut checks = 0;
        while elapsed < Duration::from_secs(1) {
            elapsed += next_wait(&slots, now + elapsed);
            while heartbeat <= elapsed {
                assert!(!renew(
                    slots.get_mut("static").unwrap(),
                    Some(layout()),
                    now + heartbeat
                ));
                heartbeat += Duration::from_millis(160);
            }
            checks += 1;
            assert!(checks <= 4);
        }
    }
}
