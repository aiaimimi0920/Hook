// Routes native mouse messages through the overlay input shield.

#[cfg(target_os = "windows")]
fn route_overlay_input_shield_mouse_message(message: u32, wparam: WPARAM) -> Option<LRESULT> {
    if NATIVE_FILE_DRAG_ACTIVE.load(Ordering::SeqCst)
        || NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst)
    {
        return None;
    }

    let (x, y) = current_cursor_position_physical()?;
    let modifiers = current_modifier_snapshot();
    let should_route_overlay_mouse = should_route_overlay_mouse_events(x, y);
    let hook_hover_active = OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.load(Ordering::SeqCst);
    let direct_drag_active = OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.load(Ordering::SeqCst);
    let native_drag_preflight_active =
        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
    let overlay_pointer_session_active =
        OVERLAY_POINTER_STATE.load(Ordering::SeqCst) != OVERLAY_POINTER_STATE_NONE;
    let configured_drag_out_active = shortcut_config::gesture_matches(
        "drag_out",
        shortcut_config::Modifiers {
            ctrl: modifiers.ctrl_pressed,
            alt: modifiers.alt_pressed,
            shift: modifiers.shift_pressed,
            meta: modifiers.meta_pressed,
        },
    ) && is_pointer_over_sticker_body_synthetic_rect(x, y);
    if modifiers.alt_pressed
        && !configured_drag_out_active
        && should_passthrough_foreign_alt_mouse_input(
            true,
            CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst),
            direct_drag_active,
            native_drag_preflight_active,
            hook_process_has_foreground_window(),
            message == WM_MOUSEWHEEL,
            should_route_overlay_mouse,
        )
    {
        set_overlay_input_shield_alt_passthrough(true);
        return None;
    }
    if !modifiers.alt_pressed {
        set_overlay_input_shield_alt_passthrough(false);
    }

    match message {
        WM_MOUSEMOVE => {
            if overlay_pointer_source_owns_session(OverlayPointerSource::LowLevelHook) {
                return Some(LRESULT(1));
            }
            if direct_drag_active || native_drag_preflight_active {
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayMove {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight: native_drag_preflight_active,
                });
                return Some(LRESULT(1));
            }

            if should_route_overlay_mouse && !hook_hover_active {
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayMove {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight: false,
                });
                return Some(LRESULT(1));
            }
        }
        WM_LBUTTONDOWN => {
            if should_route_overlay_mouse || overlay_pointer_session_active {
                let source = OverlayPointerSource::InputShield;
                match claim_overlay_pointer_down(&OVERLAY_POINTER_STATE, source) {
                    OverlayPointerDownTransition::Started => {
                        let configured_sticker_native_drag_preflight =
                            shortcut_config::gesture_matches(
                                "drag_out",
                                shortcut_config::Modifiers {
                                    ctrl: modifiers.ctrl_pressed,
                                    alt: modifiers.alt_pressed,
                                    shift: modifiers.shift_pressed,
                                    meta: modifiers.meta_pressed,
                                },
                            ) && is_pointer_over_sticker_body_synthetic_rect(x, y);
                        if configured_sticker_native_drag_preflight {
                            OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.store(false, Ordering::SeqCst);
                            OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE
                                .store(true, Ordering::SeqCst);
                            append_runtime_log_line(&format!(
                                "overlay_input_shield_native_drag_preflight_start :: x={} y={}",
                                x, y
                            ));
                            queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown {
                                x,
                                y,
                                modifiers,
                                native_drag_preflight: true,
                                source,
                                continuation: false,
                            });
                            return Some(LRESULT(1));
                        }

                        OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE
                            .store(false, Ordering::SeqCst);
                        promote_overlay_input_shield_to_fullscreen();
                        append_runtime_log_line(&format!(
                            "overlay_input_shield_drag_start :: x={} y={}",
                            x, y
                        ));
                        queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown {
                            x,
                            y,
                            modifiers,
                            native_drag_preflight: false,
                            source,
                            continuation: false,
                        });
                        return Some(LRESULT(1));
                    }
                    OverlayPointerDownTransition::Continued => {
                        let native_drag_preflight =
                            OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
                        if !native_drag_preflight {
                            OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                            promote_overlay_input_shield_to_fullscreen();
                        }
                        append_runtime_log_line(&format!(
                            "overlay_drag_recovery_down :: source={} x={} y={}",
                            source.log_name(),
                            x,
                            y
                        ));
                        queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown {
                            x,
                            y,
                            modifiers,
                            native_drag_preflight,
                            source,
                            continuation: true,
                        });
                        return Some(LRESULT(1));
                    }
                    OverlayPointerDownTransition::IgnoredDuplicate
                    | OverlayPointerDownTransition::IgnoredForeignOwner => {
                        return Some(LRESULT(1));
                    }
                }
            }
        }
        WM_LBUTTONUP => {
            let source = OverlayPointerSource::InputShield;
            match claim_overlay_pointer_up(&OVERLAY_POINTER_STATE, source) {
                OverlayPointerUpTransition::Candidate => {
                    let native_drag_preflight =
                        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
                    append_runtime_log_line(&format!(
                        "overlay_drag_up_candidate :: source={} x={} y={}",
                        source.log_name(),
                        x,
                        y
                    ));
                    queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayUp {
                        x,
                        y,
                        modifiers,
                        native_drag_preflight,
                        source,
                    });
                    return Some(LRESULT(1));
                }
                OverlayPointerUpTransition::IgnoredDuplicate
                | OverlayPointerUpTransition::IgnoredForeignOwner => {
                    return Some(LRESULT(1));
                }
                OverlayPointerUpTransition::IgnoredUnpaired => {}
            }
        }
        WM_MOUSEWHEEL => {
            if should_route_overlay_mouse && !hook_hover_active {
                let delta_y = (((wparam.0 >> 16) & 0xffff) as i16) as f64;
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayWheel {
                    x,
                    y,
                    delta_y,
                    modifiers,
                });
                return Some(LRESULT(1));
            }
        }
        WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_MBUTTONUP | WM_XBUTTONDOWN | WM_XBUTTONUP => {
            if should_route_overlay_mouse {
                return Some(LRESULT(1));
            }
        }
        WM_RBUTTONUP => {
            if should_route_overlay_mouse {
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayContextMenu {
                    x,
                    y,
                    modifiers,
                });
                return Some(LRESULT(1));
            }
        }
        _ => {}
    }

    None
}

