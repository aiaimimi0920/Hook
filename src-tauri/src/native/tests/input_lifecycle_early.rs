// Covers pointer ownership, release debounce, and movement coalescing.

    use super::{
        claim_capture_button_transition, claim_overlay_pointer_down, claim_overlay_pointer_up,
        coalesce_capture_mouse_move_until_emit, coalesce_overlay_mouse_move_until_emit,
        handle_emergency_escape_transition_with, rect_covers_rect_with_tolerance,
        resolve_overlay_pointer_release, select_overlay_mouse_move_emit_interval,
        set_capture_input_runtime_active,
        should_passthrough_foreign_alt_input, should_passthrough_foreign_alt_mouse_input,
        should_suppress_overlay_interaction_for_occlusion, wait_for_capture_mouse_up_debounce,
        wait_for_overlay_mouse_up_debounce, CaptureMouseEventEnqueueResult, CaptureMouseEventQueue,
        CaptureMouseEventReceiver, CaptureMouseHookEvent, CaptureMouseMoveCoalesceResult,
        CaptureMouseUpDebounceResult, EmergencyEscapeTracker, ModifierSnapshot,
        OverlayMouseMoveCoalesceResult, OverlayMouseUpDebounceResult, OverlayPointerDownTransition,
        OverlayPointerReleaseResult, OverlayPointerSource, OverlayPointerUpTransition,
        CAPTURE_MOUSE_HOOK_ACTIVE, CAPTURE_MOUSE_HOOK_BUTTON_DOWN, EMERGENCY_ESCAPE_WINDOW,
        OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE, OVERLAY_MOUSE_DRAG_MOVE_EMIT_INTERVAL,
        OVERLAY_MOUSE_HOOK_DRAG_ACTIVE, OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE,
        OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE, OVERLAY_MOUSE_MOVE_EMIT_INTERVAL,
        OVERLAY_POINTER_STATE, OVERLAY_POINTER_STATE_NONE,
    };
    use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::thread;
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::RECT;

    fn modifiers() -> ModifierSnapshot {
        ModifierSnapshot {
            ctrl_pressed: false,
            alt_pressed: false,
            shift_pressed: false,
            meta_pressed: false,
        }
    }

    #[test]
    fn sticker_drag_uses_a_fresher_pointer_emit_interval_than_passive_hover() {
        assert_eq!(
            select_overlay_mouse_move_emit_interval(false),
            OVERLAY_MOUSE_MOVE_EMIT_INTERVAL,
        );
        assert_eq!(
            select_overlay_mouse_move_emit_interval(true),
            OVERLAY_MOUSE_DRAG_MOVE_EMIT_INTERVAL,
        );
        assert!(OVERLAY_MOUSE_DRAG_MOVE_EMIT_INTERVAL < OVERLAY_MOUSE_MOVE_EMIT_INTERVAL);
    }

    #[test]
    fn capture_button_edges_require_a_real_down_up_pair() {
        let state = AtomicBool::new(false);

        assert!(claim_capture_button_transition(&state, true));
        assert!(!claim_capture_button_transition(&state, true));
        assert!(claim_capture_button_transition(&state, false));
        assert!(!claim_capture_button_transition(&state, false));
    }

    #[test]
    fn disabling_capture_input_resets_native_and_overlay_pointer_owners() {
        CAPTURE_MOUSE_HOOK_ACTIVE.store(true, Ordering::SeqCst);
        CAPTURE_MOUSE_HOOK_BUTTON_DOWN.store(true, Ordering::SeqCst);
        OVERLAY_POINTER_STATE.store(
            OverlayPointerSource::LowLevelHook.down_state(),
            Ordering::SeqCst,
        );
        OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(true, Ordering::SeqCst);
        OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.store(true, Ordering::SeqCst);
        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.store(true, Ordering::SeqCst);
        OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.store(true, Ordering::SeqCst);

        set_capture_input_runtime_active(false);

        assert!(!CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst));
        assert!(!CAPTURE_MOUSE_HOOK_BUTTON_DOWN.load(Ordering::SeqCst));
        assert_eq!(
            OVERLAY_POINTER_STATE.load(Ordering::SeqCst),
            OVERLAY_POINTER_STATE_NONE
        );
        assert!(!OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst));
        assert!(!OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.load(Ordering::SeqCst));
        assert!(!OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst));
        assert!(!OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.load(Ordering::SeqCst));
    }

    #[test]
    fn capture_up_followed_immediately_by_down_continues_the_same_drag() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::Move {
                x: 110.0,
                y: 120.0,
                modifiers: modifiers(),
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::Down {
                x: 130.0,
                y: 140.0,
                modifiers: modifiers(),
            })
            .unwrap();

        match wait_for_capture_mouse_up_debounce(&receiver, Duration::from_millis(1)) {
            CaptureMouseUpDebounceResult::Continue { x, y, .. } => {
                assert_eq!((x, y), (130.0, 140.0));
            }
            other => panic!("expected capture continuation, got {other:?}"),
        }
    }

    #[test]
    fn capture_up_without_a_following_down_is_released() {
        let (_sender, receiver) = mpsc::channel();

        match wait_for_capture_mouse_up_debounce(&receiver, Duration::ZERO) {
            CaptureMouseUpDebounceResult::Release {
                deferred_event: None,
            } => {}
            other => panic!("expected capture release, got {other:?}"),
        }
    }

    #[test]
    fn overlay_pointer_owner_rejects_cross_source_and_duplicate_edges() {
        let state = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);

        assert_eq!(
            claim_overlay_pointer_down(&state, OverlayPointerSource::LowLevelHook),
            OverlayPointerDownTransition::Started
        );
        assert_eq!(
            claim_overlay_pointer_down(&state, OverlayPointerSource::LowLevelHook),
            OverlayPointerDownTransition::IgnoredDuplicate
        );
        assert_eq!(
            claim_overlay_pointer_down(&state, OverlayPointerSource::InputShield),
            OverlayPointerDownTransition::IgnoredForeignOwner
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, OverlayPointerSource::InputShield),
            OverlayPointerUpTransition::IgnoredForeignOwner
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, OverlayPointerSource::LowLevelHook),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, OverlayPointerSource::LowLevelHook),
            OverlayPointerUpTransition::IgnoredDuplicate
        );
    }

    #[test]
    fn overlay_up_followed_by_down_continues_the_same_drag() {
        let state = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);
        let source = OverlayPointerSource::LowLevelHook;
        assert_eq!(
            claim_overlay_pointer_down(&state, source),
            OverlayPointerDownTransition::Started
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            claim_overlay_pointer_down(&state, source),
            OverlayPointerDownTransition::Continued
        );

        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 400.0,
                y: 410.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::OverlayDown {
                x: 420.0,
                y: 430.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
                source,
                continuation: true,
            })
            .unwrap();

        match wait_for_overlay_mouse_up_debounce(&receiver, source, Duration::from_millis(1)) {
            OverlayMouseUpDebounceResult::Continue { x, y, .. } => {
                assert_eq!((x, y), (420.0, 430.0));
            }
            other => panic!("expected overlay continuation, got {other:?}"),
        }
        assert_eq!(state.load(Ordering::SeqCst), source.down_state());
    }

    #[test]
    fn overlay_candidate_up_is_suppressed_while_primary_button_is_physically_down() {
        let state = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);
        let source = OverlayPointerSource::LowLevelHook;
        assert_eq!(
            claim_overlay_pointer_down(&state, source),
            OverlayPointerDownTransition::Started
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            resolve_overlay_pointer_release(&state, source, true),
            OverlayPointerReleaseResult::SuppressedPhysicalDown
        );
        assert_eq!(state.load(Ordering::SeqCst), source.down_state());

        assert_eq!(
            claim_overlay_pointer_up(&state, source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            resolve_overlay_pointer_release(&state, source, false),
            OverlayPointerReleaseResult::Released
        );
        assert_eq!(state.load(Ordering::SeqCst), OVERLAY_POINTER_STATE_NONE);
    }

    #[test]
    fn overlay_up_debounce_retains_the_latest_move_for_a_suppressed_release() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 500.0,
                y: 510.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 600.0,
                y: 610.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            })
            .unwrap();

        match wait_for_overlay_mouse_up_debounce(
            &receiver,
            OverlayPointerSource::LowLevelHook,
            Duration::from_millis(1),
        ) {
            OverlayMouseUpDebounceResult::Release {
                deferred_event: None,
                latest_move: Some(latest_move),
            } => {
                assert_eq!((latest_move.x, latest_move.y), (600.0, 610.0));
            }
            other => panic!("expected retained overlay move, got {other:?}"),
        }
    }

    #[test]
    fn late_recovery_down_wins_the_release_timeout_race() {
        let state = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);
        let source = OverlayPointerSource::InputShield;
        assert_eq!(
            claim_overlay_pointer_down(&state, source),
            OverlayPointerDownTransition::Started
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            claim_overlay_pointer_down(&state, source),
            OverlayPointerDownTransition::Continued
        );
        assert_eq!(
            resolve_overlay_pointer_release(&state, source, false),
            OverlayPointerReleaseResult::Superseded
        );
        assert_eq!(state.load(Ordering::SeqCst), source.down_state());
    }

    #[test]
    fn recovery_down_can_transfer_a_pending_session_to_the_fallback_input_source() {
        let state = AtomicU8::new(OVERLAY_POINTER_STATE_NONE);
        let original_source = OverlayPointerSource::LowLevelHook;
        let fallback_source = OverlayPointerSource::InputShield;
        assert_eq!(
            claim_overlay_pointer_down(&state, original_source),
            OverlayPointerDownTransition::Started
        );
        assert_eq!(
            claim_overlay_pointer_up(&state, original_source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            claim_overlay_pointer_down(&state, fallback_source),
            OverlayPointerDownTransition::Continued
        );
        assert_eq!(
            resolve_overlay_pointer_release(&state, original_source, false),
            OverlayPointerReleaseResult::Superseded
        );
        assert_eq!(state.load(Ordering::SeqCst), fallback_source.down_state());
        assert_eq!(
            claim_overlay_pointer_up(&state, fallback_source),
            OverlayPointerUpTransition::Candidate
        );
        assert_eq!(
            resolve_overlay_pointer_release(&state, fallback_source, false),
            OverlayPointerReleaseResult::Released
        );
    }

    #[test]
    fn capture_move_coalescing_emits_the_latest_point_before_a_deferred_up() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::Move {
                x: 200.0,
                y: 210.0,
                modifiers: modifiers(),
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::Move {
                x: 300.0,
                y: 310.0,
                modifiers: modifiers(),
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::Up {
                x: 320.0,
                y: 330.0,
                modifiers: modifiers(),
            })
            .unwrap();

        match coalesce_capture_mouse_move_until_emit(
            &receiver,
            100.0,
            110.0,
            modifiers(),
            Instant::now() - Duration::from_millis(10),
            Duration::from_millis(8),
        ) {
            CaptureMouseMoveCoalesceResult::Ready {
                x,
                y,
                deferred_event:
                    Some(CaptureMouseHookEvent::Up {
                        x: up_x, y: up_y, ..
                    }),
                ..
            } => {
                assert_eq!((x, y), (300.0, 310.0));
                assert_eq!((up_x, up_y), (320.0, 330.0));
            }
            other => panic!("expected latest move and deferred up, got {other:?}"),
        }
    }

    #[test]
    fn overlay_move_coalescing_emits_the_latest_point_before_a_deferred_up() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 200.0,
                y: 210.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 300.0,
                y: 310.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            })
            .unwrap();
        sender
            .send(CaptureMouseHookEvent::OverlayUp {
                x: 320.0,
                y: 330.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
                source: OverlayPointerSource::LowLevelHook,
            })
            .unwrap();

        match coalesce_overlay_mouse_move_until_emit(
            &receiver,
            100.0,
            110.0,
            modifiers(),
            false,
            Instant::now() - Duration::from_millis(20),
            Duration::from_millis(16),
        ) {
            OverlayMouseMoveCoalesceResult::Ready {
                x,
                y,
                deferred_event:
                    Some(CaptureMouseHookEvent::OverlayUp {
                        x: up_x, y: up_y, ..
                    }),
                ..
            } => {
                assert_eq!((x, y), (300.0, 310.0));
                assert_eq!((up_x, up_y), (320.0, 330.0));
            }
            other => panic!("expected latest overlay move and deferred up, got {other:?}"),
        }
    }

    #[test]
    fn overlay_move_coalescing_does_not_cross_native_drag_preflight_boundaries() {
        let (sender, receiver) = mpsc::channel();
        sender
            .send(CaptureMouseHookEvent::OverlayMove {
                x: 400.0,
                y: 410.0,
                modifiers: modifiers(),
                native_drag_preflight: true,
            })
            .unwrap();

        match coalesce_overlay_mouse_move_until_emit(
            &receiver,
            100.0,
            110.0,
            modifiers(),
            false,
            Instant::now() - Duration::from_millis(20),
            Duration::from_millis(16),
        ) {
            OverlayMouseMoveCoalesceResult::Ready {
                x,
                y,
                native_drag_preflight,
                deferred_event:
                    Some(CaptureMouseHookEvent::OverlayMove {
                        x: deferred_x,
                        y: deferred_y,
                        native_drag_preflight: deferred_preflight,
                        ..
                    }),
                ..
            } => {
                assert_eq!((x, y, native_drag_preflight), (100.0, 110.0, false));
                assert_eq!(
                    (deferred_x, deferred_y, deferred_preflight),
                    (400.0, 410.0, true)
                );
            }
            other => panic!("expected a deferred preflight stream boundary, got {other:?}"),
        }
    }

    #[test]
    fn bounded_mouse_queue_coalesces_a_large_capture_move_flood() {
        let queue = CaptureMouseEventQueue::new(32, 4);

        for index in 0..100_000 {
            let result = queue.enqueue(CaptureMouseHookEvent::Move {
                x: index as f64,
                y: (index + 1) as f64,
                modifiers: modifiers(),
            });
            assert!(matches!(
                result,
                CaptureMouseEventEnqueueResult::Enqueued
                    | CaptureMouseEventEnqueueResult::CoalescedMove
            ));
        }

        let diagnostics = queue.diagnostics();
        assert_eq!(diagnostics.current_depth, 1);
        assert_eq!(diagnostics.max_depth, 1);
        assert_eq!(diagnostics.coalesced_moves, 99_999);
        assert_eq!(diagnostics.evicted_moves, 0);
        assert_eq!(diagnostics.dropped_moves, 0);
        assert_eq!(diagnostics.critical_overflows, 0);
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::Move {
                x: 99_999.0,
                y: 100_000.0,
                ..
            })
        ));
    }
