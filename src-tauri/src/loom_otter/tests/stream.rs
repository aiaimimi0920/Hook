// Covers Surface stream version, reset, cursor, delay, and hostile-version contracts.
    #[test]
    fn surface_stream_envelope_accepts_the_declared_protocol() {
        let (next, reset, messages) = surface_stream_envelope(
            &serde_json::json!({
                "protocolVersion": "loom.surface-stream.v1",
                "next": 42,
                "reset": false,
                "messages": [{ "method": "loom.surface.patch", "params": { "revision": 3 } }]
            }),
            7,
        )
        .expect("a well-formed envelope must be accepted");
        assert_eq!(next, 42);
        assert!(!reset);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["method"], "loom.surface.patch");
    }

    #[test]
    fn surface_stream_envelope_keeps_the_cursor_when_next_is_missing() {
        let (next, reset, messages) = surface_stream_envelope(
            &serde_json::json!({
                "protocolVersion": "loom.surface-stream.v1",
                "reset": false
            }),
            19,
        )
        .expect("a cursor-less envelope is still a valid one");
        assert_eq!(
            next, 19,
            "a missing cursor must not rewind the stream to zero"
        );
        assert!(!reset);
        assert!(messages.is_empty());
    }

    #[test]
    fn surface_stream_envelope_preserves_reset_with_or_without_messages() {
        for messages in [
            serde_json::json!([]),
            serde_json::json!([{ "method": "loom.surface.snapshot", "params": {} }]),
        ] {
            let expected_len = messages.as_array().map(Vec::len).unwrap_or_default();
            let (_, reset, parsed) = surface_stream_envelope(
                &serde_json::json!({
                    "protocolVersion": "loom.surface-stream.v1",
                    "next": 9,
                    "reset": true,
                    "messages": messages
                }),
                7,
            )
            .expect("reset envelope");
            assert!(reset);
            assert_eq!(parsed.len(), expected_len);
        }
    }

    #[test]
    fn surface_stream_envelope_rejects_missing_reset_and_cursor_rewind() {
        let missing = surface_stream_envelope(
            &serde_json::json!({
                "protocolVersion": "loom.surface-stream.v1",
                "next": 8,
                "messages": []
            }),
            7,
        )
        .expect_err("reset is a required stream semantic");
        assert!(missing.contains("reset"));

        let rewind = surface_stream_envelope(
            &serde_json::json!({
                "protocolVersion": "loom.surface-stream.v1",
                "next": 6,
                "reset": false,
                "messages": []
            }),
            7,
        )
        .expect_err("the stream cursor must be monotonic");
        assert!(rewind.contains("rewound"));
    }

    #[test]
    fn unchanged_remote_cursor_requires_a_bounded_delay() {
        assert_eq!(
            remote_surface_poll_delay(7, 7),
            Some(Duration::from_millis(100))
        );
        assert_eq!(remote_surface_poll_delay(7, 8), None);
    }

    #[test]
    fn surface_stream_envelope_rejects_a_foreign_protocol() {
        let error = surface_stream_envelope(
            &serde_json::json!({
                "protocolVersion": "loom.surface-stream.v2",
                "next": 42,
                "messages": [{ "method": "loom.surface.patch", "params": {} }]
            }),
            7,
        )
        .expect_err("a different stream protocol must not be consumed as if it matched");
        assert!(
            error.contains("loom.surface-stream.v2")
                && error.contains(SURFACE_STREAM_PROTOCOL_VERSION),
            "the error must name both the received and the expected protocol: {error}"
        );
    }

    #[test]
    fn surface_stream_envelope_rejects_a_missing_protocol() {
        let error = surface_stream_envelope(&serde_json::json!({ "next": 42, "messages": [] }), 7)
            .expect_err("an envelope without the protocol field must be refused");
        assert!(
            error.contains("absent"),
            "an absent protocol must be reported as absent, not as an empty string: {error}"
        );
    }

    #[test]
    fn surface_stream_envelope_error_clips_a_hostile_protocol_string() {
        let hostile = "版".repeat(4096);
        let error = surface_stream_envelope(&serde_json::json!({ "protocolVersion": hostile }), 0)
            .expect_err("a non-Loom peer must not be accepted");
        assert!(
            error.chars().count() < 200,
            "the peer controls this string and it reaches the runtime log; it must be clipped: {} chars",
            error.chars().count()
        );
        assert!(
            error.contains('…'),
            "a clipped protocol string must show that it was clipped: {error}"
        );
    }

