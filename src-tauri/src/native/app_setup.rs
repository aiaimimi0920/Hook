// Initializes process guards, managed state, shortcuts, tray UI, and native input hooks.

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
            #[cfg(target_os = "windows")]
            let _ = MAIN_UI_THREAD_ID.set(std::thread::current().id());
            let single_instance_guard =
                match try_acquire_single_instance(&single_instance_name()) {
                    Ok(Some(guard)) => guard,
                    Ok(None) => {
                        append_runtime_log_line("single_instance_already_running");
                        std::process::exit(0);
                    }
                    Err(error) => {
                        append_runtime_log_line(&format!(
                            "single_instance_acquire_failed :: {}",
                            error
                        ));
                        return Err(error.into());
                    }
                };
            // Intentionally leak the guard so the OS mutex stays held for the
            // entire process lifetime; it is released when the process exits.
            std::mem::forget(single_instance_guard);
            // A force-killed prior Hook cannot run its cleanup path. Once this
            // process owns the single-instance mutex, reload the user's cursor
            // scheme before Hook can enter capture mode again.
            restore_system_cursors_unconditionally();
            match emergency_watchdog::spawn_for_current_process() {
                Ok(watchdog_pid) => append_runtime_log_line(&format!(
                    "emergency_watchdog_spawned :: watchdog_pid={}",
                    watchdog_pid
                )),
                Err(error) => append_runtime_log_line(&format!(
                    "emergency_watchdog_spawn_failed :: {}",
                    error
                )),
            }

            // Initialize Shared State
            let hit_map = SharedHitMap::new();
            app.manage(hit_map.clone());
            let capture_input_state = SharedCaptureInputState::new();
            app.manage(capture_input_state.clone());
            let long_capture_sessions = SharedLongCaptureSessions::new();
            app.manage(long_capture_sessions.clone());
            let app_settings_dir = effective_app_data_dir(app.handle()).map_err(|error| {
                append_runtime_log_line(&format!("app_settings_dir_failed :: {error}"));
                error
            })?;
            let initial_app_settings =
                app_settings::load_app_settings(&app_settings_dir).map_err(|error| {
                    append_runtime_log_line(&format!("app_settings_load_failed :: {error}"));
                    error
                })?;
            set_runtime_hook_cache_settings(initial_app_settings.cache.clone());
            app.manage(AppSettingsState::new(initial_app_settings));

            // Workflow instantiation is a native desktop coordination channel,
            // so it must stay available even when capability loading is disabled
            // or the frontend has not completed its Loom Hook handshake yet.
            let loom_hook = LoomHook::new();
            let listener_started =
                loom_hook::ensure_loom_hook_listener(app.handle(), &loom_hook).map_err(
                    |error| {
                        append_runtime_log_line(&format!(
                            "loom_hook_listener_start_failed :: {error}"
                        ));
                        error
                    },
                )?;
            app.manage(loom_hook);
            append_runtime_log_line(&format!(
                "loom_hook_listener_ready :: started={listener_started}"
            ));
            if let Err(error) = cleanup_clipboard_cache() {
                append_runtime_log_line(&format!("clipboard_cache_cleanup_failed :: {}", error));
            }

            #[cfg(desktop)]
            {
                // Core shortcuts come from settings; extension globals are
                // registered later from the validated contribution snapshot.
                let ctrl_alt_space =
                    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
                if let Err(error) = refresh_configured_global_shortcuts(app.handle()) {
                    append_runtime_log_line(&format!(
                        "register_loom_shortcuts_failed :: {error}"
                    ));
                }
                if let Err(e) = app.global_shortcut().register(ctrl_alt_space) {
                    console_line!("Warning: Failed to register Ctrl+Alt+Space: {}", e);
                    append_runtime_log_line(&format!("register_voice_hotkey_failed :: {}", e));
                } else {
                    append_runtime_log_line("register_voice_hotkey_success");
                }

                let capture_item = MenuItem::with_id(app, "capture", "截图 (Ctrl+1)", true, None::<&str>)?;
                let long_capture_item = MenuItem::with_id(app, "long_capture", "长截图 (Ctrl+3)", true, None::<&str>)?;
                let open_image_item =
                    MenuItem::with_id(app, "open_image", "编辑已有图片… (Ctrl+O)", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let tray_menu = Menu::with_items(
                    app,
                    &[
                        &capture_item,
                        &long_capture_item,
                        &open_image_item,
                        // Temporarily keep app settings out of the tray menu while
                        // retaining the existing command and event handler.
                        &quit_item,
                    ],
                )?;

                let mut tray_builder = TrayIconBuilder::with_id("hook")
                    .menu(&tray_menu)
                    .tooltip("Hook")
                    .show_menu_on_left_click(true)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "capture" => {
                            if let Some(window) = app.get_webview_window("main") {
                                enter_capture_mode(&window);
                            }
                        }
                        "long_capture" => {
                            if let Some(window) = app.get_webview_window("main") {
                                enter_long_capture_mode(&window);
                            }
                        }
                        "open_image" => {
                            if let Some(window) = app.get_webview_window("main") {
                                show_overlay_host_impl(&window, false);
                                if let Err(e) = window.emit("trigger-open-image", ()) {
                                    append_runtime_log_line(&format!(
                                        "tray_open_image emit_failed :: {}",
                                        e
                                    ));
                                }
                            }
                        }
                        "settings" => {
                            if let Some(window) = app.get_webview_window("main") {
                                show_canvas_window_impl(&window);
                                if let Err(e) = window.emit("trigger-open-app-settings", ()) {
                                    append_runtime_log_line(&format!(
                                        "tray_settings emit_failed :: {}",
                                        e
                                    ));
                                }
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    });

                if let Some(icon) = app.default_window_icon().cloned() {
                    tray_builder = tray_builder.icon(icon);
                }

                let tray = tray_builder.build(app)?;
                app.manage(tray);

                let Some(window) = app.get_webview_window("main") else {
                    append_runtime_log_line("app_setup_main_window_missing");
                    return Err("main window missing during setup".into());
                };
                let boot_profile = boot_profile_from_env();
                append_runtime_log_line(&format!(
                    "app_setup :: startup_mode={} initial_ui_mode={} auto_start_capture={} loom_hook_enabled={} loom_hook_ws_url={}",
                    boot_profile.startup_mode,
                    boot_profile.initial_ui_mode,
                    boot_profile.auto_start_capture,
                    boot_profile.loom_hook_enabled,
                    boot_profile.loom_hook_ws_url
                ));
                install_capture_mouse_hook_thread(window.clone());
                install_overlay_keyboard_hook_thread(window.clone());
                if boot_profile.initial_ui_mode == "tray" {
                    hide_to_tray_impl(&window);
                } else if boot_profile.initial_ui_mode == "canvas" {
                    show_canvas_window_impl(&window);
                } else {
                    show_overlay_host_impl(&window, true);
                }
            spawn_rdev_input_listener(
                window,
                hit_map,
                capture_input_state,
                long_capture_sessions,
            );
            }
            Ok(())
}
