// This proves source publication/control identity, not native WGC/device recovery or display FPS.
#[test]
fn source_capture_epochs_do_not_replace_loom_media_or_control_epoch() {
    for profile in [
        LiveRelayMediaProfile::Jpeg,
        LiveRelayMediaProfile::Legacy,
        LiveRelayMediaProfile::H264,
    ] {
        let fixture = SourceEpochFixture::new(profile);
        let first = fixture.publish(7, 100);
        let second = fixture.publish(8, 101);
        assert_eq!(
            first.descriptor.epoch, 3,
            "capture already recovered before publication"
        );
        assert_eq!(
            second.descriptor.epoch, 3,
            "local producer rebuilt while publishing"
        );
        assert_eq!(
            (first.descriptor.frame_id, second.descriptor.frame_id),
            (1, 2)
        );
        assert_eq!(
            (second.descriptor.width, second.descriptor.height),
            (64, 32)
        );
        let local = fixture
            .capture
            .frames
            .lock()
            .unwrap()
            .clone_latest_after(100)
            .unwrap();
        assert_eq!(
            local.descriptor.epoch, 8,
            "local generation must not be rewritten"
        );
        let deadline = Instant::now() + Duration::from_secs(1);
        while fixture.relay.snapshot().unwrap().last_frame_id != 2 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        let status = fixture.relay.snapshot().unwrap();
        assert_eq!(status.epoch, 3);
        assert_eq!(status.last_frame_id, 2);
        assert_eq!(status.reconnect_count, 0);
        let response = parse_live_relay_events_response(
            serde_json::json!({
                "protocolVersion":"loom.live.v1", "next":1, "reset":false,
                "events":[{"protocolVersion":"loom.live.v1", "sessionId":"live:test",
                    "epoch":3, "sequence":1, "messageType":"session_state",
                    "payload":{"revision":2,"visibility":"visible","viewers":[],
                        "controllerDeviceId":null,"reason":"media_connected"}}]
            }),
            0,
        )
        .unwrap();
        let mut after = 0;
        apply_live_relay_events(&fixture.relay, &response, &mut after).unwrap();
        assert_eq!(
            after, 1,
            "authoritative ordered control must remain applicable"
        );
        let mut foreign = response;
        foreign.next = 2;
        foreign.events[0].sequence = 2;
        foreign.events[0].epoch = 8;
        assert!(apply_live_relay_events(&fixture.relay, &foreign, &mut after).is_err());
        assert_eq!(after, 1, "capture epoch must not authorize network control");
    }
}
