//! One bounded compositor owner for the main HWND; capture never waits for it.

use std::collections::HashMap;
use std::sync::{mpsc, Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

use super::work_budget::{CaptureBudget, CpuPermit};
use super::{frame::GpuFrame, presenter::Presenter, Layout, PreviewStatus, SubmitOutcome};

#[path = "worker_schedule.rs"]
mod schedule;

const LEASE: Duration = Duration::from_millis(350);
static SERVICE: LazyLock<Mutex<Option<Service>>> = LazyLock::new(|| Mutex::new(None));

struct Slot {
    layout: Option<Layout>,
    renewed: Instant,
    latest: Option<GpuFrame>,
    spare: Option<GpuFrame>,
    in_flight: Option<GpuFrame>,
    texture_bytes: u64,
    status: PreviewStatus,
    presented_at: Option<Instant>,
    generation: u64,
}

impl Slot {
    fn new() -> Self {
        Self {
            layout: None,
            renewed: Instant::now(),
            latest: None,
            spare: None,
            in_flight: None,
            texture_bytes: 0,
            presented_at: None,
            generation: 0,
            status: PreviewStatus {
                available: true,
                ..Default::default()
            },
        }
    }

    fn active(&self) -> bool {
        self.layout.is_some() && self.renewed.elapsed() < LEASE && self.status.error.is_none()
    }

    fn cpu_suppressed(&self) -> bool {
        self.active()
            && self.status.presenting
            && self.presented_at.is_some_and(|at| at.elapsed() < LEASE)
    }
}

struct Service {
    hwnd: usize,
    slots: Arc<Mutex<HashMap<String, Slot>>>,
    wake: mpsc::SyncSender<()>,
    join: Option<std::thread::JoinHandle<()>>,
}

pub(super) fn configure(
    hwnd: usize,
    id: &str,
    layout: Option<Layout>,
) -> Result<PreviewStatus, String> {
    let mut service = SERVICE.lock().map_err(|_| "GPU service poisoned")?;
    if service.is_none() && layout.is_none() {
        return Ok(PreviewStatus {
            available: true,
            ..Default::default()
        });
    }
    if service.is_none() {
        let slots = Arc::new(Mutex::new(HashMap::new()));
        let (wake, receiver) = mpsc::sync_channel(1);
        let shared = slots.clone();
        let join = std::thread::Builder::new()
            .name("hook-live-gpu".to_string())
            .spawn(move || run(hwnd, shared, receiver))
            .map_err(|error| error.to_string())?;
        *service = Some(Service {
            hwnd,
            slots,
            wake,
            join: Some(join),
        });
    }
    let service = service.as_ref().expect("initialized GPU service");
    if service.hwnd != hwnd {
        return Err("GPU preview target changed".to_string());
    }
    let mut slots = service.slots.lock().map_err(|_| "GPU slots poisoned")?;
    if layout.is_none() && !slots.contains_key(id) {
        return Ok(PreviewStatus {
            available: true,
            ..Default::default()
        });
    }
    if !slots.contains_key(id) && slots.len() >= crate::LIVE_CAPTURE_MAX_SESSIONS {
        return Err("GPU preview session limit reached".to_string());
    }
    let slot = slots.entry(id.to_string()).or_insert_with(Slot::new);
    // Latch device/budget errors for this session. No automatic retry storm;
    // stopping the Unit removes the slot and a new session can probe again.
    let changed = schedule::renew(slot, layout, Instant::now());
    let status = slot.status.clone();
    if changed {
        let _ = service.wake.try_send(());
    }
    Ok(status)
}

// A contended compositor defers the latest preview; it must not trigger CPU readback.
// Queued frames can still supply a budgeted fallback until native presentation is healthy.
pub(crate) fn submit(
    id: &str,
    frame: &scap_direct3d::Frame,
    crop: Option<windows::Win32::Graphics::Direct3D11::D3D11_BOX>,
) -> SubmitOutcome {
    let Ok(service) = SERVICE.try_lock() else {
        return SubmitOutcome::Busy;
    };
    let Some(service) = service.as_ref() else {
        return SubmitOutcome::Fallback;
    };
    let Ok(mut slots) = service.slots.try_lock() else {
        return SubmitOutcome::Busy;
    };
    // Three owned input textures plus two swapchain buffers per active source.
    let other_bytes: u64 = slots
        .iter()
        .filter(|(key, _)| key.as_str() != id)
        .map(|(_, slot)| slot.texture_bytes)
        .sum();
    let Some(slot) = slots.get_mut(id).filter(|slot| slot.active()) else {
        return SubmitOutcome::Fallback;
    };
    let Ok((width, height)) = super::frame::region_dimensions(frame, crop) else {
        return SubmitOutcome::Fallback;
    };
    let pixels = u64::from(width) * u64::from(height);
    let texture_budget = crate::live_resources::presentation_budget();
    if !frame_budget_allows(
        pixels.saturating_mul(20),
        slot.texture_bytes,
        other_bytes,
        texture_budget,
    ) {
        slot.status.error = Some("GPU preview texture budget exceeded".to_string());
        slot.status.presenting = false;
        let _ = service.wake.try_send(());
        return SubmitOutcome::Fallback;
    }
    let latest = slot.latest.take();
    if latest.is_some() {
        slot.status.replaced_frames = slot.status.replaced_frames.saturating_add(1);
    }
    let reusable = latest.or_else(|| slot.spare.take());
    match GpuFrame::copy(frame, crop, reusable) {
        Ok(copy) => {
            slot.texture_bytes = pixels * 20;
            slot.latest = Some(copy);
            let _ = service.wake.try_send(());
            let suppressed = slot.cpu_suppressed();
            if suppressed {
                slot.status.cpu_readbacks_skipped =
                    slot.status.cpu_readbacks_skipped.saturating_add(1);
            }
            SubmitOutcome::Queued
        }
        Err(error) => {
            slot.status.error = Some(error);
            slot.status.presenting = false;
            let _ = service.wake.try_send(());
            SubmitOutcome::Fallback
        }
    }
}

// Transfer an independently owned mailbox texture after a busy submission. This
// preserves a one-off static UI update without reading pixels or copying it again.
pub(crate) fn submit_pending(id: &str, pending: &mut Option<GpuFrame>) -> SubmitOutcome {
    let Some(frame) = pending.as_ref() else {
        return SubmitOutcome::Queued;
    };
    let Ok(service) = SERVICE.try_lock() else {
        return SubmitOutcome::Busy;
    };
    let Some(service) = service.as_ref() else {
        return SubmitOutcome::Fallback;
    };
    let Ok(mut slots) = service.slots.try_lock() else {
        return SubmitOutcome::Busy;
    };
    let other_bytes: u64 = slots
        .iter()
        .filter(|(key, _)| key.as_str() != id)
        .map(|(_, slot)| slot.texture_bytes)
        .sum();
    let Some(slot) = slots.get_mut(id).filter(|slot| slot.active()) else {
        return SubmitOutcome::Fallback;
    };
    let pixels = u64::from(frame.width) * u64::from(frame.height);
    let texture_budget = crate::live_resources::presentation_budget();
    if !frame_budget_allows(
        pixels.saturating_mul(20),
        slot.texture_bytes,
        other_bytes,
        texture_budget,
    ) {
        slot.status.error = Some("GPU preview texture budget exceeded".to_string());
        slot.status.presenting = false;
        let _ = service.wake.try_send(());
        return SubmitOutcome::Fallback;
    }
    let retained = [&slot.latest, &slot.in_flight, &slot.spare]
        .map(|value| value.as_ref().map(|frame| frame.captured_at_ms));
    if pending_is_stale(frame.captured_at_ms, retained) {
        *pending = None;
    } else {
        if slot.latest.is_some() {
            slot.status.replaced_frames = slot.status.replaced_frames.saturating_add(1);
        }
        slot.latest = pending.take();
        slot.texture_bytes = pixels * 20;
        let _ = service.wake.try_send(());
    }
    SubmitOutcome::Queued
}

// A static source need not send another WGC update when a plane is hidden or
// loses its lease. Retain bounded textures and materialize that last frame once.
pub(crate) fn fallback(
    id: &str,
    after_ms: u64,
    budget: &CaptureBudget,
) -> Result<Option<(image::RgbImage, u64, CpuPermit)>, String> {
    let (readback, permit) = {
        let service = SERVICE.lock().map_err(|_| "GPU service poisoned")?;
        let Some(service) = service.as_ref() else {
            return Ok(None);
        };
        let slots = service.slots.lock().map_err(|_| "GPU slots poisoned")?;
        let Some(slot) = slots.get(id) else {
            return Ok(None);
        };
        if slot.cpu_suppressed() {
            budget.cancel_cpu();
            return Ok(None);
        }
        let Some(frame) = slot
            .latest
            .as_ref()
            .or(slot.in_flight.as_ref())
            .or(slot.spare.as_ref())
            .filter(|frame| frame.captured_at_ms > after_ms)
        else {
            return Ok(None);
        };
        let Some(permit) = budget.try_cpu(frame.width, frame.height) else {
            return Ok(None);
        };
        (super::snapshot::Readback::copy(frame)?, permit)
    };
    let (image, timestamp) = readback.into_rgb()?;
    Ok(Some((image, timestamp, permit)))
}

pub(crate) fn invalidate(id: &str) {
    if let Ok(service) = SERVICE.lock() {
        if let Some(service) = service.as_ref() {
            if let Ok(mut slots) = service.slots.lock() {
                if let Some(slot) = slots.get_mut(id) {
                    slot.generation = slot.generation.wrapping_add(1);
                    slot.layout = None;
                    slot.latest = None;
                    slot.spare = None;
                    slot.in_flight = None;
                    slot.texture_bytes = 0;
                    slot.status.presenting = false;
                    slot.presented_at = None;
                }
            }
            let _ = service.wake.try_send(());
        }
    }
}

pub(crate) fn remove(id: &str) {
    let retired = SERVICE.lock().ok().and_then(|mut owner| {
        let empty = owner.as_ref().is_some_and(|service| {
            let Ok(mut slots) = service.slots.lock() else {
                return false;
            };
            slots.remove(id);
            let _ = service.wake.try_send(());
            slots.is_empty()
        });
        if empty {
            owner.take()
        } else {
            None
        }
    });
    // Join outside SERVICE/slots locks: the retiring compositor still needs its slots.
    finish_service(retired);
}

pub(super) fn snapshot(id: &str) -> Result<Option<super::snapshot::Readback>, String> {
    let service = SERVICE.lock().map_err(|_| "GPU service poisoned")?;
    let Some(service) = service.as_ref() else {
        return Ok(None);
    };
    let slots = service.slots.lock().map_err(|_| "GPU slots poisoned")?;
    let Some(slot) = slots.get(id) else {
        return Ok(None);
    };
    slot.latest
        .as_ref()
        .or(slot.in_flight.as_ref())
        .or(slot.spare.as_ref())
        .map(super::snapshot::Readback::copy)
        .transpose()
}

pub(crate) fn shutdown() {
    let service = SERVICE.lock().ok().and_then(|mut value| value.take());
    finish_service(service);
}

fn finish_service(service: Option<Service>) {
    if let Some(mut service) = service {
        drop(service.wake);
        if let Some(join) = service.join.take() {
            let _ = join.join();
        }
    }
}

#[cfg(test)]
pub(super) fn has_service() -> bool {
    SERVICE.lock().unwrap().is_some()
}

fn run(hwnd: usize, slots: Arc<Mutex<HashMap<String, Slot>>>, receiver: mpsc::Receiver<()>) {
    if let Err(error) = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.ok() {
        fail_all(&slots, error.to_string());
        return;
    }
    let mut presenter: Option<Presenter> = None;
    let mut wait = LEASE;
    loop {
        if matches!(
            receiver.recv_timeout(wait),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ) {
            break;
        }
        let (active, frames) = {
            let Ok(mut slots) = slots.lock() else { break };
            let active: Vec<_> = slots
                .iter()
                .filter(|(_, slot)| slot.active())
                .map(|(id, _)| id.clone())
                .collect();
            let frames: Vec<_> = slots
                .iter_mut()
                .filter_map(|(id, slot)| {
                    if !slot.active() {
                        slot.status.presenting = false;
                        return None;
                    }
                    let frame = slot.latest.take().or_else(|| {
                        if !slot.status.presenting {
                            slot.spare.take()
                        } else {
                            None
                        }
                    });
                    // This reference is never returned to the capture reuse pool.
                    // Snapshot callers still make an independent staging copy.
                    slot.in_flight = frame.clone();
                    frame.map(|frame| {
                        (
                            id.clone(),
                            slot.generation,
                            slot.layout.expect("active layout"),
                            frame,
                        )
                    })
                })
                .collect();
            (active, frames)
        };
        if let Some(owner) = presenter.as_mut() {
            if let Err(error) = owner.retain(&active) {
                fail_all(&slots, error.to_string());
                presenter = None;
            }
        }
        for (id, generation, layout, frame) in frames {
            let result = (|| {
                if presenter.is_none() {
                    presenter = Some(Presenter::new(hwnd, &frame)?);
                }
                presenter
                    .as_mut()
                    .expect("initialized presenter")
                    .present(&id, layout, &frame)
            })();
            if let Ok(mut slots) = slots.lock() {
                if let Some(slot) = slots.get_mut(&id) {
                    if slot.generation != generation {
                        continue;
                    }
                    slot.in_flight = None;
                    match result {
                        Ok(submitted) => {
                            if submitted {
                                slot.presented_at = Some(Instant::now());
                                slot.status.submitted_frames =
                                    slot.status.submitted_frames.saturating_add(1);
                                slot.status.presenting =
                                    slot.active() && slot.layout == Some(layout);
                            }
                            // A one-off UI update must survive a busy swapchain.
                            // Retry it unless capture already supplied a newer frame.
                            if retry_present(submitted, slot.latest.is_some()) {
                                slot.latest = Some(frame);
                            } else {
                                slot.spare = Some(frame);
                            }
                        }
                        Err(error) => {
                            slot.status.error = Some(error.to_string());
                            slot.status.presenting = false;
                        }
                    }
                }
            }
        }
        let Ok(current) = slots.lock() else { break };
        wait = schedule::next_wait(&current, Instant::now());
        // A lease/fault may change while Present runs outside the lock.
        if active
            .iter()
            .any(|id| current.get(id).is_some_and(|slot| !slot.active()))
        {
            wait = Duration::ZERO;
        }
    }
    drop(presenter);
    unsafe { CoUninitialize() };
}

fn fail_all(slots: &Mutex<HashMap<String, Slot>>, error: String) {
    if let Ok(mut slots) = slots.lock() {
        for slot in slots.values_mut() {
            slot.status.error = Some(error.clone());
            slot.status.presenting = false;
        }
    }
}

fn retry_present(submitted: bool, has_newer_frame: bool) -> bool {
    !submitted && !has_newer_frame
}

fn pending_is_stale(candidate: u64, retained: [Option<u64>; 3]) -> bool {
    retained.into_iter().flatten().any(|at| at >= candidate)
}

fn frame_budget_allows(requested: u64, retained: u64, other: u64, budget: u64) -> bool {
    // A shrinking external budget must not latch healthy, reusable slots into
    // permanent JPEG fallback. Only new/growing payloads require fresh headroom.
    requested <= retained
        || other
            .checked_add(requested)
            .is_some_and(|total| total <= budget)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn budget_shrink_preserves_existing_payload_but_refuses_growth() {
        assert!(frame_budget_allows(40, 40, 100, 80));
        assert!(!frame_budget_allows(41, 40, 100, 80));
        assert!(!frame_budget_allows(40, 0, 100, 80));
        assert!(frame_budget_allows(40, 0, 20, 80));
        assert!(!frame_budget_allows(40, 0, u64::MAX, 80));
    }

    #[test]
    fn deferred_frames_never_overwrite_newer_or_equal_native_ownership_slots() {
        assert!(!pending_is_stale(10, [None; 3]));
        for slot in 0..3 {
            for (timestamp, stale) in [(9, false), (10, true), (11, true)] {
                let mut retained = [None; 3];
                retained[slot] = Some(timestamp);
                assert_eq!(pending_is_stale(10, retained), stale);
            }
        }
    }

    #[test]
    fn a_busy_swapchain_retries_the_last_update_but_never_replaces_a_newer_one() {
        assert!(retry_present(false, false));
        assert!(!retry_present(false, true));
        assert!(!retry_present(true, false));
        assert!(!retry_present(true, true));
    }

    #[test]
    fn lease_expiry_and_faults_disable_a_native_plane() {
        let mut slot = Slot::new();
        slot.layout = Some(Layout {
            x: 1.0,
            y: 1.0,
            width: 100.0,
            height: 100.0,
            inset: 0.0,
        });
        assert!(slot.active());
        assert!(!slot.cpu_suppressed());
        slot.status.presenting = true;
        slot.presented_at = Some(Instant::now());
        assert!(slot.cpu_suppressed());
        slot.presented_at = Some(Instant::now() - LEASE);
        assert!(!slot.cpu_suppressed());
        slot.presented_at = Some(Instant::now());
        slot.renewed = Instant::now() - LEASE;
        assert!(!slot.active());
        assert!(!slot.cpu_suppressed());
        slot.renewed = Instant::now();
        slot.status.error = Some("device removed".to_string());
        assert!(!slot.active());
        assert!(!slot.cpu_suppressed());
    }
}
