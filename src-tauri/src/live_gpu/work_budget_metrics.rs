use std::sync::atomic::{AtomicU64, Ordering};

// 归CaptureBudget所有，不保留会话ID或历史；不新增锁或改变准入返回值。
// granted/policyDenied在既有预算锁内记录，仍有少量计数开销。
#[derive(Default)]
pub(super) struct CpuAdmissionCounters {
    granted: AtomicU64,
    policy_denied: AtomicU64,
    lock_unavailable: AtomicU64,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CpuAdmissionSnapshot {
    pub granted: u64,
    pub policy_denied: u64,
    pub lock_unavailable: u64,
}

pub(super) enum AdmissionOutcome {
    Granted,
    PolicyDenied,
    LockUnavailable,
}

impl CpuAdmissionCounters {
    pub fn record(&self, outcome: AdmissionOutcome) {
        let value = match outcome {
            AdmissionOutcome::Granted => &self.granted,
            AdmissionOutcome::PolicyDenied => &self.policy_denied,
            AdmissionOutcome::LockUnavailable => &self.lock_unavailable,
        };
        let _ = value.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| {
            Some(v.saturating_add(1))
        });
    }

    pub fn snapshot(&self) -> CpuAdmissionSnapshot {
        // 三个独立原子读，不声称与帧状态或彼此构成原子快照。
        CpuAdmissionSnapshot {
            granted: self.granted.load(Ordering::Relaxed),
            policy_denied: self.policy_denied.load(Ordering::Relaxed),
            lock_unavailable: self.lock_unavailable.load(Ordering::Relaxed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcomes_are_separate_and_saturate() {
        let counters = CpuAdmissionCounters::default();
        counters.granted.store(u64::MAX, Ordering::Relaxed);
        counters.record(AdmissionOutcome::Granted);
        counters.record(AdmissionOutcome::PolicyDenied);
        counters.record(AdmissionOutcome::LockUnavailable);
        let value = counters.snapshot();
        assert_eq!(
            (value.granted, value.policy_denied, value.lock_unavailable),
            (u64::MAX, 1, 1)
        );
        assert_eq!(
            serde_json::to_value(value)
                .unwrap()
                .as_object()
                .unwrap()
                .len(),
            3
        );
    }
}
