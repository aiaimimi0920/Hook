// Covers the arithmetic and allocation gates that protect protocol-facing resources.
    #[test]
    fn hook_image_and_base64_budgets_reject_oversized_descriptors() {
        assert_eq!(checked_hook_rgba_len(2, 3), Ok(24));
        assert!(checked_hook_rgba_len(0, 3).is_err());
        assert!(checked_hook_rgba_len(MAX_HOOK_IMAGE_DIMENSION + 1, 1).is_err());
        assert!(validate_hook_base64_char_count(MAX_HOOK_BASE64_CHARS).is_ok());
        assert!(validate_hook_base64_char_count(MAX_HOOK_BASE64_CHARS + 1).is_err());
    }

    #[test]
    fn art_input_source_budget_limits_count_and_total_encoded_size() {
        let mut inputs = HashMap::new();
        for index in 0..MAX_HOOK_ART_INPUT_COUNT {
            inputs.insert(index.to_string(), "QQ==".to_owned());
        }
        assert!(validate_hook_art_input_sources(&inputs).is_ok());
        inputs.insert("overflow".to_owned(), "QQ==".to_owned());
        assert!(validate_hook_art_input_sources(&inputs).is_err());
        assert!(validate_hook_art_input_budget(1, MAX_HOOK_ART_INPUT_SOURCE_CHARS + 1).is_err());
    }

    #[test]
    fn surface_chunks_are_rejected_before_crossing_the_budget() {
        let mut bytes = vec![1, 2];
        append_surface_chunk_with_limit(&mut bytes, &[3, 4], 4).expect("within budget");
        assert_eq!(bytes, vec![1, 2, 3, 4]);
        assert!(append_surface_chunk_with_limit(&mut bytes, &[5], 4).is_err());
        assert_eq!(bytes, vec![1, 2, 3, 4]);
    }

    #[test]
    fn formal_shared_memory_size_must_match_rgba_dimensions() {
        let mismatched = serde_json::json!({
            "kind": "shared_memory",
            "handle": "Loom_Buffer_1",
            "size": 7,
            "width": 2,
            "height": 1,
            "format": "rgba8"
        });
        assert!(formal_hook_port_delivery(&mismatched).is_err());
    }

    #[test]
    fn loom_worker_slots_enforce_their_limit_without_oversubscription() {
        let active = AtomicUsize::new(0);
        assert!(try_reserve_loom_worker_slot(&active, 2));
        assert!(try_reserve_loom_worker_slot(&active, 2));
        assert!(!try_reserve_loom_worker_slot(&active, 2));
        assert_eq!(active.load(Ordering::Acquire), 2);
    }

    #[test]
    fn connection_state_records_only_real_transitions() {
        let hook = LoomHook::new();
        assert!(!record_backend_connection_state(&hook.state, false));
        assert!(record_backend_connection_state(&hook.state, true));
        assert!(!record_backend_connection_state(&hook.state, true));
        assert!(record_backend_connection_state(&hook.state, false));
    }

    #[test]
    fn untrusted_diagnostics_redact_locations_secrets_and_control_characters() {
        let message = sanitize_untrusted_message(
            "request https://example.invalid/a failed token=secret\nC:\\private\\input.png",
            "fallback",
        );
        assert_eq!(
            message,
            "request [REDACTED_LOCATION] failed [REDACTED_SECRET] [REDACTED_LOCATION]"
        );
        assert_eq!(sanitize_untrusted_message(" \n\t", "fallback"), "fallback");
    }

    fn valid_handshake_request() -> HandshakeRequest {
        serde_json::from_value(serde_json::json!({
            "protocolVersion": "loom.hook.v1",
            "supportedProtocolVersions": ["loom.hook.v1"],
            "clientId": "hook.test",
            "clientVersion": "0.1.7",
            "platform": "windows-x64",
            "transports": ["shared_memory"]
        }))
        .expect("handshake request")
    }

    fn valid_handshake_response() -> LoomHookHandshake {
        serde_json::from_value(serde_json::json!({
            "protocolVersion": "loom.hook.v1",
            "serverName": "loom-test",
            "serverVersion": "0.1.0",
            "sessionId": "session:test",
            "transport": "shared_memory",
            "capabilities": {
                "artDefinitions": [],
                "surface": {
                    "apiVersion": "loom.surface.v1",
                    "runtimes": [],
                    "nodes": [],
                    "transports": [],
                    "capabilities": [],
                    "input": {
                        "pointer": true,
                        "hover": true,
                        "touch": false,
                        "keyboard": true
                    }
                },
                "operations": []
            }
        }))
        .expect("handshake response")
    }

    #[test]
    fn handshake_validation_rejects_unoffered_transport_and_invalid_identity() {
        let request = valid_handshake_request();
        assert!(validate_loom_hook_handshake_request(&request).is_ok());
        let mut response = valid_handshake_response();
        assert!(validate_loom_hook_handshake_response(&response, &request.transports).is_ok());

        response.transport = TransportMode::CloudflareRelay;
        assert!(validate_loom_hook_handshake_response(&response, &request.transports).is_err());
        response.transport = TransportMode::SharedMemory;
        response.session_id = "\n".to_owned();
        assert!(validate_loom_hook_handshake_response(&response, &request.transports).is_err());
    }

    #[test]
    fn json_payload_budget_stops_serialization_without_allocating_a_copy() {
        let payload = serde_json::json!({ "value": "x".repeat(64) });
        assert!(validate_json_payload_size(&payload, "test payload", 128).is_ok());
        assert!(validate_json_payload_size(&payload, "test payload", 16).is_err());
    }

    #[test]
    fn surface_stream_rejects_message_floods() {
        let response = serde_json::json!({
            "protocolVersion": SURFACE_STREAM_PROTOCOL_VERSION,
            "next": 1,
            "reset": false,
            "messages": vec![serde_json::json!({}); MAX_SURFACE_STREAM_MESSAGES + 1]
        });
        assert!(surface_stream_envelope(&response, 0).is_err());
    }
