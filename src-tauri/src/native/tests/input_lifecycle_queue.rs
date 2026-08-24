// Covers bounded queues, emergency escape, occlusion, and Alt passthrough.

    #[test]
    fn bounded_mouse_queue_preserves_down_up_order_inside_move_floods() {
        let queue = CaptureMouseEventQueue::new(32, 4);

        for index in 0..10_000 {
            let _ = queue.enqueue(CaptureMouseHookEvent::Move {
                x: index as f64,
                y: 10.0,
                modifiers: modifiers(),
            });
        }
        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::Down {
                x: 10_000.0,
                y: 20.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::Enqueued
        );
        for index in 0..10_000 {
            let _ = queue.enqueue(CaptureMouseHookEvent::Move {
                x: (20_000 + index) as f64,
                y: 30.0,
                modifiers: modifiers(),
            });
        }
        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::Up {
                x: 30_000.0,
                y: 40.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::Enqueued
        );

        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::Move { x: 9_999.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::Down { x: 10_000.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::Move { x: 29_999.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::Up { x: 30_000.0, .. })
        ));
        assert!(matches!(queue.try_recv(), Err(mpsc::TryRecvError::Empty)));

        let diagnostics = queue.diagnostics();
        assert_eq!(diagnostics.current_depth, 0);
        assert_eq!(diagnostics.max_depth, 4);
        assert_eq!(diagnostics.enqueued_edges, 2);
        assert_eq!(diagnostics.critical_overflows, 0);
    }

    #[test]
    fn bounded_mouse_queue_keeps_overlay_preflight_stream_boundaries() {
        let queue = CaptureMouseEventQueue::new(16, 4);
        for (x, native_drag_preflight) in
            [(100.0, false), (200.0, true), (300.0, true), (400.0, false)]
        {
            let _ = queue.enqueue(CaptureMouseHookEvent::OverlayMove {
                x,
                y: x + 1.0,
                modifiers: modifiers(),
                native_drag_preflight,
            });
        }

        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayMove {
                x: 100.0,
                native_drag_preflight: false,
                ..
            })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayMove {
                x: 300.0,
                native_drag_preflight: true,
                ..
            })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayMove {
                x: 400.0,
                native_drag_preflight: false,
                ..
            })
        ));
        assert!(matches!(queue.try_recv(), Err(mpsc::TryRecvError::Empty)));
        assert_eq!(queue.diagnostics().coalesced_moves, 1);
    }

    #[test]
    fn bounded_mouse_queue_reserves_capacity_for_button_edges() {
        let queue = CaptureMouseEventQueue::new(8, 2);

        for index in 0..3 {
            let _ = queue.enqueue(CaptureMouseHookEvent::Move {
                x: index as f64,
                y: 0.0,
                modifiers: modifiers(),
            });
            let _ = queue.enqueue(CaptureMouseHookEvent::OverlayContextMenu {
                x: index as f64,
                y: 1.0,
                modifiers: modifiers(),
            });
        }
        assert_eq!(queue.diagnostics().current_depth, 6);
        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::Move {
                x: 99.0,
                y: 100.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::EnqueuedAfterEvictingMove
        );
        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::Down {
                x: 101.0,
                y: 102.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::Enqueued
        );
        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::Up {
                x: 103.0,
                y: 104.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::Enqueued
        );

        let mut saw_down = false;
        let mut saw_up = false;
        while let Ok(event) = queue.try_recv() {
            match event {
                CaptureMouseHookEvent::Down { .. } => saw_down = true,
                CaptureMouseHookEvent::Up { .. } => {
                    assert!(saw_down);
                    saw_up = true;
                }
                _ => {}
            }
        }
        assert!(saw_down && saw_up);
        let diagnostics = queue.diagnostics();
        assert_eq!(diagnostics.current_depth, 0);
        assert_eq!(diagnostics.max_depth, 8);
        assert_eq!(diagnostics.evicted_moves, 1);
        assert_eq!(diagnostics.critical_overflows, 0);
    }

    #[test]
    fn bounded_mouse_queue_reports_edge_only_overflow_without_growing() {
        let queue = CaptureMouseEventQueue::new(3, 1);
        let _ = queue.enqueue(CaptureMouseHookEvent::Down {
            x: 1.0,
            y: 2.0,
            modifiers: modifiers(),
        });
        let _ = queue.enqueue(CaptureMouseHookEvent::Up {
            x: 3.0,
            y: 4.0,
            modifiers: modifiers(),
        });
        let _ = queue.enqueue(CaptureMouseHookEvent::OverlayContextMenu {
            x: 5.0,
            y: 6.0,
            modifiers: modifiers(),
        });

        assert_eq!(
            queue.enqueue(CaptureMouseHookEvent::OverlayWheel {
                x: 7.0,
                y: 8.0,
                delta_y: 120.0,
                modifiers: modifiers(),
            }),
            CaptureMouseEventEnqueueResult::CriticalOverflow
        );
        let diagnostics = queue.diagnostics();
        assert_eq!(diagnostics.current_depth, 3);
        assert_eq!(diagnostics.max_depth, 3);
        assert_eq!(diagnostics.enqueued_edges, 3);
        assert_eq!(diagnostics.critical_overflows, 1);
    }

    #[test]
    fn bounded_mouse_queue_preserves_overlay_edges_and_actions_between_move_floods() {
        let queue = CaptureMouseEventQueue::new(12, 4);
        let source = OverlayPointerSource::LowLevelHook;
        let _ = queue.enqueue(CaptureMouseHookEvent::OverlayDown {
            x: 1.0,
            y: 2.0,
            modifiers: modifiers(),
            native_drag_preflight: false,
            source,
            continuation: false,
        });
        for index in 0..1_000 {
            let _ = queue.enqueue(CaptureMouseHookEvent::OverlayMove {
                x: index as f64,
                y: 3.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            });
        }
        let _ = queue.enqueue(CaptureMouseHookEvent::OverlayWheel {
            x: 1_000.0,
            y: 4.0,
            delta_y: 120.0,
            modifiers: modifiers(),
        });
        for index in 0..1_000 {
            let _ = queue.enqueue(CaptureMouseHookEvent::OverlayMove {
                x: (1_000 + index) as f64,
                y: 5.0,
                modifiers: modifiers(),
                native_drag_preflight: false,
            });
        }
        let _ = queue.enqueue(CaptureMouseHookEvent::OverlayContextMenu {
            x: 2_000.0,
            y: 6.0,
            modifiers: modifiers(),
        });
        let _ = queue.enqueue(CaptureMouseHookEvent::OverlayUp {
            x: 2_001.0,
            y: 7.0,
            modifiers: modifiers(),
            native_drag_preflight: false,
            source,
        });

        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayDown { .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayMove { x: 999.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayWheel { delta_y: 120.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayMove { x: 1_999.0, .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayContextMenu { .. })
        ));
        assert!(matches!(
            queue.try_recv(),
            Ok(CaptureMouseHookEvent::OverlayUp { .. })
        ));
        assert!(matches!(queue.try_recv(), Err(mpsc::TryRecvError::Empty)));
        let diagnostics = queue.diagnostics();
        assert_eq!(diagnostics.enqueued_edges, 4);
        assert_eq!(diagnostics.coalesced_moves, 1_998);
        assert_eq!(diagnostics.critical_overflows, 0);
    }

    #[test]
    fn bounded_mouse_queue_receiver_times_out_and_wakes_for_an_edge() {
        let queue = Arc::new(CaptureMouseEventQueue::new(8, 2));
        assert!(matches!(
            queue.recv_timeout(Duration::ZERO),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        let producer_queue = Arc::clone(&queue);
        let producer = thread::spawn(move || {
            thread::sleep(Duration::from_millis(5));
            producer_queue.enqueue(CaptureMouseHookEvent::Up {
                x: 10.0,
                y: 20.0,
                modifiers: modifiers(),
            })
        });

        assert!(matches!(
            queue.recv_timeout(Duration::from_secs(1)),
            Ok(CaptureMouseHookEvent::Up {
                x: 10.0,
                y: 20.0,
                ..
            })
        ));
        assert_eq!(
            producer.join().unwrap(),
            CaptureMouseEventEnqueueResult::Enqueued
        );
    }

    #[test]
    fn triple_escape_requires_three_distinct_presses_inside_the_emergency_window() {
        let started_at = Instant::now();
        let mut tracker = EmergencyEscapeTracker::default();

        assert!(!tracker.record_press(started_at));
        assert!(!tracker.record_press(started_at + Duration::from_millis(100)));
        assert!(tracker.record_press(started_at + Duration::from_millis(200)));

        let mut expired_tracker = EmergencyEscapeTracker::default();
        assert!(!expired_tracker.record_press(started_at));
        assert!(!expired_tracker.record_press(started_at + EMERGENCY_ESCAPE_WINDOW));
        assert!(!expired_tracker
            .record_press(started_at + EMERGENCY_ESCAPE_WINDOW + Duration::from_millis(100)));
    }

    #[test]
    fn keyboard_hook_and_rdev_escape_edges_do_not_suppress_each_other() {
        let keyboard_down = AtomicBool::new(false);
        let keyboard_tracker = OnceLock::<Mutex<EmergencyEscapeTracker>>::new();
        let rdev_down = AtomicBool::new(false);
        let rdev_tracker = OnceLock::<Mutex<EmergencyEscapeTracker>>::new();

        assert!(handle_emergency_escape_transition_with(
            &keyboard_down,
            &keyboard_tracker,
            true,
            "keyboard_test",
        ));
        assert!(handle_emergency_escape_transition_with(
            &rdev_down,
            &rdev_tracker,
            true,
            "rdev_test",
        ));
        assert!(!handle_emergency_escape_transition_with(
            &keyboard_down,
            &keyboard_tracker,
            true,
            "keyboard_test",
        ));
        assert!(!handle_emergency_escape_transition_with(
            &rdev_down,
            &rdev_tracker,
            true,
            "rdev_test",
        ));
    }

    #[test]
    fn fullscreen_occlusion_suppresses_only_new_overlay_interactions() {
        assert!(should_suppress_overlay_interaction_for_occlusion(
            true, false, false, false, false,
        ));
        assert!(!should_suppress_overlay_interaction_for_occlusion(
            false, false, false, false, false,
        ));
        assert!(!should_suppress_overlay_interaction_for_occlusion(
            true, true, false, false, false,
        ));
        assert!(!should_suppress_overlay_interaction_for_occlusion(
            true, false, true, false, false,
        ));
        assert!(!should_suppress_overlay_interaction_for_occlusion(
            true, false, false, true, false,
        ));
        assert!(!should_suppress_overlay_interaction_for_occlusion(
            true, false, false, false, true,
        ));
    }

    #[test]
    fn fullscreen_coverage_requires_the_foreground_window_to_cover_the_overlay() {
        let overlay = RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        };
        assert!(rect_covers_rect_with_tolerance(
            RECT {
                left: -8,
                top: -8,
                right: 1928,
                bottom: 1088,
            },
            overlay,
            8,
        ));
        assert!(!rect_covers_rect_with_tolerance(
            RECT {
                left: 0,
                top: 0,
                right: 1920,
                bottom: 1040,
            },
            overlay,
            8,
        ));
        assert!(!rect_covers_rect_with_tolerance(
            RECT {
                left: 300,
                top: 100,
                right: 1600,
                bottom: 1000,
            },
            overlay,
            8,
        ));
    }

    #[test]
    fn foreign_alt_input_fails_open_except_during_capture_or_an_existing_drag() {
        assert!(should_passthrough_foreign_alt_input(
            true, false, false, false, false,
        ));
        assert!(!should_passthrough_foreign_alt_input(
            false, false, false, false, false,
        ));
        assert!(!should_passthrough_foreign_alt_input(
            true, true, false, false, false,
        ));
        assert!(!should_passthrough_foreign_alt_input(
            true, false, true, false, false,
        ));
        assert!(!should_passthrough_foreign_alt_input(
            true, false, false, true, false,
        ));
        assert!(!should_passthrough_foreign_alt_input(
            true, false, false, false, true,
        ));
    }

    #[test]
    fn foreign_alt_wheel_routes_only_when_the_pointer_is_over_hook() {
        assert!(!should_passthrough_foreign_alt_mouse_input(
            true, false, false, false, false, true, true,
        ));
        assert!(should_passthrough_foreign_alt_mouse_input(
            true, false, false, false, false, true, false,
        ));
        assert!(should_passthrough_foreign_alt_mouse_input(
            true, false, false, false, false, false, true,
        ));
        assert!(!should_passthrough_foreign_alt_mouse_input(
            false, false, false, false, false, true, true,
        ));
    }
