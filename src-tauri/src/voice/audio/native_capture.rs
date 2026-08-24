//! Native Windows microphone capture through CPAL.

use super::{native_windows_audio_error, AudioCaptureRequest, CapturedAudioBuffer, VoiceError};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::Sample;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const MAX_NATIVE_CAPTURE_BYTES: usize = 256 * 1024 * 1024;
const MAX_REPORTED_STREAM_ERRORS: usize = 32;

pub(super) fn capture_native_windows_audio(
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

    let stream_errors = Arc::try_unwrap(stream_errors)
        .map_err(|_| native_windows_audio_error("input stream error buffer is still shared"))?
        .into_inner()
        .map_err(|_| native_windows_audio_error("input stream error lock was poisoned"))?;
    if !stream_errors.is_empty() {
        return Err(native_windows_audio_error(format!(
            "input stream reported errors: {}",
            stream_errors.join("; ")
        )));
    }
    let samples = Arc::try_unwrap(samples)
        .map_err(|_| native_windows_audio_error("captured sample buffer is still shared"))?
        .into_inner()
        .map_err(|_| native_windows_audio_error("captured sample buffer lock was poisoned"))?;
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

fn max_native_capture_samples(
    config: &cpal::StreamConfig,
    recording_duration: Duration,
) -> Result<usize, VoiceError> {
    let frames =
        u128::from(u32::from(config.sample_rate)) * u128::from(recording_duration.as_secs());
    let samples = frames * u128::from(config.channels);
    let samples = usize::try_from(samples).map_err(|_| {
        native_windows_audio_error("requested native recording duration is too large")
    })?;
    let bytes = samples
        .checked_mul(std::mem::size_of::<f32>())
        .ok_or_else(|| native_windows_audio_error("native capture byte count overflow"))?;
    if bytes > MAX_NATIVE_CAPTURE_BYTES {
        return Err(native_windows_audio_error(format!(
            "native capture exceeds the {MAX_NATIVE_CAPTURE_BYTES}-byte memory limit"
        )));
    }
    Ok(samples)
}

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
                let mut errors = stream_errors
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if errors.len() < MAX_REPORTED_STREAM_ERRORS {
                    errors.push(error.to_string());
                }
            },
            None,
        )
        .map_err(|error| {
            native_windows_audio_error(format!("failed to build input stream: {error}"))
        })
}

fn append_native_input_samples<T>(input: &[T], samples: &Arc<Mutex<Vec<f32>>>, max_samples: usize)
where
    T: cpal::Sample,
    f32: cpal::FromSample<T>,
{
    // CPAL releases its callback before stream teardown, so blocking here cannot
    // contend with the final buffer handoff and avoids silently dropping audio.
    let mut samples = samples
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_capture_allocation_is_checked_and_bounded() {
        let normal = cpal::StreamConfig {
            channels: 2,
            sample_rate: 48_000,
            buffer_size: cpal::BufferSize::Default,
        };
        assert_eq!(
            max_native_capture_samples(&normal, Duration::from_secs(60)).unwrap(),
            5_760_000
        );

        let excessive = cpal::StreamConfig {
            channels: 8,
            sample_rate: 384_000,
            buffer_size: cpal::BufferSize::Default,
        };
        assert!(max_native_capture_samples(&excessive, Duration::from_secs(60)).is_err());
    }
}
