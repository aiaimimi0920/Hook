// Covers settings, formal delivery, cancellation identity, release, and output preference contracts.
    #[test]
    fn cache_settings_event_reads_canonical_camel_case_only() {
        let event = hook_cache_settings_event(&serde_json::json!({
            "recycleBinMaxEntries": 15,
            "recycle_bin_max_entries": 99,
            "recycleBinRetentionDays": 7,
            "tempCacheMaxBytes": 1024,
            "tempCacheRetentionDays": 3
        }));
        assert_eq!(event["recycleBinMaxEntries"], 15);
        assert_eq!(event["recycleBinRetentionDays"], 7);
        assert_eq!(event["tempCacheMaxBytes"], 1024);
        assert_eq!(event["tempCacheRetentionDays"], 3);
    }

    #[test]
    fn formal_hook_port_delivery_validates_and_preserves_canonical_values() {
        let value = formal_hook_port_delivery(&serde_json::json!({
            "kind": "value",
            "value": { "ok": true }
        }))
        .expect("value delivery");
        assert_eq!(
            value,
            serde_json::json!({
                "type": "value",
                "value": { "ok": true }
            })
        );

        let inline = formal_hook_port_delivery(&serde_json::json!({
            "kind": "inline_resource",
            "mime": "image/png",
            "dataBase64": "QQ==",
            "width": 1,
            "height": 1
        }))
        .expect("inline delivery");
        assert_eq!(
            inline,
            serde_json::json!({
                "type": "base64",
                "data": "data:image/png;base64,QQ==",
                "width": 1,
                "height": 1
            })
        );

        let shared = formal_hook_port_delivery(&serde_json::json!({
            "kind": "shared_memory",
            "handle": "Loom_Buffer_1",
            "size": 8,
            "width": 2,
            "height": 1,
            "format": "rgba8"
        }))
        .expect("shared-memory delivery");
        assert_eq!(
            shared,
            serde_json::json!({
                "type": "shared_memory",
                "handle": "Loom_Buffer_1",
                "size": 8,
                "width": 2,
                "height": 1,
                "format": "rgba8"
            })
        );
    }

    #[test]
    fn formal_hook_port_delivery_rejects_malformed_unknown_and_resource_kinds() {
        for malformed in [
            serde_json::json!({
                "kind": "inline_resource",
                "mime": "",
                "dataBase64": "QQ=="
            }),
            serde_json::json!({
                "kind": "inline_resource",
                "mime": "image/png",
                "dataBase64": "data:image/png;base64,QQ=="
            }),
            serde_json::json!({
                "kind": "inline_resource",
                "mime": "image/png",
                "dataBase64": "not base64!"
            }),
            serde_json::json!({
                "kind": "inline_resource",
                "mime": "text/html",
                "dataBase64": "PGgxPng8L2gxPg=="
            }),
            serde_json::json!({
                "kind": "value"
            }),
            serde_json::json!({
                "kind": "shared_memory",
                "handle": "loom-buffer-1",
                "size": 8,
                "width": 2,
                "height": 1,
                "format": "rgba8"
            }),
            serde_json::json!({
                "kind": "shared_memory",
                "handle": "Loom_Buffer_1",
                "size": 8,
                "width": 2,
                "height": 1
            }),
            serde_json::json!({
                "kind": "shared_memory",
                "handle": "Loom_Buffer_1",
                "size": 8,
                "width": 2,
                "height": 1,
                "format": "bgra8"
            }),
        ] {
            assert!(
                formal_hook_port_delivery(&malformed).is_err(),
                "{malformed}"
            );
        }
        assert!(formal_hook_port_delivery(&serde_json::json!({
            "kind": "resource",
            "resource": { "id": "res:1" }
        }))
        .is_err());
        assert!(formal_hook_port_delivery(&serde_json::json!({
            "kind": "mystery"
        }))
        .is_err());
        assert!(formal_output_map_value(&serde_json::json!({
            "kind": "value"
        }))
        .is_err());
    }

    #[test]
    fn cancel_response_requires_protocol_and_request_identity() {
        let response = serde_json::json!({
            "protocolVersion": "loom.hook.v1",
            "requestId": "request:expected",
            "status": "cancel_requested",
            "data": { "nodeId": "node:one", "generation": 2 }
        });
        assert!(hook_art_cancel_response(&response, "request:expected").is_some());
        assert!(hook_art_cancel_response(&response, "request:other").is_none());
        assert!(hook_art_cancel_response(
            &serde_json::json!({
                "protocolVersion": "loom.hook.v1",
                "method": "loom.hook.art.progress",
                "params": { "requestId": "request:expected" }
            }),
            "request:expected"
        )
        .is_none());
        assert!(hook_art_cancel_response(
            &serde_json::json!({
                "protocolVersion": "loom.hook.v0",
                "requestId": "request:expected",
                "status": "cancel_requested"
            }),
            "request:expected"
        )
        .is_none());
    }

    #[test]
    fn resource_release_uses_fresh_command_and_explicit_execution_identity() {
        let handles = vec!["Loom_Buffer_1".to_owned()];
        let (first_request_id, first) =
            hook_art_resource_release_request("node:one", "execution:one", 4, &handles);
        let (second_request_id, _) =
            hook_art_resource_release_request("node:one", "execution:one", 4, &handles);
        assert_ne!(first_request_id, second_request_id);
        assert_eq!(first["method"], "loom.hook.art.resources.release");
        assert_eq!(first["params"]["requestId"], first_request_id);
        assert_eq!(first["params"]["executionRequestId"], "execution:one");
        assert_eq!(first["params"]["nodeId"], "node:one");
        assert_eq!(first["params"]["generation"], 4);
        assert_eq!(first["params"]["deviceId"], "device:local");
        assert_eq!(first["params"]["handles"][0], "Loom_Buffer_1");
    }

    #[test]
    fn preferred_formal_output_prefers_canonical_port_names() {
        let outputs = serde_json::json!({
            "alpha": { "kind": "value", "value": 1 },
            "output": { "kind": "value", "value": 2 },
            "output_image": { "kind": "inline_resource", "mime": "image/png", "dataBase64": "QQ==" }
        });
        let map = outputs.as_object().expect("output map");
        assert_eq!(
            preferred_formal_output(map).map(|(name, _)| name),
            Some("output_image")
        );
        assert_eq!(
            formal_output_map_value(&map["alpha"]).expect("decode alpha"),
            serde_json::json!(1)
        );
        assert_eq!(
            formal_output_map_value(&map["output_image"]).expect("decode image"),
            serde_json::json!("data:image/png;base64,QQ==")
        );
    }
