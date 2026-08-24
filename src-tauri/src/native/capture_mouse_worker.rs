// Consumes queued mouse-hook events and emits normalized UI events.

#[cfg(target_os = "windows")]
fn install_capture_mouse_hook_thread(window: tauri::WebviewWindow) {
    let queue = Arc::new(CaptureMouseEventQueue::new(
        CAPTURE_MOUSE_EVENT_QUEUE_CAPACITY,
        CAPTURE_MOUSE_EVENT_EDGE_RESERVE,
    ));
    if CAPTURE_MOUSE_EVENT_QUEUE.set(Arc::clone(&queue)).is_err() {
        append_runtime_log_line("capture_mouse_event_queue_already_initialized");
        return;
    }

    let emit_window = window.clone();
    let _ = std::thread::Builder::new()
        .name("hook-capture-mouse-events".to_string())
        .spawn(move || {
            let mut deferred_event: Option<CaptureMouseHookEvent> = None;
            let mut cached_metrics = capture_window_metrics(&emit_window);
            let mut last_capture_move_emit = Instant::now() - CAPTURE_MOUSE_MOVE_EMIT_INTERVAL;
            let mut last_overlay_move_emit = Instant::now() - OVERLAY_MOUSE_MOVE_EMIT_INTERVAL;
            let mut last_queue_diagnostic_log = Instant::now();
            let mut last_queue_diagnostics = queue.diagnostics();
            loop {
                let event = match deferred_event.take() {
                    Some(event) => event,
                    None => match queue.recv() {
                        Ok(event) => event,
                        Err(_) => break,
                    },
                };
                log_capture_mouse_queue_diagnostics_if_due(
                    &queue,
                    &mut last_queue_diagnostic_log,
                    &mut last_queue_diagnostics,
                );

                match event {
                    CaptureMouseHookEvent::Move {
                        x,
                        y,
                        modifiers,
                    } => {
                        match coalesce_capture_mouse_move_until_emit(
                            queue.as_ref(),
                            x,
                            y,
                            modifiers,
                            last_capture_move_emit,
                            CAPTURE_MOUSE_MOVE_EMIT_INTERVAL,
                        ) {
                            CaptureMouseMoveCoalesceResult::Ready {
                                x: latest_x,
                                y: latest_y,
                                modifiers: latest_modifiers,
                                deferred_event: next,
                            } => {
                                deferred_event = next;
                                emit_capture_mouse_event(
                                    &emit_window,
                                    "capture/global_mouse_move",
                                    latest_x,
                                    latest_y,
                                    latest_modifiers,
                                    false,
                                    cached_metrics,
                                );
                                last_capture_move_emit = Instant::now();
                            }
                            CaptureMouseMoveCoalesceResult::Disconnected => return,
                        }
                    }
                    CaptureMouseHookEvent::Down { x, y, modifiers } => {
                        cached_metrics = capture_window_metrics(&emit_window).or(cached_metrics);
                        emit_capture_mouse_event(
                            &emit_window,
                            "capture/global_mouse_down",
                            x,
                            y,
                            modifiers,
                            false,
                            cached_metrics,
                        );
                    }
                    CaptureMouseHookEvent::OverlayDown {
                        x,
                        y,
                        modifiers,
                        native_drag_preflight,
                        source,
                        continuation,
                    } => {
                        cached_metrics = capture_window_metrics(&emit_window).or(cached_metrics);
                        sync_overlay_input_shield_from_runtime_state(&emit_window);
                        emit_capture_mouse_event(
                            &emit_window,
                            if continuation {
                                append_runtime_log_line(&format!(
                                    "overlay_mouse_up_down_bounce_suppressed :: source={} continue_x={} continue_y={}",
                                    source.log_name(),
                                    x,
                                    y
                                ));
                                "overlay/global_mouse_move"
                            } else {
                                "overlay/global_mouse_down"
                            },
                            x,
                            y,
                            modifiers,
                            native_drag_preflight,
                            cached_metrics,
                        );
                        if continuation {
                            last_overlay_move_emit = Instant::now();
                        }
                    }
                    CaptureMouseHookEvent::OverlayMove {
                        x,
                        y,
                        modifiers,
                        native_drag_preflight,
                    } => match coalesce_overlay_mouse_move_until_emit(
                        queue.as_ref(),
                        x,
                        y,
                        modifiers,
                        native_drag_preflight,
                        last_overlay_move_emit,
                        select_overlay_mouse_move_emit_interval(overlay_sticker_drag_active()),
                    ) {
                        OverlayMouseMoveCoalesceResult::Ready {
                            x: latest_x,
                            y: latest_y,
                            modifiers: latest_modifiers,
                            native_drag_preflight: latest_native_drag_preflight,
                            deferred_event: next,
                        } => {
                            deferred_event = next;
                            // The queue sample can already be several milliseconds
                            // old by the time Tauri IPC starts. During a sticker
                            // drag, sample the hardware cursor again at the last
                            // native boundary so the webview receives the freshest
                            // possible position.
                            let (emit_x, emit_y) = if overlay_sticker_drag_active() {
                                current_cursor_position_physical()
                                    .unwrap_or((latest_x, latest_y))
                            } else {
                                (latest_x, latest_y)
                            };
                            emit_capture_mouse_event(
                                &emit_window,
                                "overlay/global_mouse_move",
                                emit_x,
                                emit_y,
                                latest_modifiers,
                                latest_native_drag_preflight,
                                cached_metrics,
                            );
                            last_overlay_move_emit = Instant::now();
                        }
                        OverlayMouseMoveCoalesceResult::Disconnected => return,
                    },
                    CaptureMouseHookEvent::Up { x, y, modifiers } => {
                        match wait_for_capture_mouse_up_debounce(
                            queue.as_ref(),
                            CAPTURE_MOUSE_UP_BOUNCE_WINDOW,
                        ) {
                            CaptureMouseUpDebounceResult::Continue {
                                x: continue_x,
                                y: continue_y,
                                modifiers: continue_modifiers,
                            } => {
                                append_runtime_log_line(&format!(
                                    "capture_mouse_up_down_bounce_suppressed :: up_x={} up_y={} continue_x={} continue_y={}",
                                    x, y, continue_x, continue_y
                                ));
                                emit_capture_mouse_event(
                                    &emit_window,
                                    "capture/global_mouse_move",
                                    continue_x,
                                    continue_y,
                                    continue_modifiers,
                                    false,
                                    cached_metrics,
                                );
                                last_capture_move_emit = Instant::now();
                            }
                            CaptureMouseUpDebounceResult::Release { deferred_event: next } => {
                                deferred_event = next;
                                emit_capture_mouse_event(
                                    &emit_window,
                                    "capture/global_mouse_up",
                                    x,
                                    y,
                                    modifiers,
                                    false,
                                    cached_metrics,
                                );
                            }
                            CaptureMouseUpDebounceResult::Disconnected => return,
                        }
                    }
                    CaptureMouseHookEvent::OverlayUp {
                        x,
                        y,
                        modifiers,
                        native_drag_preflight,
                        source,
                    } => {
                        match wait_for_overlay_mouse_up_debounce(
                            queue.as_ref(),
                            source,
                            OVERLAY_MOUSE_UP_BOUNCE_WINDOW,
                        ) {
                            OverlayMouseUpDebounceResult::Continue {
                                x: continue_x,
                                y: continue_y,
                                modifiers: continue_modifiers,
                                native_drag_preflight: continue_native_drag_preflight,
                            } => {
                                append_runtime_log_line(&format!(
                                    "overlay_mouse_up_down_bounce_suppressed :: source={} up_x={} up_y={} continue_x={} continue_y={}",
                                    source.log_name(),
                                    x,
                                    y,
                                    continue_x,
                                    continue_y
                                ));
                                sync_overlay_input_shield_from_runtime_state(&emit_window);
                                emit_capture_mouse_event(
                                    &emit_window,
                                    "overlay/global_mouse_move",
                                    continue_x,
                                    continue_y,
                                    continue_modifiers,
                                    continue_native_drag_preflight,
                                    cached_metrics,
                                );
                                last_overlay_move_emit = Instant::now();
                            }
                            OverlayMouseUpDebounceResult::Release {
                                deferred_event: next,
                                latest_move,
                            } => {
                                deferred_event = next;
                                match resolve_overlay_pointer_release(
                                    &OVERLAY_POINTER_STATE,
                                    source,
                                    overlay_primary_button_physically_down(),
                                ) {
                                    OverlayPointerReleaseResult::SuppressedPhysicalDown => {
                                        let resume_point = latest_move.unwrap_or(
                                            OverlayMouseMoveSnapshot {
                                                x,
                                                y,
                                                modifiers,
                                                native_drag_preflight,
                                            },
                                        );
                                        append_runtime_log_line(&format!(
                                            "overlay_mouse_up_physical_button_down_suppressed :: source={} x={} y={}",
                                            source.log_name(),
                                            resume_point.x,
                                            resume_point.y
                                        ));
                                        sync_overlay_input_shield_from_runtime_state(&emit_window);
                                        emit_capture_mouse_event(
                                            &emit_window,
                                            "overlay/global_mouse_move",
                                            resume_point.x,
                                            resume_point.y,
                                            resume_point.modifiers,
                                            resume_point.native_drag_preflight,
                                            cached_metrics,
                                        );
                                        last_overlay_move_emit = Instant::now();
                                    }
                                    OverlayPointerReleaseResult::Released => {
                                        OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(false, Ordering::SeqCst);
                                        let synthetic_drag_active =
                                            OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE
                                                .swap(false, Ordering::SeqCst);
                                        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE
                                            .store(false, Ordering::SeqCst);
                                        let direct_drag_active =
                                            OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE
                                                .swap(false, Ordering::SeqCst);
                                        let pointer_still_over_overlay =
                                            should_route_overlay_mouse_events(x, y);
                                        OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(
                                            pointer_still_over_overlay,
                                            Ordering::SeqCst,
                                        );
                                        match source {
                                            OverlayPointerSource::LowLevelHook => {
                                                append_runtime_log_line(&format!(
                                                    "overlay_drag_end :: synthetic={} x={} y={}",
                                                    synthetic_drag_active, x, y
                                                ));
                                            }
                                            OverlayPointerSource::InputShield => {
                                                append_runtime_log_line(&format!(
                                                    "overlay_input_shield_drag_end :: direct={} x={} y={}",
                                                    direct_drag_active, x, y
                                                ));
                                            }
                                        }
                                        sync_overlay_input_shield_from_runtime_state(&emit_window);
                                        emit_capture_mouse_event(
                                            &emit_window,
                                            "overlay/global_mouse_up",
                                            x,
                                            y,
                                            modifiers,
                                            native_drag_preflight,
                                            cached_metrics,
                                        );
                                    }
                                    OverlayPointerReleaseResult::Superseded => {
                                        append_runtime_log_line(&format!(
                                            "overlay_mouse_up_release_superseded :: source={} x={} y={}",
                                            source.log_name(),
                                            x,
                                            y
                                        ));
                                    }
                                }
                            }
                            OverlayMouseUpDebounceResult::Disconnected => return,
                        }
                    }
                    CaptureMouseHookEvent::Wheel { x, y, modifiers } => {
                        let _ = (x, y, modifiers);
                    }
                    CaptureMouseHookEvent::OverlayWheel {
                        x,
                        y,
                        delta_y,
                        modifiers,
                    } => {
                        emit_overlay_wheel_event(
                            &emit_window,
                            "overlay/global_mouse_wheel",
                            x,
                            y,
                            delta_y,
                            modifiers,
                            cached_metrics,
                        );
                    }
                    CaptureMouseHookEvent::OverlayContextMenu { x, y, modifiers } => {
                        emit_capture_mouse_event(
                            &emit_window,
                            "overlay/global_context_menu",
                            x,
                            y,
                            modifiers,
                            false,
                            cached_metrics,
                        );
                    }
                }
            }
        });

    let _ = std::thread::Builder::new()
        .name("hook-capture-mouse-hook".to_string())
        .spawn(move || {
            let hook = match unsafe {
                SetWindowsHookExW(WH_MOUSE_LL, Some(capture_mouse_hook_proc), None, 0)
            } {
                Ok(hook) => {
                    append_runtime_log_line("capture_mouse_hook_install_success");
                    hook
                }
                Err(error) => {
                    append_runtime_log_line(&format!(
                        "capture_mouse_hook_install_failed :: {}",
                        error
                    ));
                    return;
                }
            };

            let mut msg = MSG::default();
            while unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
                let _ = unsafe { TranslateMessage(&msg) };
                unsafe { DispatchMessageW(&msg) };
            }
            let _ = unsafe { UnhookWindowsHookEx(hook) };
            append_runtime_log_line("capture_mouse_hook_thread_exited");
        });
}

#[cfg(not(target_os = "windows"))]
fn install_capture_mouse_hook_thread(_window: tauri::WebviewWindow) {}
