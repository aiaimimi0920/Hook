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

    #[test]
    fn capture_audio_rejects_unsafe_session_paths_before_writing() {
        let request = AudioCaptureRequest {
            backend: AudioBackendMode::Silent,
            temp_dir: std::env::temp_dir(),
            session_id: "../outside".to_string(),
            wav_settings: WavSettings::mono_16khz(),
            max_recording_seconds: 60,
            silent_samples: 1,
        };

        let error = capture_audio(&request).expect_err("unsafe session path must fail");
        assert!(error.to_string().contains("session_id"), "error={error}");
        assert!(validate_session_id("NUL").is_err());
        assert!(validate_session_id("safe_session-1").is_ok());
    }

    #[test]
    fn wav_writers_reject_invalid_or_oversized_payloads_before_file_creation() {
        let dir = std::env::temp_dir().join(format!("hook-audio-bounds-{}", std::process::id()));
        let invalid_settings = AudioArtifact::new(dir.join("invalid.wav"), "audio/wav");
        let error = write_silent_wav(
            &invalid_settings,
            WavSettings {
                sample_rate_hz: 0,
                channels: 1,
            },
            1,
        )
        .expect_err("zero sample rate must fail");
        assert!(error.to_string().contains("sample_rate_hz"));
        assert!(!invalid_settings.path.exists());

        let oversized = AudioArtifact::new(dir.join("oversized.wav"), "audio/wav");
        let error = write_silent_wav(
            &oversized,
            WavSettings::mono_16khz(),
            (MAX_WAV_PCM_BYTES / std::mem::size_of::<i16>()) + 1,
        )
        .expect_err("oversized PCM must fail");
        assert!(error.to_string().contains("limit"));
        assert!(!oversized.path.exists());
    }

    #[test]
    fn captured_wav_rejects_incomplete_source_frames() {
        let artifact = AudioArtifact::new(
            std::env::temp_dir().join("hook-incomplete-frame.wav"),
            "audio/wav",
        );
        let source = CapturedAudioBuffer {
            sample_rate_hz: 48_000,
            channels: 2,
            samples: vec![0.5],
        };

        let error = write_captured_wav(&artifact, &source, WavSettings::mono_16khz())
            .expect_err("partial frame must fail");
        assert!(error.to_string().contains("incomplete source frame"));
    }
}
