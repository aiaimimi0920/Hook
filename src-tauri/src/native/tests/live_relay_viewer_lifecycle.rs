// 用有界 HTTP 夹具验证真实 control worker，不把连接失败冒充关闭。
fn viewer_relay(base_url: String) -> Arc<LiveRelaySession> {
    Arc::new(LiveRelaySession {
        relay_id: "relay:test".to_owned(),
        live_session_id: "live:test".to_owned(),
        role: LiveRelayRole::Viewer,
        base_url,
        surface_instance_id: Some("instance:test".to_owned()),
        attachment_id: Some("attachment:test".to_owned()),
        authorization: crate::device_session::DeviceSessionAuthorization::none_for_test(
            "viewer:test",
        ),
        publication: None,
        recovery_busy: AtomicBool::new(false),
        event_cursor: std::sync::atomic::AtomicU64::new(0),
        capture: None,
        state: Arc::new(Mutex::new(LiveRelayRuntimeState::starting(
            1,
            Vec::new(),
            None,
        ))),
        frames: Arc::new(Mutex::new(LiveRelayFrameBuffer::new())),
        stop: Arc::new(AtomicBool::new(false)),
        reconnect: Arc::new(AtomicBool::new(false)),
        join: Mutex::new(None),
        control_join: Mutex::new(None),
        observation_join: Mutex::new(None),
        control_sequence: Mutex::new(1),
        input_sequence: Mutex::new(0),
    })
}

mod live_relay_command_owner_tests {
    use super::*;

    fn source_relay() -> Arc<LiveRelaySession> {
        let mut relay = viewer_relay("http://127.0.0.1:1".to_owned());
        Arc::get_mut(&mut relay).unwrap().role = LiveRelayRole::Source;
        mark_live_relay_connected(&relay);
        relay
    }

    #[test]
    fn active_command_preserves_identity_and_nonterminal_recovery() {
        let relay = source_relay();
        *relay.input_sequence.lock().unwrap() = 7;
        for recovering in [false, true] {
            if recovering {
                mark_live_relay_recovering(&relay, "network", "temporary");
            }
            let snapshot = relay.command_snapshot().unwrap();
            assert_eq!(snapshot.relay_id, relay.relay_id);
            assert_eq!(snapshot.live_session_id, relay.live_session_id);
            assert_eq!(snapshot.epoch, 1);
            assert_eq!(snapshot.last_input_sequence, 7);
            assert_eq!(
                snapshot.connection_state,
                if recovering {
                    "recovering"
                } else {
                    "connected"
                }
            );
        }
    }

    #[test]
    fn retired_source_cannot_return_closed_as_a_successful_control_result() {
        let old = source_relay();
        let pending_command = Arc::clone(&old);
        old.stop_and_join().unwrap();
        let replacement = source_relay();
        assert_eq!(old.relay_id, replacement.relay_id);
        assert_eq!(
            old.snapshot().unwrap().epoch,
            replacement.snapshot().unwrap().epoch
        );
        // 恢复保留公开身份；旧 worker 的关闭可供状态读取，但不是新 owner 的控制结果。
        assert_eq!(
            pending_command.snapshot().unwrap().connection_state,
            "closed"
        );
        assert_eq!(
            replacement.command_snapshot().unwrap().connection_state,
            "connected"
        );
        assert_eq!(
            pending_command.command_snapshot().err().as_deref(),
            Some("live relay session is stopping")
        );
    }

    #[test]
    fn stopping_command_is_rejected_before_closed_state_is_published() {
        let relay = source_relay();
        relay.stop.store(true, Ordering::SeqCst);
        assert_eq!(relay.snapshot().unwrap().connection_state, "connected");
        assert_eq!(
            relay.command_snapshot().err().as_deref(),
            Some("live relay session is stopping")
        );
    }

    #[test]
    fn terminal_command_is_rejected_even_before_stop_flag_is_set() {
        let relay = source_relay();
        relay.state.lock().unwrap().mark_closed();
        assert!(!relay.stop.load(Ordering::SeqCst));
        assert_eq!(relay.snapshot().unwrap().connection_state, "closed");
        assert_eq!(
            relay.command_snapshot().err().as_deref(),
            Some("live relay session is stopping")
        );
    }
}

fn frame_bytes() -> Vec<u8> {
    encode_live_relay_binary_frame(
        &LiveRelayBinaryMetadata {
            epoch: 1,
            frame_id: 7,
            capture_timestamp_ms: 1,
            encode_timestamp_ms: 2,
            width: 1,
            height: 1,
            dropped_frames: 0,
            keyframe: true,
            color_space: "srgb",
            codec: "raw_bgra",
        },
        &[0; 4],
    )
    .unwrap()
}

#[test]
fn stopping_viewer_rejects_inflight_media_and_recovery() {
    let relay = viewer_relay("http://127.0.0.1:1".to_owned());
    relay.stop_and_join().unwrap();
    mark_live_relay_connected(&relay);
    mark_live_relay_recovering(&relay, "late_failure", "late");
    fail_live_relay_control(&relay, "late_poll", "late");
    assert_eq!(relay.snapshot().unwrap().connection_state, "closed");
    assert!(accept_live_relay_viewer_frame(&relay, &frame_bytes()).is_err());
    assert!(relay.frames.lock().unwrap().frames.is_empty());
    assert!(relay.snapshot().unwrap().error_code.is_none());
}

#[test]
fn late_join_anchors_to_its_ack_and_preserves_subsequent_events() {
    let mut events = parse_live_relay_events_response(joined_events(), 0).unwrap();
    let attached = viewer_snapshot(false);
    let mut cursor =
        live_viewer_join_cursor(&events, &attached, "live:test", "viewer:test").unwrap();
    assert_eq!(cursor, 300);
    let relay = viewer_relay("http://127.0.0.1:1".to_owned());
    events.events.retain(|event| event.sequence > cursor);
    events.reset = false;
    apply_live_relay_events(&relay, &events, &mut cursor).unwrap();
    assert_eq!(cursor, 302);
    assert!(!relay.snapshot().unwrap().controller_owned);
    assert!(relay.snapshot().unwrap().error_code.is_none());
}

fn viewer_observation(sequence: u64) -> serde_json::Value {
    serde_json::json!({
        "observationId": "uia:test", "sequence": sequence, "state": "stable",
        "source": "ui_automation", "confidence": "exact", "observedAtMs": 1,
        "locator": { "automationId": "target", "controlType": "Text", "ancestorPath": [] },
        "value": { "name": "Frame: 501" }
    })
}

#[test]
fn late_join_hydrates_observation_sequence_and_still_rejects_gaps() {
    let mut attached = viewer_snapshot(false);
    attached["observations"] = serde_json::json!([viewer_observation(501)]);
    let mut value = joined_events();
    value["events"][2]["messageType"] = serde_json::json!("observation");
    value["events"][2]["payload"] = viewer_observation(502);
    let mut events = parse_live_relay_events_response(value, 0).unwrap();
    let mut cursor =
        live_viewer_join_cursor(&events, &attached, "live:test", "viewer:test").unwrap();
    let relay = viewer_relay("http://127.0.0.1:1".to_owned());
    {
        let mut state = relay.state.lock().unwrap();
        state.observation_capabilities = vec!["uia_tree".to_owned()];
        state.observations = parse_live_viewer_observations(&attached).unwrap();
    }
    refresh_live_observation_summary(&relay).unwrap();
    assert_eq!(relay.snapshot().unwrap().observation_state, "stable");
    events.events.retain(|event| event.sequence > cursor);
    events.reset = false;
    apply_live_relay_events(&relay, &events, &mut cursor).unwrap();
    assert_eq!(relay.snapshot().unwrap().observations[0].sequence, 502);
    assert_eq!(cursor, 302);
    assert!(!relay.snapshot().unwrap().controller_owned);
    assert!(apply_live_relay_observation_event(&relay, &viewer_observation(504)).is_err());
    assert!(apply_live_relay_observation_event(&relay, &viewer_observation(502)).is_err());
    let mut unknown = viewer_observation(2);
    unknown["observationId"] = serde_json::json!("uia:new");
    assert!(apply_live_relay_observation_event(&relay, &unknown).is_err());
    apply_live_relay_observation_event(&relay, &viewer_observation(503)).unwrap();
    assert_eq!(relay.snapshot().unwrap().observations[0].sequence, 503);
}

#[test]
fn late_join_rejects_invalid_duplicate_or_oversized_observation_snapshots() {
    for mutation in 0..8 {
        let mut attached = viewer_snapshot(false);
        attached["observations"] = serde_json::json!([viewer_observation(501)]);
        match mutation {
            0 => {
                attached.as_object_mut().unwrap().remove("observations");
            }
            1 => attached["observations"] = serde_json::Value::Null,
            2 => attached["observations"] = serde_json::json!(vec![viewer_observation(501); 2]),
            3 => {
                attached["observations"] =
                    serde_json::json!(vec![viewer_observation(501); LIVE_OBSERVATION_LIMIT + 1])
            }
            4 => attached["observations"][0]["sequence"] = serde_json::json!(0),
            5 => attached["observations"][0]["state"] = serde_json::json!("stale"),
            6 => attached["observations"][0]["invented"] = serde_json::json!(true),
            _ => {
                attached["observations"][0]["value"] =
                    serde_json::json!("x".repeat(LIVE_OBSERVATION_VALUE_LIMIT + 1))
            }
        }
        assert!(
            parse_live_viewer_observations(&attached).is_err(),
            "mutation {mutation}"
        );
    }
    let mut attached = viewer_snapshot(false);
    attached["observations"] = serde_json::json!([]);
    assert!(parse_live_viewer_observations(&attached)
        .unwrap()
        .is_empty());
}

#[test]
fn late_join_rejects_missing_anchor_gaps_foreign_epochs_and_wrong_ack() {
    for mutation in 0..6 {
        let mut value = joined_events();
        let mut attached = viewer_snapshot(false);
        match mutation {
            0 => value["events"][1]["payload"]["reason"] = serde_json::json!("unrelated"),
            1 => value["events"][2]["sequence"] = serde_json::json!(304),
            2 => value["events"][2]["epoch"] = serde_json::json!(2),
            3 => value["events"][2]["sessionId"] = serde_json::json!("live:foreign"),
            4 => attached["session"]["revision"] = serde_json::json!(9),
            _ => value["next"] = serde_json::json!(303),
        }
        let events = parse_live_relay_events_response(value, 0).unwrap();
        assert!(
            live_viewer_join_cursor(&events, &attached, "live:test", "viewer:test").is_err(),
            "mutation {mutation}"
        );
    }
}

#[tokio::test]
async fn bootstrap_uses_real_http_without_replaying_prejoin_authority() {
    let fixture = ViewerHttpFixture::new(Some(joined_events()), viewer_snapshot(false));
    let relay = viewer_relay(fixture.url.clone());
    let request = LiveRelayJoinRequest {
        live_session_id: relay.live_session_id.clone(),
        surface_instance_id: "instance:test".to_owned(),
        attachment_id: "attachment:test".to_owned(),
    };
    assert_eq!(
        bootstrap_live_viewer_cursor(
            &fixture.url,
            &relay.authorization,
            &request,
            &viewer_snapshot(false)
        )
        .await
        .unwrap(),
        300
    );
    assert_eq!(fixture.paths.lock().unwrap().len(), 1);
    assert!(fixture.paths.lock().unwrap()[0].contains("after=0&timeoutMs=0"));
}

#[test]
fn control_worker_confirms_terminal_snapshot_and_clears_pixels() {
    let fixture = ViewerHttpFixture::new(None, viewer_snapshot(true));
    let relay = viewer_relay(fixture.url.clone());
    accept_live_relay_viewer_frame(&relay, &frame_bytes()).unwrap();
    let worker = spawn_live_relay_control_worker(Arc::clone(&relay)).unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    while !relay.stop.load(Ordering::SeqCst) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    let stopped = relay.stop.load(Ordering::SeqCst);
    let status = relay.snapshot().unwrap();
    let empty = relay.frames.lock().unwrap().frames.is_empty();
    relay.stop.store(true, Ordering::SeqCst);
    worker.join().unwrap();
    assert!(stopped, "worker did not detect authoritative closure");
    assert_eq!(status.connection_state, "closed");
    assert!(status.error_code.is_none());
    assert!(empty);
    assert!(fixture
        .paths
        .lock()
        .unwrap()
        .iter()
        .any(|path| !path.contains("/events?")));
    assert!(accept_live_relay_viewer_frame(&relay, &frame_bytes()).is_err());
}

#[test]
fn temporary_poll_failure_preserves_recovery_and_previous_pixels() {
    let fixture = ViewerHttpFixture::new(None, viewer_snapshot(false));
    let relay = viewer_relay(fixture.url.clone());
    accept_live_relay_viewer_frame(&relay, &frame_bytes()).unwrap();
    assert!(poll_live_relay_events_blocking(&relay, 0).is_err());
    assert!(!close_live_viewer_if_terminal(&relay).unwrap());
    mark_live_relay_recovering(&relay, "network", "temporary");
    assert!(!relay.stop.load(Ordering::SeqCst));
    assert_eq!(relay.snapshot().unwrap().connection_state, "recovering");
    assert!(!relay.frames.lock().unwrap().frames.is_empty());
    mark_live_relay_connected(&relay);
    assert_eq!(relay.snapshot().unwrap().connection_state, "connected");
}

#[test]
fn terminal_requires_explicit_closed_and_exact_member_identity() {
    for mutation in 0..6 {
        let mut value = viewer_snapshot(true);
        match mutation {
            0 => {
                value.as_object_mut().unwrap().remove("closed");
            }
            1 => value["session"]["protocolVersion"] = serde_json::json!("other"),
            2 => value["session"]["sessionId"] = serde_json::json!("live:other"),
            3 => value["epoch"] = serde_json::json!(0),
            4 => value["session"]["viewerDevices"] = serde_json::json!([]),
            _ => value["closed"] = serde_json::json!("true"),
        }
        assert!(
            live_viewer_snapshot_closed(&value, "live:test", 1, "viewer:test").is_err(),
            "mutation {mutation}"
        );
    }
}

#[cfg(feature = "remote-surface")]
mod live_viewer_authorization_tests {
    use super::*;

    fn rejected() -> serde_json::Value {
        serde_json::json!({"error":{"message":"device session is missing or expired"}})
    }

    fn assert_rejoin_required(relay: &LiveRelaySession) {
        let status = relay.snapshot().unwrap();
        assert!(relay.stop.load(Ordering::SeqCst));
        assert_eq!(status.connection_state, "closed");
        assert_eq!(
            status.error_code.as_deref(),
            Some("live_viewer_authorization_required")
        );
        assert!(!status.controller_owned && !status.remote_control_active);
        assert!(relay.frames.lock().unwrap().frames.is_empty());
        assert!(accept_live_relay_viewer_frame(relay, &frame_bytes()).is_err());
    }

    #[test]
    fn unauthorized_headers_close_viewer_before_unreadable_body() {
        for body in [
            format!("Content-Length: {}\r\n\r\n", LIVE_RELAY_MAX_JSON_BYTES + 1),
            "Content-Length: 100\r\n\r\n{".to_owned(),
            "Transfer-Encoding: chunked\r\n\r\ninvalid-chunk\r\n".to_owned(),
            "Content-Length: 1\r\n\r\n{".to_owned(),
        ] {
            let fixture = ViewerHttpFixture::with_response_override(
                None,
                rejected(),
                200,
                401,
                Some(format!(
                    "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n{body}"
                )),
            );
            let relay = device_viewer(fixture.url.clone());
            accept_live_relay_viewer_frame(&relay, &frame_bytes()).unwrap();
            assert!(resume_live_viewer_blocking(&relay)
                .unwrap_err()
                .contains("HTTP 401:"));
            assert_rejoin_required(&relay);
            assert_eq!(fixture.paths.lock().unwrap().len(), 1);
        }
    }

    #[test]
    fn unauthorized_resume_closes_old_viewer_without_advancing_cursors() {
        let fixture = ViewerHttpFixture::with_snapshot_status(None, rejected(), 401);
        let relay = device_viewer(fixture.url.clone());
        accept_live_relay_viewer_frame(&relay, &frame_bytes()).unwrap();
        relay.state.lock().unwrap().controller_owned = true;
        *relay.control_sequence.lock().unwrap() = 41;
        *relay.input_sequence.lock().unwrap() = 29;
        let error = resume_live_viewer_blocking(&relay).unwrap_err();
        assert!(error.contains("HTTP 401:"), "{error}");
        assert_rejoin_required(&relay);
        assert_eq!(*relay.control_sequence.lock().unwrap(), 41);
        assert_eq!(*relay.input_sequence.lock().unwrap(), 29);
        assert_eq!(fixture.paths.lock().unwrap().len(), 1);
    }

    #[test]
    fn unauthorized_event_or_terminal_snapshot_stops_control_worker_retries() {
        for deny_events in [true, false] {
            let fixture = if deny_events {
                ViewerHttpFixture::with_statuses(Some(rejected()), viewer_snapshot(false), 401, 200)
            } else {
                ViewerHttpFixture::with_snapshot_status(None, rejected(), 401)
            };
            let relay = device_viewer(fixture.url.clone());
            accept_live_relay_viewer_frame(&relay, &frame_bytes()).unwrap();
            *relay.control_join.lock().unwrap() =
                Some(spawn_live_relay_control_worker(Arc::clone(&relay)).unwrap());
            let stopped = wait_media(|| relay.stop.load(Ordering::SeqCst));
            // 跨过既有重试间隔，验证真实 worker 不再用已拒绝的固定凭据发请求。
            std::thread::sleep(Duration::from_millis(650));
            let requests = fixture.paths.lock().unwrap().len();
            relay.stop_and_join().unwrap();
            assert!(stopped, "unauthorized worker kept retrying: {requests}");
            assert_rejoin_required(&relay);
            assert_eq!(requests, if deny_events { 1 } else { 2 });
        }
    }

    #[test]
    fn other_http_failures_do_not_masquerade_as_viewer_auth_expiry() {
        for status in [400, 403, 404, 409, 500, 503] {
            let fixture = ViewerHttpFixture::with_snapshot_status(
                None,
                serde_json::json!({"error":{"message":"upstream text mentions HTTP 401:"}}),
                status,
            );
            let relay = device_viewer(fixture.url.clone());
            accept_live_relay_viewer_frame(&relay, &frame_bytes()).unwrap();
            assert!(resume_live_viewer_blocking(&relay).is_err());
            assert!(!relay.stop.load(Ordering::SeqCst), "HTTP {status}");
            assert!(!relay.frames.lock().unwrap().frames.is_empty());
            assert!(relay.snapshot().unwrap().error_code.is_none());
        }
    }

    #[test]
    fn source_and_nondevice_viewers_keep_existing_auth_recovery() {
        for source in [true, false] {
            let fixture = ViewerHttpFixture::with_statuses(
                Some(rejected()),
                viewer_snapshot(false),
                401,
                200,
            );
            let mut relay = if source {
                device_viewer(fixture.url.clone())
            } else {
                viewer_relay(fixture.url.clone())
            };
            if source {
                Arc::get_mut(&mut relay).unwrap().role = LiveRelayRole::Source;
            }
            assert!(poll_live_relay_events_blocking(&relay, 0).is_err());
            assert!(!relay.stop.load(Ordering::SeqCst));
            assert!(relay.snapshot().unwrap().error_code.is_none());
        }
    }

    #[test]
    fn late_unauthorized_response_preserves_stopped_or_revoked_terminal_state() {
        for code in [None, Some("live_media_device_revoked")] {
            let fixture = ViewerHttpFixture::with_snapshot_status(None, rejected(), 401);
            let relay = device_viewer(fixture.url.clone());
            relay.stop_and_join().unwrap();
            relay.state.lock().unwrap().error_code = code.map(str::to_owned);
            assert!(resume_live_viewer_blocking(&relay).is_err());
            mark_live_relay_recovering(&relay, "late_failure", "late");
            let status = relay.snapshot().unwrap();
            assert_eq!(status.connection_state, "closed");
            assert_eq!(status.error_code.as_deref(), code);
        }
    }

    #[test]
    fn terminal_snapshot_does_not_erase_an_already_closed_error() {
        let fixture = ViewerHttpFixture::new(None, viewer_snapshot(true));
        let relay = device_viewer(fixture.url.clone());
        accept_live_relay_viewer_frame(&relay, &frame_bytes()).unwrap();
        {
            let mut state = relay.state.lock().unwrap();
            state.mark_closed();
            state.error_code = Some("live_viewer_authorization_required".to_owned());
        }
        assert!(close_live_viewer_if_terminal(&relay).unwrap());
        assert_rejoin_required(&relay);
    }
}
