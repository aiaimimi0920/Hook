use hook_lib::voice::audio::read_wav_info;
use hook_lib::voice::core::{
    AudioBackendMode, ClipboardBackendMode, OutputMode, ProviderKind, SessionStatus, TriggerMode,
    VoiceConfig, VoiceError,
};
use hook_lib::voice::insert::{InsertMethod, InsertOutcome};
use hook_lib::voice::session::{run_voice_once, VoiceRunOptions};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_runtime_dir(name: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    std::env::temp_dir().join(format!("hook-{name}-{}-{nonce}", std::process::id()))
}

fn voice_config(audio_dir: &PathBuf, log_dir: &PathBuf, output_mode: &str) -> VoiceConfig {
    voice_config_with_clipboard_backend(audio_dir, log_dir, output_mode, "fallback")
}

fn voice_config_with_clipboard_backend(
    audio_dir: &PathBuf,
    log_dir: &PathBuf,
    output_mode: &str,
    clipboard_backend: &str,
) -> VoiceConfig {
    let raw = format!(
        r#"
[trigger]
mode = "toggle"
toggle_shortcut = "Ctrl+Alt+Space"

[audio]
backend = "silent"
max_recording_seconds = 60
sample_rate_hz = 16000
channels = 1
temp_dir = "{}"

[provider]
kind = "mock"
mock_transcript = "hello from hook"

[output]
mode = "{output_mode}"
restore_clipboard = true
clipboard_backend = "{clipboard_backend}"

[logging]
dir = "{}"
"#,
        audio_dir.display().to_string().replace('\\', "\\\\"),
        log_dir.display().to_string().replace('\\', "\\\\"),
    );
    VoiceConfig::from_toml_str(&raw).expect("valid voice config")
}

#[tokio::test]
async fn voice_once_runs_safe_mvp_sequence_and_persists_completed_session_log() {
    let runtime_dir = unique_runtime_dir("voice-once-ok");
    let audio_dir = runtime_dir.join("audio");
    let log_dir = runtime_dir.join("logs");
    let config = voice_config(&audio_dir, &log_dir, "dry_run");

    let report = run_voice_once(
        &config,
        VoiceRunOptions::new_for_test("session-ok").with_silent_samples(32),
    )
    .await
    .expect("voice once succeeds");

    assert_eq!(report.session.status(), SessionStatus::Completed);
    assert_eq!(report.session.transcript(), Some("hello from hook"));
    assert_eq!(report.session.output_text(), Some("hello from hook"));
    assert_eq!(report.trigger_events, ["trigger_start", "trigger_stop"]);
    assert_eq!(
        report.insert_outcome,
        Some(InsertOutcome::Inserted {
            method: InsertMethod::DryRun
        })
    );

    let audio_artifact = report.audio_artifact.expect("audio artifact");
    assert!(audio_artifact.path.exists());
    let wav_info = read_wav_info(&audio_artifact).expect("readable wav");
    assert_eq!(wav_info.sample_rate_hz, 16000);
    assert_eq!(wav_info.channels, 1);

    let session_log = std::fs::read_to_string(&report.session_log_path).expect("session log");
    assert!(session_log.contains(r#""status": "completed""#));
    assert!(session_log.contains(r#""trigger_events": ["#));
    assert!(session_log.contains(r#""trigger_start""#));
    assert!(session_log.contains(r#""trigger_stop""#));
    assert!(session_log.contains(r#""method": "dry_run""#));

    let _ = std::fs::remove_dir_all(runtime_dir);
}

#[tokio::test]
async fn voice_once_persists_failed_session_log_when_insertion_fails_after_trigger_sequence() {
    let runtime_dir = unique_runtime_dir("voice-once-insert-fail");
    let audio_dir = runtime_dir.join("audio");
    let log_dir = runtime_dir.join("logs");
    let config = voice_config(&audio_dir, &log_dir, "clipboard_paste");

    let error = run_voice_once(
        &config,
        VoiceRunOptions::new_for_test("session-insert-fail")
            .with_mock_text_override("")
            .with_silent_samples(32),
    )
    .await
    .expect_err("empty insertion fails");

    assert!(matches!(error, VoiceError::Insert(_)));
    let session_log_path = log_dir.join("session-insert-fail.json");
    let session_log = std::fs::read_to_string(&session_log_path).expect("failed session log");
    assert!(session_log.contains(r#""status": "failed""#));
    assert!(session_log.contains(r#""trigger_start""#));
    assert!(session_log.contains(r#""trigger_stop""#));
    assert!(session_log.contains(r#""error": "insert error: refusing to insert empty text""#));

    let _ = std::fs::remove_dir_all(runtime_dir);
}

#[tokio::test]
async fn native_clipboard_session_honors_disable_guard_before_insertion_work() {
    let runtime_dir = unique_runtime_dir("voice-once-native-clipboard-disabled");
    let audio_dir = runtime_dir.join("audio");
    let log_dir = runtime_dir.join("logs");
    let config = voice_config_with_clipboard_backend(
        &audio_dir,
        &log_dir,
        "clipboard_paste",
        "native_windows",
    );

    let previous = std::env::var_os("HOOK_DISABLE_NATIVE_CLIPBOARD");
    std::env::set_var("HOOK_DISABLE_NATIVE_CLIPBOARD", "1");
    let error = run_voice_once(
        &config,
        VoiceRunOptions::new_for_test("session-native-clipboard-disabled")
            .with_mock_text_override("")
            .with_silent_samples(32),
    )
    .await
    .expect_err("disabled native clipboard must fail before insert validation or side effects");
    match previous {
        Some(value) => std::env::set_var("HOOK_DISABLE_NATIVE_CLIPBOARD", value),
        None => std::env::remove_var("HOOK_DISABLE_NATIVE_CLIPBOARD"),
    }

    assert!(
        error.to_string().contains("HOOK_DISABLE_NATIVE_CLIPBOARD"),
        "error={error}"
    );
    assert!(
        !error.to_string().contains("refusing to insert empty text"),
        "disable guard must run before clipboard paste insertion validation: {error}"
    );

    let session_log_path = log_dir.join("session-native-clipboard-disabled.json");
    let session_log = std::fs::read_to_string(&session_log_path).expect("failed session log");
    assert!(session_log.contains(r#""status": "failed""#));
    assert!(session_log.contains("HOOK_DISABLE_NATIVE_CLIPBOARD"));

    let _ = std::fs::remove_dir_all(runtime_dir);
}

#[test]
fn voice_config_for_orchestration_keeps_safe_hook_defaults() {
    let runtime_dir = unique_runtime_dir("voice-config-contract");
    let config = voice_config(
        &runtime_dir.join("audio"),
        &runtime_dir.join("logs"),
        "dry_run",
    );

    assert_eq!(config.trigger.mode, TriggerMode::Toggle);
    assert_eq!(config.audio.backend, AudioBackendMode::Silent);
    assert_eq!(config.provider.kind, ProviderKind::Mock);
    assert_eq!(config.output.mode, OutputMode::DryRun);
    assert_eq!(
        config.output.clipboard_backend,
        ClipboardBackendMode::Fallback
    );
}
