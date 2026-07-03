use hook_lib::voice::core::{
    AudioBackendMode, ClipboardBackendMode, OutputMode, ProviderKind, SessionStatus, TriggerMode,
    VoiceConfig, VoiceError, VoiceEvent, VoiceMode, VoiceSession,
};

#[test]
fn voice_config_parses_hook_voice_contract_defaults_for_hook() {
    let raw = r#"
[trigger]
mode = "toggle"
toggle_shortcut = "Ctrl+Alt+Space"

[audio]
max_recording_seconds = 60
sample_rate_hz = 16000
channels = 1
temp_dir = ".runtime/hook/voice/audio"

[provider]
kind = "mock"
mock_transcript = "hello from hook"

[output]
mode = "clipboard_paste"
restore_clipboard = true

[logging]
dir = ".runtime/hook/voice/logs"
"#;

    let config = VoiceConfig::from_toml_str(raw).expect("valid voice config");

    assert_eq!(config.trigger.mode, TriggerMode::Toggle);
    assert_eq!(config.audio.backend, AudioBackendMode::Silent);
    assert_eq!(config.provider.kind, ProviderKind::Mock);
    assert_eq!(config.output.mode, OutputMode::ClipboardPaste);
    assert_eq!(
        config.output.clipboard_backend,
        ClipboardBackendMode::Fallback
    );
    assert_eq!(config.voice_mode, VoiceMode::Dictate);
}

#[test]
fn voice_session_state_machine_matches_hook_voice_contract() {
    let mut session = VoiceSession::new("hook-session");

    session.apply(VoiceEvent::TriggerStart).expect("start");
    assert_eq!(session.status(), SessionStatus::Recording);

    session.apply(VoiceEvent::TriggerStop).expect("stop");
    assert_eq!(session.status(), SessionStatus::Transcribing);

    session
        .apply(VoiceEvent::TranscriptReady {
            text: "raw transcript".to_string(),
        })
        .expect("transcript");
    assert_eq!(session.status(), SessionStatus::Processing);
    assert_eq!(session.transcript(), Some("raw transcript"));

    session
        .apply(VoiceEvent::ProcessedTextReady {
            text: "processed text".to_string(),
        })
        .expect("processed");
    assert_eq!(session.status(), SessionStatus::Inserting);
    assert_eq!(session.output_text(), Some("processed text"));

    session
        .apply(VoiceEvent::InsertSucceeded)
        .expect("insert succeeded");
    assert_eq!(session.status(), SessionStatus::Completed);

    let terminal_error = session
        .apply(VoiceEvent::TriggerCancel)
        .expect_err("completed sessions are terminal");
    assert!(matches!(
        terminal_error,
        VoiceError::TerminalTransition { .. }
    ));
}
