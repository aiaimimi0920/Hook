//! Conservative admission estimates are corrected upwards by observed allocation growth.
use std::collections::HashMap;

pub(crate) const HARD_LIMIT: usize = 16;
pub(super) const MIB: u64 = 1024 * 1024;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Cost {
    pub memory: u64,
    pub gpu: u64,
}

impl Cost {
    pub fn new(source_pixels: u64, crop_pixels: u64) -> Result<Self, &'static str> {
        if source_pixels == 0
            || crop_pixels == 0
            || source_pixels > 128_000_000
            || crop_pixels > source_pixels
        {
            return Err("live_resource_dimensions");
        }
        // Includes two full-source pools, crop/mailbox/preview/staging allowances,
        // decoded/encoded copies and fixed bookkeeping. Not a total-VRAM guarantee.
        Ok(Self {
            memory: crop_pixels * 32 + 8 * MIB,
            gpu: source_pixels * 8 + crop_pixels * 40 + 8 * MIB,
        })
    }
}

#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Sample {
    pub sequence: u64,
    pub total_memory: u64,
    pub available_memory: u64,
    pub private_bytes: Option<u64>,
    pub system_cpu: Option<f64>,
    pub process_cpu: Option<f64>,
    pub gpu_budget: Option<u64>,
    pub gpu_usage: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    pub active_sources: usize,
    pub shared_window_capture_pools: usize,
    pub hard_limit: usize,
    pub reserved_memory_bytes: u64,
    pub reserved_gpu_bytes: u64,
    pub gpu_admission_budget_bytes: u64,
    pub memory_growth_factor: f64,
    pub gpu_growth_factor: f64,
    pub cpu_growth_per_source: f64,
    pub under_pressure: bool,
    pub cadence_scale: f64,
    pub sample: Sample,
}

pub(super) struct Policy {
    pub costs: HashMap<String, Cost>,
    sample: Sample,
    growth: (f64, f64),
    cpu_growth: f64,
    pending: Option<(Sample, Cost, usize)>,
    pressured: bool,
    cadence_steps: u8,
    cool_samples: u8,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            costs: HashMap::new(),
            sample: Sample::default(),
            growth: (1.0, 1.0),
            cpu_growth: 0.02,
            pending: None,
            pressured: false,
            cadence_steps: 1,
            cool_samples: 0,
        }
    }
}

impl Policy {
    pub fn observe(&mut self, sample: Sample) {
        if sample.sequence <= self.sample.sequence {
            return;
        }
        if self
            .pending
            .is_some_and(|(before, _, _)| sample.sequence >= before.sequence + 2)
        {
            let (before, cost, count) = self.pending.take().expect("pending cohort");
            // Concurrent starts are one cohort; unrelated process/driver growth can
            // overestimate cost. Never treat this heuristic as causal profiling.
            if let (Some(old), Some(new)) = (before.private_bytes, sample.private_bytes) {
                if cost.memory > 0 {
                    self.growth.0 = self
                        .growth
                        .0
                        .max(new.saturating_sub(old) as f64 / cost.memory as f64);
                }
            }
            if let (Some(old), Some(new)) = (before.gpu_usage, sample.gpu_usage) {
                if cost.gpu > 0 {
                    self.growth.1 = self
                        .growth
                        .1
                        .max(new.saturating_sub(old) as f64 / cost.gpu as f64);
                }
            }
            if let (Some(old), Some(new)) = (before.process_cpu, sample.process_cpu) {
                self.cpu_growth = self.cpu_growth.max((new - old) / count as f64);
            }
        }
        let memory_low = sample.available_memory < (sample.total_memory / 10).max(512 * MIB);
        let gpu_low = sample
            .gpu_budget
            .zip(sample.gpu_usage)
            .is_some_and(|(budget, used)| used > budget.saturating_mul(85) / 100);
        if sample.system_cpu.is_some_and(|cpu| cpu >= 0.85) || memory_low || gpu_low {
            self.pressured = true;
            // One decision per fresh OS sample, not per subscriber polling call.
            self.cadence_steps = self.cadence_steps.saturating_add(1).clamp(2, 8);
            self.cool_samples = 0;
        } else if sample.system_cpu.is_some_and(|cpu| cpu < 0.65) {
            self.cool_samples = self.cool_samples.saturating_add(1);
            if self.cool_samples >= 5 {
                // Restore at most twice the rate per quiet window. Linear recovery
                // left an 8x slowdown latched for 35 fresh samples after a CPU spike.
                self.cadence_steps = self.cadence_steps.div_ceil(2).max(1);
                self.pressured = self.cadence_steps > 1;
                self.cool_samples = 0;
            }
        } else {
            self.cool_samples = 0;
        }
        self.sample = sample;
    }

    fn weighted(&self, cost: Cost) -> Cost {
        Cost {
            memory: (cost.memory as f64 * self.growth.0) as u64,
            gpu: (cost.gpu as f64 * self.growth.1) as u64,
        }
    }

    fn totals_without(&self, id: &str) -> Cost {
        self.costs
            .iter()
            .filter(|(key, _)| key.as_str() != id)
            .fold(Cost { memory: 0, gpu: 0 }, |sum, (_, cost)| {
                let cost = self.weighted(*cost);
                Cost {
                    memory: sum.memory.saturating_add(cost.memory),
                    gpu: sum.gpu.saturating_add(cost.gpu),
                }
            })
    }

    pub fn gpu_limit(&self) -> u64 {
        self.sample
            .gpu_budget
            .map(|budget| budget / 3)
            .unwrap_or(256 * MIB)
            .min(1024 * MIB)
    }

    pub fn admit(&mut self, id: &str, cost: Cost) -> Result<(), &'static str> {
        let previous = self.costs.get(id).copied();
        if previous.is_none() && self.costs.len() >= HARD_LIMIT {
            return Err("live_resource_hard_limit");
        }
        if self.sample.total_memory == 0 {
            return Err("live_resource_telemetry_unavailable");
        }
        let reducing = previous.is_some_and(|old| cost.memory <= old.memory && cost.gpu <= old.gpu);
        if reducing {
            self.costs.insert(id.to_string(), cost);
            return Ok(());
        }
        let weighted = self.weighted(cost);
        let old = previous
            .map(|old| self.weighted(old))
            .unwrap_or(Cost { memory: 0, gpu: 0 });
        let delta = Cost {
            memory: weighted.memory.saturating_sub(old.memory),
            gpu: weighted.gpu.saturating_sub(old.gpu),
        };
        let total = self.totals_without(id);
        let reserve = (self.sample.total_memory / 10).max(512 * MIB);
        // Pending starts have not necessarily appeared in the sampled OS counters.
        let pending = self
            .pending
            .map(|(_, cost, _)| self.weighted(cost))
            .unwrap_or(Cost { memory: 0, gpu: 0 });
        if total.memory.saturating_add(weighted.memory)
            > (self.sample.total_memory / 8).min(2 * 1024 * MIB)
            || reserve
                .saturating_add(delta.memory)
                .saturating_add(pending.memory)
                > self.sample.available_memory
        {
            return Err("live_resource_memory_pressure");
        }
        if total.gpu.saturating_add(weighted.gpu) > self.gpu_limit()
            || self
                .sample
                .gpu_budget
                .zip(self.sample.gpu_usage)
                .is_some_and(|(budget, used)| {
                    used.saturating_add(pending.gpu).saturating_add(delta.gpu)
                        > budget.saturating_mul(85) / 100
                })
        {
            return Err("live_resource_gpu_pressure");
        }
        if self.pressured {
            return Err("live_resource_cooldown");
        }
        if self.sample.system_cpu.unwrap_or(0.5)
            + self.cpu_growth * (self.pending.map_or(0, |(_, _, count)| count) + 1) as f64
            > 0.85
        {
            return Err("live_resource_cpu_pressure");
        }
        self.costs.insert(id.to_string(), cost);
        let added = Cost {
            memory: cost
                .memory
                .saturating_sub(previous.map_or(0, |old| old.memory)),
            gpu: cost.gpu.saturating_sub(previous.map_or(0, |old| old.gpu)),
        };
        let cohort = self
            .pending
            .get_or_insert((self.sample, Cost { memory: 0, gpu: 0 }, 0));
        cohort.1.memory = cohort.1.memory.saturating_add(added.memory);
        cohort.1.gpu = cohort.1.gpu.saturating_add(added.gpu);
        cohort.2 += 1;
        Ok(())
    }

    pub fn remove(&mut self, id: &str) {
        self.costs.remove(id);
        // Mixed start/stop cohorts cannot attribute growth, but their pending
        // allocations must stay charged until fresh OS samples have caught up.
        if let Some((before, _, _)) = self.pending.as_mut() {
            before.private_bytes = None;
            before.gpu_usage = None;
            before.process_cpu = None;
        }
        if self.costs.is_empty() {
            self.pending = None;
            self.growth = (1.0, 1.0);
            self.cpu_growth = 0.02;
        }
    }

    pub fn cadence_scale(&self) -> f64 {
        f64::from(self.cadence_steps)
    }

    pub fn status(&self) -> Status {
        let total = self.totals_without("");
        Status {
            active_sources: self.costs.len(),
            shared_window_capture_pools: 0,
            hard_limit: HARD_LIMIT,
            reserved_memory_bytes: total.memory,
            reserved_gpu_bytes: total.gpu,
            gpu_admission_budget_bytes: self.gpu_limit(),
            memory_growth_factor: self.growth.0,
            gpu_growth_factor: self.growth.1,
            cpu_growth_per_source: self.cpu_growth,
            under_pressure: self.pressured,
            cadence_scale: self.cadence_scale(),
            sample: self.sample,
        }
    }
}
