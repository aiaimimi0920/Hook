// Converts re-resolved UIA samples into ordered observing, stable, stale, and error events.
#[cfg(target_os = "windows")]
const LIVE_UIA_STABLE_HEARTBEAT_MS: u64 = 1_000;

#[cfg(target_os = "windows")]
fn apply_live_uia_scan(
    relay: &LiveRelaySession,
    client: &reqwest::blocking::Client,
    tracks: &mut std::collections::BTreeMap<String, UiaObservationTrack>,
    scan: UiaObservationScan,
) -> Result<(), String> {
    let now = live_capture_now_ms();
    let publish_deadline = Instant::now() + Duration::from_secs(8);
    let mut seen = std::collections::BTreeSet::new();
    for sample in scan.samples {
        seen.insert(sample.observation_id.clone());
        let candidate = next_live_uia_observation(tracks.get(&sample.observation_id), &sample, now);
        if let Some(observation) = candidate {
            publish_live_uia_within_deadline(relay, client, &observation, publish_deadline)?;
            tracks.insert(
                observation.observation_id.clone(),
                live_uia_track(&observation, sample.fingerprint),
            );
            store_live_relay_observation(relay, observation)?;
        } else if let Some(track) = tracks.get_mut(&sample.observation_id) {
            track.locator = sample.locator;
        }
    }
    let missing = tracks
        .keys()
        .filter(|observation_id| !seen.contains(*observation_id))
        .cloned()
        .collect::<Vec<_>>();
    for observation_id in missing {
        let Some(track) = tracks.get(&observation_id) else {
            continue;
        };
        if track.state == LiveRelayObservationState::Stale {
            continue;
        }
        let observation = LiveRelayObservation {
            observation_id: observation_id.clone(),
            sequence: track.sequence.saturating_add(1),
            state: LiveRelayObservationState::Stale,
            source: LiveRelayObservationSource::UiAutomation,
            confidence: LiveRelayObservationConfidence::Exact,
            observed_at_ms: now,
            stable_since_ms: None,
            locator: Some(track.locator.clone()),
            value: None,
            reason: Some("element_not_found".to_owned()),
        };
        publish_live_uia_within_deadline(relay, client, &observation, publish_deadline)?;
        tracks.insert(observation_id, live_uia_track(&observation, None));
        store_live_relay_observation(relay, observation)?;
    }
    refresh_live_observation_summary(relay)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn next_live_uia_observation(
    previous: Option<&UiaObservationTrack>,
    sample: &UiaObservationSample,
    now: u64,
) -> Option<LiveRelayObservation> {
    let sequence = previous.map_or(1, |track| track.sequence.saturating_add(1));
    match &sample.value {
        Err(reason) => {
            if previous.is_some_and(|track| {
                track.state == LiveRelayObservationState::Error
                    && track.reason.as_deref() == Some(reason.as_str())
            }) {
                return None;
            }
            Some(LiveRelayObservation {
                observation_id: sample.observation_id.clone(),
                sequence,
                state: LiveRelayObservationState::Error,
                source: LiveRelayObservationSource::UiAutomation,
                confidence: LiveRelayObservationConfidence::Exact,
                observed_at_ms: now,
                stable_since_ms: None,
                locator: Some(sample.locator.clone()),
                value: None,
                reason: Some(reason.clone()),
            })
        }
        Ok(value) => {
            let same = previous
                .is_some_and(|track| track.fingerprint.as_ref() == sample.fingerprint.as_ref());
            if same
                && previous.is_some_and(|track| {
                    track.state == LiveRelayObservationState::Stable
                        && now.saturating_sub(track.observed_at_ms) < LIVE_UIA_STABLE_HEARTBEAT_MS
                })
            {
                return None;
            }
            let (state, stable_since_ms) = if same {
                (
                    LiveRelayObservationState::Stable,
                    previous
                        .and_then(|track| track.stable_since_ms)
                        .or(Some(now)),
                )
            } else {
                (LiveRelayObservationState::Observing, None)
            };
            Some(LiveRelayObservation {
                observation_id: sample.observation_id.clone(),
                sequence,
                state,
                source: LiveRelayObservationSource::UiAutomation,
                confidence: LiveRelayObservationConfidence::Exact,
                observed_at_ms: now,
                stable_since_ms,
                locator: Some(sample.locator.clone()),
                value: Some(value.clone()),
                reason: None,
            })
        }
    }
}

#[cfg(target_os = "windows")]
fn live_uia_track(
    observation: &LiveRelayObservation,
    fingerprint: Option<String>,
) -> UiaObservationTrack {
    UiaObservationTrack {
        sequence: observation.sequence,
        state: observation.state,
        fingerprint,
        observed_at_ms: observation.observed_at_ms,
        stable_since_ms: observation.stable_since_ms,
        locator: observation
            .locator
            .clone()
            .expect("UIA observations always have locators"),
        reason: observation.reason.clone(),
    }
}

#[cfg(target_os = "windows")]
fn mark_live_uia_scan_error(
    relay: &LiveRelaySession,
    client: &reqwest::blocking::Client,
    tracks: &mut std::collections::BTreeMap<String, UiaObservationTrack>,
) -> Result<(), String> {
    let now = live_capture_now_ms();
    let publish_deadline = Instant::now() + Duration::from_secs(8);
    let observation_ids = tracks.keys().cloned().collect::<Vec<_>>();
    for observation_id in observation_ids {
        let Some(track) = tracks.get(&observation_id) else {
            continue;
        };
        if track.state == LiveRelayObservationState::Error
            && track.reason.as_deref() == Some("uia_scan_failed")
        {
            continue;
        }
        let observation = LiveRelayObservation {
            observation_id: observation_id.clone(),
            sequence: track.sequence.saturating_add(1),
            state: LiveRelayObservationState::Error,
            source: LiveRelayObservationSource::UiAutomation,
            confidence: LiveRelayObservationConfidence::Exact,
            observed_at_ms: now,
            stable_since_ms: None,
            locator: Some(track.locator.clone()),
            value: None,
            reason: Some("uia_scan_failed".to_owned()),
        };
        publish_live_uia_within_deadline(relay, client, &observation, publish_deadline)?;
        tracks.insert(observation_id, live_uia_track(&observation, None));
        store_live_relay_observation(relay, observation)?;
    }
    mark_live_observation_failure(relay, "uia_scan_failed");
    Ok(())
}

#[cfg(target_os = "windows")]
fn publish_live_uia_within_deadline(
    relay: &LiveRelaySession,
    client: &reqwest::blocking::Client,
    observation: &LiveRelayObservation,
    deadline: Instant,
) -> Result<(), String> {
    if Instant::now() >= deadline {
        return Err("live observation scan publish deadline exceeded".to_owned());
    }
    publish_live_relay_observation_blocking(relay, client, observation)
}

fn store_live_relay_observation(
    relay: &LiveRelaySession,
    observation: LiveRelayObservation,
) -> Result<(), String> {
    observation.validate()?;
    let mut state = relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned".to_owned())?;
    if !state.observations.contains_key(&observation.observation_id)
        && state.observations.len() >= LIVE_OBSERVATION_LIMIT
    {
        return Err("live observation limit reached".to_owned());
    }
    state
        .observations
        .insert(observation.observation_id.clone(), observation);
    Ok(())
}

fn refresh_live_observation_summary(relay: &LiveRelaySession) -> Result<(), String> {
    let mut state = relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned".to_owned())?;
    if state.observation_capabilities.is_empty() {
        state.observation_state = "unsupported".to_owned();
        return Ok(());
    }
    let (status, reason) = if let Some(value) = state
        .observations
        .values()
        .find(|value| value.state == LiveRelayObservationState::Error)
    {
        ("error", value.reason.clone())
    } else if state.observations.values().any(|value| {
        matches!(
            value.state,
            LiveRelayObservationState::Detected | LiveRelayObservationState::Observing
        )
    }) {
        ("observing", None)
    } else if state.observations.values().any(|value| {
        matches!(
            value.state,
            LiveRelayObservationState::Stable | LiveRelayObservationState::Triggered
        )
    }) {
        ("stable", None)
    } else if !state.observations.is_empty() {
        ("stale", Some("element_not_found".to_owned()))
    } else {
        ("observing", None)
    };
    state.observation_state = status.to_owned();
    state.observation_reason = reason;
    Ok(())
}

fn mark_live_observation_failure(relay: &LiveRelaySession, reason: &str) {
    if let Ok(mut state) = relay.state.lock() {
        state.observation_state = "error".to_owned();
        state.observation_reason = Some(reason.chars().take(512).collect());
    }
}

#[cfg(test)]
mod live_observation_state_tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn stable_requires_two_identical_trusted_samples() {
        let sample = UiaObservationSample {
            observation_id: "uia:test".to_owned(),
            locator: LiveRelayElementLocator {
                automation_id: Some("progress".to_owned()),
                name: None,
                control_type: "ProgressBar".to_owned(),
                ancestor_path: Vec::new(),
                runtime_id: Some(vec![1, 2]),
            },
            value: Ok(serde_json::json!({ "rangeValue": { "value": 10.0 } })),
            fingerprint: Some("10".to_owned()),
        };
        let first = next_live_uia_observation(None, &sample, 10).expect("first sample");
        assert_eq!(first.state, LiveRelayObservationState::Observing);
        let track = live_uia_track(&first, sample.fingerprint.clone());
        let second = next_live_uia_observation(Some(&track), &sample, 20)
            .expect("second sample becomes stable");
        assert_eq!(second.state, LiveRelayObservationState::Stable);
        assert_eq!(second.stable_since_ms, Some(20));

        let stable_track = live_uia_track(&second, sample.fingerprint.clone());
        assert!(next_live_uia_observation(
            Some(&stable_track),
            &sample,
            20 + LIVE_UIA_STABLE_HEARTBEAT_MS - 1,
        )
        .is_none());
        let heartbeat = next_live_uia_observation(
            Some(&stable_track),
            &sample,
            20 + LIVE_UIA_STABLE_HEARTBEAT_MS,
        )
        .expect("stable values emit a bounded heartbeat");
        assert_eq!(heartbeat.sequence, 3);
        assert_eq!(heartbeat.stable_since_ms, Some(20));
    }
}
