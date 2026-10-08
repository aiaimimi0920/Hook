#[cfg(test)]
mod live_relay_renewal_tests {
    use super::*;

    fn member() -> serde_json::Value {
        serde_json::json!({"closed": false, "epoch": 3,
            "session": {"protocolVersion": "loom.live.v1", "sessionId": "live:a"},
            "requesterControl": {"deviceId": "device:a", "epoch": 3,
                "controlSequence": 17, "inputSequence": 8}})
    }

    #[test]
    fn recovery_cursor_is_actor_epoch_scoped_and_preserves_independent_sequences() {
        let value = member();
        let cursor = parse_live_requester_cursor(&value, "live:a", "device:a", 3).unwrap();
        assert_eq!(cursor.next_control().unwrap(), 18);
        assert_eq!(cursor.input, 8);
        assert!(parse_live_requester_cursor(&value, "live:b", "device:a", 3).is_err());
        assert!(parse_live_requester_cursor(&value, "live:a", "device:b", 3).is_err());
        assert!(parse_live_requester_cursor(&value, "live:a", "device:a", 4).is_err());
        for pointer in [
            "/requesterControl",
            "/requesterControl/deviceId",
            "/requesterControl/epoch",
            "/requesterControl/controlSequence",
            "/requesterControl/inputSequence",
        ] {
            let mut invalid = member();
            *invalid.pointer_mut(pointer).unwrap() = serde_json::Value::Null;
            assert!(
                parse_live_requester_cursor(&invalid, "live:a", "device:a", 3).is_err(),
                "{pointer}"
            );
        }
        let mut closed = member();
        closed["closed"] = true.into();
        assert!(parse_live_requester_cursor(&closed, "live:a", "device:a", 3).is_err());
        let mut exhausted = member();
        exhausted["requesterControl"]["controlSequence"] = u64::MAX.into();
        assert!(
            parse_live_requester_cursor(&exhausted, "live:a", "device:a", 3)
                .unwrap()
                .next_control()
                .is_err()
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn recovery_uia_preserves_sequence_but_requires_fresh_stability() {
        let sample = UiaObservationSample {
            observation_id: "uia:renewed".to_owned(),
            locator: LiveRelayElementLocator {
                automation_id: Some("progress".to_owned()),
                name: None,
                control_type: "ProgressBar".to_owned(),
                ancestor_path: Vec::new(),
                runtime_id: Some(vec![1, 2]),
            },
            value: Ok(serde_json::json!({"rangeValue": {"value": 10}})),
            fingerprint: Some("10".to_owned()),
        };
        let mut old = next_live_uia_observation(None, &sample, 10).unwrap();
        old.sequence = 73;
        old.state = LiveRelayObservationState::Stable;
        old.stable_since_ms = Some(10);
        let mut observations =
            std::collections::BTreeMap::from([(old.observation_id.clone(), old)]);
        let tracks = seed_live_uia_tracks(&observations).unwrap();
        let first = next_live_uia_observation(tracks.get("uia:renewed"), &sample, 100).unwrap();
        assert_eq!(first.sequence, 74);
        assert_eq!(first.state, LiveRelayObservationState::Observing);
        assert_eq!(first.stable_since_ms, None);
        let fresh = live_uia_track(&first, sample.fingerprint.clone());
        let second = next_live_uia_observation(Some(&fresh), &sample, 200).unwrap();
        assert_eq!(second.sequence, 75);
        assert_eq!(second.state, LiveRelayObservationState::Stable);
        assert_eq!(second.stable_since_ms, Some(200));
        observations.get_mut("uia:renewed").unwrap().locator = None;
        assert!(seed_live_uia_tracks(&observations).is_err());
        assert!(seed_live_uia_tracks(&std::collections::BTreeMap::new())
            .unwrap()
            .is_empty());
    }
}
