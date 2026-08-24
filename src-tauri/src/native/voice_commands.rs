// Owns voice configuration, summaries, commands, session events, and WebView setup.

fn default_voice_config() -> voice::core::VoiceConfig {
    let voice_root = runtime_log_dir().join("voice");
    voice::core::VoiceConfig {
        trigger: voice::core::TriggerConfig {
            mode: voice::core::TriggerMode::Toggle,
            toggle_shortcut: "Ctrl+Alt+Space".to_string(),
        },
        audio: voice::core::AudioConfig {
            backend: voice::core::AudioBackendMode::Silent,
            max_recording_seconds: 60,
            sample_rate_hz: 16000,
            channels: 1,
            temp_dir: voice_root.join("audio"),
        },
        provider: voice::core::ProviderConfig {
            kind: voice::core::ProviderKind::Mock,
            mock_transcript: Some("hello from hook voice".to_string()),
            endpoint: None,
        },
        output: voice::core::OutputConfig {
            mode: voice::core::OutputMode::DryRun,
            restore_clipboard: true,
            clipboard_backend: voice::core::ClipboardBackendMode::Fallback,
        },
        logging: voice::core::LoggingConfig {
            dir: voice_root.join("logs"),
        },
        voice_mode: voice::core::VoiceMode::Dictate,
    }
}

async fn effective_voice_config() -> voice::core::VoiceConfig {
    let Some(base_url) = std::env::var("HOOK_LOOM_BASE_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return default_voice_config();
    };
    let token = std::env::var("HOOK_LOOM_AUTH_TOKEN").ok();
    match loom_config::read_hook_voice_config(&base_url, token.as_deref()).await {
        Ok(Some(config)) => config,
        Ok(None) => default_voice_config(),
        Err(error) => {
            append_runtime_log_line(&format!("loom_hook_voice_config_read_failed :: {error}"));
            default_voice_config()
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceSettingsSummary {
    shortcut: String,
    trigger_mode: String,
    audio_backend: String,
    provider_kind: String,
    output_mode: String,
    clipboard_backend: String,
    voice_mode: String,
}

impl VoiceSettingsSummary {
    fn from_config(config: &voice::core::VoiceConfig) -> Self {
        Self {
            shortcut: config.trigger.toggle_shortcut.clone(),
            trigger_mode: voice_trigger_mode_name(config.trigger.mode).to_string(),
            audio_backend: voice_audio_backend_name(config.audio.backend).to_string(),
            provider_kind: voice_provider_kind_name(config.provider.kind).to_string(),
            output_mode: voice_output_mode_name(config.output.mode).to_string(),
            clipboard_backend: voice_clipboard_backend_name(config.output.clipboard_backend)
                .to_string(),
            voice_mode: voice_mode_name(config.voice_mode).to_string(),
        }
    }
}

fn voice_trigger_mode_name(mode: voice::core::TriggerMode) -> &'static str {
    match mode {
        voice::core::TriggerMode::Toggle => "toggle",
        voice::core::TriggerMode::PushToTalk => "push_to_talk",
    }
}

fn voice_audio_backend_name(backend: voice::core::AudioBackendMode) -> &'static str {
    match backend {
        voice::core::AudioBackendMode::Silent => "silent",
        voice::core::AudioBackendMode::NativeWindows => "native_windows",
    }
}

fn voice_provider_kind_name(kind: voice::core::ProviderKind) -> &'static str {
    match kind {
        voice::core::ProviderKind::Mock => "mock",
        voice::core::ProviderKind::Http => "http",
    }
}

fn voice_output_mode_name(mode: voice::core::OutputMode) -> &'static str {
    match mode {
        voice::core::OutputMode::ClipboardPaste => "clipboard_paste",
        voice::core::OutputMode::DryRun => "dry_run",
    }
}

fn voice_clipboard_backend_name(backend: voice::core::ClipboardBackendMode) -> &'static str {
    match backend {
        voice::core::ClipboardBackendMode::Fallback => "fallback",
        voice::core::ClipboardBackendMode::NativeWindows => "native_windows",
    }
}

fn voice_mode_name(mode: voice::core::VoiceMode) -> &'static str {
    match mode {
        voice::core::VoiceMode::Dictate => "dictate",
        voice::core::VoiceMode::Polish => "polish",
        voice::core::VoiceMode::Translate => "translate",
        voice::core::VoiceMode::Command => "command",
    }
}

#[tauri::command]
async fn get_voice_settings_summary() -> VoiceSettingsSummary {
    let config = effective_voice_config().await;
    VoiceSettingsSummary::from_config(&config)
}

#[tauri::command]
async fn talk_capture_voice_once(
    request: Option<talk_connector::TalkVoiceCaptureRequest>,
) -> Result<talk_connector::TalkVoiceCaptureResult, String> {
    talk_connector::capture_voice_once(request.unwrap_or_default())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn loom_brain_plan(
    request: loom_connector::LoomBrainPlanRequest,
) -> Result<loom_connector::LoomBrainPlanResult, String> {
    loom_connector::invoke_brain_plan(request)
        .await
        .map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VoiceSessionEventPayload {
    id: String,
    status: String,
    transcript: Option<String>,
    output_text: Option<String>,
    error: Option<String>,
    session_log_path: Option<String>,
}

fn voice_session_status_name(status: voice::core::SessionStatus) -> &'static str {
    match status {
        voice::core::SessionStatus::Idle => "idle",
        voice::core::SessionStatus::Recording => "recording",
        voice::core::SessionStatus::Transcribing => "transcribing",
        voice::core::SessionStatus::Processing => "processing",
        voice::core::SessionStatus::Inserting => "inserting",
        voice::core::SessionStatus::Completed => "completed",
        voice::core::SessionStatus::Failed => "failed",
        voice::core::SessionStatus::Cancelled => "cancelled",
    }
}

fn voice_session_completed_payload(
    report: voice::session::VoiceRunReport,
) -> VoiceSessionEventPayload {
    VoiceSessionEventPayload {
        id: report.session.id().to_string(),
        status: voice_session_status_name(report.session.status()).to_string(),
        transcript: report.session.transcript().map(str::to_string),
        output_text: report.session.output_text().map(str::to_string),
        error: report.session.error().map(str::to_string),
        session_log_path: Some(report.session_log_path.to_string_lossy().to_string()),
    }
}

fn voice_session_failed_payload(error: &voice::core::VoiceError) -> VoiceSessionEventPayload {
    VoiceSessionEventPayload {
        id: "unknown".to_string(),
        status: "failed".to_string(),
        transcript: None,
        output_text: None,
        error: Some(error.to_string()),
        session_log_path: None,
    }
}

fn spawn_voice_session_for_window(window: tauri::WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        let voice_config = effective_voice_config().await;
        let options = voice::session::VoiceRunOptions::default();
        match voice::session::run_voice_once(&voice_config, options).await {
            Ok(report) => {
                append_runtime_log_line("voice_session_completed");
                let payload = voice_session_completed_payload(report);
                if let Err(error) = window.emit("voice-session-event", payload) {
                    append_runtime_log_line(&format!("voice_session_emit_failed :: {}", error));
                }
            }
            Err(error) => {
                append_runtime_log_line(&format!("voice_session_failed :: {}", error));
                let payload = voice_session_failed_payload(&error);
                if let Err(emit_error) = window.emit("voice-session-event", payload) {
                    append_runtime_log_line(&format!(
                        "voice_session_emit_failed :: {}",
                        emit_error
                    ));
                }
            }
        }
    });
}

#[cfg(target_os = "windows")]
fn configure_webview2_video_safe_composition() {
    const ENV_NAME: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    const VIDEO_SAFE_ARGS: &[&str] = &[
        "--disable-gpu",
        "--disable-gpu-compositing",
        "--disable-gpu-rasterization",
        "--disable-zero-copy",
        "--disable-features=UseSkiaRenderer,CanvasOopRasterization",
    ];

    let existing_args = std::env::var(ENV_NAME).unwrap_or_default();
    let mut combined_args = existing_args.clone();
    for arg in VIDEO_SAFE_ARGS {
        if existing_args.contains(arg) || combined_args.contains(arg) {
            continue;
        }
        if !combined_args.trim().is_empty() {
            combined_args.push(' ');
        }
        combined_args.push_str(arg);
    }

    std::env::set_var(ENV_NAME, combined_args);
    append_runtime_log_line("webview2_video_safe_composition_args_applied");
}

#[cfg(not(target_os = "windows"))]
fn configure_webview2_video_safe_composition() {}

