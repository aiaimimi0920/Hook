#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhaseSixControlEvidence {
    observation_id: String,
    automation_id: Option<String>,
    name: Option<String>,
    control_type: String,
    ancestor_path: Vec<String>,
    patterns: Vec<String>,
    state: String,
    sequence: u64,
    has_exact_value: bool,
    anchored: bool,
    reason: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct PhaseSixObservationEvidence {
    enabled: bool,
    capabilities: Vec<String>,
    total: usize,
    stable: usize,
    exact_values: usize,
    anchored: usize,
    errors: usize,
    control_types: Vec<String>,
    controls: Vec<PhaseSixControlEvidence>,
    logical_hide_correct: bool,
    hidden_update_observed: bool,
    hidden_observation_count: usize,
    hidden_error_count: usize,
    hidden_unexpected_error_count: usize,
    hidden_errors: Vec<String>,
    locator_continuity: bool,
    worker_stopped_cleanly: bool,
}

#[derive(Default)]
struct PhaseSixSourceContinuity {
    before: std::collections::BTreeMap<String, u64>,
    hidden_at: Option<Instant>,
    restored_at: Option<Instant>,
    logical_hide_correct: bool,
    hidden_update_observed: bool,
    hidden_observation_count: usize,
    hidden_error_count: usize,
    hidden_unexpected_error_count: usize,
    hidden_errors: Vec<String>,
    locator_continuity: bool,
}

fn phase_six_observation_evidence(
    enabled: bool,
    snapshot: &LiveRelaySnapshot,
) -> PhaseSixObservationEvidence {
    if !enabled {
        return PhaseSixObservationEvidence::default();
    }
    let mut controls = snapshot
        .observations
        .iter()
        .map(|observation| {
            let value = observation
                .value
                .as_ref()
                .and_then(serde_json::Value::as_object);
            let patterns = value
                .and_then(|value| value.get("patterns"))
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(serde_json::Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>();
            let anchored = value
                .and_then(|value| value.get("anchor"))
                .and_then(|anchor| anchor.get("normalizedBounds"))
                .is_some();
            let locator = observation.locator.as_ref();
            PhaseSixControlEvidence {
                observation_id: observation.observation_id.clone(),
                automation_id: locator.and_then(|locator| locator.automation_id.clone()),
                name: locator.and_then(|locator| locator.name.clone()),
                control_type: locator
                    .map(|locator| locator.control_type.clone())
                    .unwrap_or_else(|| "Unknown".to_owned()),
                ancestor_path: locator
                    .map(|locator| locator.ancestor_path.clone())
                    .unwrap_or_default(),
                patterns,
                state: format!("{:?}", observation.state).to_ascii_lowercase(),
                sequence: observation.sequence,
                has_exact_value: observation.confidence == LiveRelayObservationConfidence::Exact
                    && observation.value.is_some(),
                anchored,
                reason: observation.reason.clone(),
            }
        })
        .collect::<Vec<_>>();
    controls.sort_by(|left, right| left.observation_id.cmp(&right.observation_id));
    let mut control_types = controls
        .iter()
        .map(|control| control.control_type.clone())
        .collect::<Vec<_>>();
    control_types.sort();
    control_types.dedup();
    PhaseSixObservationEvidence {
        enabled,
        capabilities: snapshot.observation_capabilities.clone(),
        total: controls.len(),
        stable: snapshot
            .observations
            .iter()
            .filter(|value| value.state == LiveRelayObservationState::Stable)
            .count(),
        exact_values: controls
            .iter()
            .filter(|value| value.has_exact_value)
            .count(),
        anchored: controls.iter().filter(|value| value.anchored).count(),
        errors: snapshot
            .observations
            .iter()
            .filter(|value| {
                matches!(
                    value.state,
                    LiveRelayObservationState::Stale | LiveRelayObservationState::Error
                )
            })
            .count(),
        control_types,
        controls,
        logical_hide_correct: false,
        hidden_update_observed: false,
        hidden_observation_count: 0,
        hidden_error_count: 0,
        hidden_unexpected_error_count: 0,
        hidden_errors: Vec::new(),
        locator_continuity: false,
        worker_stopped_cleanly: false,
    }
}

fn phase_six_source_tick(
    relay: &LiveRelaySession,
    elapsed: Duration,
    continuity: &mut PhaseSixSourceContinuity,
) -> Result<(), String> {
    let now = Instant::now();
    if continuity.hidden_at.is_none() && elapsed >= Duration::from_secs(3) {
        let snapshot = relay.snapshot()?;
        if snapshot.observations.len() < 4 {
            return Ok(());
        }
        continuity.before = snapshot
            .observations
            .iter()
            .map(|value| (value.observation_id.clone(), value.sequence))
            .collect();
        set_phase_six_source_hidden(relay, true)?;
        continuity.hidden_at = Some(now);
        return Ok(());
    }
    if continuity.restored_at.is_none()
        && continuity
            .hidden_at
            .is_some_and(|started| now.duration_since(started) >= Duration::from_secs(4))
    {
        let hidden_for = now.duration_since(continuity.hidden_at.expect("hidden timestamp"));
        let snapshot = relay.snapshot()?;
        let updated = snapshot.observations.iter().any(|value| {
            continuity
                .before
                .get(&value.observation_id)
                .is_some_and(|sequence| value.sequence > *sequence)
        });
        let error_count = snapshot
            .observations
            .iter()
            .filter(|value| {
                matches!(
                    value.state,
                    LiveRelayObservationState::Stale | LiveRelayObservationState::Error
                )
            })
            .count();
        let unexpected_error_count = snapshot
            .observations
            .iter()
            .filter(|value| {
                matches!(
                    value.state,
                    LiveRelayObservationState::Stale | LiveRelayObservationState::Error
                ) && !phase_six_expected_hidden_chrome_stale(value)
            })
            .count();
        continuity.hidden_update_observed |= updated;
        continuity.hidden_observation_count = snapshot.observations.len();
        continuity.hidden_error_count = error_count;
        continuity.hidden_unexpected_error_count = unexpected_error_count;
        continuity.hidden_errors = snapshot
            .observations
            .iter()
            .filter(|value| {
                matches!(
                    value.state,
                    LiveRelayObservationState::Stale | LiveRelayObservationState::Error
                )
            })
            .map(|value| {
                let locator = value.locator.as_ref();
                format!(
                    "{}:{}:{}:{}",
                    value.observation_id,
                    locator
                        .and_then(|locator| locator.automation_id.as_deref())
                        .unwrap_or("-"),
                    locator
                        .map(|locator| locator.control_type.as_str())
                        .unwrap_or("-"),
                    value.reason.as_deref().unwrap_or("-")
                )
            })
            .collect();
        let healthy = updated && snapshot.observations.len() >= 4 && unexpected_error_count == 0;
        if !healthy && hidden_for < Duration::from_secs(7) {
            return Ok(());
        }
        continuity.logical_hide_correct = healthy;
        set_phase_six_source_hidden(relay, false)?;
        continuity.restored_at = Some(now);
        return Ok(());
    }
    if !continuity.locator_continuity
        && continuity
            .restored_at
            .is_some_and(|started| now.duration_since(started) >= Duration::from_secs(3))
    {
        let snapshot = relay.snapshot()?;
        let retained = snapshot
            .observations
            .iter()
            .filter(|value| continuity.before.contains_key(&value.observation_id))
            .count();
        let stable = snapshot
            .observations
            .iter()
            .filter(|value| value.state == LiveRelayObservationState::Stable)
            .count();
        continuity.locator_continuity = retained >= 4 && stable >= 3;
    }
    Ok(())
}

fn phase_six_expected_hidden_chrome_stale(value: &LiveRelayObservation) -> bool {
    value.state == LiveRelayObservationState::Stale
        && value.reason.as_deref() == Some("element_not_found")
        && value.locator.as_ref().is_some_and(|locator| {
            locator
                .ancestor_path
                .iter()
                .any(|ancestor| ancestor == "TitleBar")
        })
}

fn set_phase_six_source_hidden(relay: &LiveRelaySession, hidden: bool) -> Result<(), String> {
    relay
        .capture
        .as_ref()
        .and_then(|capture| capture.source_window.as_ref())
        .ok_or_else(|| "Phase 6 source lifecycle is unavailable".to_owned())?
        .lock()
        .map_err(|_| "Phase 6 source lifecycle lock poisoned".to_owned())?
        .set_logically_hidden(hidden, "phase6_observation_acceptance")
}

fn phase_six_enabled() -> bool {
    std::env::var("HOOK_LIVE_PHASE6").is_ok_and(|value| value == "1")
}
