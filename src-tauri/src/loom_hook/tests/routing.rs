// Covers action deserialization, subscription routing, Surface convergence, and listener claiming.
    #[test]
    fn cancel_art_action_deserializes_from_frontend_payload() {
        let action = serde_json::from_value::<LoomHookAction>(serde_json::json!({
            "action": "cancel_art",
            "payload": {
                "node_id": "node-1",
                "request_id": "req-old",
                "generation": 3
            }
        }))
        .expect("deserialize cancel_art");
        assert!(matches!(
            action,
            LoomHookAction::CancelArt {
                node_id,
                request_id,
                generation
            } if node_id == "node-1" && request_id == "req-old" && generation == 3
        ));
    }

    #[test]
    fn native_listener_subscribes_to_art_and_surface_updates() {
        let message: serde_json::Value =
            serde_json::from_str(&loom_hook_listener_subscription_message())
                .expect("subscription message");
        assert_eq!(message["method"], "loom.hook.subscribe");
        assert_eq!(
            message["params"]["events"],
            serde_json::json!([
                "loom.hook.workflow.instantiated",
                "loom.hook.capabilities.updated",
                "loom.hook.cache.control",
                "loom.hook.settings.updated",
                "loom.surface.snapshot",
                "loom.surface.patch",
                "loom.surface.generation",
                "loom.surface.action.ack",
                "loom.surface.confirmation.request",
                "loom.surface.action.progress",
                "loom.surface.preview",
                "loom.surface.result",
                "loom.surface.failure",
                "loom.surface.lifecycle",
                "loom.surface.dispose"
            ])
        );
    }

    #[test]
    fn surface_event_instance_state_recovers_snapshot_and_matching_result() {
        let instance = serde_json::json!({
            "descriptor": {
                "instanceId": "instance:stock",
                "generation": 3
            },
            "attachments": {
                "attachment:hook": {
                    "descriptor": {
                        "hookNodeId": "node:stock"
                    },
                    "snapshot": {
                        "protocolVersion": "loom.surface.v1",
                        "instanceId": "instance:stock",
                        "attachmentId": "attachment:hook",
                        "revision": 12,
                        "scene": { "root": "root", "nodes": {} },
                        "authoritativeState": { "quote": { "price": 25.2 } }
                    }
                }
            },
            "eventAcks": {
                "event:refresh": {
                    "requestId": "request:refresh",
                    "status": "succeeded"
                }
            },
            "latestResult": {
                "protocolVersion": "loom.surface.v1",
                "instanceId": "instance:stock",
                "requestId": "request:refresh",
                "generation": 3,
                "resultRevision": 11,
                "outputs": {}
            }
        });

        let state = surface_event_instance_state(
            &instance,
            "instance:stock",
            "attachment:hook",
            "event:refresh",
        )
        .expect("converged Surface state");

        assert_eq!(state.hook_node_id, "node:stock");
        assert_eq!(state.generation, 3);
        assert_eq!(state.revision, 12);
        assert_eq!(state.action_status.as_deref(), Some("succeeded"));
        assert_eq!(state.snapshot["authoritativeState"]["quote"]["price"], 25.2);
        assert_eq!(
            state
                .result_commit
                .as_ref()
                .and_then(|commit| commit["resultRevision"].as_u64()),
            Some(11)
        );
    }

    #[test]
    fn surface_event_instance_state_does_not_replay_an_older_result() {
        let instance = serde_json::json!({
            "descriptor": {
                "instanceId": "instance:stock",
                "generation": 0
            },
            "attachments": {
                "attachment:hook": {
                    "descriptor": { "hookNodeId": "node:stock" },
                    "snapshot": {
                        "instanceId": "instance:stock",
                        "attachmentId": "attachment:hook",
                        "revision": 4
                    }
                }
            },
            "eventAcks": {
                "event:interval": {
                    "requestId": "request:interval",
                    "status": "succeeded"
                }
            },
            "latestResult": {
                "requestId": "request:previous",
                "resultRevision": 3
            }
        });

        let state = surface_event_instance_state(
            &instance,
            "instance:stock",
            "attachment:hook",
            "event:interval",
        )
        .expect("converged Surface state");

        assert!(state.result_commit.is_none());
    }

    #[test]
    fn surface_attach_action_preserves_host_capabilities() {
        let action = serde_json::from_value::<LoomHookAction>(serde_json::json!({
            "action": "surface_attach",
            "payload": {
                "art_id": "neuro.official/stock",
                "hook_node_id": "hook-node:stock",
                "capabilities": {
                    "apiVersion": "1.0",
                    "runtimes": ["declarative"],
                    "nodes": ["column", "text"],
                    "transports": [],
                    "capabilities": [],
                    "input": {
                        "pointer": true,
                        "hover": true,
                        "touch": true,
                        "keyboard": true
                    }
                }
            }
        }))
        .expect("deserialize Surface attach action");
        assert!(matches!(
            action,
            LoomHookAction::SurfaceAttach {
                art_id,
                hook_node_id,
                ..
            } if art_id == "neuro.official/stock" && hook_node_id == "hook-node:stock"
        ));
    }

    #[test]
    fn surface_remount_action_preserves_recovery_identity() {
        let action = serde_json::from_value::<LoomHookAction>(serde_json::json!({
            "action": "surface_remount",
            "payload": {
                "instance_id": "instance:stock",
                "attachment_id": "attachment:hook-stock",
                "hook_node_id": "hook-node:stock"
            }
        }))
        .expect("deserialize Surface remount action");
        assert!(matches!(
            action,
            LoomHookAction::SurfaceRemount {
                instance_id,
                attachment_id,
                hook_node_id,
            } if instance_id == "instance:stock"
                && attachment_id == "attachment:hook-stock"
                && hook_node_id == "hook-node:stock"
        ));
    }

    #[test]
    fn native_listener_start_claim_is_idempotent() {
        let loom_hook = LoomHook::new();
        let mut state = loom_hook.state.lock().expect("lock Loom Hook state");

        assert!(claim_loom_hook_listener_start(&mut state));
        assert!(!claim_loom_hook_listener_start(&mut state));
    }

