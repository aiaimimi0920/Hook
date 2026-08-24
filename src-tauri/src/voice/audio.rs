use crate::voice::core::{AudioBackendMode, VoiceError};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[cfg(windows)]
mod native_capture;
#[cfg(windows)]
use native_capture::capture_native_windows_audio;

const MAX_SESSION_ID_BYTES: usize = 128;
const MAX_RECORDING_SECONDS: u64 = 60 * 60;
const MAX_WAV_PCM_BYTES: usize = 256 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AudioArtifact {
    pub path: PathBuf,
    pub mime_type: String,
}

impl AudioArtifact {
    pub fn new(path: PathBuf, mime_type: impl Into<String>) -> Self {
        Self {
            path,
            mime_type: mime_type.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioPlan {
    temp_dir: PathBuf,
    session_id: String,
}

impl AudioPlan {
    pub fn new(temp_dir: PathBuf, session_id: impl Into<String>) -> Self {
        Self {
            temp_dir,
            session_id: session_id.into(),
        }
    }

    pub fn artifact(&self) -> AudioArtifact {
        AudioArtifact::new(
            self.temp_dir.join(format!("{}.wav", self.session_id)),
            "audio/wav",
        )
    }

    pub fn ensure_parent_dir(&self) -> Result<(), VoiceError> {
        std::fs::create_dir_all(&self.temp_dir)
            .map_err(|error| VoiceError::Audio(error.to_string()))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WavSettings {
    pub sample_rate_hz: u32,
    pub channels: u16,
}

impl WavSettings {
    pub fn mono_16khz() -> Self {
        Self {
            sample_rate_hz: 16_000,
            channels: 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WavInfo {
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub duration_samples: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CapturedAudioBuffer {
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub samples: Vec<f32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioCaptureRequest {
    pub backend: AudioBackendMode,
    pub temp_dir: PathBuf,
    pub session_id: String,
    pub wav_settings: WavSettings,
    pub max_recording_seconds: u64,
    pub silent_samples: usize,
}

pub fn capture_audio(request: &AudioCaptureRequest) -> Result<AudioArtifact, VoiceError> {
    validate_capture_request(request)?;
    let artifact = AudioPlan::new(request.temp_dir.clone(), request.session_id.clone()).artifact();
    match request.backend {
        AudioBackendMode::Silent => {
            write_silent_wav(&artifact, request.wav_settings, request.silent_samples)?;
            Ok(artifact)
        }
        AudioBackendMode::NativeWindows => {
            if std::env::var_os("HOOK_DISABLE_NATIVE_AUDIO").is_some() {
                return Err(VoiceError::Audio(
                    "native_windows audio backend disabled by HOOK_DISABLE_NATIVE_AUDIO"
                        .to_string(),
                ));
            }
            let captured = capture_native_windows_audio(request)?;
            write_captured_wav(&artifact, &captured, request.wav_settings).map_err(|error| {
                native_windows_audio_error(format!("failed to write captured WAV: {error}"))
            })?;
            Ok(artifact)
        }
    }
}

pub fn write_silent_wav(
    artifact: &AudioArtifact,
    settings: WavSettings,
    samples: usize,
) -> Result<(), VoiceError> {
    validate_wav_settings(settings)?;
    validate_total_pcm_samples(samples)?;
    ensure_artifact_parent_dir(artifact)?;

    let spec = hound::WavSpec {
        channels: settings.channels,
        sample_rate: settings.sample_rate_hz,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&artifact.path, spec)
        .map_err(|error| VoiceError::Audio(error.to_string()))?;
    for _ in 0..samples {
        writer
            .write_sample::<i16>(0)
            .map_err(|error| VoiceError::Audio(error.to_string()))?;
    }
    writer
        .finalize()
        .map_err(|error| VoiceError::Audio(error.to_string()))
}

pub fn write_captured_wav(
    artifact: &AudioArtifact,
    source: &CapturedAudioBuffer,
    settings: WavSettings,
) -> Result<(), VoiceError> {
    validate_wav_settings(settings)?;
    if source.sample_rate_hz == 0 {
        return Err(VoiceError::Audio(
            "captured audio sample_rate_hz must be greater than 0".to_string(),
        ));
    }
    if source.channels == 0 {
        return Err(VoiceError::Audio(
            "captured audio channels must be greater than 0".to_string(),
        ));
    }

    let source_channels = usize::from(source.channels);
    if source.samples.len() % source_channels != 0 {
        return Err(VoiceError::Audio(
            "captured audio contains an incomplete source frame".to_string(),
        ));
    }
    let source_frames = source.samples.len() / source_channels;
    let target_frames = resampled_frame_count(
        source_frames,
        source.sample_rate_hz,
        settings.sample_rate_hz,
    )?;
    let total_target_samples = target_frames
        .checked_mul(usize::from(settings.channels))
        .ok_or_else(|| VoiceError::Audio("target WAV sample count overflow".to_string()))?;
    validate_total_pcm_samples(total_target_samples)?;

    ensure_artifact_parent_dir(artifact)?;
    let spec = hound::WavSpec {
        channels: settings.channels,
        sample_rate: settings.sample_rate_hz,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&artifact.path, spec)
        .map_err(|error| VoiceError::Audio(error.to_string()))?;

    for target_frame_index in 0..target_frames {
        let source_frame_index = source_frame_index_for_target(
            target_frame_index,
            source_frames,
            source.sample_rate_hz,
            settings.sample_rate_hz,
        )?;
        let mono_sample = downmix_source_frame_to_mono(source, source_frame_index);

        for _ in 0..settings.channels {
            writer
                .write_sample::<i16>(float_sample_to_i16(mono_sample))
                .map_err(|error| VoiceError::Audio(error.to_string()))?;
        }
    }

    writer
        .finalize()
        .map_err(|error| VoiceError::Audio(error.to_string()))
}

pub fn read_wav_info(artifact: &AudioArtifact) -> Result<WavInfo, VoiceError> {
    let reader = hound::WavReader::open(&artifact.path)
        .map_err(|error| VoiceError::Audio(error.to_string()))?;
    let spec = reader.spec();
    Ok(WavInfo {
        sample_rate_hz: spec.sample_rate,
        channels: spec.channels,
        bits_per_sample: spec.bits_per_sample,
        duration_samples: reader.duration(),
    })
}

fn ensure_artifact_parent_dir(artifact: &AudioArtifact) -> Result<(), VoiceError> {
    if let Some(parent) = artifact.path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| VoiceError::Audio(error.to_string()))?;
    }
    Ok(())
}

fn validate_wav_settings(settings: WavSettings) -> Result<(), VoiceError> {
    if settings.sample_rate_hz == 0 {
        return Err(VoiceError::Audio(
            "wav sample_rate_hz must be greater than 0".to_string(),
        ));
    }
    if settings.channels == 0 {
        return Err(VoiceError::Audio(
            "wav channels must be greater than 0".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn validate_session_id(session_id: &str) -> Result<(), VoiceError> {
    let valid_chars = session_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    let reserved = matches!(
        session_id.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );
    if session_id.is_empty() || session_id.len() > MAX_SESSION_ID_BYTES || !valid_chars || reserved
    {
        return Err(VoiceError::Audio(
            "session_id must be a safe 1-128 byte ASCII filename component".to_string(),
        ));
    }
    Ok(())
}

fn validate_capture_request(request: &AudioCaptureRequest) -> Result<(), VoiceError> {
    validate_session_id(&request.session_id)?;
    validate_wav_settings(request.wav_settings)?;
    if request.max_recording_seconds == 0 || request.max_recording_seconds > MAX_RECORDING_SECONDS {
        return Err(VoiceError::Audio(format!(
            "max_recording_seconds must be between 1 and {MAX_RECORDING_SECONDS}"
        )));
    }
    Ok(())
}

fn validate_total_pcm_samples(samples: usize) -> Result<(), VoiceError> {
    let bytes = samples
        .checked_mul(std::mem::size_of::<i16>())
        .ok_or_else(|| VoiceError::Audio("WAV PCM byte count overflow".to_string()))?;
    if bytes > MAX_WAV_PCM_BYTES {
        return Err(VoiceError::Audio(format!(
            "WAV PCM payload exceeds the {MAX_WAV_PCM_BYTES}-byte limit"
        )));
    }
    Ok(())
}

fn resampled_frame_count(
    source_frames: usize,
    source_sample_rate_hz: u32,
    target_sample_rate_hz: u32,
) -> Result<usize, VoiceError> {
    if source_frames == 0 {
        return Ok(0);
    }

    let target_frames = (source_frames as u128 * u128::from(target_sample_rate_hz))
        / u128::from(source_sample_rate_hz);
    usize::try_from(target_frames.max(1)).map_err(|_| {
        VoiceError::Audio("captured audio is too large to resample on this platform".to_string())
    })
}

fn source_frame_index_for_target(
    target_frame_index: usize,
    source_frames: usize,
    source_sample_rate_hz: u32,
    target_sample_rate_hz: u32,
) -> Result<usize, VoiceError> {
    let source_frame_index = (target_frame_index as u128 * u128::from(source_sample_rate_hz))
        / u128::from(target_sample_rate_hz);
    let source_frame_index = usize::try_from(source_frame_index).map_err(|_| {
        VoiceError::Audio("captured audio is too large to resample on this platform".to_string())
    })?;
    Ok(source_frame_index.min(source_frames.saturating_sub(1)))
}

fn downmix_source_frame_to_mono(source: &CapturedAudioBuffer, source_frame_index: usize) -> f32 {
    let source_channels = usize::from(source.channels);
    let frame_start = source_frame_index * source_channels;
    let frame_end = frame_start + source_channels;
    let sum = source.samples[frame_start..frame_end]
        .iter()
        .copied()
        .sum::<f32>();
    sum / f32::from(source.channels)
}

fn float_sample_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16
}

#[cfg(not(windows))]
fn capture_native_windows_audio(
    _request: &AudioCaptureRequest,
) -> Result<CapturedAudioBuffer, VoiceError> {
    Err(native_windows_audio_error(
        "native_windows audio backend is only available on Windows",
    ))
}

fn native_windows_audio_error(message: impl Into<String>) -> VoiceError {
    VoiceError::Audio(format!("native_windows audio backend: {}", message.into()))
}

#[cfg(test)]
include!("audio/tests.rs");
