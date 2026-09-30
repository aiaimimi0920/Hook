use std::collections::BTreeSet;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, PostMessageW, SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER, WM_CLOSE,
};

use crate::{
    CaptureWindowMetrics, LiveCaptureFrameBuffer, LiveCaptureSession, LiveCaptureSessionState,
    LiveCaptureWorkerConfig,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PhaseTwoProbe {
    schema_version: u8,
    duration_seconds: u64,
    frames_received: u64,
    distinct_frame_digests: usize,
    maximum_frame_gap_ms: u128,
    observed_epochs: Vec<u64>,
    resize_recovered: bool,
    window_region_move_followed: bool,
    clean_shutdown: bool,
    source_close_failed_closed: bool,
    dropped_frames: u64,
    errors: Vec<String>,
}

fn required_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} is required"))
}

fn fixture_hwnd() -> HWND {
    let raw = u64::from_str_radix(
        required_env("HOOK_LIVE_PHASE2_HWND").trim_start_matches("0x"),
        16,
    )
    .expect("fixture HWND must be hexadecimal");
    HWND(raw as *mut std::ffi::c_void)
}

fn config(session_id: &str, hwnd: HWND) -> LiveCaptureWorkerConfig {
    let use_window_region = std::env::var("HOOK_LIVE_PHASE2_WINDOW_REGION").as_deref() == Ok("1");
    LiveCaptureWorkerConfig {
        session_id: session_id.to_string(),
        window_id: Some(format!("{:x}", hwnd.0 as usize)),
        expected_process_id: None,
        source_title: Some("Hook live Phase 2 fixture".to_string()),
        x: 0,
        y: 0,
        width: 640,
        height: 420,
        window_region: use_window_region.then_some(crate::LiveCapturePhysicalRegion {
            left: 100,
            top: 100,
            width: 50,
            height: 50,
        }),
        target_fps: 12,
        display_metrics: CaptureWindowMetrics {
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            scale_factor: 1.0,
            logical_width: 1920.0,
            logical_height: 1080.0,
        },
        source_window: None,
    }
}

fn wait_for_state(
    state: &Arc<Mutex<LiveCaptureSessionState>>,
    expected: &str,
    timeout: Duration,
) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if state
            .lock()
            .map(|value| value.capture_state == expected)
            .unwrap_or(false)
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}

#[test]
#[ignore = "requires the interactive Phase 2 WinForms fixture"]
fn phase_two_live_worker_soaks_recovers_and_cleans_up() {
    let duration_seconds = required_env("HOOK_LIVE_PHASE2_DURATION_SECONDS")
        .parse::<u64>()
        .expect("duration must be an integer")
        .clamp(10, 600);
    let hwnd = fixture_hwnd();
    let worker_config = config("phase2-soak", hwnd);
    let state = Arc::new(Mutex::new(LiveCaptureSessionState::starting(
        &worker_config,
    )));
    let frames = Arc::new(Mutex::new(LiveCaptureFrameBuffer::new()));
    let dropped = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let (stop_tx, stop_rx) = mpsc::sync_channel(1);
    let worker = super::spawn_live_capture_worker(
        worker_config,
        state.clone(),
        frames.clone(),
        dropped.clone(),
        stop_rx,
    )
    .expect("spawn live worker");
    let session = LiveCaptureSession {
        state: state.clone(),
        frames: frames.clone(),
        dropped_frames: dropped.clone(),
        stop_tx: Mutex::new(Some(stop_tx)),
        join: Mutex::new(Some(worker)),
        source_window: None,
    };

    let started = Instant::now();
    let deadline = started + Duration::from_secs(duration_seconds);
    let resize_at = started + Duration::from_secs((duration_seconds / 3).max(2));
    let move_at = started + Duration::from_secs((duration_seconds / 4).max(1));
    let use_window_region = std::env::var("HOOK_LIVE_PHASE2_WINDOW_REGION").as_deref() == Ok("1");
    let mut resize_requested = false;
    let mut move_requested = false;
    let mut move_after_frame_id = u64::MAX;
    let mut window_region_move_followed = !use_window_region;
    let mut last_frame_id = 0u64;
    let mut last_frame_at = started;
    let mut maximum_frame_gap = Duration::ZERO;
    let mut digests = BTreeSet::new();
    let mut epochs = BTreeSet::new();
    let mut received = 0u64;
    let mut errors = Vec::new();

    while Instant::now() < deadline {
        if use_window_region && !move_requested && Instant::now() >= move_at {
            let mut rect = windows::Win32::Foundation::RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
                let width = (rect.right - rect.left).max(1);
                let height = (rect.bottom - rect.top).max(1);
                if unsafe {
                    SetWindowPos(
                        hwnd,
                        None,
                        rect.left + 120,
                        rect.top + 80,
                        width,
                        height,
                        SWP_NOZORDER | SWP_NOACTIVATE,
                    )
                }
                .is_err()
                {
                    errors.push("fixture move failed".to_string());
                }
            } else {
                errors.push("fixture bounds were unavailable before move".to_string());
            }
            move_after_frame_id = last_frame_id;
            move_requested = true;
        }
        if !resize_requested && Instant::now() >= resize_at {
            let mut rect = windows::Win32::Foundation::RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
                let width = (rect.right - rect.left + 96).max(320);
                let height = (rect.bottom - rect.top + 64).max(240);
                if unsafe {
                    SetWindowPos(
                        hwnd,
                        None,
                        0,
                        0,
                        width,
                        height,
                        SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
                    )
                }
                .is_err()
                {
                    errors.push("fixture resize failed".to_string());
                }
            } else {
                errors.push("fixture bounds were unavailable".to_string());
            }
            resize_requested = true;
        }

        let descriptor = frames
            .lock()
            .ok()
            .and_then(|queue| queue.latest_after(last_frame_id));
        if let Some(descriptor) = descriptor {
            let bytes = frames
                .lock()
                .ok()
                .and_then(|mut queue| queue.take_bytes_for(descriptor.frame_id));
            if let Some(bytes) = bytes {
                let now = Instant::now();
                maximum_frame_gap = maximum_frame_gap.max(now.duration_since(last_frame_at));
                last_frame_at = now;
                last_frame_id = descriptor.frame_id;
                epochs.insert(descriptor.epoch);
                if move_requested
                    && descriptor.frame_id > move_after_frame_id
                    && descriptor.width == 50
                    && descriptor.height == 50
                {
                    window_region_move_followed = true;
                }
                digests.insert(Sha256::digest(&bytes).to_vec());
                received += 1;
            }
        }
        std::thread::sleep(Duration::from_millis(25));
    }

    session
        .stop_and_join()
        .expect("live session must stop without panic");
    let clean_shutdown = state
        .lock()
        .map(|value| value.capture_state == "closed")
        .unwrap_or(false)
        && frames
            .lock()
            .map(|queue| queue.frames.is_empty())
            .unwrap_or(false);

    let close_config = config("phase2-source-close", hwnd);
    let close_state = Arc::new(Mutex::new(LiveCaptureSessionState::starting(&close_config)));
    let close_frames = Arc::new(Mutex::new(LiveCaptureFrameBuffer::new()));
    let close_dropped = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let (close_stop_tx, close_stop_rx) = mpsc::sync_channel(1);
    let close_worker = super::spawn_live_capture_worker(
        close_config,
        close_state.clone(),
        close_frames.clone(),
        close_dropped,
        close_stop_rx,
    )
    .expect("spawn source-close worker");
    let streaming_before_close = wait_for_state(&close_state, "streaming", Duration::from_secs(10));
    let _ = unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) };
    let failed_after_close = wait_for_state(&close_state, "failed", Duration::from_secs(12));
    if !failed_after_close {
        let _ = close_stop_tx.try_send(());
    }
    close_worker
        .join()
        .expect("source-close worker must not panic");
    let source_close_failed_closed = streaming_before_close
        && failed_after_close
        && close_state
            .lock()
            .map(|value| value.error_code.as_deref() == Some("source_closed"))
            .unwrap_or(false)
        && close_frames
            .lock()
            .map(|queue| queue.frames.is_empty())
            .unwrap_or(false);

    if received < duration_seconds.saturating_mul(4) {
        errors.push("sustained frame rate fell below 4 fps".to_string());
    }
    if digests.len() < 2 {
        errors.push("fixture did not produce changing frames".to_string());
    }
    if maximum_frame_gap > Duration::from_secs(7) {
        errors.push("a live frame gap exceeded seven seconds".to_string());
    }
    if epochs.len() < 2 {
        errors.push("resize did not recreate the WGC session".to_string());
    }
    if !window_region_move_followed {
        errors.push("window-relative region did not continue after source movement".to_string());
    }
    if !clean_shutdown {
        errors.push("explicit stop did not clean the worker and frame queue".to_string());
    }
    if !source_close_failed_closed {
        errors.push("source close did not fail closed and clear buffered frames".to_string());
    }

    let report = PhaseTwoProbe {
        schema_version: 1,
        duration_seconds,
        frames_received: received,
        distinct_frame_digests: digests.len(),
        maximum_frame_gap_ms: maximum_frame_gap.as_millis(),
        observed_epochs: epochs.into_iter().collect(),
        resize_recovered: resize_requested,
        window_region_move_followed,
        clean_shutdown,
        source_close_failed_closed,
        dropped_frames: dropped.load(std::sync::atomic::Ordering::Relaxed),
        errors,
    };
    let output = required_env("HOOK_LIVE_PHASE2_OUTPUT");
    std::fs::write(
        output,
        serde_json::to_vec_pretty(&report).expect("serialize Phase 2 report"),
    )
    .expect("write Phase 2 report");
    assert!(report.errors.is_empty(), "{}", report.errors.join("; "));
}
