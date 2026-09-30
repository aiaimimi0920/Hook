//! Process-local counters of validated NLWM bytes, not NIC traffic or physical presentation.
use std::sync::atomic::{AtomicU64, Ordering};
static RECEIVED_FRAMES: AtomicU64 = AtomicU64::new(0);
static RECEIVED_BYTES: AtomicU64 = AtomicU64::new(0);
static READ_FRAMES: AtomicU64 = AtomicU64::new(0);
static REPLACED_FRAMES: AtomicU64 = AtomicU64::new(0);

fn add(counter: &AtomicU64, value: u64) {
    let _ = counter.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
        Some(current.saturating_add(value).min(9_007_199_254_740_991))
    });
}
pub(super) fn received(bytes: usize, replaced: bool) {
    add(&RECEIVED_FRAMES, 1);
    add(&RECEIVED_BYTES, bytes as u64);
    if replaced {
        add(&REPLACED_FRAMES, 1);
    }
}
pub(super) fn read() {
    add(&READ_FRAMES, 1);
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WallLiveStats {
    active_streams: usize,
    received_frames: u64,
    received_bytes: u64,
    read_frames: u64,
    replaced_frames: u64,
}
pub(super) fn snapshot(active_streams: usize) -> WallLiveStats {
    WallLiveStats {
        active_streams,
        received_frames: RECEIVED_FRAMES.load(Ordering::Relaxed),
        received_bytes: RECEIVED_BYTES.load(Ordering::Relaxed),
        read_frames: READ_FRAMES.load(Ordering::Relaxed),
        replaced_frames: REPLACED_FRAMES.load(Ordering::Relaxed),
    }
}
