use std::collections::BTreeSet;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};

#[path = "live_source_phase3_region.rs"]
mod region_support;

use crate::{
    CaptureWindowMetrics, LiveCaptureFrameBuffer, LiveCaptureInputRequest, LiveCaptureSession,
    LiveCaptureSessionState, LiveCaptureWorkerConfig, LiveSourceWindowLifecycle,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PhaseThreeProbe {
    schema_version: u8,
    fixture_kind: String,
    logical_hide_strategy: &'static str,
    native_minimize_claimed: bool,
    window_region_input: bool,
    hidden_frames: u64,
    distinct_hidden_frames: usize,
    post_restore_frames: u64,
    click_delivered: bool,
    key_delivered: bool,
    wheel_delivered: bool,
    drag_delivered: bool,
    track_before: isize,
    track_after_wheel: isize,
    track_after_drag: isize,
    restored_bounds_exactly: bool,
    local_reclaim_released_input: bool,
    watchdog_recovery_armed: bool,
    watchdog_recovery_verified: bool,
    recovery_journal_cleared: bool,
    clean_shutdown: bool,
    errors: Vec<String>,
}

fn required_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} is required"))
}

fn fixture_hwnd() -> HWND {
    let raw = u64::from_str_radix(
        required_env("HOOK_LIVE_PHASE3_HWND").trim_start_matches("0x"),
        16,
    )
    .expect("fixture HWND must be hexadecimal");
    HWND(raw as *mut std::ffi::c_void)
}

fn config(
    hwnd: HWND,
    source_window: Arc<Mutex<LiveSourceWindowLifecycle>>,
    window_region: Option<crate::LiveCapturePhysicalRegion>,
) -> LiveCaptureWorkerConfig {
    let process_id = source_window.lock().expect("source lock").process_id;
    LiveCaptureWorkerConfig {
        session_id: "phase3-logical-hide".to_string(),
        window_id: Some(format!("{:x}", hwnd.0 as usize)),
        expected_process_id: Some(process_id),
        source_title: Some("Hook live Phase 3 fixture".to_string()),
        x: 0,
        y: 0,
        width: 640,
        height: 420,
        window_region,
        target_fps: 12,
        display_metrics: CaptureWindowMetrics {
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            scale_factor: 1.0,
            logical_width: 1920.0,
            logical_height: 1080.0,
        },
        source_window: Some(source_window),
    }
}

fn wait_for_streaming(state: &Arc<Mutex<LiveCaptureSessionState>>) -> bool {
    let deadline = Instant::now() + Duration::from_secs(12);
    while Instant::now() < deadline {
        if state
            .lock()
            .map(|state| state.capture_state == "streaming")
            .unwrap_or(false)
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}

fn collect_frames(
    frames: &Arc<Mutex<LiveCaptureFrameBuffer>>,
    mut after: u64,
    duration: Duration,
) -> (u64, u64, BTreeSet<Vec<u8>>) {
    let deadline = Instant::now() + duration;
    let mut count = 0;
    let mut digests = BTreeSet::new();
    while Instant::now() < deadline {
        let descriptor = frames
            .lock()
            .ok()
            .and_then(|queue| queue.latest_after(after));
        if let Some(descriptor) = descriptor {
            if let Some(bytes) = frames
                .lock()
                .ok()
                .and_then(|mut queue| queue.take_bytes_for(descriptor.frame_id))
            {
                after = descriptor.frame_id;
                count += 1;
                digests.insert(Sha256::digest(bytes).to_vec());
            }
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    (after, count, digests)
}

unsafe extern "system" fn collect_child(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let children = unsafe { &mut *(lparam.0 as *mut Vec<HWND>) };
    children.push(hwnd);
    BOOL(1)
}

fn window_text(hwnd: HWND) -> String {
    let length = unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowTextLengthW(hwnd) };
    let mut value = vec![0u16; length.max(0) as usize + 1];
    let copied =
        unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowTextW(hwnd, &mut value) };
    String::from_utf16_lossy(&value[..copied.max(0) as usize])
}

fn window_class(hwnd: HWND) -> String {
    let mut value = vec![0u16; 256];
    let copied =
        unsafe { windows::Win32::UI::WindowsAndMessaging::GetClassNameW(hwnd, &mut value) };
    String::from_utf16_lossy(&value[..copied.max(0) as usize])
}

fn child_windows(root: HWND) -> Vec<HWND> {
    let mut children = Vec::new();
    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::EnumChildWindows(
            Some(root),
            Some(collect_child),
            LPARAM((&mut children as *mut Vec<HWND>) as isize),
        );
    }
    children
}

fn find_child(root: HWND, text: &str, class: &str) -> Option<HWND> {
    child_windows(root).into_iter().find(|child| {
        (text.is_empty() || window_text(*child).starts_with(text))
            && (class.is_empty() || window_class(*child).to_ascii_uppercase().contains(class))
    })
}

fn click_count(text: &str) -> i32 {
    text.split(':')
        .nth(1)
        .and_then(|value| value.trim().parse().ok())
        .unwrap_or(-1)
}

fn normalized_point(root: HWND, target: HWND, fraction_x: f64) -> (f64, f64) {
    let mut rect = RECT::default();
    unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowRect(target, &mut rect) }
        .expect("target bounds");
    let mut point = windows::Win32::Foundation::POINT {
        x: rect.left + ((rect.right - rect.left) as f64 * fraction_x) as i32,
        y: rect.top + (rect.bottom - rect.top) / 2,
    };
    assert!(unsafe { windows::Win32::Graphics::Gdi::ScreenToClient(root, &mut point) }.as_bool());
    let mut client = RECT::default();
    unsafe { windows::Win32::UI::WindowsAndMessaging::GetClientRect(root, &mut client) }
        .expect("root client bounds");
    (
        f64::from(point.x) / f64::from((client.right - 1).max(1)),
        f64::from(point.y) / f64::from((client.bottom - 1).max(1)),
    )
}

fn input(sequence: u64, kind: &str, point: Option<(f64, f64)>) -> LiveCaptureInputRequest {
    LiveCaptureInputRequest {
        sequence,
        kind: kind.to_string(),
        normalized_x: point.map(|value| value.0),
        normalized_y: point.map(|value| value.1),
        button: None,
        wheel_delta: None,
        wheel_axis: None,
        click_count: None,
        virtual_key: None,
    }
}

fn send_click(source: &mut LiveSourceWindowLifecycle, sequence: &mut u64, point: (f64, f64)) {
    let mut down = input(*sequence, "mouse_button_down", Some(point));
    down.button = Some("left".to_string());
    down.click_count = Some(1);
    source.send_input(&down).expect("send mouse down");
    *sequence += 1;
    let mut up = input(*sequence, "mouse_button_up", Some(point));
    up.button = Some("left".to_string());
    source.send_input(&up).expect("send mouse up");
    *sequence += 1;
}

#[test]
#[ignore = "requires an interactive Phase 3 Win32 or WinForms fixture"]
fn phase_three_logical_hide_input_reclaim_and_restore() {
    let hwnd = fixture_hwnd();
    let fixture_kind = required_env("HOOK_LIVE_PHASE3_FIXTURE_KIND");
    let window_region = (std::env::var("HOOK_LIVE_PHASE3_WINDOW_REGION").as_deref() == Ok("1"))
        .then(|| region_support::client_region(hwnd));
    let source = Arc::new(Mutex::new(
        LiveSourceWindowLifecycle::new_with_region(
            &format!("{:x}", hwnd.0 as usize),
            window_region,
        )
        .expect("create source lifecycle"),
    ));
    let worker_config = config(hwnd, source.clone(), window_region);
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
    .expect("spawn Phase 3 worker");
    let session = LiveCaptureSession {
        state: state.clone(),
        frames: frames.clone(),
        dropped_frames: dropped,
        stop_tx: Mutex::new(Some(stop_tx)),
        join: Mutex::new(Some(worker)),
        source_window: Some(source.clone()),
    };
    let mut errors = Vec::new();
    if !wait_for_streaming(&state) {
        errors.push("worker did not reach streaming state".to_string());
    }
    let mut original = RECT::default();
    unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut original) }
        .expect("original source bounds");
    let (mut frame_id, _, _) = collect_frames(&frames, 0, Duration::from_secs(1));

    source
        .lock()
        .expect("source lock")
        .set_logically_hidden(true, "phase3_probe")
        .expect("logical hide");
    let recovery_path =
        crate::live_source_recovery_path(std::process::id()).expect("live source recovery path");
    let watchdog_recovery_armed = recovery_path.is_file();
    if !watchdog_recovery_armed {
        errors.push("emergency watchdog recovery journal was not armed".to_string());
    }
    let (next_frame, hidden_frames, hidden_digests) =
        collect_frames(&frames, frame_id, Duration::from_secs(3));
    frame_id = next_frame;
    if hidden_frames < 8 || hidden_digests.len() < 2 {
        errors.push("logical hide did not keep fresh changing frames".to_string());
    }

    let children = child_windows(hwnd);
    let action = find_child(hwnd, "Apply action", "BUTTON").expect("action button");
    let status = find_child(hwnd, "Clicks:", "").expect("click status");
    let track = children
        .iter()
        .copied()
        .find(|child| {
            window_class(*child)
                .to_ascii_uppercase()
                .contains("TRACKBAR")
        })
        .expect("trackbar control");

    let clicks_before = window_text(status);
    let key_status = find_child(hwnd, "Keys:", "").expect("key status");
    let key_edges_before = window_text(key_status);
    let drag_status = (fixture_kind == "WinForms")
        .then(|| find_child(hwnd, "Drag edges:", "").expect("drag status"));
    let drag_edges_before = drag_status.map(window_text);
    let track_before = unsafe {
        windows::Win32::UI::WindowsAndMessaging::SendMessageW(track, 0x0400, None, None).0
    };
    let mut sequence = 1u64;
    let mut lifecycle = source.lock().expect("source lock");
    lifecycle
        .set_interaction_enabled(true)
        .expect("enable source interaction");
    send_click(
        &mut lifecycle,
        &mut sequence,
        normalized_point(hwnd, action, 0.5),
    );
    std::thread::sleep(Duration::from_millis(100));
    let mut key_down = input(sequence, "key_down", None);
    key_down.virtual_key = Some(0x20);
    lifecycle.send_input(&key_down).expect("key down");
    sequence += 1;
    let mut key_up = input(sequence, "key_up", None);
    key_up.virtual_key = Some(0x20);
    lifecycle.send_input(&key_up).expect("key up");
    sequence += 1;
    send_click(
        &mut lifecycle,
        &mut sequence,
        normalized_point(hwnd, track, 0.4),
    );
    let mut wheel = input(
        sequence,
        "mouse_wheel",
        Some(normalized_point(hwnd, track, 0.4)),
    );
    wheel.wheel_delta = Some(120);
    wheel.wheel_axis = Some("vertical".to_string());
    lifecycle.send_input(&wheel).expect("mouse wheel");
    sequence += 1;
    std::thread::sleep(Duration::from_millis(200));
    let track_after_wheel = unsafe {
        windows::Win32::UI::WindowsAndMessaging::SendMessageW(track, 0x0400, None, None).0
    };
    let drag_target = if fixture_kind == "WinForms" {
        action
    } else {
        track
    };
    let drag_start = normalized_point(
        hwnd,
        drag_target,
        if fixture_kind == "WinForms" {
            0.3
        } else {
            (track_after_wheel as f64 / 100.0).clamp(0.1, 0.9)
        },
    );
    let drag_end = normalized_point(hwnd, drag_target, 0.8);
    let mut down = input(sequence, "mouse_button_down", Some(drag_start));
    down.button = Some("left".to_string());
    lifecycle.send_input(&down).expect("drag down");
    sequence += 1;
    for fraction in [0.55, 0.7, 0.8] {
        lifecycle
            .send_input(&input(
                sequence,
                "mouse_move",
                Some(normalized_point(hwnd, drag_target, fraction)),
            ))
            .expect("drag move");
        sequence += 1;
    }
    let mut up = input(sequence, "mouse_button_up", Some(drag_end));
    up.button = Some("left".to_string());
    lifecycle.send_input(&up).expect("drag up");
    std::thread::sleep(Duration::from_millis(500));

    let clicks_after = window_text(status);
    let key_edges_after = window_text(key_status);
    let drag_edges_after = drag_status.map(window_text);
    let track_after = unsafe {
        windows::Win32::UI::WindowsAndMessaging::SendMessageW(track, 0x0400, None, None).0
    };
    let click_delivered = click_count(&clicks_after) >= click_count(&clicks_before) + 1;
    let key_delivered = click_count(&key_edges_after) >= click_count(&key_edges_before) + 2;
    let wheel_delivered = track_before != track_after_wheel;
    let drag_delivered = if let (Some(before), Some(after)) = (drag_edges_before, drag_edges_after)
    {
        click_count(&after) >= click_count(&before) + 3
    } else {
        track_after != track_after_wheel
    };
    if !click_delivered {
        errors.push("mouse click was not delivered".to_string());
    }
    if !key_delivered {
        errors.push("keyboard edge was not delivered".to_string());
    }
    if !wheel_delivered {
        errors.push("wheel was not delivered".to_string());
    }
    if !drag_delivered {
        errors.push("mouse drag was not delivered".to_string());
    }

    let watchdog_recovery_verified =
        match crate::restore_live_source_windows_for_parent(std::process::id()) {
            Ok(1) => {
                let mut watchdog_restored = RECT::default();
                unsafe {
                    windows::Win32::UI::WindowsAndMessaging::GetWindowRect(
                        hwnd,
                        &mut watchdog_restored,
                    )
                }
                .is_ok()
                    && watchdog_restored == original
                    && !recovery_path.exists()
            }
            Ok(count) => {
                errors.push(format!(
                    "watchdog restored {count} source windows instead of one"
                ));
                false
            }
            Err(error) => {
                errors.push(format!("watchdog recovery failed: {error}"));
                false
            }
        };
    if !watchdog_recovery_verified {
        errors.push("watchdog recovery did not restore the exact source window".to_string());
    }

    lifecycle
        .set_interaction_enabled(false)
        .expect("local reclaim input");
    lifecycle.restore().expect("local reclaim source window");
    let local_reclaim_released_input = !lifecycle.interaction_enabled
        && lifecycle.pressed_mouse_buttons == 0
        && lifecycle.pressed_virtual_keys.is_empty();
    drop(lifecycle);
    let recovery_journal_cleared = !recovery_path.exists();
    if !recovery_journal_cleared {
        errors.push("source recovery journal remained after normal restore".to_string());
    }
    let mut restored = RECT::default();
    unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut restored) }
        .expect("restored source bounds");
    let restored_bounds_exactly = original == restored;
    if !restored_bounds_exactly {
        errors.push("source bounds were not restored exactly".to_string());
    }
    let (_, post_restore_frames, _) = collect_frames(&frames, frame_id, Duration::from_secs(2));
    if post_restore_frames < 4 {
        errors.push("frames did not continue after restore".to_string());
    }

    let stop_result = session.stop_and_join();
    let clean_shutdown = stop_result.is_ok()
        && state
            .lock()
            .map(|state| state.capture_state == "closed")
            .unwrap_or(false)
        && frames
            .lock()
            .map(|frames| frames.frames.is_empty())
            .unwrap_or(false);
    if !clean_shutdown {
        errors.push(format!("session cleanup failed: {stop_result:?}"));
    }
    let report = PhaseThreeProbe {
        schema_version: 1,
        fixture_kind,
        logical_hide_strategy: "near_transparent_compositor_window",
        native_minimize_claimed: false,
        window_region_input: window_region.is_some(),
        hidden_frames,
        distinct_hidden_frames: hidden_digests.len(),
        post_restore_frames,
        click_delivered,
        key_delivered,
        wheel_delivered,
        drag_delivered,
        track_before,
        track_after_wheel,
        track_after_drag: track_after,
        restored_bounds_exactly,
        local_reclaim_released_input,
        watchdog_recovery_armed,
        watchdog_recovery_verified,
        recovery_journal_cleared,
        clean_shutdown,
        errors,
    };
    std::fs::write(
        required_env("HOOK_LIVE_PHASE3_OUTPUT"),
        serde_json::to_vec_pretty(&report).expect("serialize Phase 3 report"),
    )
    .expect("write Phase 3 report");
    assert!(report.errors.is_empty(), "{}", report.errors.join("; "));
}
