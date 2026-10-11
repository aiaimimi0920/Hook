// Covers convergence identity, terminal status, and generation fences.
fn stream_ack(status: &str) -> serde_json::Value {
    serde_json::json!({
        "protocolVersion": "loom.surface.v1", "instanceId": "instance:one",
        "eventId": "event:one", "requestId": "request:one", "accepted": true, "status": status
    })
}
fn stream_state() -> SurfaceEventStreamState {
    SurfaceEventStreamState::new(
        "instance:one",
        "attachment:one",
        "event:one",
        2,
        3,
        &stream_ack("accepted"),
    )
    .unwrap()
}
fn stream_snapshot(attachment: &str, generation: u64, revision: u64) -> serde_json::Value {
    serde_json::json!({"method": "loom.surface.snapshot", "params": {
        "hookNodeId": "node:one", "generation": generation, "snapshot": {
            "instanceId": "instance:one", "attachmentId": attachment, "revision": revision
        }
    }})
}
fn ack_message(status: &str) -> serde_json::Value {
    serde_json::json!({"method": "loom.surface.action.ack", "params": stream_ack(status)})
}

#[test]
fn surface_device_stream_requires_matching_ack_and_snapshot() {
    let mut state = stream_state();
    state
        .accept_messages(&[
            stream_snapshot("attachment:other", 2, 4),
            ack_message("succeeded"),
        ])
        .unwrap();
    assert!(!state.ready());
    state
        .accept_messages(&[stream_snapshot("attachment:one", 2, 4)])
        .unwrap();
    assert!(state.ready());
    assert_eq!(state.snapshot.unwrap()["hookNodeId"], "node:one");
}

#[test]
fn surface_device_stream_does_not_complete_on_unrelated_revision_or_ack() {
    let mut state = stream_state();
    let mut ack = ack_message("succeeded");
    ack["params"]["eventId"] = serde_json::json!("event:other");
    state
        .accept_messages(&[stream_snapshot("attachment:one", 2, 4), ack])
        .unwrap();
    assert!(!state.ready());
}

#[test]
fn surface_device_stream_supports_noop_success_and_ignores_old_snapshots() {
    let mut state = stream_state();
    state
        .accept_messages(&[
            stream_snapshot("attachment:one", 2, 2),
            ack_message("succeeded"),
        ])
        .unwrap();
    assert!(!state.ready());
    state
        .accept_messages(&[stream_snapshot("attachment:one", 2, 3)])
        .unwrap();
    assert!(state.ready());
}

#[test]
fn surface_device_stream_failure_and_generation_change_fail_closed() {
    for status in ["failed", "cancelled", "interrupted"] {
        let mut state = stream_state();
        assert!(state
            .accept_messages(&[
                stream_snapshot("attachment:one", 2, 4),
                ack_message("succeeded"),
                ack_message(status)
            ])
            .is_err());
    }
    assert!(stream_state()
        .accept_messages(&[stream_snapshot("attachment:one", 3, 4)])
        .is_err());
}

#[test]
fn surface_device_stream_only_keeps_this_request_result() {
    let mut state = stream_state();
    let result = |request_id| {
        serde_json::json!({"method": "loom.surface.result", "params": {
            "hookNodeId": "node:one", "commit": {"instanceId": "instance:one", "generation": 2,
                "requestId": request_id, "outputs": {}}
        }})
    };
    state.accept_messages(&[result("request:other")]).unwrap();
    assert!(state.result.is_none());
    state.accept_messages(&[result("request:one")]).unwrap();
    assert!(state.result.is_some());
}

#[test]
fn surface_device_stream_rejects_initial_ack_identity_or_admission_mismatch() {
    for field in [
        "instanceId",
        "eventId",
        "protocolVersion",
        "requestId",
        "accepted",
    ] {
        let mut ack = stream_ack("accepted");
        ack[field] = serde_json::Value::Null;
        assert!(SurfaceEventStreamState::new(
            "instance:one",
            "attachment:one",
            "event:one",
            2,
            3,
            &ack
        )
        .is_err());
    }
}
