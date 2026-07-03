use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum VoiceError {
    #[error("invalid configuration: {0}")]
    InvalidConfig(String),
    #[error("provider error: {0}")]
    Provider(String),
    #[error("insert error: {0}")]
    Insert(String),
    #[error("audio error: {0}")]
    Audio(String),
    #[error("hotkey error: {0}")]
    Hotkey(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("invalid transition: state={state:?} event={event:?}")]
    InvalidTransition {
        state: SessionStatus,
        event: VoiceEventKind,
    },
    #[error("session is terminal: state={state:?} event={event:?}")]
    TerminalTransition {
        state: SessionStatus,
        event: VoiceEventKind,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceMode {
    Dictate,
    Polish,
    Translate,
    Command,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TriggerMode {
    Toggle,
    PushToTalk,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Mock,
    Http,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputMode {
    ClipboardPaste,
    DryRun,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClipboardBackendMode {
    Fallback,
    NativeWindows,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioBackendMode {
    Silent,
    NativeWindows,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoiceConfig {
    pub trigger: TriggerConfig,
    pub audio: AudioConfig,
    pub provider: ProviderConfig,
    pub output: OutputConfig,
    pub logging: LoggingConfig,
    #[serde(default = "default_voice_mode")]
    pub voice_mode: VoiceMode,
}

impl VoiceConfig {
    pub fn from_toml_str(raw: &str) -> Result<Self, VoiceError> {
        let config: Self =
            toml::from_str(raw).map_err(|error| VoiceError::InvalidConfig(error.to_string()))?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), VoiceError> {
        let mut problems = Vec::new();

        if self.trigger.toggle_shortcut.trim().is_empty() {
            problems.push("trigger.toggle_shortcut must not be empty");
        }
        if self.audio.max_recording_seconds == 0 {
            problems.push("audio.max_recording_seconds must be greater than 0");
        }
        if self.audio.sample_rate_hz == 0 {
            problems.push("audio.sample_rate_hz must be greater than 0");
        }
        if self.audio.channels == 0 {
            problems.push("audio.channels must be greater than 0");
        }
        if self.audio.temp_dir.as_os_str().is_empty() {
            problems.push("audio.temp_dir must not be empty");
        }
        if self.logging.dir.as_os_str().is_empty() {
            problems.push("logging.dir must not be empty");
        }
        if self.provider.kind == ProviderKind::Mock
            && self
                .provider
                .mock_transcript
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .is_empty()
        {
            problems.push("provider.mock_transcript must be set for mock provider");
        }
        if self.provider.kind == ProviderKind::Http
            && self
                .provider
                .endpoint
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .is_empty()
        {
            problems.push("provider.endpoint must be set for http provider");
        }

        if problems.is_empty() {
            Ok(())
        } else {
            Err(VoiceError::InvalidConfig(problems.join("; ")))
        }
    }

    pub fn default_voice_mode(&self) -> VoiceMode {
        self.voice_mode
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TriggerConfig {
    pub mode: TriggerMode,
    pub toggle_shortcut: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioConfig {
    #[serde(default = "default_audio_backend")]
    pub backend: AudioBackendMode,
    pub max_recording_seconds: u64,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub temp_dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub kind: ProviderKind,
    #[serde(default)]
    pub mock_transcript: Option<String>,
    #[serde(default)]
    pub endpoint: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutputConfig {
    pub mode: OutputMode,
    pub restore_clipboard: bool,
    #[serde(default = "default_clipboard_backend")]
    pub clipboard_backend: ClipboardBackendMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoggingConfig {
    pub dir: PathBuf,
}

fn default_voice_mode() -> VoiceMode {
    VoiceMode::Dictate
}

fn default_clipboard_backend() -> ClipboardBackendMode {
    ClipboardBackendMode::Fallback
}

fn default_audio_backend() -> AudioBackendMode {
    AudioBackendMode::Silent
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionStatus {
    Idle,
    Recording,
    Transcribing,
    Processing,
    Inserting,
    Completed,
    Failed,
    Cancelled,
}

impl SessionStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            SessionStatus::Completed | SessionStatus::Failed | SessionStatus::Cancelled
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoiceEventKind {
    TriggerStart,
    TriggerStop,
    TriggerCancel,
    TranscriptReady,
    ProcessedTextReady,
    InsertSucceeded,
    InsertFailed,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoiceEvent {
    TriggerStart,
    TriggerStop,
    TriggerCancel,
    TranscriptReady { text: String },
    ProcessedTextReady { text: String },
    InsertSucceeded,
    InsertFailed { reason: String },
    Error { reason: String },
}

impl VoiceEvent {
    pub fn kind(&self) -> VoiceEventKind {
        match self {
            VoiceEvent::TriggerStart => VoiceEventKind::TriggerStart,
            VoiceEvent::TriggerStop => VoiceEventKind::TriggerStop,
            VoiceEvent::TriggerCancel => VoiceEventKind::TriggerCancel,
            VoiceEvent::TranscriptReady { .. } => VoiceEventKind::TranscriptReady,
            VoiceEvent::ProcessedTextReady { .. } => VoiceEventKind::ProcessedTextReady,
            VoiceEvent::InsertSucceeded => VoiceEventKind::InsertSucceeded,
            VoiceEvent::InsertFailed { .. } => VoiceEventKind::InsertFailed,
            VoiceEvent::Error { .. } => VoiceEventKind::Error,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoiceSession {
    id: String,
    status: SessionStatus,
    transcript: Option<String>,
    output_text: Option<String>,
    error: Option<String>,
}

impl VoiceSession {
    pub fn new_for_test(id: impl Into<String>) -> Self {
        Self::new(id)
    }

    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            status: SessionStatus::Idle,
            transcript: None,
            output_text: None,
            error: None,
        }
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn status(&self) -> SessionStatus {
        self.status
    }

    pub fn transcript(&self) -> Option<&str> {
        self.transcript.as_deref()
    }

    pub fn output_text(&self) -> Option<&str> {
        self.output_text.as_deref()
    }

    pub fn error(&self) -> Option<&str> {
        self.error.as_deref()
    }

    pub fn apply(&mut self, event: VoiceEvent) -> Result<(), VoiceError> {
        if self.status.is_terminal() {
            return Err(VoiceError::TerminalTransition {
                state: self.status,
                event: event.kind(),
            });
        }

        match (self.status, event) {
            (SessionStatus::Idle, VoiceEvent::TriggerStart) => {
                self.status = SessionStatus::Recording;
                Ok(())
            }
            (SessionStatus::Recording, VoiceEvent::TriggerStop) => {
                self.status = SessionStatus::Transcribing;
                Ok(())
            }
            (SessionStatus::Transcribing, VoiceEvent::TranscriptReady { text }) => {
                self.transcript = Some(text);
                self.status = SessionStatus::Processing;
                Ok(())
            }
            (SessionStatus::Processing, VoiceEvent::ProcessedTextReady { text }) => {
                self.output_text = Some(text);
                self.status = SessionStatus::Inserting;
                Ok(())
            }
            (SessionStatus::Inserting, VoiceEvent::InsertSucceeded) => {
                self.status = SessionStatus::Completed;
                Ok(())
            }
            (_, VoiceEvent::TriggerCancel) => {
                self.status = SessionStatus::Cancelled;
                Ok(())
            }
            (_, VoiceEvent::Error { reason }) | (_, VoiceEvent::InsertFailed { reason }) => {
                self.error = Some(reason);
                self.status = SessionStatus::Failed;
                Ok(())
            }
            (state, event) => Err(VoiceError::InvalidTransition {
                state,
                event: event.kind(),
            }),
        }
    }
}

impl fmt::Display for VoiceSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}:{:?}", self.id, self.status)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AudioBackendMode, ClipboardBackendMode, OutputMode, ProviderKind, SessionStatus,
        TriggerMode, VoiceConfig, VoiceError, VoiceEvent, VoiceMode, VoiceSession,
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
}
