use super::policy::*;

#[test]
fn sustained_pressure_escalates_once_per_sample_and_recovers_gradually() {
    let mut policy = Policy::default();
    let mut sample = machine(4096);
    sample.system_cpu = Some(0.95);
    for sequence in 1..=12 {
        sample.sequence = sequence;
        policy.observe(sample);
        let expected = (sequence + 1).min(8) as f64;
        assert_eq!(policy.cadence_scale(), expected);
        for _ in 0..16 {
            policy.observe(sample);
            assert_eq!(policy.cadence_scale(), expected);
        }
    }
    sample.system_cpu = Some(0.2);
    for (before, after) in [(8, 4), (4, 2), (2, 1)] {
        for quiet in 1..=5 {
            sample.sequence += 1;
            policy.observe(sample);
            assert_eq!(
                policy.cadence_scale(),
                if quiet == 5 { after } else { before } as f64
            );
        }
    }
    assert!(!policy.status().under_pressure);
    sample.sequence += 1;
    sample.system_cpu = Some(0.95);
    policy.observe(sample);
    assert_eq!(policy.cadence_scale(), 2.0);
}

#[test]
fn interrupted_or_unknown_recovery_cannot_restore_full_rate() {
    let mut policy = Policy::default();
    let mut sample = machine(4096);
    sample.system_cpu = Some(0.95);
    policy.observe(sample);
    for cpu in [Some(0.2), Some(0.2), Some(0.7), Some(0.2), None, Some(0.2)] {
        sample.sequence += 1;
        sample.system_cpu = cpu;
        policy.observe(sample);
        assert_eq!(policy.status().cadence_scale, 2.0);
        assert!(policy.status().under_pressure);
    }
    // GPU allocation pressure also overrides a quiet CPU; slowing is not freeing VRAM.
    sample.sequence += 1;
    sample.gpu_usage = sample.gpu_budget;
    policy.observe(sample);
    assert_eq!(policy.cadence_scale(), 3.0);
}

#[test]
fn recovery_is_bounded_for_odd_scales_and_repeated_samples() {
    let mut policy = Policy::default();
    let mut sample = machine(4096);
    sample.system_cpu = Some(0.95);
    for sequence in 1..=6 {
        sample.sequence = sequence;
        policy.observe(sample);
    }
    assert_eq!(policy.cadence_scale(), 7.0);
    sample.system_cpu = Some(0.2);
    for quiet in 1..=5 {
        sample.sequence += 1;
        for _ in 0..20 {
            policy.observe(sample);
            assert_eq!(policy.cadence_scale(), if quiet == 5 { 4.0 } else { 7.0 });
        }
    }
    assert!(policy.status().under_pressure);
    // Renewed pressure immediately slows again rather than completing recovery.
    sample.sequence += 1;
    sample.available_memory = 0;
    policy.observe(sample);
    assert_eq!(policy.cadence_scale(), 5.0);
}

fn machine(gpu_mib: u64) -> Sample {
    Sample {
        sequence: 1,
        total_memory: 16 * 1024 * MIB,
        available_memory: 12 * 1024 * MIB,
        private_bytes: Some(100 * MIB),
        system_cpu: Some(0.1),
        process_cpu: Some(0.01),
        gpu_budget: Some(gpu_mib * MIB),
        gpu_usage: Some(40 * MIB),
    }
}

fn count_on(machine: Sample, cost: Cost) -> usize {
    let mut policy = Policy::default();
    policy.observe(machine);
    (0..HARD_LIMIT)
        .take_while(|id| policy.admit(&id.to_string(), cost).is_ok())
        .count()
}

#[test]
fn capacity_depends_on_machine_and_actual_source_not_four() {
    let cost = Cost::new(1920 * 1080, 300 * 200).unwrap();
    let weak = count_on(machine(192), cost);
    let strong = count_on(machine(4096), cost);
    assert!((1..4).contains(&weak));
    assert!(strong > 4);
    assert!(strong <= HARD_LIMIT);
    assert!(count_on(machine(4096), Cost::new(3840 * 2160, 3840 * 2160).unwrap()) < strong);
}

#[test]
fn concurrent_reservations_are_charged_before_os_usage_catches_up() {
    let cost = Cost {
        memory: 64 * MIB,
        gpu: 64 * MIB,
    };
    let mut policy = Policy::default();
    let mut sample = machine(4096);
    sample.available_memory = sample.total_memory / 10 + 100 * MIB;
    policy.observe(sample);
    policy.admit("first", cost).unwrap();
    assert_eq!(
        policy.admit("second", cost),
        Err("live_resource_memory_pressure")
    );
    assert_eq!(policy.costs.len(), 1);
}

#[test]
fn cpu_growth_is_measured_and_prevents_the_next_expensive_source() {
    let mut policy = Policy::default();
    let mut sample = machine(4096);
    policy.observe(sample);
    let cost = Cost {
        memory: 16 * MIB,
        gpu: 16 * MIB,
    };
    policy.admit("first", cost).unwrap();
    sample.sequence = 3;
    sample.system_cpu = Some(0.7);
    sample.process_cpu = Some(0.21);
    policy.observe(sample);
    assert!(policy.status().cpu_growth_per_source > 0.19);
    assert_eq!(
        policy.admit("second", cost),
        Err("live_resource_cpu_pressure")
    );
}

#[test]
fn observed_allocation_growth_corrects_the_estimate_upwards() {
    let mut policy = Policy::default();
    let mut sample = machine(4096);
    policy.observe(sample);
    let cost = Cost {
        memory: 16 * MIB,
        gpu: 16 * MIB,
    };
    policy.admit("first", cost).unwrap();
    sample.sequence = 3;
    sample.private_bytes = sample.private_bytes.map(|bytes| bytes + 48 * MIB);
    sample.gpu_usage = sample.gpu_usage.map(|bytes| bytes + 64 * MIB);
    policy.observe(sample);
    let status = policy.status();
    assert_eq!(status.memory_growth_factor, 3.0);
    assert_eq!(status.gpu_growth_factor, 4.0);
    assert_eq!(status.reserved_gpu_bytes, 64 * MIB);
}

#[test]
fn pressure_slows_existing_sources_and_recovers_with_hysteresis() {
    let mut policy = Policy::default();
    let mut sample = machine(4096);
    policy.observe(sample);
    let cost = Cost::new(640 * 480, 100 * 100).unwrap();
    policy.admit("existing", cost).unwrap();
    sample.sequence = 2;
    sample.system_cpu = Some(0.95);
    policy.observe(sample);
    assert_eq!(policy.cadence_scale(), 2.0);
    assert_eq!(policy.admit("new", cost), Err("live_resource_cooldown"));
    assert!(policy.costs.contains_key("existing"));
    sample.system_cpu = Some(0.2);
    for sequence in 3..7 {
        sample.sequence = sequence;
        policy.observe(sample);
        assert_eq!(policy.cadence_scale(), 2.0);
    }
    sample.sequence = 7;
    policy.observe(sample);
    assert_eq!(policy.cadence_scale(), 1.0);
    policy.admit("new", cost).unwrap();
}

#[test]
fn resize_is_atomic_and_stopping_releases_cost_without_killing_siblings() {
    let mut policy = Policy::default();
    policy.observe(machine(192));
    let small = Cost::new(640 * 480, 100 * 100).unwrap();
    policy.admit("first", small).unwrap();
    policy.admit("second", small).unwrap();
    assert!(policy
        .admit("first", Cost::new(3840 * 2160, 3840 * 2160).unwrap())
        .is_err());
    assert_eq!(policy.costs["first"].gpu, small.gpu);
    policy.remove("first");
    policy.admit("replacement", small).unwrap();
    assert!(policy.costs.contains_key("second"));
}

#[test]
fn invalid_dimensions_telemetry_and_old_samples_do_not_open_capacity() {
    assert!(Cost::new(u64::MAX, 1).is_err());
    assert!(Cost::new(1, 2).is_err());
    assert!(Cost::new(1, 0).is_err());
    let mut policy = Policy::default();
    let cost = Cost::new(1, 1).unwrap();
    assert_eq!(
        policy.admit("none", cost),
        Err("live_resource_telemetry_unavailable")
    );
    let mut sample = machine(4096);
    sample.sequence = 5;
    sample.system_cpu = Some(0.99);
    policy.observe(sample);
    policy.observe(machine(4096));
    assert!(policy.status().under_pressure);
}

#[test]
fn missing_gpu_counter_uses_a_conservative_byte_budget_not_an_unlimited_cap() {
    let mut sample = machine(4096);
    sample.gpu_budget = None;
    sample.gpu_usage = None;
    let cost = Cost {
        memory: 8 * MIB,
        gpu: 60 * MIB,
    };
    assert_eq!(count_on(sample, cost), 4);
    assert!(
        count_on(
            sample,
            Cost {
                memory: 8 * MIB,
                gpu: 20 * MIB
            }
        ) > 4
    );
}

#[test]
fn stopping_a_sibling_does_not_uncharge_other_pending_starts() {
    let mut policy = Policy::default();
    let mut sample = machine(4096);
    sample.available_memory = sample.total_memory / 10 + 140 * MIB;
    policy.observe(sample);
    let cost = Cost {
        memory: 64 * MIB,
        gpu: 16 * MIB,
    };
    policy.admit("a", cost).unwrap();
    policy.admit("b", cost).unwrap();
    policy.remove("a");
    assert_eq!(
        policy.admit("c", cost),
        Err("live_resource_memory_pressure")
    );
    sample.sequence = 3;
    policy.observe(sample);
    policy.admit("c", cost).unwrap();
}
