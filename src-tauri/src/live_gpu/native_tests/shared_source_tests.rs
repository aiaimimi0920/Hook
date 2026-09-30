//! Static late join, separate crops, owner stop, and actual source-close proof.
use super::*;
use std::sync::{atomic::AtomicU64, mpsc, Arc, Mutex};

fn start(source: HWND, id: &str, left: u32) -> CaptureGuard {
    let config = crate::LiveCaptureWorkerConfig {
        session_id: id.to_string(),
        window_id: Some(format!("{:x}", source.0 as usize)),
        expected_process_id: Some(std::process::id()),
        source_title: None,
        x: 0,
        y: 0,
        width: 64,
        height: 64,
        target_fps: 60,
        window_region: Some(crate::LiveCapturePhysicalRegion {
            left,
            top: 16,
            width: 64,
            height: 64,
        }),
        display_metrics: crate::CaptureWindowMetrics {
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            scale_factor: 1.0,
            logical_width: 1920.0,
            logical_height: 1080.0,
        },
        source_window: None,
    };
    let state = Arc::new(Mutex::new(crate::LiveCaptureSessionState::starting(
        &config,
    )));
    let frames = Arc::new(Mutex::new(crate::LiveCaptureFrameBuffer::new()));
    let dropped_frames = Arc::new(AtomicU64::new(0));
    let (tx, rx) = mpsc::sync_channel(1);
    let join = crate::screenshot::spawn_live_capture_worker(
        config,
        state.clone(),
        frames.clone(),
        dropped_frames.clone(),
        rx,
    )
    .unwrap();
    CaptureGuard(crate::LiveCaptureSession {
        state,
        frames,
        dropped_frames,
        stop_tx: Mutex::new(Some(tx)),
        join: Mutex::new(Some(join)),
        source_window: None,
    })
}

fn wait_color(capture: &CaptureGuard, target: HWND, id: &str, color: [u8; 3]) {
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        pump();
        worker::configure(
            target.0 as usize,
            id,
            Some(Layout {
                x: 8.0,
                y: 8.0,
                width: 64.0,
                height: 64.0,
                inset: 0.0,
            }),
        )
        .unwrap();
        if let Some(frame) = worker::snapshot(id).unwrap() {
            let (image, _) = frame.into_rgb().unwrap();
            assert_eq!(image.dimensions(), (64, 64));
            if image.get_pixel(16, 16).0 == color && image.get_pixel(48, 48).0 == color {
                return;
            }
        }
        assert!(
            Instant::now() < deadline,
            "static shared crop did not arrive before the health-rebuild timeout: {:?}",
            capture.0.state.lock().unwrap().snapshot(0)
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[test]
#[ignore = "interactive desktop: two owned windows, no global input"]
fn shared_window_static_late_join_resize_sibling_stop_and_source_close() {
    let _probe = PROBE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let mut owned = create_windows();
    let (source, target) = (owned.0[0], owned.0[1]);
    pump();
    fill(
        source,
        RECT {
            left: 0,
            top: 16,
            right: 64,
            bottom: 80,
        },
        0x0000ff00,
    );
    fill(
        source,
        RECT {
            left: 64,
            top: 16,
            right: 128,
            bottom: 80,
        },
        0x0000ffff,
    );
    let first = start(source, "shared-static-first", 0);
    wait_color(&first, target, "shared-static-first", [0, 255, 0]);
    let second = start(source, "shared-static-second", 64);
    // Deliberately no source paint between joins: refresh must supply the initial frame.
    wait_color(&second, target, "shared-static-second", [255, 255, 0]);
    assert_eq!(crate::screenshot::live_shared_pool_count(), 1);
    assert_eq!(second.0.state.lock().unwrap().snapshot(0).epoch, 1);
    drop(first);
    assert_eq!(crate::screenshot::live_shared_pool_count(), 1);
    fill(
        source,
        RECT {
            left: 64,
            top: 16,
            right: 128,
            bottom: 80,
        },
        0x00ff0000,
    );
    wait_color(&second, target, "shared-static-second", [0, 0, 255]);

    unsafe {
        windows::Win32::UI::WindowsAndMessaging::SetWindowPos(
            source,
            None,
            0,
            0,
            180,
            160,
            windows::Win32::UI::WindowsAndMessaging::SWP_NOMOVE
                | windows::Win32::UI::WindowsAndMessaging::SWP_NOZORDER
                | windows::Win32::UI::WindowsAndMessaging::SWP_NOACTIVATE,
        )
        .unwrap();
    }
    let deadline = Instant::now() + Duration::from_secs(4);
    while second.0.state.lock().unwrap().snapshot(0).epoch < 2 {
        pump();
        assert!(
            Instant::now() < deadline,
            "shared source resize did not advance the Unit epoch"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    fill(
        source,
        RECT {
            left: 64,
            top: 16,
            right: 128,
            bottom: 80,
        },
        0x0000ffff,
    );
    wait_color(&second, target, "shared-static-second", [255, 255, 0]);
    assert_eq!(crate::screenshot::live_shared_pool_count(), 1);
    unsafe { DestroyWindow(owned.0.remove(0)) }.unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        pump();
        let snapshot = second.0.state.lock().unwrap().snapshot(0);
        if snapshot.capture_state == "failed" {
            assert_eq!(snapshot.error_code.as_deref(), Some("source_closed"));
            break;
        }
        assert!(
            Instant::now() < deadline,
            "closing source did not invalidate shared subscriber"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
    drop(second);
    assert_eq!(crate::screenshot::live_shared_pool_count(), 0);
    assert_eq!(
        crate::live_resources::get_live_resource_status()
            .unwrap()
            .active_sources,
        0
    );
    println!("SHARED_SOURCE_PROBE passed: static late join; distinct ROI colors; one pool; sibling stop; resize; source close; zero pools/reservations");
}
