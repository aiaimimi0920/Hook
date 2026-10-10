// Recovery reads authenticated, actor-scoped cursors; it never guesses from a 409 message.
#[derive(Debug, PartialEq)]
struct LiveRequesterCursor {
    control: u64,
    input: u64,
}

impl LiveRequesterCursor {
    fn next_control(&self) -> Result<u64, String> {
        self.control
            .checked_add(1)
            .ok_or_else(|| "Loom live control sequence exhausted".to_owned())
    }
}

fn parse_live_requester_cursor(
    value: &serde_json::Value,
    session_id: &str,
    device_id: &str,
    epoch: u64,
) -> Result<LiveRequesterCursor, String> {
    if validate_live_session_snapshot(value, session_id)? != epoch {
        return Err("Loom live recovery epoch changed".to_owned());
    }
    let cursor = value
        .get("requesterControl")
        .ok_or("Loom does not support safe live cursor recovery; upgrade Loom")?;
    if cursor.get("deviceId").and_then(serde_json::Value::as_str) != Some(device_id)
        || cursor.get("epoch").and_then(serde_json::Value::as_u64) != Some(epoch)
    {
        return Err("Loom live recovery cursor identity does not match".to_owned());
    }
    let read = |key| {
        cursor
            .get(key)
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| format!("Loom live recovery cursor has invalid {key}"))
    };
    let input = read("inputSequence")?;
    if input >= LIVE_INPUT_MAX_SAFE_SEQUENCE {
        return Err("Loom live recovery input sequence exhausted".to_owned());
    }
    Ok(LiveRequesterCursor {
        control: read("controlSequence")?,
        input,
    })
}

fn recovery_source_observations(
    snapshot: &serde_json::Value,
) -> Result<std::collections::BTreeMap<String, LiveRelayObservation>, String> {
    let mut observations = parse_live_viewer_observations(snapshot)?;
    for observation in observations.values_mut() {
        // 共享快照也必须失去旧稳定性和值；首次重发失败时仍不得暴露旧触发依据。
        observation.state = LiveRelayObservationState::Observing;
        observation.stable_since_ms = None;
        observation.value = None;
        observation.reason = None;
    }
    Ok(observations)
}

async fn get_live_member_snapshot_http(
    base_url: &str,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    session_id: &str,
) -> Result<serde_json::Value, String> {
    let client = crate::network_proxy::shared_client(base_url, Some(Duration::from_secs(10)))
        .map_err(|error| format!("build Loom live recovery client: {error}"))?;
    let url = live_relay_session_url(base_url, session_id, None)?;
    send_live_relay_json(
        authorization.apply(client.get(url)),
        "read Loom live member recovery snapshot",
    )
    .await
}

async fn live_viewer_join_baseline(
    base_url: &str,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    session_id: &str,
    preview: &serde_json::Value,
    epoch: u64,
) -> Result<LiveRequesterCursor, String> {
    let viewers = preview
        .pointer("/session/viewerDevices")
        .and_then(serde_json::Value::as_array)
        .ok_or("Loom live discovery has no viewer membership")?;
    if !viewers
        .iter()
        .any(|id| id.as_str() == Some(&authorization.device_id))
    {
        return Ok(LiveRequesterCursor {
            control: 0,
            input: 0,
        });
    }
    let snapshot = get_live_member_snapshot_http(base_url, authorization, session_id).await?;
    parse_live_requester_cursor(&snapshot, session_id, &authorization.device_id, epoch)
}

#[cfg(target_os = "windows")]
fn seed_live_uia_tracks(
    observations: &std::collections::BTreeMap<String, LiveRelayObservation>,
) -> Result<std::collections::BTreeMap<String, UiaObservationTrack>, String> {
    let mut tracks = std::collections::BTreeMap::new();
    for (id, observation) in observations {
        if observation.locator.is_none() {
            return Err("Loom UIA recovery observation has no locator".to_owned());
        }
        let mut track = live_uia_track(observation, None);
        // Preserve ordering, not old stability or authority. A fresh scan must establish both samples.
        track.state = LiveRelayObservationState::Observing;
        track.stable_since_ms = None;
        track.reason = None;
        tracks.insert(id.clone(), track);
    }
    Ok(tracks)
}
