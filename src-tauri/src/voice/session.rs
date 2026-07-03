use crate::voice::audio::{capture_audio, AudioArtifact, AudioCaptureRequest, WavSettings};
use crate::voice::client::{
    FrontContext, HttpTextProcessor, HttpTranscriber, MockTranscriber, NoopTextProcessor,
    TextProcessor, Transcriber,
};
use crate::voice::core::{
    ClipboardBackendMode, OutputMode, ProviderKind, SessionStatus, TriggerMode, VoiceConfig,
    VoiceError, VoiceEvent, VoiceEventKind, VoiceSession,
};
use crate::voice::hotkey::{HotkeyAction, HotkeyStateMachine};
use crate::voice::insert::{
    ClipboardFallbackInserter, ClipboardPasteInserter, ClipboardRestorePolicy, DryRunInserter,
    InsertMethod, InsertOutcome, TextInserter, WindowsClipboardBackend, WindowsPasteShortcut,
};
use serde::Serialize;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceRunOptions {
    pub session_id: Option<String>,
    pub mock_text_override: Option<String>,
    pub front_context: FrontContext,
    pub silent_samples: usize,
}

impl Default for VoiceRunOptions {
    fn default() -> Self {
        Self {
            session_id: None,
            mock_text_override: None,
            front_context: FrontContext::default(),
            silent_samples: 320,
        }
    }
}

impl VoiceRunOptions {
    pub fn new_for_test(session_id: impl Into<String>) -> Self {
        Self {
            session_id: Some(session_id.into()),
            ..Self::default()
        }
    }

    pub fn with_mock_text_override(mut self, text: impl Into<String>) -> Self {
        self.mock_text_override = Some(text.into());
        self
    }

    pub fn with_silent_samples(mut self, samples: usize) -> Self {
        self.silent_samples = samples;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceRunReport {
    pub session: VoiceSession,
    pub trigger_events: Vec<&'static str>,
    pub audio_artifact: Option<AudioArtifact>,
    pub insert_outcome: Option<InsertOutcome>,
    pub session_log_path: PathBuf,
}

pub async fn run_voice_once(
    config: &VoiceConfig,
    options: VoiceRunOptions,
) -> Result<VoiceRunReport, VoiceError> {
    config.validate()?;

    let session_id = options
        .session_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let mut session = VoiceSession::new(session_id);
    let trigger_events = apply_configured_trigger_sequence(config, &mut session)?;

    let audio_artifact = match capture_audio_artifact(config, session.id(), options.silent_samples)
    {
        Ok(audio_artifact) => audio_artifact,
        Err(error) => {
            persist_failed_session(config, &mut session, &trigger_events, &error, false)?;
            return Err(error);
        }
    };

    let transcript = match transcribe_output(
        config,
        options.mock_text_override,
        audio_artifact.path.clone(),
        options.front_context.clone(),
    )
    .await
    {
        Ok(transcript) => transcript,
        Err(error) => {
            persist_failed_session(config, &mut session, &trigger_events, &error, false)?;
            return Err(error);
        }
    };
    session.apply(VoiceEvent::TranscriptReady {
        text: transcript.clone(),
    })?;

    let output = match process_output(config, transcript, options.front_context).await {
        Ok(output) => output,
        Err(error) => {
            persist_failed_session(config, &mut session, &trigger_events, &error, false)?;
            return Err(error);
        }
    };
    session.apply(VoiceEvent::ProcessedTextReady {
        text: output.clone(),
    })?;

    let insert_outcome = match insert_output(config, &output) {
        Ok(outcome) => outcome,
        Err(error) => {
            persist_failed_session(config, &mut session, &trigger_events, &error, true)?;
            return Err(error);
        }
    };
    session.apply(VoiceEvent::InsertSucceeded)?;
    let session_log_path =
        persist_session_log(config, &session, Some(&insert_outcome), &trigger_events)?;

    Ok(VoiceRunReport {
        session,
        trigger_events,
        audio_artifact: Some(audio_artifact),
        insert_outcome: Some(insert_outcome),
        session_log_path,
    })
}

fn capture_audio_artifact(
    config: &VoiceConfig,
    session_id: &str,
    silent_samples: usize,
) -> Result<AudioArtifact, VoiceError> {
    let request = AudioCaptureRequest {
        backend: config.audio.backend,
        temp_dir: config.audio.temp_dir.clone(),
        session_id: session_id.to_string(),
        wav_settings: WavSettings {
            sample_rate_hz: config.audio.sample_rate_hz,
            channels: config.audio.channels,
        },
        max_recording_seconds: config.audio.max_recording_seconds,
        silent_samples,
    };
    capture_audio(&request)
}

fn persist_failed_session(
    config: &VoiceConfig,
    session: &mut VoiceSession,
    trigger_events: &[&'static str],
    error: &VoiceError,
    insert_failure: bool,
) -> Result<PathBuf, VoiceError> {
    let reason = error.to_string();
    let event = if insert_failure {
        VoiceEvent::InsertFailed { reason }
    } else {
        VoiceEvent::Error { reason }
    };
    session.apply(event)?;
    persist_session_log(config, session, None, trigger_events)
}

fn apply_configured_trigger_sequence(
    config: &VoiceConfig,
    session: &mut VoiceSession,
) -> Result<Vec<&'static str>, VoiceError> {
    let mut hotkeys = HotkeyStateMachine::new_toggle(config.trigger.toggle_shortcut.clone());
    let actions = match config.trigger.mode {
        TriggerMode::Toggle => [HotkeyAction::TogglePressed, HotkeyAction::TogglePressed],
        TriggerMode::PushToTalk => [
            HotkeyAction::PushToTalkPressed,
            HotkeyAction::PushToTalkReleased,
        ],
    };
    let mut trigger_events = Vec::new();
    for action in actions {
        if let Some(event) = hotkeys.handle_action(action) {
            trigger_events.push(voice_event_kind_name(event.kind()));
            session.apply(event)?;
        }
    }
    Ok(trigger_events)
}

async fn transcribe_output(
    config: &VoiceConfig,
    mock_text: Option<String>,
    audio_path: PathBuf,
    context: FrontContext,
) -> Result<String, VoiceError> {
    match config.provider.kind {
        ProviderKind::Mock => {
            let transcript = mock_text
                .or_else(|| config.provider.mock_transcript.clone())
                .unwrap_or_else(|| "hello from hook voice".to_string());
            MockTranscriber::new(transcript)
                .transcribe(audio_path, context)
                .await
        }
        ProviderKind::Http => {
            let endpoint = config.provider.endpoint.as_deref().ok_or_else(|| {
                VoiceError::Provider("provider.endpoint must be set for http provider".to_string())
            })?;
            HttpTranscriber::new(endpoint)
                .transcribe(audio_path, context)
                .await
        }
    }
}

async fn process_output(
    config: &VoiceConfig,
    transcript: String,
    context: FrontContext,
) -> Result<String, VoiceError> {
    match config.provider.kind {
        ProviderKind::Mock => {
            NoopTextProcessor
                .process(transcript, config.default_voice_mode(), context)
                .await
        }
        ProviderKind::Http => {
            let endpoint = config.provider.endpoint.as_deref().ok_or_else(|| {
                VoiceError::Provider("provider.endpoint must be set for http provider".to_string())
            })?;
            HttpTextProcessor::new(endpoint)
                .process(transcript, config.default_voice_mode(), context)
                .await
        }
    }
}

fn insert_output(config: &VoiceConfig, output: &str) -> Result<InsertOutcome, VoiceError> {
    match config.output.mode {
        OutputMode::DryRun => DryRunInserter::default().insert_text(output),
        OutputMode::ClipboardPaste => match config.output.clipboard_backend {
            ClipboardBackendMode::Fallback => ClipboardFallbackInserter.insert_text(output),
            ClipboardBackendMode::NativeWindows => {
                if std::env::var_os("HOOK_DISABLE_NATIVE_CLIPBOARD").is_some() {
                    return Err(VoiceError::Insert(
                        "native_windows clipboard backend disabled by HOOK_DISABLE_NATIVE_CLIPBOARD"
                            .to_string(),
                    ));
                }
                let restore_policy = if config.output.restore_clipboard {
                    ClipboardRestorePolicy::RestoreOriginal
                } else {
                    ClipboardRestorePolicy::LeaveInsertedText
                };
                ClipboardPasteInserter::new(
                    WindowsClipboardBackend,
                    WindowsPasteShortcut,
                    restore_policy,
                )
                .insert_text(output)
            }
        },
    }
}

#[derive(Debug, Serialize)]
struct SessionLog<'a> {
    id: &'a str,
    status: &'static str,
    transcript: Option<&'a str>,
    output_text: Option<&'a str>,
    error: Option<&'a str>,
    trigger_mode: &'static str,
    trigger_events: &'a [&'static str],
    #[serde(skip_serializing_if = "Option::is_none")]
    insert_outcome: Option<InsertOutcomeLog<'a>>,
}

#[derive(Debug, Serialize)]
struct InsertOutcomeLog<'a> {
    method: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'a str>,
}

fn persist_session_log(
    config: &VoiceConfig,
    session: &VoiceSession,
    outcome: Option<&InsertOutcome>,
    trigger_events: &[&'static str],
) -> Result<PathBuf, VoiceError> {
    std::fs::create_dir_all(&config.logging.dir).map_err(|error| {
        VoiceError::Io(format!(
            "failed to create session log dir {}: {error}",
            config.logging.dir.display()
        ))
    })?;
    let log = SessionLog {
        id: session.id(),
        status: status_name(session.status()),
        transcript: session.transcript(),
        output_text: session.output_text(),
        error: session.error(),
        trigger_mode: trigger_mode_name(config.trigger.mode),
        trigger_events,
        insert_outcome: outcome.map(insert_outcome_log),
    };
    let path = config.logging.dir.join(format!("{}.json", session.id()));
    let json = serde_json::to_string_pretty(&log)
        .map_err(|error| VoiceError::Io(format!("failed to serialize session log: {error}")))?;
    std::fs::write(&path, json).map_err(|error| {
        VoiceError::Io(format!(
            "failed to write session log {}: {error}",
            path.display()
        ))
    })?;
    Ok(path)
}

fn trigger_mode_name(mode: TriggerMode) -> &'static str {
    match mode {
        TriggerMode::Toggle => "toggle",
        TriggerMode::PushToTalk => "push_to_talk",
    }
}

fn voice_event_kind_name(kind: VoiceEventKind) -> &'static str {
    match kind {
        VoiceEventKind::TriggerStart => "trigger_start",
        VoiceEventKind::TriggerStop => "trigger_stop",
        VoiceEventKind::TriggerCancel => "trigger_cancel",
        VoiceEventKind::TranscriptReady => "transcript_ready",
        VoiceEventKind::ProcessedTextReady => "processed_text_ready",
        VoiceEventKind::InsertSucceeded => "insert_succeeded",
        VoiceEventKind::InsertFailed => "insert_failed",
        VoiceEventKind::Error => "error",
    }
}

fn status_name(status: SessionStatus) -> &'static str {
    match status {
        SessionStatus::Idle => "idle",
        SessionStatus::Recording => "recording",
        SessionStatus::Transcribing => "transcribing",
        SessionStatus::Processing => "processing",
        SessionStatus::Inserting => "inserting",
        SessionStatus::Completed => "completed",
        SessionStatus::Failed => "failed",
        SessionStatus::Cancelled => "cancelled",
    }
}

fn insert_outcome_log(outcome: &InsertOutcome) -> InsertOutcomeLog<'_> {
    match outcome {
        InsertOutcome::Inserted { method } => InsertOutcomeLog {
            method: insert_method_name(*method),
            reason: None,
        },
        InsertOutcome::FallbackClipboard { reason } => InsertOutcomeLog {
            method: "clipboard_fallback",
            reason: Some(reason),
        },
    }
}

fn insert_method_name(method: InsertMethod) -> &'static str {
    match method {
        InsertMethod::DryRun => "dry_run",
        InsertMethod::ClipboardPaste => "clipboard_paste",
        InsertMethod::ClipboardFallback => "clipboard_fallback",
    }
}
