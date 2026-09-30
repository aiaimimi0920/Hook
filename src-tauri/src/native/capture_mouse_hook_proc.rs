// Routes low-level Windows mouse-hook messages into capture and overlay pipelines.

#[cfg(target_os = "windows")]
unsafe extern "system" fn capture_mouse_hook_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code != HC_ACTION as i32 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let _timing = CaptureMouseHookTiming {
        started: Instant::now(),
        message: wparam.0 as u32,
        capture_active: CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::Relaxed),
    };

    if lparam.0 == 0 {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    if NATIVE_FILE_DRAG_ACTIVE.load(Ordering::SeqCst)
        || NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst)
    {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    let mouse = unsafe { *(lparam.0 as *const MSLLHOOKSTRUCT) };
    let x = mouse.pt.x as f64;
    let y = mouse.pt.y as f64;
    let mouse_flags = mouse.flags;
    let message = wparam.0 as u32;
    let capture_active = CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst);

    // Capture has a dedicated global pointer stream. Keep this hot path free of
    // overlay hit-map locks, foreground-window checks, window-style changes,
    // and other work that can make a WH_MOUSE_LL callback fall behind a
    // high-polling-rate mouse.
    if capture_active {
        let modifiers = current_modifier_snapshot();
        match message {
            WM_MOUSEMOVE => {
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::Move { x, y, modifiers });
                // Keep the low-level move in the normal Windows chain so the
                // physical cursor continues to move. During capture the native
                // full-screen input shield is the hit-test owner, so forwarding
                // this message does not expose the underlying application to
                // hover transitions.
                return unsafe { CallNextHookEx(None, code, wparam, lparam) };
            }
            WM_LBUTTONDOWN => {
                if claim_capture_button_transition(&CAPTURE_MOUSE_HOOK_BUTTON_DOWN, true) {
                    append_runtime_log_line(&format!(
                        "capture_mouse_down :: x={} y={} flags={}",
                        x, y, mouse_flags
                    ));
                    queue_capture_mouse_hook_event(CaptureMouseHookEvent::Down { x, y, modifiers });
                } else {
                    append_runtime_log_line("capture_mouse_down_ignored_duplicate");
                }
                return LRESULT(1);
            }
            WM_LBUTTONUP => {
                if claim_capture_button_transition(&CAPTURE_MOUSE_HOOK_BUTTON_DOWN, false) {
                    append_runtime_log_line(&format!(
                        "capture_mouse_up :: x={} y={} flags={}",
                        x, y, mouse_flags
                    ));
                    queue_capture_mouse_hook_event(CaptureMouseHookEvent::Up { x, y, modifiers });
                } else {
                    append_runtime_log_line("capture_mouse_up_ignored_unpaired");
                }
                return LRESULT(1);
            }
            WM_MOUSEWHEEL => {
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::Wheel { x, y, modifiers });
                return LRESULT(1);
            }
            WM_RBUTTONDOWN | WM_RBUTTONUP | WM_MBUTTONDOWN | WM_MBUTTONUP | WM_XBUTTONDOWN
            | WM_XBUTTONUP => {
                return LRESULT(1);
            }
            _ => {
                return unsafe { CallNextHookEx(None, code, wparam, lparam) };
            }
        }
    }

    let modifiers = current_modifier_snapshot();
    let should_route_overlay_mouse = should_route_overlay_mouse_events(x, y);
    let overlay_hover_active = OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.load(Ordering::SeqCst);
    let overlay_drag_active = OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst)
        || OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.load(Ordering::SeqCst);
    let native_drag_preflight_active =
        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
    let hook_pointer_owner =
        overlay_pointer_source_owns_session(OverlayPointerSource::LowLevelHook);
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
            capture_active,
            overlay_drag_active,
            native_drag_preflight_active,
            hook_process_has_foreground_window(),
            message == WM_MOUSEWHEEL,
            should_route_overlay_mouse,
        )
    {
        set_overlay_input_shield_alt_passthrough(true);
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }
    if !modifiers.alt_pressed {
        set_overlay_input_shield_alt_passthrough(false);
    }
    if !capture_active
        && !should_route_overlay_mouse
        && !overlay_hover_active
        && !overlay_drag_active
        && !native_drag_preflight_active
        && !overlay_pointer_session_active
    {
        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
    }

    match message {
        WM_MOUSEMOVE => {
            if overlay_pointer_session_active && !hook_pointer_owner {
                return unsafe { CallNextHookEx(None, code, wparam, lparam) };
            }
            if should_route_overlay_mouse || overlay_drag_active || native_drag_preflight_active {
                OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayMove {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight: native_drag_preflight_active,
                });
            }
            if !should_route_overlay_mouse
                && !overlay_drag_active
                && !native_drag_preflight_active
                && overlay_hover_active
            {
                OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(false, Ordering::SeqCst);
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayMove {
                    x,
                    y,
                    modifiers,
                    native_drag_preflight: native_drag_preflight_active,
                });
            }
        }
        WM_LBUTTONDOWN => {
            if should_route_overlay_mouse || overlay_pointer_session_active {
                let source = OverlayPointerSource::LowLevelHook;
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
                            OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(false, Ordering::SeqCst);
                            OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.store(false, Ordering::SeqCst);
                            OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE
                                .store(true, Ordering::SeqCst);
                            OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
                            append_runtime_log_line(&format!(
                                "overlay_native_drag_preflight_start :: x={} y={}",
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
                            return LRESULT(1);
                        }
                        OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                        OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                        OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE
                            .store(false, Ordering::SeqCst);
                        OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
                        promote_overlay_input_shield_to_fullscreen();
                        append_runtime_log_line(&format!(
                            "overlay_drag_start :: synthetic={} x={} y={}",
                            true, x, y
                        ));
                        queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayDown {
                            x,
                            y,
                            modifiers,
                            native_drag_preflight: false,
                            source,
                            continuation: false,
                        });
                        return LRESULT(1);
                    }
                    OverlayPointerDownTransition::Continued => {
                        let native_drag_preflight =
                            OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst);
                        if !native_drag_preflight {
                            OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                            OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.store(true, Ordering::SeqCst);
                            promote_overlay_input_shield_to_fullscreen();
                        }
                        OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
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
                        return LRESULT(1);
                    }
                    OverlayPointerDownTransition::IgnoredDuplicate => {
                        append_runtime_log_line("overlay_drag_down_ignored_duplicate");
                        return LRESULT(1);
                    }
                    OverlayPointerDownTransition::IgnoredForeignOwner => {
                        return unsafe { CallNextHookEx(None, code, wparam, lparam) };
                    }
                }
            }
        }
        WM_LBUTTONUP => {
            let source = OverlayPointerSource::LowLevelHook;
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
                    return LRESULT(1);
                }
                OverlayPointerUpTransition::IgnoredDuplicate => {
                    append_runtime_log_line("overlay_drag_up_ignored_duplicate");
                    return LRESULT(1);
                }
                OverlayPointerUpTransition::IgnoredUnpaired => {}
                OverlayPointerUpTransition::IgnoredForeignOwner => {
                    return unsafe { CallNextHookEx(None, code, wparam, lparam) };
                }
            }
        }
        WM_MOUSEWHEEL => {
            if should_route_overlay_mouse {
                let delta_y = (((mouse.mouseData >> 16) & 0xffff) as i16) as f64;
                queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayWheel {
                    x,
                    y,
                    delta_y,
                    modifiers,
                });
                OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
                return LRESULT(1);
            }
        }
        WM_RBUTTONDOWN | WM_RBUTTONUP | WM_MBUTTONDOWN | WM_MBUTTONUP | WM_XBUTTONDOWN
        | WM_XBUTTONUP => {
            if should_route_overlay_mouse {
                OVERLAY_MOUSE_HOOK_HOVER_ACTIVE.store(true, Ordering::SeqCst);
                if wparam.0 as u32 == WM_RBUTTONUP {
                    queue_capture_mouse_hook_event(CaptureMouseHookEvent::OverlayContextMenu {
                        x,
                        y,
                        modifiers,
                    });
                }
                return LRESULT(1);
            }
        }
        _ => {}
    }

    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

#[cfg(target_os = "windows")]
struct CaptureMouseHookTiming {
    started: Instant,
    message: u32,
    capture_active: bool,
}

#[cfg(target_os = "windows")]
impl Drop for CaptureMouseHookTiming {
    fn drop(&mut self) {
        let elapsed = self.started.elapsed();
        // Slow low-level hooks can be silently removed by Windows. Record only
        // outliers through the existing nonblocking log queue, never per move.
        if elapsed >= Duration::from_millis(100) {
            append_runtime_log_line(&format!(
                "capture_mouse_hook_slow :: message={} capture_active={} elapsed_ms={}",
                self.message,
                self.capture_active,
                elapsed.as_millis()
            ));
        }
    }
}
