use super::*;

fn fixture(count: usize, pixels: u64) -> (Budget, Instant) {
    let now = Instant::now();
    let mut budget = Budget::default();
    for i in 0..count {
        budget.demands.insert(
            i.to_string(),
            Demand {
                fps: 60,
                source_pixels: pixels,
                output_pixels: pixels,
                shared_source: None,
                visible: true,
                ticket: None,
                requested_at: now,
            },
        );
    }
    (budget, now)
}

#[test]
fn source_budget_accounts_for_full_window_pixels_and_all_consumers() {
    let (mut budget, _) = fixture(4, 1920 * 1080);
    assert!((budget.interval("0").as_secs_f64() - 1.0 / 15.0).abs() < 0.000001);
    for i in 1..4 {
        budget.demands.remove(&i.to_string());
    }
    assert!((budget.interval("0").as_secs_f64() - 1.0 / 60.0).abs() < 0.000001);
    budget.demands.get_mut("0").unwrap().visible = false;
    assert_eq!(budget.interval("0"), Duration::from_secs(1));
    let (small, _) = fixture(4, 100 * 100);
    assert!((small.interval("0").as_secs_f64() - 1.0 / 30.0).abs() < 0.000001);
}

#[test]
fn cpu_admission_is_serial_pixel_bounded_and_fair_under_fixed_poll_order() {
    let (mut budget, mut now) = fixture(4, 1920 * 1080);
    let mut winners = Vec::new();
    for _ in 0..12 {
        for i in 0..4 {
            if let Some(cost) = budget.admit(&i.to_string(), 1920 * 1080, now) {
                assert!(cost >= Duration::from_millis(86));
                winners.push(i);
            }
        }
        assert!(budget.cpu_busy);
        budget.cpu_busy = false;
        budget.cpu_due = Some(now + Duration::from_millis(87));
        assert!(budget.admit("0", 1, now).is_none());
        now += Duration::from_millis(87);
    }
    assert_eq!(winners, [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
}

#[test]
fn hidden_and_abandoned_requests_cannot_starve_visible_consumers() {
    let (mut budget, now) = fixture(2, 100);
    budget.cpu_busy = true;
    assert!(budget.admit("0", 100, now).is_none());
    budget.cpu_busy = false;
    assert!(budget
        .admit("1", 100, now + REQUEST_LEASE + Duration::from_millis(1))
        .is_some());
    budget.cpu_busy = false;
    budget.demands.get_mut("0").unwrap().visible = false;
    assert!(budget
        .admit("0", 100, now + Duration::from_secs(1))
        .is_none());
    assert!(budget.demands["0"].ticket.is_none());
}

#[test]
fn permit_covers_encode_and_releases_with_cooldown_even_on_error() {
    let (budget, _) = fixture(1, 100);
    let shared = Arc::new(Mutex::new(budget));
    let owner = CaptureBudget {
        id: "0".into(),
        shared: shared.clone(),
    };
    let permit = owner.try_cpu(10, 10).unwrap();
    assert!(owner.try_cpu(10, 10).is_none());
    drop(permit);
    assert!(!shared.lock().unwrap().cpu_busy);
    assert!(owner.try_cpu(10, 10).is_none());
    drop(owner);
    assert!(shared.lock().unwrap().demands.is_empty());
}

#[test]
fn six_shared_crops_charge_acquisition_once_but_each_output_separately() {
    let (mut budget, _) = fixture(6, 1920 * 1080);
    for demand in budget.demands.values_mut() {
        demand.shared_source = Some("window:1:1920:1080".into());
        demand.output_pixels = 100 * 100;
    }
    assert_eq!(budget.work(), (60.0, 124_416_000.0, 3_600_000.0));
    assert!((budget.interval("0").as_secs_f64() - 1.0 / 60.0).abs() < 0.000001);
    for demand in budget.demands.values_mut() {
        demand.output_pixels = 1920 * 1080;
    }
    assert!((budget.interval("0").as_secs_f64() - 0.1).abs() < 0.000001);
}

#[test]
fn shared_source_uses_fastest_visible_rate_and_keeps_cpu_consumers_independent() {
    let (mut budget, now) = fixture(2, 100);
    for demand in budget.demands.values_mut() {
        demand.shared_source = Some("window".into());
    }
    budget.demands.get_mut("0").unwrap().fps = 30;
    assert_eq!(budget.work(), (60.0, 6000.0, 9000.0));
    assert!(budget.admit("0", 100, now).is_some());
    assert!(budget.admit("1", 100, now).is_none());
    budget.cpu_busy = false;
    assert!(budget.admit("1", 100, now).is_some());
    budget.demands.get_mut("1").unwrap().visible = false;
    assert_eq!(budget.work(), (30.0, 3000.0, 3100.0));
    budget.demands.remove("0");
    assert_eq!(budget.work(), (1.0, 100.0, 100.0));
    budget.demands.clear();
    assert_eq!(budget.work(), (0.0, 0.0, 0.0));
}

#[test]
fn rebinding_source_releases_old_group_and_private_ids_never_alias_shared_ids() {
    let (budget, _) = fixture(2, 100);
    let shared = Arc::new(Mutex::new(budget));
    let owners: Vec<_> = (0..2)
        .map(|i| CaptureBudget {
            id: i.to_string(),
            shared: shared.clone(),
        })
        .collect();
    owners[0].source_size(10, 10, 100, Some("1".into()));
    assert_eq!(shared.lock().unwrap().work().0, 120.0);
    owners[1].source_size(10, 10, 100, Some("1".into()));
    assert_eq!(shared.lock().unwrap().work().0, 60.0);
    owners[1].source_size(20, 10, 50, Some("resized".into()));
    assert_eq!(shared.lock().unwrap().work(), (120.0, 18000.0, 9000.0));
    drop(owners);
    assert_eq!(shared.lock().unwrap().work(), (0.0, 0.0, 0.0));
}
