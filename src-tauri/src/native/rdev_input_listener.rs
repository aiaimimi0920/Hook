// Runs the global rdev listener and routes input into Hook's native state machines.

fn spawn_rdev_input_listener(
    window: tauri::WebviewWindow,
    hit_map_clone: SharedHitMap,
    capture_input_state_clone: SharedCaptureInputState,
    long_capture_sessions_clone: SharedLongCaptureSessions,
) {
    // Start Global Event Listener (Inputs)
    std::thread::spawn(move || {
        struct RdevInputRuntimeState {
            is_ignoring_events: bool,
            ctrl_pressed: bool,
            alt_pressed: bool,
            shift_pressed: bool,
            meta_pressed: bool,
            last_capture_trigger: std::time::Instant,
        }

        let input_runtime_state = std::sync::Mutex::new(RdevInputRuntimeState {
            is_ignoring_events: false,
            ctrl_pressed: false,
            alt_pressed: false,
            shift_pressed: false,
            meta_pressed: false,
            last_capture_trigger: std::time::Instant::now() - std::time::Duration::from_secs(2),
        });

        if let Err(error) = rdev::listen(move |event| {
            let mut input_state = match input_runtime_state.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };

            match &event.event_type {
                rdev::EventType::KeyPress(rdev::Key::Escape) => {
                    handle_rdev_emergency_escape_transition(true);
                }
                rdev::EventType::KeyRelease(rdev::Key::Escape) => {
                    handle_rdev_emergency_escape_transition(false);
                    return;
                }
                _ => {}
            }

            if NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst) {
                input_state.is_ignoring_events = true;
                input_state.ctrl_pressed = false;
                input_state.alt_pressed = false;
                input_state.shift_pressed = false;
                input_state.meta_pressed = false;
                return;
            }

            match &event.event_type {
                rdev::EventType::KeyPress(rdev::Key::ControlLeft)
                | rdev::EventType::KeyPress(rdev::Key::ControlRight) => {
                    input_state.ctrl_pressed = true;
                }
                rdev::EventType::KeyRelease(rdev::Key::ControlLeft)
                | rdev::EventType::KeyRelease(rdev::Key::ControlRight) => {
                    input_state.ctrl_pressed = false;
                }
                rdev::EventType::KeyPress(rdev::Key::Alt)
                | rdev::EventType::KeyPress(rdev::Key::AltGr) => {
                    input_state.alt_pressed = true;
                }
                rdev::EventType::KeyRelease(rdev::Key::Alt)
                | rdev::EventType::KeyRelease(rdev::Key::AltGr) => {
                    input_state.alt_pressed = false;
                }
                rdev::EventType::KeyPress(rdev::Key::ShiftLeft)
                | rdev::EventType::KeyPress(rdev::Key::ShiftRight) => {
                    input_state.shift_pressed = true;
                }
                rdev::EventType::KeyRelease(rdev::Key::ShiftLeft)
                | rdev::EventType::KeyRelease(rdev::Key::ShiftRight) => {
                    input_state.shift_pressed = false;
                }
                rdev::EventType::KeyPress(rdev::Key::MetaLeft)
                | rdev::EventType::KeyPress(rdev::Key::MetaRight) => {
                    input_state.meta_pressed = true;
                }
                rdev::EventType::KeyRelease(rdev::Key::MetaLeft)
                | rdev::EventType::KeyRelease(rdev::Key::MetaRight) => {
                    input_state.meta_pressed = false;
                }
                _ => {}
            }

            if let rdev::EventType::KeyPress(key) = &event.event_type {
                if let Some(vk_code) = rdev_key_to_vk_code(*key) {
                    let modifiers = shortcut_config::Modifiers {
                        ctrl: input_state.ctrl_pressed,
                        alt: input_state.alt_pressed,
                        shift: input_state.shift_pressed,
                        meta: input_state.meta_pressed,
                    };
                    if let Some(action) = shortcut_config::global_action(vk_code, modifiers) {
                        let handled_by_registered_shortcut =
                            configured_global_shortcut_is_registered(vk_code, modifiers);
                        if !handled_by_registered_shortcut {
                            let elapsed = input_state.last_capture_trigger.elapsed();
                            if elapsed > std::time::Duration::from_millis(500) {
                                input_state.last_capture_trigger = std::time::Instant::now();
                                match action {
                                    "capture" => enter_capture_mode(&window),
                                    "live_capture" => enter_live_capture_mode(&window),
                                    "long_capture" => enter_long_capture_mode(&window),
                                    "toggle_sticker_toolbar" => {
                                        trigger_toggle_sticker_toolbar(&window)
                                    }
                                    _ => {}
                                }
                                append_runtime_log_line(&format!(
                                    "rdev_configured_shortcut_triggered :: {action}"
                                ));
                                return;
                            }
                        }
                    }
                }
            }

            match &event.event_type {
                rdev::EventType::KeyPress(rdev::Key::ControlLeft)
                | rdev::EventType::KeyPress(rdev::Key::ControlRight) => {
                    input_state.ctrl_pressed = true;
                }
                rdev::EventType::KeyRelease(rdev::Key::ControlLeft)
                | rdev::EventType::KeyRelease(rdev::Key::ControlRight) => {
                    input_state.ctrl_pressed = false;
                }
                rdev::EventType::KeyPress(rdev::Key::Num1) => {
                    if input_state.ctrl_pressed
                        && !configured_global_shortcut_is_registered(
                            b'1' as u32,
                            shortcut_config::Modifiers {
                                ctrl: true,
                                ..shortcut_config::Modifiers::default()
                            },
                        )
                        && shortcut_config::action_matches(
                            "capture",
                            b'1' as u32,
                            shortcut_config::Modifiers {
                                ctrl: true,
                                ..shortcut_config::Modifiers::default()
                            },
                        )
                        && input_state.last_capture_trigger.elapsed()
                            > std::time::Duration::from_millis(500)
                    {
                        input_state.last_capture_trigger = std::time::Instant::now();
                        append_runtime_log_line("rdev_ctrl1_triggered");
                        enter_capture_mode(&window);
                    }
                }
                rdev::EventType::KeyPress(rdev::Key::Num3) => {
                    if input_state.ctrl_pressed
                        && !configured_global_shortcut_is_registered(
                            b'3' as u32,
                            shortcut_config::Modifiers {
                                ctrl: true,
                                ..shortcut_config::Modifiers::default()
                            },
                        )
                        && shortcut_config::action_matches(
                            "long_capture",
                            b'3' as u32,
                            shortcut_config::Modifiers {
                                ctrl: true,
                                ..shortcut_config::Modifiers::default()
                            },
                        )
                        && input_state.last_capture_trigger.elapsed()
                            > std::time::Duration::from_millis(500)
                    {
                        input_state.last_capture_trigger = std::time::Instant::now();
                        append_runtime_log_line("rdev_ctrl3_triggered");
                        enter_long_capture_mode(&window);
                    }
                }
                rdev::EventType::KeyPress(rdev::Key::Escape) => {
                    let modifiers = shortcut_config::Modifiers {
                        ctrl: input_state.ctrl_pressed,
                        alt: input_state.alt_pressed,
                        shift: input_state.shift_pressed,
                        meta: input_state.meta_pressed,
                    };
                    if !shortcut_config::action_matches("cancel", 0x1B, modifiers)
                        && !shortcut_config::action_matches("delete_unit", 0x1B, modifiers)
                    {
                        return;
                    }
                    if overlay_keyboard_capture_should_handle_current_cursor() {
                        append_runtime_log_line("rdev_escape_skipped_overlay_keyboard_capture");
                        return;
                    }
                    let capture_active = capture_input_state_clone
                        .active
                        .lock()
                        .map(|guard| *guard)
                        .unwrap_or(false)
                        || CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst);
                    let app_has_focus = overlay_webview_has_foreground_focus();
                    if !rdev_should_dispatch_app_scoped_shortcut(
                        RdevAppScopedShortcut::Escape,
                        app_has_focus,
                        capture_active,
                    ) {
                        append_runtime_log_line("rdev_escape_skipped_unfocused_app_scope");
                        return;
                    }
                    append_runtime_log_line("rdev_escape_triggered");
                    set_capture_input_runtime_active(false);
                    let _ = window.emit("trigger-escape", ());
                }
                rdev::EventType::KeyPress(rdev::Key::Delete)
                | rdev::EventType::KeyPress(rdev::Key::Backspace) => {
                    let vk_code = match event.event_type {
                        rdev::EventType::KeyPress(rdev::Key::Delete) => 0x2E,
                        _ => 0x08,
                    };
                    let modifiers = shortcut_config::Modifiers {
                        ctrl: input_state.ctrl_pressed,
                        alt: input_state.alt_pressed,
                        shift: input_state.shift_pressed,
                        meta: input_state.meta_pressed,
                    };
                    if !shortcut_config::action_matches("delete_unit", vk_code, modifiers)
                        && !shortcut_config::action_matches("cancel", vk_code, modifiers)
                    {
                        return;
                    }
                    if overlay_keyboard_capture_should_handle_current_cursor() {
                        append_runtime_log_line("rdev_delete_skipped_overlay_keyboard_capture");
                        return;
                    }
                    let app_has_focus = overlay_webview_has_foreground_focus();
                    if !rdev_should_dispatch_app_scoped_shortcut(
                        RdevAppScopedShortcut::Delete,
                        app_has_focus,
                        false,
                    ) {
                        append_runtime_log_line("rdev_delete_skipped_unfocused_app_scope");
                        return;
                    }
                    append_runtime_log_line("rdev_delete_triggered");
                    let _ = window.emit("trigger-delete", ());
                }
                rdev::EventType::KeyPress(rdev::Key::Return) => {
                    append_runtime_log_line("rdev_enter_triggered");
                    let _ = window.emit("trigger-long-capture-finish", ());
                }
                rdev::EventType::Wheel { delta_x, delta_y } => {
                    let capture_active = capture_input_state_clone
                        .active
                        .lock()
                        .map(|guard| *guard)
                        .unwrap_or(false);
                    if capture_active {
                        return;
                    }

                    let has_long_capture_sessions = long_capture_sessions_clone
                        .sessions
                        .lock()
                        .ok()
                        .map(|sessions| !sessions.is_empty())
                        .unwrap_or(false);
                    if has_long_capture_sessions {
                        append_runtime_log_line(&format!(
                            "rdev_long_capture_wheel :: delta_x={} delta_y={}",
                            delta_x, delta_y
                        ));
                        let _ = window.emit(
                            "trigger-long-capture-wheel",
                            LongCaptureWheelEvent {
                                delta_x: *delta_x,
                                delta_y: *delta_y,
                            },
                        );
                    }
                }
                rdev::EventType::MouseMove { x, y } => {
                    let _ = (x, y);
                    if NATIVE_FILE_DRAG_ACTIVE.load(Ordering::SeqCst)
                        || NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst)
                    {
                        input_state.is_ignoring_events = true;
                        return;
                    }
                    let capture_active = capture_input_state_clone
                        .active
                        .lock()
                        .map(|guard| *guard)
                        .unwrap_or(false);
                    if capture_active {
                        return;
                    }
                    if should_suppress_overlay_interaction_for_current_occlusion() {
                        if !input_state.is_ignoring_events {
                            let _ = window.set_ignore_cursor_events(true);
                            set_overlay_transparent_style(&window, true);
                            OVERLAY_CLICK_THROUGH_ACTIVE.store(true, Ordering::SeqCst);
                            apply_overlay_no_activate(&window);
                            input_state.is_ignoring_events = true;
                        }
                        return;
                    }

                    // Hit Testing Logic
                    let active = hit_map_clone
                        .active
                        .lock()
                        .map(|guard| *guard)
                        .unwrap_or(false);
                    if active {
                        let should_ignore = hit_map_clone
                            .rectangles
                            .lock()
                            .map(|rects| should_overlay_window_ignore_cursor_events(&rects, *x, *y))
                            .unwrap_or(true);
                        if should_ignore != input_state.is_ignoring_events {
                            let _ = window.set_ignore_cursor_events(should_ignore);
                            set_overlay_transparent_style(&window, should_ignore);
                            OVERLAY_CLICK_THROUGH_ACTIVE.store(should_ignore, Ordering::SeqCst);
                            apply_overlay_no_activate(&window);
                            input_state.is_ignoring_events = should_ignore;
                        }
                    } else {
                        input_state.is_ignoring_events = false;
                    }
                }
                _ => {}
            }
        }) {
            console_line!("Error: {:?}", error);
            append_runtime_log_line(&format!("rdev_listen_failed :: {:?}", error));
        }
    });
}
