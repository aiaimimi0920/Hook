// Builds the Tauri application and owns its top-level runtime lifecycle.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_logger();
    configure_webview2_video_safe_composition();

    let tauri_ctrl_1_last_trigger = Arc::new(std::sync::Mutex::new(
        std::time::Instant::now() - std::time::Duration::from_secs(2),
    ));
    let tauri_ctrl_3_last_trigger = Arc::new(std::sync::Mutex::new(
        std::time::Instant::now() - std::time::Duration::from_secs(2),
    ));
    let voice_hotkeys = Arc::new(std::sync::Mutex::new(
        voice::hotkey::HotkeyStateMachine::new_toggle("Ctrl+Alt+Space"),
    ));

    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler({
                    let tauri_ctrl_1_last_trigger = tauri_ctrl_1_last_trigger.clone();
                    let tauri_ctrl_3_last_trigger = tauri_ctrl_3_last_trigger.clone();
                    let voice_hotkeys = voice_hotkeys.clone();
                    move |app, shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            if let Some(action) = configured_global_action_for_shortcut(shortcut) {
                                match action {
                                    "capture" => {
                                        if !should_accept_tauri_shortcut_trigger(
                                            &tauri_ctrl_1_last_trigger,
                                            "tauri_capture_duplicate_ignored",
                                        ) {
                                            return;
                                        }
                                        if let Some(window) = app.get_webview_window("main") {
                                            enter_capture_mode(&window);
                                        }
                                    }
                                    "long_capture" => {
                                        if !should_accept_tauri_shortcut_trigger(
                                            &tauri_ctrl_3_last_trigger,
                                            "tauri_long_capture_duplicate_ignored",
                                        ) {
                                            return;
                                        }
                                        if let Some(window) = app.get_webview_window("main") {
                                            enter_long_capture_mode(&window);
                                        }
                                    }
                                    "toggle_sticker_toolbar" => {
                                        if let Some(window) = app.get_webview_window("main") {
                                            trigger_toggle_sticker_toolbar(&window);
                                        }
                                    }
                                    _ => {}
                                }
                            } else if let Some(payload) = extension_shortcut_payload(shortcut) {
                                if let Some(window) = app.get_webview_window("main") {
                                    if let Err(e) = window.emit("overlay/global_shortcut", payload) {
                                        console_line!("Failed to emit extension shortcut: {}", e);
                                    }
                                }
                            } else if shortcut
                                .matches(Modifiers::CONTROL | Modifiers::ALT, Code::Space)
                            {
                                let voice_event = match voice_hotkeys.lock() {
                                    Ok(mut hotkeys) => {
                                        voice::hotkey::handle_voice_toggle_hotkey(&mut hotkeys)
                                    }
                                    Err(error) => {
                                        append_runtime_log_line(&format!(
                                            "voice_hotkey_lock_failed :: {}",
                                            error
                                        ));
                                        None
                                    }
                                };

                                if let Some(voice_event) = voice_event {
                                    let should_run_voice_session = matches!(
                                        voice_event.kind,
                                        voice::core::VoiceEventKind::TriggerStop
                                    );
                                    append_runtime_log_line(&format!(
                                        "voice_hotkey_event :: {:?}",
                                        voice_event.kind
                                    ));
                                    if let Some(window) = app.get_webview_window("main") {
                                        if let Err(error) =
                                            window.emit("voice-hotkey-event", voice_event)
                                        {
                                            append_runtime_log_line(&format!(
                                                "voice_hotkey_emit_failed :: {}",
                                                error
                                            ));
                                        }
                                        if should_run_voice_session {
                                            spawn_voice_session_for_window(window);
                                        }
                                    } else {
                                        append_runtime_log_line("voice_hotkey_main_window_missing");
                                    }
                                }
                            }
                        }
                    }
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::Focused(focused) = event {
                    let _ = window.emit("hook/window_focus_changed", *focused);
                }
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if shortcut_config::close_to_tray_enabled() {
                    api.prevent_close();
                    append_runtime_log_line("window_close_requested :: action=tray");
                    let _ = window.hide();
                } else {
                    append_runtime_log_line("window_close_requested :: action=exit");
                    window.app_handle().exit(0);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            capture::capture_region,
            list_capture_window_targets,
            get_capture_cursor_position,
            update_pin_rects,
            set_mouse_monitor_active,
            begin_sticker_native_file_drag,
            begin_sticker_native_file_drag_from_path,
            save_sticker_image,
            save_sticker_image_as,
            save_sticker_drag_export,
            save_sticker_drag_export_from_path,
            get_cursor_position,
            copy_to_clipboard,
            copy_text_to_clipboard,
            copy_node_image_to_clipboard,
            copy_sticker_image_to_smart_clipboard,
            set_capture_input_active,
            set_desktop_color_picker_active,
            save_session,
            load_session,
            save_history,
            load_history,
            save_tool_settings,
            load_tool_settings,
            save_app_settings,
            load_app_settings,
            get_loom_shortcut_settings,
            set_extension_shortcuts,
            get_installed_fonts,
            hook_has_foreground_window,
            initialize_overlay,
            get_boot_profile,
            request_native_acceptance_exit,
            get_voice_settings_summary,
            talk_capture_voice_once,
            loom_brain_plan,
            show_canvas_window,
            show_overlay_host,
            set_overlay_click_through,
            set_native_drag_preflight_active,
            set_overlay_keyboard_capture_active,
            focus_overlay_window,
            set_overlay_capture_exclusion,
            hide_to_tray,
            trigger_capture_mode,
            trigger_long_capture_mode,
            append_runtime_log,
            get_precise_selection,
            pick_screen_color_at,
            pick_screen_color_at_cursor,
            capture_vertical_long_region,
            stitch_vertical_long_capture_frames,
            analyze_long_capture_pair,
            stitch_long_capture_frames,
            start_long_capture_session,
            sample_long_capture_session,
            finish_long_capture_session,
            cancel_long_capture_session,
            trigger_ocr_event,
            barcode::decode_barcodes,
            url_actions::open_http_url,
            tea_client::create_tea_ticket,
            loom_hook::loom_hook_handshake,
            loom_hook::loom_hook_dispatch_action,
            loom_hook::prefetch_shader,
            read_shared_memory,
            release_art_shared_memory,
            read_image_from_path,
            cache_remote_image_asset,
            open_image_for_edit,
            read_clipboard_image
        ])
        .setup(setup_app)
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    let exit_code = app.run_return(|_app_handle, event| match event {
        tauri::RunEvent::ExitRequested { .. } => {
            prepare_for_hook_process_exit("tauri_exit_requested");
        }
        tauri::RunEvent::Exit => prepare_for_hook_process_exit("tauri_exit"),
        _ => {}
    });
    prepare_for_hook_process_exit("tauri_run_returned");
    std::process::exit(exit_code);
}
