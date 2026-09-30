//! Process-wide Live work admission. Waiting consumers retain pixels, not queued CPU jobs.
use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

const CAPTURE_PIXELS_PER_SECOND: f64 = 124_416_000.0;
const CAPTURE_FRAMES_PER_SECOND: f64 = 120.0;
const OUTPUT_PIXELS_PER_SECOND: f64 = 124_416_000.0;
const CPU_PIXELS_PER_SECOND: f64 = 24_000_000.0;
const CPU_FRAMES_PER_SECOND: f64 = 30.0;
const REQUEST_LEASE: Duration = Duration::from_millis(100);
static BUDGET: LazyLock<Arc<Mutex<Budget>>> =
    LazyLock::new(|| Arc::new(Mutex::new(Budget::default())));

struct Demand {
    fps: u16,
    source_pixels: u64,
    output_pixels: u64,
    shared_source: Option<String>,
    visible: bool,
    ticket: Option<u64>,
    requested_at: Instant,
}

#[derive(Default)]
struct Budget {
    demands: HashMap<String, Demand>,
    next_ticket: u64,
    cpu_busy: bool,
    cpu_due: Option<Instant>,
    cpu_grants: u64,
}

impl Budget {
    fn interval(&self, id: &str) -> Duration {
        let Some(own) = self.demands.get(id) else {
            return Duration::from_secs(1);
        };
        if !own.visible {
            return Duration::from_secs(1);
        }
        let (requested, pixels, output) = self.work();
        let scale = (requested / CAPTURE_FRAMES_PER_SECOND)
            .max(pixels / CAPTURE_PIXELS_PER_SECOND)
            .max(output / OUTPUT_PIXELS_PER_SECOND)
            .max(1.0);
        Duration::from_secs_f64((scale / f64::from(own.fps)).min(1.0))
    }

    fn work(&self) -> (f64, f64, f64) {
        let mut sources = HashMap::new();
        let mut output = 0.0;
        for (id, demand) in &self.demands {
            let fps = if demand.visible {
                f64::from(demand.fps)
            } else {
                1.0
            };
            // Private captures never alias a shared key. Same-source subscribers
            // request one acquisition at their fastest rate, but each copies a ROI.
            let key = match demand.shared_source.as_deref() {
                Some(source) => (true, source),
                None => (false, id.as_str()),
            };
            let entry = sources.entry(key).or_insert((0.0_f64, 0_u64));
            entry.0 = entry.0.max(fps);
            entry.1 = entry.1.max(demand.source_pixels);
            output += demand.output_pixels as f64 * fps;
        }
        let frames = sources.values().map(|(fps, _)| fps).sum();
        let pixels = sources
            .values()
            .map(|(fps, pixels)| fps * *pixels as f64)
            .sum();
        (frames, pixels, output)
    }

    fn admit(&mut self, id: &str, pixels: u64, now: Instant) -> Option<Duration> {
        let demand = self.demands.get_mut(id)?;
        if !demand.visible {
            demand.ticket = None;
            return None;
        }
        if demand.ticket.is_none() {
            demand.ticket = Some(self.next_ticket);
            self.next_ticket = self.next_ticket.wrapping_add(1);
        }
        demand.requested_at = now;
        if self.cpu_busy || self.cpu_due.is_some_and(|due| now < due) {
            return None;
        }
        let first = self
            .demands
            .iter()
            .filter(|(_, d)| d.visible && now.duration_since(d.requested_at) <= REQUEST_LEASE)
            .filter_map(|(id, d)| d.ticket.map(|ticket| (id, ticket)))
            .min_by_key(|(_, ticket)| *ticket);
        if first.is_none_or(|(first, _)| first != id) {
            return None;
        }
        self.demands.get_mut(id)?.ticket = None;
        self.cpu_busy = true;
        self.cpu_grants += 1;
        Some(Duration::from_secs_f64(
            (pixels as f64 / CPU_PIXELS_PER_SECOND).max(1.0 / CPU_FRAMES_PER_SECOND),
        ))
    }
}

pub(crate) struct CaptureBudget {
    id: String,
    shared: Arc<Mutex<Budget>>,
}

impl CaptureBudget {
    pub fn register(id: &str, fps: u16) -> Self {
        let shared = BUDGET.clone();
        if let Ok(mut budget) = shared.lock() {
            budget.demands.insert(
                id.to_string(),
                Demand {
                    fps: fps.clamp(1, 60),
                    source_pixels: 0,
                    output_pixels: 0,
                    shared_source: None,
                    visible: true,
                    ticket: None,
                    requested_at: Instant::now(),
                },
            );
        }
        Self {
            id: id.to_string(),
            shared,
        }
    }

    pub fn source_size(
        &self,
        width: u32,
        height: u32,
        output_pixels: u64,
        shared_source: Option<String>,
    ) {
        if let Ok(mut budget) = self.shared.lock() {
            if let Some(demand) = budget.demands.get_mut(&self.id) {
                demand.source_pixels = u64::from(width) * u64::from(height);
                demand.output_pixels = output_pixels.min(demand.source_pixels);
                demand.shared_source = shared_source;
            }
        }
    }

    pub fn interval(&self) -> Duration {
        let scale = crate::live_resources::cadence_scale();
        self.shared
            .lock()
            .map(|b| {
                b.interval(&self.id)
                    .mul_f64(scale)
                    .min(Duration::from_secs(1))
            })
            .unwrap_or(Duration::from_secs(1))
    }

    pub fn cancel_cpu(&self) {
        if let Ok(mut budget) = self.shared.lock() {
            if let Some(demand) = budget.demands.get_mut(&self.id) {
                demand.ticket = None;
            }
        }
    }

    // Admission precedes staging allocation/Map and remains held through JPEG encoding.
    pub fn try_cpu(&self, width: u32, height: u32) -> Option<CpuPermit> {
        let now = Instant::now();
        let cost = self.shared.try_lock().ok()?.admit(
            &self.id,
            u64::from(width) * u64::from(height),
            now,
        )?;
        Some(CpuPermit {
            shared: self.shared.clone(),
            started: now,
            cost,
        })
    }
}

impl Drop for CaptureBudget {
    fn drop(&mut self) {
        if let Ok(mut budget) = self.shared.lock() {
            budget.demands.remove(&self.id);
        }
    }
}

pub(crate) struct CpuPermit {
    shared: Arc<Mutex<Budget>>,
    started: Instant,
    cost: Duration,
}
impl Drop for CpuPermit {
    fn drop(&mut self) {
        if let Ok(mut budget) = self.shared.lock() {
            let now = Instant::now();
            // Deliberately cool down for at least the measured readback/encode time:
            // sustained fallback uses at most half of one worker's wall time, not all cores.
            budget.cpu_due =
                Some((self.started + self.cost).max(now + now.duration_since(self.started)));
            budget.cpu_busy = false;
        }
    }
}

pub(crate) fn set_visible(id: &str, visible: bool) {
    if let Ok(mut budget) = BUDGET.lock() {
        if let Some(demand) = budget.demands.get_mut(id) {
            demand.visible = visible;
            if !visible {
                demand.ticket = None;
            }
        }
    }
}

#[cfg(test)]
pub(crate) fn diagnostics() -> serde_json::Value {
    let budget = BUDGET.lock().unwrap();
    let (source_fps, source_pixels, output_pixels) = budget.work();
    serde_json::json!({
        "active": budget.demands.len(), "cpuGrants": budget.cpu_grants, "cpuBusy": budget.cpu_busy,
        "sourceRequestedFps": source_fps, "sourcePixelsPerSecond": source_pixels,
        "outputPixelsPerSecond": output_pixels,
        "intervalsMs": budget.demands.keys().map(|id| (id.clone(), budget.interval(id).as_secs_f64() * 1000.0))
            .collect::<HashMap<_, _>>(),
    })
}

#[cfg(test)]
#[path = "work_budget_tests.rs"]
mod tests;
