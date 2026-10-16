// Initializes process guards, managed state, shortcuts, tray UI, and native input hooks.

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "windows")]
    let _ = MAIN_UI_THREAD_ID.set(std::thread::current().id());
    let single_instance_guard = match try_acquire_single_instance(&single_instance_name()) {
        Ok(Some(guard)) => guard,
        Ok(None) => {
            append_runtime_log_line("single_instance_already_running");
            std::process::exit(0);
        }
        Err(error) => {
            append_runtime_log_line(&format!("single_instance_acquire_failed :: {}", error));
            return Err(error.into());
        }
    };
    // Intentionally leak the guard so the OS mutex stays held for the
    // entire process lifetime; it is released when the process exits.
    std::mem::forget(single_instance_guard);
    if let Ok(executable) = std::env::current_exe() {
        append_runtime_log_line(&format!(
            "runtime_identity :: version={} pid={} executable={}",
            env!("CARGO_PKG_VERSION"),
            std::process::id(),
            executable.display().to_string().replace(['\r', '\n'], " ")
        ));
    }
    // A force-killed prior Otter cannot run its cleanup path. Once this
    // process owns the single-instance mutex, reload the user's cursor
    // scheme before Otter can enter capture mode again.
    restore_system_cursors_unconditionally();
    match emergency_watchdog::spawn_for_current_process() {
        Ok(watchdog_pid) => append_runtime_log_line(&format!(
            "emergency_watchdog_spawned :: watchdog_pid={}",
            watchdog_pid
        )),
        Err(error) => {
            append_runtime_log_line(&format!("emergency_watchdog_spawn_failed :: {}", error))
        }
    }

    // Initialize Shared State
    #[cfg(target_os = "windows")]
    match crate::clipboard_history::listen(app.handle().clone()) {
        Ok(listener) => { app.manage(listener); }
        Err(_) => append_runtime_log_line("system_clipboard_listener_unavailable"),
    }
    let hit_map = SharedHitMap::new();
    app.manage(hit_map.clone());
    let capture_input_state = SharedCaptureInputState::new();
    app.manage(capture_input_state.clone());
    let long_capture_sessions = SharedLongCaptureSessions::new();
    app.manage(long_capture_sessions.clone());
    app.manage(SharedLiveCaptureSessions::new());
    app.manage(SharedLiveRelaySessions::new());
    app.manage(extension_bridge_native::ExtensionBridgeState::default());
    let app_settings_dir = effective_app_data_dir(app.handle()).map_err(|error| {
        append_runtime_log_line(&format!("app_settings_dir_failed :: {error}"));
        error
    })?;
    // Restored sessions use file-backed images instead of the first-run data URLs.
    // Grant only managed image files, including when the app-data root is overridden.
    app.asset_protocol_scope()
        .allow_directory(app_settings_dir.join("images"), false)?;
    let initial_app_settings =
        app_settings::load_app_settings(&app_settings_dir).map_err(|error| {
            append_runtime_log_line(&format!("app_settings_load_failed :: {error}"));
            error
        })?;
    set_runtime_otter_cache_settings(initial_app_settings.cache.clone());
    app.manage(AppSettingsState::new(initial_app_settings));

    // Native coordination may start before the frontend handshake, but only
    // when the process has explicitly enabled the authenticated integration.
    let loom_otter = LoomOtter::new();
    let listener_started = loom_otter::ensure_loom_otter_listener(app.handle(), &loom_otter)
        .map_err(|error| {
            append_runtime_log_line(&format!("loom_otter_listener_start_failed :: {error}"));
            error
        })?;
    app.manage(loom_otter);
    append_runtime_log_line(&format!(
        "loom_otter_listener_ready :: started={listener_started}"
    ));
    if let Err(error) = cleanup_clipboard_cache() {
        append_runtime_log_line(&format!("clipboard_cache_cleanup_failed :: {}", error));
    }

    #[cfg(desktop)]
    {
        // Core shortcuts come from settings; extension globals are
        // registered later from the validated contribution snapshot.
        let ctrl_alt_space = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
        if let Err(error) = refresh_configured_global_shortcuts(app.handle()) {
            append_runtime_log_line(&format!("register_loom_shortcuts_failed :: {error}"));
        }
        if let Err(e) = app.global_shortcut().register(ctrl_alt_space) {
            console_line!("Warning: Failed to register Ctrl+Alt+Space: {}", e);
            append_runtime_log_line(&format!("register_voice_hotkey_failed :: {}", e));
        } else {
            append_runtime_log_line("register_voice_hotkey_success");
        }

        let capture_item = MenuItem::with_id(
            app,
            "capture",
            tray_shortcut_label("截图", "capture"),
            true,
            None::<&str>,
        )?;
        let live_capture_item = MenuItem::with_id(
            app,
            "live_capture",
            tray_shortcut_label("实时截图…", "live_capture"),
            true,
            None::<&str>,
        )?;
        let long_capture_item = MenuItem::with_id(
            app,
            "long_capture",
            tray_shortcut_label("长截图", "long_capture"),
            true,
            None::<&str>,
        )?;
        let open_image_item = MenuItem::with_id(
            app,
            "open_image",
            tray_shortcut_label("编辑已有图片…", "open_image"),
            true,
            None::<&str>,
        )?;
        let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
        let autostart_item = create_tray_autostart(app)?;
        let projection_item =
            MenuItem::with_id(app, "receive_projection", "接收投射", true, None::<&str>)?;
        let tray_menu = Menu::with_items(
            app,
            &[
                &capture_item,
                &live_capture_item,
                &long_capture_item,
                &open_image_item,
                &projection_item,
                &autostart_item,
                // Temporarily keep app settings out of the tray menu while
                // retaining the existing command and event handler.
                &quit_item,
            ],
        )?;

        let mut tray_builder = TrayIconBuilder::with_id("hook")
            .menu(&tray_menu)
            .tooltip("Otter")
            .show_menu_on_left_click(true)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "capture" => {
                    if let Some(window) = app.get_webview_window("main") {
                        enter_capture_mode(&window);
                    }
                }
                "live_capture" => {
                    if let Some(window) = app.get_webview_window("main") {
                        enter_live_capture_mode(&window);
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
                            append_runtime_log_line(&format!("tray_settings emit_failed :: {}", e));
                        }
                    }
                }
                "receive_projection" => {
                    if let Some(window) = app.get_webview_window("main") {
                        show_overlay_host_impl(&window, false);
                        let _ = window.emit("trigger-receive-projection", ());
                    }
                }
                "autostart" => toggle_tray_autostart(app),
                "quit" => {
                    record_process_exit_event("tray_quit", Some(0));
                    app.exit(0);
                }
                _ => {}
            });

        if let Some(icon) = app.default_window_icon().cloned() {
            tray_builder = tray_builder.icon(icon);
        }

        let tray = tray_builder.build(app)?;
        app.manage(tray);
        app.manage(TrayAutostartItem(autostart_item));
        app.manage(TrayShortcutItems(vec![
            (capture_item, "截图", "capture"),
            (live_capture_item, "实时截图…", "live_capture"),
            (long_capture_item, "长截图", "long_capture"),
            (open_image_item, "编辑已有图片…", "open_image"),
        ]));
        refresh_tray_shortcut_labels(app.handle());

        let Some(window) = app.get_webview_window("main") else {
            append_runtime_log_line("app_setup_main_window_missing");
            return Err("main window missing during setup".into());
        };
        let boot_profile = boot_profile_from_env();
        append_runtime_log_line(&format!(
                    "app_setup :: startup_mode={} initial_ui_mode={} auto_start_capture={} loom_otter_enabled={} loom_otter_ws_url={}",
                    boot_profile.startup_mode,
                    boot_profile.initial_ui_mode,
                    boot_profile.auto_start_capture,
                    boot_profile.loom_otter_enabled,
                    boot_profile.loom_otter_ws_url
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
        spawn_rdev_input_listener(window, hit_map, capture_input_state, long_capture_sessions);
    }
    if let Ok(root) = effective_app_data_dir(app.handle()) {
        if let Err(error) = crate::loom_lan_trust::initialize(&root) {
            append_runtime_log_line(&format!("loom_lan_trust_load_failed :: {error}"));
        }
    }
    crate::loom_connection::startup(app.handle().clone());
    Ok(())
}
