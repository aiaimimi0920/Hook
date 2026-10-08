// viewer 的初始事件边界及终态；区分 Device 认证拒绝、权威关闭与断网/404。
fn parse_live_viewer_observations(
    attached: &serde_json::Value,
) -> Result<std::collections::BTreeMap<String, LiveRelayObservation>, String> {
    let values = attached
        .get("observations")
        .and_then(serde_json::Value::as_array)
        .ok_or("Loom viewer attachment has no observation snapshot")?;
    if values.len() > LIVE_OBSERVATION_LIMIT {
        return Err("Loom viewer observation snapshot exceeds the limit".to_owned());
    }
    let mut observations = std::collections::BTreeMap::new();
    for value in values {
        let observation: LiveRelayObservation = serde_json::from_value(value.clone())
            .map_err(|error| format!("parse Loom viewer observation snapshot: {error}"))?;
        observation.validate()?;
        if observations
            .insert(observation.observation_id.clone(), observation)
            .is_some()
        {
            return Err("Loom viewer observation snapshot repeats an id".to_owned());
        }
    }
    Ok(observations)
}

async fn bootstrap_live_viewer_cursor(
    base_url: &str,
    authorization: &crate::device_session::DeviceSessionAuthorization,
    request: &LiveRelayJoinRequest,
    attached: &serde_json::Value,
) -> Result<u64, String> {
    let client = crate::network_proxy::shared_client(base_url, Some(Duration::from_secs(3)))
        .map_err(|error| format!("build Loom live bootstrap client: {error}"))?;
    let mut url = live_relay_session_url(base_url, &request.live_session_id, Some("events"))?;
    url.query_pairs_mut()
        .append_pair("after", "0")
        .append_pair("timeoutMs", "0");
    let value = send_live_relay_json(
        authorization.apply(client.get(url)),
        "bootstrap Loom live viewer",
    )
    .await?;
    let events = parse_live_relay_events_response(value, 0)?;
    live_viewer_join_cursor(
        &events,
        attached,
        &request.live_session_id,
        &authorization.device_id,
    )
}

fn live_viewer_join_cursor(
    response: &LiveRelayEventsResponse,
    attached: &serde_json::Value,
    session_id: &str,
    device_id: &str,
) -> Result<u64, String> {
    let epoch = validate_live_session_snapshot(attached, session_id)?;
    let revision = attached
        .pointer("/session/revision")
        .and_then(serde_json::Value::as_u64)
        .filter(|revision| *revision > 0)
        .ok_or("Loom viewer attachment has no revision")?;
    // 只跳过本次加入以前的历史。加入事件已被淘汰或后续缺事件时拒绝，不能盲用 next。
    let start = response
        .events
        .iter()
        .position(|event| {
            event.protocol_version == LIVE_RELAY_PROTOCOL_VERSION
                && event.session_id == session_id
                && event.epoch == epoch
                && event.message_type == "session_state"
                && event
                    .payload
                    .get("revision")
                    .and_then(serde_json::Value::as_u64)
                    == Some(revision)
                && event
                    .payload
                    .get("reason")
                    .and_then(serde_json::Value::as_str)
                    == Some("viewer_joined")
                && event
                    .payload
                    .get("viewers")
                    .and_then(serde_json::Value::as_array)
                    .is_some_and(|viewers| {
                        viewers
                            .iter()
                            .any(|viewer| viewer.as_str() == Some(device_id))
                    })
        })
        .ok_or("Loom viewer join event is missing from control history")?;
    let cursor = response.events[start]
        .sequence
        .checked_sub(1)
        .ok_or("invalid viewer join sequence")?;
    let mut next = cursor;
    for event in &response.events[start..] {
        if event.protocol_version != LIVE_RELAY_PROTOCOL_VERSION
            || event.session_id != session_id
            || event.epoch != epoch
            || next.checked_add(1) != Some(event.sequence)
        {
            return Err("Loom viewer bootstrap history is incomplete".to_owned());
        }
        next = event.sequence;
    }
    if response.protocol_version != LIVE_RELAY_PROTOCOL_VERSION || next != response.next {
        return Err("Loom viewer bootstrap cursor is invalid".to_owned());
    }
    Ok(cursor)
}

fn send_live_relay_worker_json_blocking(
    relay: &LiveRelaySession,
    request: reqwest::blocking::RequestBuilder,
    context: &str,
) -> Result<serde_json::Value, String> {
    let (status, bytes) = read_live_relay_json_blocking(request, context)?;
    // 固定的 Device 凭据不能靠原地重试续签；HTTP 401 只终止旧观看，不代表设备已撤销。
    if status == 401
        && relay.role == LiveRelayRole::Viewer
        && relay.authorization.uses_device_session()
    {
        let mut state = relay
            .state
            .lock()
            .map_err(|_| "live relay state poisoned")?;
        if !relay.stop.load(Ordering::SeqCst) && state.connection_state != "closed" {
            relay.stop.store(true, Ordering::SeqCst);
            state.mark_closed();
            state.error_code = Some("live_viewer_authorization_required".to_owned());
            state.error_message = Some("观看凭据已失效，请关闭此观看后重新加入。".to_owned());
            // 与接帧共用 state → frames 锁序；不在 worker 内 join 自己。
            relay
                .frames
                .lock()
                .map_err(|_| "live relay frame buffer poisoned")?
                .clear();
        }
    }
    parse_live_relay_response(status, &bytes, context)
}

fn close_live_viewer_if_terminal(relay: &LiveRelaySession) -> Result<bool, String> {
    if relay.role != LiveRelayRole::Viewer || relay.stop.load(Ordering::SeqCst) {
        return Ok(false);
    }
    // events/resume 对 closed 会话返回 404；member snapshot 仍保留精确关闭事实。
    let client =
        crate::network_proxy::blocking_client(&relay.base_url, Some(Duration::from_secs(3)))
            .map_err(|error| format!("build Loom live terminal client: {error}"))?;
    let url = live_relay_session_url(&relay.base_url, &relay.live_session_id, None)?;
    let value = send_live_relay_worker_json_blocking(
        relay,
        relay.authorization.apply_blocking(client.get(url)),
        "read Loom live terminal state",
    )?;
    let mut state = relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned".to_owned())?;
    let already_closed = relay.stop.load(Ordering::SeqCst) || state.connection_state == "closed";
    if !already_closed
        && !live_viewer_snapshot_closed(
            &value,
            &relay.live_session_id,
            state.epoch,
            &relay.authorization.device_id,
        )?
    {
        return Ok(false);
    }
    // 不在 worker 内 join 自己；stop 让所有 worker 有界退出，显式关闭仍负责回收 JoinHandle。
    relay.stop.store(true, Ordering::SeqCst);
    state.mark_closed();
    // 迟到的 member 快照不能清除已确认的停止、认证拒绝或撤销原因。
    if !already_closed {
        state.error_code = None;
        state.error_message = None;
    }
    relay
        .frames
        .lock()
        .map_err(|_| "live relay frame buffer poisoned".to_owned())?
        .clear();
    Ok(true)
}

fn live_viewer_snapshot_closed(
    value: &serde_json::Value,
    session_id: &str,
    epoch: u64,
    device_id: &str,
) -> Result<bool, String> {
    if value
        .pointer("/session/protocolVersion")
        .and_then(serde_json::Value::as_str)
        != Some(LIVE_RELAY_PROTOCOL_VERSION)
        || value
            .pointer("/session/sessionId")
            .and_then(serde_json::Value::as_str)
            != Some(session_id)
        || !value
            .get("epoch")
            .and_then(serde_json::Value::as_u64)
            .is_some_and(|current| current >= epoch)
        || !value
            .pointer("/session/viewerDevices")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|viewers| {
                viewers
                    .iter()
                    .any(|viewer| viewer.as_str() == Some(device_id))
            })
    {
        return Err("Loom terminal snapshot identity is invalid".to_owned());
    }
    value
        .get("closed")
        .and_then(serde_json::Value::as_bool)
        .ok_or_else(|| "Loom terminal snapshot has no closed state".to_owned())
}
