// Source publication and viewer-side ordering for reliable loom.live.v1 observations.
fn publish_live_relay_observation_blocking(
    relay: &LiveRelaySession,
    client: &reqwest::blocking::Client,
    observation: &LiveRelayObservation,
) -> Result<(), String> {
    if relay.role != LiveRelayRole::Source {
        return Err("only a live relay source can publish observations".to_owned());
    }
    observation.validate()?;
    let epoch = relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned".to_owned())?
        .epoch;
    let mut sequence = relay
        .control_sequence
        .lock()
        .map_err(|_| "live relay control sequence poisoned".to_owned())?;
    let next = sequence.saturating_add(1);
    let body = serde_json::json!({
        "surfaceInstanceId": relay.surface_instance_id,
        "attachmentId": relay.attachment_id,
        "envelope": {
            "protocolVersion": LIVE_RELAY_PROTOCOL_VERSION,
            "sessionId": relay.live_session_id,
            "epoch": epoch,
            "sequence": next,
            "messageType": "observation",
            "payload": observation,
        }
    });
    let url = live_relay_session_url(
        &relay.base_url,
        &relay.live_session_id,
        Some("observations"),
    )?;
    let response = send_live_relay_json_blocking(
        relay
            .authorization
            .apply_blocking(client.post(url))
            .json(&body),
        "publish Loom live observation",
    )?;
    if response
        .get("protocolVersion")
        .and_then(serde_json::Value::as_str)
        != Some(LIVE_RELAY_PROTOCOL_VERSION)
        || response
            .get("acceptedSequence")
            .and_then(serde_json::Value::as_u64)
            != Some(next)
        || response
            .get("acceptedObservationSequence")
            .and_then(serde_json::Value::as_u64)
            != Some(observation.sequence)
    {
        return Err("Loom live observation acknowledgement is invalid".to_owned());
    }
    *sequence = next;
    Ok(())
}

fn live_relay_observation_client(
    relay: &LiveRelaySession,
) -> Result<reqwest::blocking::Client, String> {
    crate::network_proxy::blocking_client(&relay.base_url, Some(Duration::from_secs(3)))
        .map_err(|error| format!("build Loom live observation client: {error}"))
}

fn apply_live_relay_observation_event(
    relay: &LiveRelaySession,
    payload: &serde_json::Value,
) -> Result<(), String> {
    if relay.role != LiveRelayRole::Viewer {
        return Ok(());
    }
    let observation: LiveRelayObservation = serde_json::from_value(payload.clone())
        .map_err(|error| format!("parse Loom live observation: {error}"))?;
    observation.validate()?;
    {
        let state = relay
            .state
            .lock()
            .map_err(|_| "live relay state poisoned".to_owned())?;
        let expected = state
            .observations
            .get(&observation.observation_id)
            .map_or(1, |current| current.sequence.saturating_add(1));
        if observation.sequence != expected {
            return Err(format!(
                "live observation sequence must be exactly {expected}"
            ));
        }
    }
    store_live_relay_observation(relay, observation)?;
    refresh_live_observation_summary(relay)
}

#[cfg(test)]
mod live_relay_observation_tests {
    use super::*;

    #[test]
    fn viewer_observation_parser_rejects_unknown_fields() {
        let payload = serde_json::json!({
            "observationId": "uia:test",
            "sequence": 1,
            "state": "stale",
            "source": "ui_automation",
            "confidence": "exact",
            "observedAtMs": 1,
            "locator": {
                "automationId": "target",
                "controlType": "Button",
                "ancestorPath": [],
            },
            "reason": "element_not_found",
            "invented": true,
        });
        assert!(serde_json::from_value::<LiveRelayObservation>(payload).is_err());
    }
}
