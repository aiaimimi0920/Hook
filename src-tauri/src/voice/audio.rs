use crate::voice::core::{AudioBackendMode, VoiceError};
#[cfg(windows)]
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
#[cfg(windows)]
use cpal::Sample;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[cfg(windows)]
use std::sync::{Arc, Mutex};
#[cfg(windows)]
use std::time::Duration;

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

    ensure_artifact_parent_dir(artifact)?;

    let spec = hound::WavSpec {
        channels: settings.channels,
        sample_rate: settings.sample_rate_hz,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&artifact.path, spec)
        .map_err(|error| VoiceError::Audio(error.to_string()))?;

    let source_channels = usize::from(source.channels);
    let source_frames = source.samples.len() / source_channels;
    let target_frames = resampled_frame_count(
        source_frames,
        source.sample_rate_hz,
        settings.sample_rate_hz,
    )?;

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

#[cfg(windows)]
fn capture_native_windows_audio(
    request: &AudioCaptureRequest,
) -> Result<CapturedAudioBuffer, VoiceError> {
    let recording_duration = native_windows_recording_duration(request)?;
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| native_windows_audio_error("no default input device is available"))?;
    let supported_config = device.default_input_config().map_err(|error| {
        native_windows_audio_error(format!("failed to get default input config: {error}"))
    })?;
    let sample_format = supported_config.sample_format();
    let config: cpal::StreamConfig = supported_config.into();
    let max_samples = max_native_capture_samples(&config, recording_duration)?;

    let samples = Arc::new(Mutex::new(Vec::<f32>::with_capacity(
        max_samples.min(1_000_000),
    )));
    let stream_errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let stream = build_native_input_stream(
        &device,
        &config,
        sample_format,
        Arc::clone(&samples),
        max_samples,
        Arc::clone(&stream_errors),
    )?;

    stream.play().map_err(|error| {
        native_windows_audio_error(format!("failed to start input stream: {error}"))
    })?;
    std::thread::sleep(recording_duration);
    drop(stream);

    let stream_errors = stream_errors
        .lock()
        .map_err(|_| native_windows_audio_error("input stream error lock was poisoned"))?;
    if !stream_errors.is_empty() {
        return Err(native_windows_audio_error(format!(
            "input stream reported errors: {}",
            stream_errors.join("; ")
        )));
    }
    drop(stream_errors);

    let samples = samples
        .lock()
        .map_err(|_| native_windows_audio_error("captured sample buffer lock was poisoned"))?
        .clone();
    if samples.is_empty() {
        return Err(native_windows_audio_error(
            "input stream produced no samples; microphone capture is unavailable",
        ));
    }

    Ok(CapturedAudioBuffer {
        sample_rate_hz: config.sample_rate.into(),
        channels: config.channels,
        samples,
    })
}

#[cfg(not(windows))]
fn capture_native_windows_audio(
    _request: &AudioCaptureRequest,
) -> Result<CapturedAudioBuffer, VoiceError> {
    Err(native_windows_audio_error(
        "native_windows audio backend is only available on Windows",
    ))
}

#[cfg(windows)]
fn native_windows_recording_duration(
    request: &AudioCaptureRequest,
) -> Result<Duration, VoiceError> {
    let requested_seconds = match std::env::var_os("HOOK_NATIVE_AUDIO_SECONDS") {
        Some(raw) => {
            let raw = raw.to_string_lossy();
            let seconds = raw.trim().parse::<u64>().map_err(|error| {
                native_windows_audio_error(format!(
                    "HOOK_NATIVE_AUDIO_SECONDS must be a positive integer: {error}"
                ))
            })?;
            if seconds == 0 {
                return Err(native_windows_audio_error(
                    "HOOK_NATIVE_AUDIO_SECONDS must be greater than 0",
                ));
            }
            seconds.min(request.max_recording_seconds)
        }
        None => request.max_recording_seconds,
    };
    if requested_seconds == 0 {
        return Err(native_windows_audio_error(
            "max_recording_seconds must be greater than 0",
        ));
    }
    Ok(Duration::from_secs(requested_seconds))
}

#[cfg(windows)]
fn max_native_capture_samples(
    config: &cpal::StreamConfig,
    recording_duration: Duration,
) -> Result<usize, VoiceError> {
    let frames =
        u128::from(u32::from(config.sample_rate)) * u128::from(recording_duration.as_secs());
    let samples = frames * u128::from(config.channels);
    usize::try_from(samples)
        .map_err(|_| native_windows_audio_error("requested native recording duration is too large"))
}

#[cfg(windows)]
fn build_native_input_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    sample_format: cpal::SampleFormat,
    samples: Arc<Mutex<Vec<f32>>>,
    max_samples: usize,
    stream_errors: Arc<Mutex<Vec<String>>>,
) -> Result<cpal::Stream, VoiceError> {
    match sample_format {
        cpal::SampleFormat::I8 => build_native_input_stream_for_sample::<i8>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::I16 => build_native_input_stream_for_sample::<i16>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::I24 => build_native_input_stream_for_sample::<cpal::I24>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::I32 => build_native_input_stream_for_sample::<i32>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::I64 => build_native_input_stream_for_sample::<i64>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::U8 => build_native_input_stream_for_sample::<u8>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::U16 => build_native_input_stream_for_sample::<u16>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::U24 => build_native_input_stream_for_sample::<cpal::U24>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::U32 => build_native_input_stream_for_sample::<u32>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::U64 => build_native_input_stream_for_sample::<u64>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::F32 => build_native_input_stream_for_sample::<f32>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::F64 => build_native_input_stream_for_sample::<f64>(
            device,
            config,
            samples,
            max_samples,
            stream_errors,
        ),
        cpal::SampleFormat::DsdU8 | cpal::SampleFormat::DsdU16 | cpal::SampleFormat::DsdU32 => Err(
            native_windows_audio_error(format!("unsupported input sample format {sample_format}")),
        ),
        _ => Err(native_windows_audio_error(format!(
            "unsupported input sample format {sample_format}"
        ))),
    }
}

#[cfg(windows)]
fn build_native_input_stream_for_sample<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    samples: Arc<Mutex<Vec<f32>>>,
    max_samples: usize,
    stream_errors: Arc<Mutex<Vec<String>>>,
) -> Result<cpal::Stream, VoiceError>
where
    T: cpal::SizedSample + Send + 'static,
    f32: cpal::FromSample<T>,
{
    device
        .build_input_stream(
            config,
            move |data: &[T], _| append_native_input_samples(data, &samples, max_samples),
            move |error| {
                if let Ok(mut errors) = stream_errors.lock() {
                    errors.push(error.to_string());
                }
            },
            None,
        )
        .map_err(|error| {
            native_windows_audio_error(format!("failed to build input stream: {error}"))
        })
}

#[cfg(windows)]
fn append_native_input_samples<T>(input: &[T], samples: &Arc<Mutex<Vec<f32>>>, max_samples: usize)
where
    T: cpal::Sample,
    f32: cpal::FromSample<T>,
{
    let Ok(mut samples) = samples.try_lock() else {
        return;
    };
    let remaining = max_samples.saturating_sub(samples.len());
    if remaining == 0 {
        return;
    }
    samples.extend(
        input
            .iter()
            .take(remaining)
            .map(|sample| f32::from_sample(*sample)),
    );
}

fn native_windows_audio_error(message: impl Into<String>) -> VoiceError {
    VoiceError::Audio(format!("native_windows audio backend: {}", message.into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn audio_plan_builds_session_wav_path() {
        let plan = AudioPlan::new(PathBuf::from(".runtime/hook/audio"), "session-1");
        let artifact = plan.artifact();

        assert_eq!(
            artifact,
            AudioArtifact::new(
                PathBuf::from(".runtime/hook/audio/session-1.wav"),
                "audio/wav"
            )
        );
    }

    #[test]
    fn write_silent_wav_creates_readable_pcm_wav() {
        let mut dir = std::env::temp_dir();
        dir.push(format!("hook-audio-contract-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp audio dir");

        let artifact = AudioArtifact::new(dir.join("sample.wav"), "audio/wav");
        write_silent_wav(&artifact, WavSettings::mono_16khz(), 320).expect("write silent wav");

        let info = read_wav_info(&artifact).expect("read wav info");
        assert_eq!(info.sample_rate_hz, 16_000);
        assert_eq!(info.channels, 1);
        assert_eq!(info.bits_per_sample, 16);
        assert_eq!(info.duration_samples, 320);
    }

    #[test]
    fn capture_audio_uses_silent_backend_for_readable_wav_artifacts() {
        let mut dir = std::env::temp_dir();
        dir.push(format!("hook-audio-silent-capture-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let request = AudioCaptureRequest {
            backend: AudioBackendMode::Silent,
            temp_dir: dir.clone(),
            session_id: "silent-session".to_string(),
            wav_settings: WavSettings::mono_16khz(),
            max_recording_seconds: 60,
            silent_samples: 320,
        };

        let artifact = capture_audio(&request).expect("capture silent audio");

        assert_eq!(artifact.path, dir.join("silent-session.wav"));
        let info = read_wav_info(&artifact).expect("read wav info");
        assert_eq!(info.sample_rate_hz, 16_000);
        assert_eq!(info.channels, 1);
        assert_eq!(info.duration_samples, 320);
    }

    #[test]
    fn write_captured_wav_downmixes_and_resamples_to_requested_pcm_wav() {
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "hook-audio-captured-conversion-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);

        let artifact = AudioArtifact::new(dir.join("captured.wav"), "audio/wav");
        let source = CapturedAudioBuffer {
            sample_rate_hz: 48_000,
            channels: 2,
            samples: vec![
                0.25, 0.75, // mono 0.50
                0.20, 0.20, // skipped by 3:1 downsample
                0.10, 0.10, // skipped by 3:1 downsample
                -0.25, -0.75, // mono -0.50
                0.30, 0.30, // skipped by 3:1 downsample
                0.40, 0.40, // skipped by 3:1 downsample
            ],
        };

        write_captured_wav(&artifact, &source, WavSettings::mono_16khz())
            .expect("write converted captured wav");

        let info = read_wav_info(&artifact).expect("read wav info");
        assert_eq!(info.sample_rate_hz, 16_000);
        assert_eq!(info.channels, 1);
        assert_eq!(info.bits_per_sample, 16);
        assert_eq!(info.duration_samples, 2);
    }

    #[test]
    fn capture_audio_native_windows_backend_disabled_is_not_silent_fallback() {
        let mut dir = std::env::temp_dir();
        dir.push(format!("hook-audio-native-disabled-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let previous = std::env::var_os("HOOK_DISABLE_NATIVE_AUDIO");
        std::env::set_var("HOOK_DISABLE_NATIVE_AUDIO", "1");

        let request = AudioCaptureRequest {
            backend: AudioBackendMode::NativeWindows,
            temp_dir: dir.clone(),
            session_id: "native-session".to_string(),
            wav_settings: WavSettings::mono_16khz(),
            max_recording_seconds: 60,
            silent_samples: 320,
        };
        let error = capture_audio(&request).expect_err("native audio should fail when disabled");

        match previous {
            Some(value) => std::env::set_var("HOOK_DISABLE_NATIVE_AUDIO", value),
            None => std::env::remove_var("HOOK_DISABLE_NATIVE_AUDIO"),
        }

        assert!(error.to_string().contains("native_windows"));
        assert!(error.to_string().contains("HOOK_DISABLE_NATIVE_AUDIO"));
        let wav_path = dir.join("native-session.wav");
        assert!(
            !wav_path.exists(),
            "native audio failure must not create silent wav artifact at {}",
            wav_path.display()
        );
    }
}
