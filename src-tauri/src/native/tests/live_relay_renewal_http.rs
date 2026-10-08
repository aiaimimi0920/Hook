// Real bounded HTTP through the production client, not historical binaries or device pairing.
fn renewal_member_snapshot() -> serde_json::Value {
    let mut snapshot = viewer_snapshot(false);
    snapshot["requesterControl"] = serde_json::json!({
        "deviceId": "viewer:test", "epoch": 1, "controlSequence": 41, "inputSequence": 29
    });
    snapshot
}

fn assert_one_cursor_get(fixture: &ViewerHttpFixture) {
    assert_eq!(
        *fixture.paths.lock().unwrap(),
        ["GET /v1/live/sessions/live:test HTTP/1.1"]
    );
}

#[tokio::test]
async fn renewal_http_post_retirement_failure_remains_retryable_only_for_current_source() {
    for boundary in ["active", "removed", "replaced", "revoked"] {
        let fixture = ViewerHttpFixture::with_snapshot_status(None, serde_json::json!({}), 500);
        let mut old = viewer_relay(fixture.url.clone());
        Arc::get_mut(&mut old).unwrap().role = LiveRelayRole::Source;
        let relays = SharedLiveRelaySessions::new();
        relays.insert(Arc::clone(&old)).unwrap();
        old.recovery_busy.store(true, Ordering::SeqCst);
        old.stop_and_join().unwrap();
        let error =
            get_live_member_snapshot_http(&fixture.url, &old.authorization, &old.live_session_id)
                .await
                .unwrap_err();
        match boundary {
            "removed" => {
                relays.0.lock().unwrap().remove(&old.relay_id);
            }
            "replaced" => {
                relays
                    .0
                    .lock()
                    .unwrap()
                    .insert(old.relay_id.clone(), viewer_relay(fixture.url.clone()));
            }
            "revoked" => {
                old.state.lock().unwrap().error_code = Some("live_media_device_revoked".to_owned());
            }
            _ => {}
        }
        mark_live_source_recovery_failed(&relays, &old, "source_recovery_failed", &error);
        let snapshot = old.snapshot().unwrap();
        assert_eq!(
            snapshot.connection_state,
            if boundary == "active" {
                "recovering"
            } else {
                "closed"
            }
        );
        assert!(old.stop.load(Ordering::SeqCst));
        assert!(!snapshot.controller_owned && !snapshot.remote_control_active);
        if boundary == "revoked" {
            assert_eq!(
                snapshot.error_code.as_deref(),
                Some("live_media_device_revoked")
            );
        }
        assert_one_cursor_get(&fixture);
    }
}

#[tokio::test]
async fn renewal_http_first_join_keeps_legacy_sequence_without_requesting_cursor() {
    let fixture = ViewerHttpFixture::new(None, viewer_snapshot(false));
    let authorization =
        crate::device_session::DeviceSessionAuthorization::none_for_test("viewer:test");
    let mut discovery = viewer_snapshot(false);
    discovery["session"]["viewerDevices"] = serde_json::json!([]);
    let cursor =
        live_viewer_join_baseline(&fixture.url, &authorization, "live:test", &discovery, 1)
            .await
            .unwrap();
    assert_eq!(cursor.next_control().unwrap(), 1);
    assert_eq!(cursor.input, 0);
    assert!(fixture.paths.lock().unwrap().is_empty());
}

#[tokio::test]
async fn renewal_http_invalid_membership_is_not_treated_as_first_join() {
    let fixture = ViewerHttpFixture::new(None, renewal_member_snapshot());
    let authorization =
        crate::device_session::DeviceSessionAuthorization::none_for_test("viewer:test");
    let mut discovery = viewer_snapshot(false);
    discovery["session"]["viewerDevices"] = serde_json::Value::Null;
    let error = live_viewer_join_baseline(&fixture.url, &authorization, "live:test", &discovery, 1)
        .await
        .unwrap_err();
    assert_eq!(error, "Loom live discovery has no viewer membership");
    assert!(fixture.paths.lock().unwrap().is_empty());
}

#[tokio::test]
async fn renewal_http_legacy_member_response_requires_upgrade_without_sequence_reset() {
    // The field is absent, matching the old response shape, rather than present as null.
    let fixture = ViewerHttpFixture::new(None, viewer_snapshot(false));
    let authorization =
        crate::device_session::DeviceSessionAuthorization::none_for_test("viewer:test");
    let error = live_viewer_join_baseline(
        &fixture.url,
        &authorization,
        "live:test",
        &viewer_snapshot(false),
        1,
    )
    .await
    .unwrap_err();
    assert_eq!(
        error,
        "Loom does not support safe live cursor recovery; upgrade Loom"
    );
    assert_one_cursor_get(&fixture);
}

#[tokio::test]
async fn renewal_http_current_member_preserves_actor_sequences_and_unknown_fields() {
    let mut snapshot = renewal_member_snapshot();
    snapshot["futureExtension"] = serde_json::json!({"sequence": 900});
    snapshot["requesterControl"]["futureExtension"] = serde_json::json!({"inputSequence": 0});
    let fixture = ViewerHttpFixture::new(None, snapshot);
    let authorization =
        crate::device_session::DeviceSessionAuthorization::none_for_test("viewer:test");
    let cursor = live_viewer_join_baseline(
        &fixture.url,
        &authorization,
        "live:test",
        &viewer_snapshot(false),
        1,
    )
    .await
    .unwrap();
    assert_eq!(cursor.next_control().unwrap(), 42);
    assert_eq!(cursor.input, 29);
    assert_one_cursor_get(&fixture);
}

#[tokio::test]
async fn renewal_http_denial_and_conflict_never_fall_back_or_retry() {
    for status in [401, 403, 409] {
        let fixture = ViewerHttpFixture::with_snapshot_status(
            None,
            serde_json::json!({"error": {"code": "rejected", "message": "fixture rejection", "retryable": true}}),
            status,
        );
        let authorization =
            crate::device_session::DeviceSessionAuthorization::none_for_test("viewer:test");
        let error = live_viewer_join_baseline(
            &fixture.url,
            &authorization,
            "live:test",
            &viewer_snapshot(false),
            1,
        )
        .await
        .unwrap_err();
        assert!(error.contains(&format!("HTTP {status}:")), "{error}");
        assert_one_cursor_get(&fixture);
    }
}
