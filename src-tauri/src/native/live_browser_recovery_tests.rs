// Exercises the actual WGC owner loop, not a simulated recovering status.
use super::*;

struct OwnedCapture(LiveCaptureSession);
impl Drop for OwnedCapture {
    fn drop(&mut self) {
        let _ = self.0.stop_and_join();
    }
}

#[test]
#[ignore = "requires isolated Chrome launched by live-browser-input-probe.mjs"]
fn crop_outside_surface_recovers_after_more_than_three_build_failures() {
    let _lock = WATCHDOG_TEST_LOCK.lock().unwrap();
    let _watchdog = crate::emergency_watchdog::tests::start_interactive_test_watchdog();
    let ready: serde_json::Value = serde_json::from_slice(
        &std::fs::read(std::env::var("HOOK_BROWSER_INPUT_FIXTURE").unwrap()).unwrap(),
    )
    .unwrap();
    let hwnd = owned_window(
        ready["title"].as_str().unwrap(),
        ready["pid"].as_u64().unwrap() as u32,
    );
    let resize = |width, height| unsafe {
        SetWindowPos(
            hwnd,
            None,
            40,
            100,
            width,
            height,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .unwrap();
    };
    unsafe {
        let _ = ShowWindowAsync(hwnd, SW_RESTORE);
    }
    resize(900, 760);
    std::thread::sleep(Duration::from_millis(300));
    let region = LiveCapturePhysicalRegion {
        left: 650,
        top: 500,
        width: 100,
        height: 100,
    };
    let source = Arc::new(Mutex::new(
        LiveSourceWindowLifecycle::new_with_region(&format!("{:x}", hwnd.0 as usize), Some(region))
            .unwrap(),
    ));
    let config = LiveCaptureWorkerConfig {
        session_id: "browser-crop-recovery".into(),
        window_id: Some(format!("{:x}", hwnd.0 as usize)),
        expected_process_id: Some(ready["pid"].as_u64().unwrap() as u32),
        source_title: None,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        window_region: Some(region),
        target_fps: 12,
        display_metrics: CaptureWindowMetrics {
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            scale_factor: 1.0,
            logical_width: 1920.0,
            logical_height: 1080.0,
        },
        source_window: Some(source.clone()),
    };
    let state = Arc::new(Mutex::new(LiveCaptureSessionState::starting(&config)));
    let frames = Arc::new(Mutex::new(LiveCaptureFrameBuffer::new()));
    let dropped = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let worker = crate::screenshot::spawn_live_capture_worker(
        config,
        state.clone(),
        frames.clone(),
        dropped.clone(),
        rx,
    )
    .unwrap();
    // Stop and join the worker even if an assertion unwinds.
    let session = OwnedCapture(LiveCaptureSession {
        state: state.clone(),
        frames: frames.clone(),
        dropped_frames: dropped,
        stop_tx: Mutex::new(Some(tx)),
        join: Mutex::new(Some(worker)),
        source_window: Some(source),
    });
    wait_until(|| frames.lock().unwrap().latest_after(0).is_some());
    let before = frames.lock().unwrap().latest_after(0).unwrap().frame_id;
    resize(400, 300);
    std::thread::sleep(Duration::from_secs(8));
    assert_eq!(
        state.lock().unwrap().capture_state,
        "recovering",
        "temporary invalid crop must not kill the worker"
    );
    let resumed_at = live_capture_now_ms();
    resize(900, 760);
    wait_until(|| {
        state.lock().unwrap().capture_state == "streaming"
            && frames
                .lock()
                .unwrap()
                .latest_after(before)
                .is_some_and(|frame| frame.capture_timestamp_ms >= resumed_at)
    });
    let value = state.lock().unwrap();
    assert!(value.error_code.is_none());
    drop(value);
    println!("PASS real WGC recovering -> streaming with newer frame after 8 second invalid crop");
    resize(400, 300);
    wait_until(|| state.lock().unwrap().capture_state == "recovering");
    let stopping = Instant::now();
    session.0.stop_and_join().unwrap();
    assert!(
        stopping.elapsed() < Duration::from_secs(1),
        "retry delay must be cancellable"
    );
    resize(900, 760);
}
