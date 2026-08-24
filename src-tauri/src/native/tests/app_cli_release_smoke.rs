// Verifies stable CLI, voice, console, and release-smoke contracts.

    #[test]
    fn self_check_report_is_stable_json_for_release_smoke() {
        let report = self_check_report_json().expect("self-check json");
        let value: serde_json::Value = serde_json::from_str(&report).expect("valid json");

        assert_eq!(value["app"], "Hook");
        assert_eq!(value["binary"], "hook.exe");
        assert_eq!(value["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(value["status"], "ok");
        assert_eq!(value["capabilities"]["desktop"], true);
        assert_eq!(value["capabilities"]["loomConnector"], true);
        assert_eq!(value["capabilities"]["talkConnector"], true);
        assert_eq!(value["capabilities"]["teaConnector"], true);
    }

    #[test]
    fn help_and_version_text_support_no_gui_release_smoke() {
        assert!(hook_help_text().contains("Usage: hook"));
        assert!(hook_help_text().contains("--self-check"));
        assert!(hook_help_text().contains("--loom-brain-plan-smoke"));
        assert!(hook_help_text().contains("HOOK_LOOM_BRAIN_PLAN_OUTPUT"));
        assert!(hook_help_text().contains("--talk-voice-capture-smoke"));
        assert!(hook_help_text().contains("HOOK_TALK_VOICE_CAPTURE_OUTPUT"));
        assert_eq!(
            hook_version_text(),
            format!("hook {}", env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn loom_brain_plan_smoke_request_is_stable_for_release_smoke() {
        let request = loom_brain_plan_smoke_request();

        assert_eq!(request.request_id.as_deref(), Some("hook-loom-smoke-1"));
        assert_eq!(request.goal, "Hook Loom release smoke");
        assert_eq!(request.constraints, vec!["no-ui".to_string()]);
        assert_eq!(request.timeout_ms, Some(5_000));
    }

    #[test]
    fn talk_capture_smoke_request_is_stable_for_release_smoke() {
        let request = talk_capture_smoke_request();

        assert_eq!(request.request_id.as_deref(), Some("hook-talk-smoke-1"));
        assert_eq!(request.mode.as_deref(), Some("dictation"));
        assert_eq!(request.timeout_ms, Some(5_000));
        let context = request.context.expect("smoke context");
        assert_eq!(context["source"], "hook-cli-smoke");
    }

    #[test]
    fn voice_settings_summary_from_config_preserves_command_contract() {
        let config = default_voice_config();
        let summary = VoiceSettingsSummary::from_config(&config);

        assert_eq!(summary.shortcut, "Ctrl+Alt+Space");
        assert_eq!(summary.provider_kind, "mock");
        assert_eq!(summary.voice_mode, "dictate");
    }

    #[test]
    fn optional_cli_output_writes_to_env_path_for_windowed_release_binary_smoke() {
        let env_name = format!("HOOK_TEST_CLI_OUTPUT_{}", std::process::id());
        let output_path = std::env::temp_dir().join(format!(
            "hook-cli-output-{}-{}.txt",
            std::process::id(),
            "windowed-release"
        ));
        let _ = std::fs::remove_file(&output_path);

        std::env::set_var(&env_name, &output_path);
        let result = write_optional_cli_output(&env_name, "hook 0.1.4\n");
        std::env::remove_var(&env_name);

        result.expect("write optional cli output");
        let written = std::fs::read_to_string(&output_path).expect("read cli output");
        let _ = std::fs::remove_file(&output_path);
        assert_eq!(written, "hook 0.1.4\n");
    }

    #[test]
    fn closed_gui_console_does_not_panic() {
        struct ClosedConsole;

        impl std::io::Write for ClosedConsole {
            fn write(&mut self, _buffer: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
            }

            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }

        write_console_line(&mut ClosedConsole, format_args!("release without stdout"));
    }
