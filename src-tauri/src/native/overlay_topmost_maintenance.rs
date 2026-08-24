// Maintains overlay HWND discovery, topmost state, and occlusion monitoring.

#[cfg(target_os = "windows")]
fn install_overlay_hwnd_retry_thread(window: &tauri::WebviewWindow) {
    if OVERLAY_HWND_RETRY_THREAD_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let app_handle = window.app_handle().clone();
    let _ = std::thread::Builder::new()
        .name("hook-overlay-hwnd-retry".to_string())
        .spawn(move || {
            for _attempt in 0..OVERLAY_HWND_RETRY_ATTEMPTS {
                let Some(window) = app_handle.get_webview_window("main") else {
                    std::thread::sleep(Duration::from_millis(OVERLAY_HWND_RETRY_INTERVAL_MS));
                    continue;
                };

                if let Some(hwnd) = resolve_overlay_main_hwnd(&window) {
                    let _ = OVERLAY_MAIN_HWND.set(hwnd.0 as isize);
                    apply_overlay_no_activate(&window);
                    install_overlay_mouse_activate_no_activate(&window);
                    set_overlay_transparent_style(
                        &window,
                        OVERLAY_CLICK_THROUGH_ACTIVE.load(Ordering::SeqCst),
                    );
                    install_overlay_topmost_maintenance_thread(&window);
                    append_runtime_log_line("overlay_hwnd_retry_completed");
                    return;
                }

                std::thread::sleep(Duration::from_millis(OVERLAY_HWND_RETRY_INTERVAL_MS));
            }

            append_runtime_log_line("overlay_hwnd_retry_exhausted");
        });
}

#[cfg(not(target_os = "windows"))]
fn install_overlay_hwnd_retry_thread(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn install_overlay_topmost_maintenance_thread(window: &tauri::WebviewWindow) {
    let Some(hwnd) = resolve_overlay_main_hwnd(window) else {
        append_runtime_log_line("overlay_topmost_maintenance_hwnd_failed");
        return;
    };
    let _ = OVERLAY_MAIN_HWND.set(hwnd.0 as isize);

    if OVERLAY_TOPMOST_MAINTENANCE_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let maintenance_window = window.clone();
    let _ = std::thread::Builder::new()
        .name("hook-overlay-topmost-maintenance".to_string())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_millis(
                OVERLAY_TOPMOST_MAINTENANCE_INTERVAL_MS,
            ));

            if NATIVE_FILE_DIALOG_ACTIVE.load(Ordering::SeqCst) {
                continue;
            }

            let main_hwnd = OVERLAY_MAIN_HWND
                .get()
                .copied()
                .map(|value| HWND(value as *mut core::ffi::c_void));
            let visually_occluded = main_hwnd
                .map(foreign_fullscreen_foreground_covers_overlay)
                .unwrap_or(false);
            OVERLAY_VISUALLY_OCCLUDED_BY_FULLSCREEN.store(visually_occluded, Ordering::SeqCst);

            if should_suppress_overlay_interaction_for_current_occlusion() {
                if !OVERLAY_FULLSCREEN_OCCLUSION_PASSTHROUGH_ACTIVE.swap(true, Ordering::SeqCst) {
                    OVERLAY_FULLSCREEN_OCCLUSION_PREVIOUS_CLICK_THROUGH.store(
                        OVERLAY_CLICK_THROUGH_ACTIVE.load(Ordering::SeqCst),
                        Ordering::SeqCst,
                    );
                    if let Some(main_hwnd) = main_hwnd {
                        enter_overlay_fullscreen_occlusion_passthrough(
                            &maintenance_window,
                            main_hwnd,
                        );
                    }
                }
                continue;
            }

            if OVERLAY_FULLSCREEN_OCCLUSION_PASSTHROUGH_ACTIVE.swap(false, Ordering::SeqCst) {
                if let Some(main_hwnd) = main_hwnd {
                    leave_overlay_fullscreen_occlusion_passthrough(&maintenance_window, main_hwnd);
                }
            }

            let needs_topmost_maintenance = OVERLAY_MOUSE_HIT_MAP_ACTIVE.load(Ordering::SeqCst)
                || CAPTURE_MOUSE_HOOK_ACTIVE.load(Ordering::SeqCst)
                || OVERLAY_MOUSE_HOOK_DRAG_ACTIVE.load(Ordering::SeqCst)
                || OVERLAY_MOUSE_HOOK_SYNTHETIC_DRAG_ACTIVE.load(Ordering::SeqCst)
                || OVERLAY_MOUSE_HOOK_NATIVE_DRAG_PREFLIGHT_ACTIVE.load(Ordering::SeqCst)
                || OVERLAY_INPUT_SHIELD_DIRECT_DRAG_ACTIVE.load(Ordering::SeqCst);
            if !needs_topmost_maintenance {
                continue;
            }

            if let Some(main_hwnd) = main_hwnd {
                reassert_overlay_topmost_window(main_hwnd);
            }
            if let Some(shield_hwnd) = overlay_input_shield_hwnd() {
                reassert_overlay_topmost_window(shield_hwnd);
            }
        });

    append_runtime_log_line("overlay_topmost_maintenance_started");
}

#[cfg(not(target_os = "windows"))]
fn install_overlay_topmost_maintenance_thread(_window: &tauri::WebviewWindow) {}
