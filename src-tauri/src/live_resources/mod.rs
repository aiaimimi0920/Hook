//! Source admission precedes worker/pool allocation; reservations live until worker teardown.
#[cfg(target_os = "windows")]
mod metrics;
mod policy;
#[cfg(test)]
mod tests;
#[cfg(target_os = "windows")]
pub(crate) use metrics::set_device;
pub(crate) use policy::{Cost, Status, HARD_LIMIT};
use std::sync::{LazyLock, Mutex};

static POLICY: LazyLock<Mutex<policy::Policy>> =
    LazyLock::new(|| Mutex::new(policy::Policy::default()));

fn sample() -> Result<policy::Sample, &'static str> {
    #[cfg(target_os = "windows")]
    {
        metrics::sample()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("live_resource_telemetry_unavailable")
    }
}

pub(crate) struct Reservation {
    id: String,
}

pub(crate) fn reserve(id: &str, cost: Cost) -> Result<Reservation, String> {
    let sample = sample()?;
    let mut policy = POLICY
        .lock()
        .map_err(|_| "live_resource_lock_unavailable")?;
    policy.observe(sample);
    if policy.costs.contains_key(id) {
        return Err("live_resource_id_collision".into());
    }
    policy.admit(id, cost)?;
    Ok(Reservation { id: id.to_string() })
}

pub(crate) fn resize(id: &str, cost: Cost) -> Result<(), String> {
    let sample = sample()?;
    let mut policy = POLICY
        .lock()
        .map_err(|_| "live_resource_lock_unavailable")?;
    policy.observe(sample);
    if !policy.costs.contains_key(id) {
        return Err("live_resource_reservation_missing".into());
    }
    policy.admit(id, cost).map_err(str::to_string)
}

impl Drop for Reservation {
    fn drop(&mut self) {
        if let Ok(mut policy) = POLICY.lock() {
            policy.remove(&self.id);
        }
    }
}

pub(crate) fn cadence_scale() -> f64 {
    let Ok(sample) = sample() else {
        return 2.0;
    };
    POLICY
        .lock()
        .map(|mut policy| {
            policy.observe(sample);
            policy.cadence_scale()
        })
        .unwrap_or(2.0)
}

// This is an admission estimate, not total GPU capacity or measured GPU utilization.
pub(crate) fn presentation_budget() -> u64 {
    POLICY
        .lock()
        .map(|policy| policy.gpu_limit())
        .unwrap_or(256 * policy::MIB)
}

#[tauri::command]
pub(crate) fn get_live_resource_status() -> Result<Status, String> {
    let sample = sample()?;
    let mut policy = POLICY
        .lock()
        .map_err(|_| "live_resource_lock_unavailable")?;
    policy.observe(sample);
    let status = policy.status();
    #[cfg(target_os = "windows")]
    let status = Status {
        shared_window_capture_pools: crate::screenshot::live_shared_pool_count(),
        ..status
    };
    Ok(status)
}
