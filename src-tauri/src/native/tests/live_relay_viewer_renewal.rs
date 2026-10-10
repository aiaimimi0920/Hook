#[cfg(feature = "remote-surface")]
mod viewer_renewal_tests {
    use super::*;

    fn expired_viewer() -> Arc<LiveRelaySession> {
        let mut relay = viewer_relay("http://127.0.0.1:1".to_owned());
        let inner = Arc::get_mut(&mut relay).unwrap();
        inner.authorization = crate::device_session::DeviceSessionAuthorization::device_for_test(
            "viewer:test",
            "expired",
        );
        inner.viewer_identity = Some(LiveViewerIdentity {
            source_device_id: "source:test".to_owned(),
            source_hook_id: "hook:test".to_owned(),
            epoch: 1,
        });
        close_live_viewer_on_http_status(&relay, 401, "test").unwrap_err();
        relay
    }

    #[test]
    fn renewal_requires_exact_expiry_terminal_and_retained_identity() {
        let mut relay = expired_viewer();
        ensure_live_viewer_renewable(&relay).unwrap();
        relay.stop_and_join().unwrap();
        ensure_live_viewer_renewable(&relay).unwrap();
        for code in [
            "live_media_device_revoked",
            "live_session_closed",
            "network",
        ] {
            relay.state.lock().unwrap().error_code = Some(code.to_owned());
            assert!(ensure_live_viewer_renewable(&relay).is_err());
        }
        relay.state.lock().unwrap().error_code =
            Some("live_viewer_authorization_required".to_owned());
        Arc::get_mut(&mut relay).unwrap().viewer_identity = None;
        assert!(ensure_live_viewer_renewable(&relay).is_err());
    }

    #[test]
    fn removed_or_replaced_owner_never_starts_replacement_workers() {
        for replaced in [false, true] {
            let store = SharedLiveRelaySessions::new();
            let old = expired_viewer();
            store.insert(Arc::clone(&old)).unwrap();
            store.remove(&old.relay_id).unwrap();
            if replaced {
                store.insert(expired_viewer()).unwrap();
            }
            let next = viewer_relay("http://127.0.0.1:1".to_owned());
            assert!(store.replace_viewer(&old, Arc::clone(&next)).is_err());
            assert!(next.join.lock().unwrap().is_none());
            assert!(next.control_join.lock().unwrap().is_none());
        }
    }

    #[test]
    fn changed_source_epoch_and_closed_snapshots_reject_identity() {
        let value = serde_json::json!({
            "session": {"protocolVersion": LIVE_RELAY_PROTOCOL_VERSION,
                "sessionId":"live:test", "sourceDeviceId":"source:test", "sourceHookId":"hook:test"},
            "epoch":1, "closed":false,
        });
        let identity = LiveViewerIdentity::from_snapshot(&value, "live:test").unwrap();
        for (pointer, replacement) in [
            ("/epoch", serde_json::json!(2)),
            ("/closed", serde_json::json!(true)),
            ("/session/sourceDeviceId", serde_json::json!("other")),
            ("/session/sourceHookId", serde_json::json!("other")),
        ] {
            let mut changed = value.clone();
            *changed.pointer_mut(pointer).unwrap() = replacement;
            assert!(identity.validate(&changed, "live:test").is_err());
        }
    }

    #[tokio::test]
    async fn renewal_attach_requires_atomic_policy_without_legacy_fallback() {
        for status in [200, 400, 403, 409] {
            let fixture =
                ViewerHttpFixture::with_snapshot_status(None, serde_json::json!({}), status);
            let authorization = crate::device_session::DeviceSessionAuthorization::device_for_test(
                "viewer:test",
                "renewed",
            );
            let request = LiveRelayJoinRequest {
                live_session_id: "live:test".to_owned(),
                surface_instance_id: "instance:test".to_owned(),
                attachment_id: "attachment:test".to_owned(),
            };
            let result = attach_live_viewer_with_policy_http(
                &fixture.url,
                &authorization,
                &request,
                1,
                42,
                true,
            )
            .await;
            assert_eq!(result.is_ok(), status == 200);
            assert_eq!(fixture.paths.lock().unwrap().len(), 1);
            let bodies = fixture.bodies.lock().unwrap();
            assert_eq!(bodies.len(), 1);
            assert_eq!(bodies[0]["requireExistingMembership"], true);
            assert_eq!(bodies[0]["envelope"]["sequence"], 42);
        }
    }

    #[tokio::test]
    async fn ordinary_attach_omits_new_policy_for_older_daemons() {
        let fixture = ViewerHttpFixture::new(None, serde_json::json!({}));
        let authorization =
            crate::device_session::DeviceSessionAuthorization::none_for_test("viewer:test");
        let request = LiveRelayJoinRequest {
            live_session_id: "live:test".to_owned(),
            surface_instance_id: "instance:test".to_owned(),
            attachment_id: "attachment:test".to_owned(),
        };
        attach_live_viewer_http(&fixture.url, &authorization, &request, 1, 1)
            .await
            .unwrap();
        assert!(fixture.bodies.lock().unwrap()[0]
            .get("requireExistingMembership")
            .is_none());
    }
}
