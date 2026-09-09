//! Opt-in, owned-window GPU proof; never starts Hook or touches existing app windows.

use std::time::{Duration, Instant};
use windows::core::w;
use windows::Graphics::Capture::GraphicsCaptureItem;
use windows::Win32::Foundation::{COLORREF, HMODULE, HWND, RECT};
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, D3D11_BOX, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_SDK_VERSION,
};
use windows::Win32::Graphics::Gdi::{
    CreateSolidBrush, DeleteObject, FillRect, GdiFlush, GetDC, GetPixel, ReleaseDC,
};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::{
    SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, DispatchMessageW, GetWindowRect, PeekMessageW,
    TranslateMessage, MSG, PM_REMOVE, WS_EX_NOACTIVATE, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
};

use super::{worker, Layout};

// Both probes share the process-wide compositor; their owned HWND lifetimes cannot overlap.
static PROBE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
mod shared_source_tests;

struct OwnedWindows(Vec<HWND>, windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT);
impl Drop for OwnedWindows {
    fn drop(&mut self) {
        worker::shutdown();
        for hwnd in self.0.iter().rev() {
            let _ = unsafe { DestroyWindow(*hwnd) };
        }
        unsafe { SetThreadDpiAwarenessContext(self.1) };
        unsafe { RoUninitialize() };
    }
}

fn pump() {
    unsafe {
        let mut message = MSG::default();
        while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}

fn fill(hwnd: HWND, rect: RECT, color: u32) {
    unsafe {
        let dc = GetDC(Some(hwnd));
        let brush = CreateSolidBrush(COLORREF(color));
        assert_ne!(FillRect(dc, &rect, brush), 0);
        let _ = DeleteObject(brush.into());
        ReleaseDC(Some(hwnd), dc);
        let _ = GdiFlush();
    }
}

fn pixel(hwnd: HWND, x: i32, y: i32) -> u32 {
    // Deliberately observe desktop composition, not just a GPU buffer. This
    // smoke requires an unobstructed SDR desktop and waits for eventual present.
    unsafe {
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).unwrap();
        let dc = GetDC(None);
        let color = GetPixel(dc, rect.left + x, rect.top + y).0;
        ReleaseDC(None, dc);
        color
    }
}

fn snapshot() -> super::snapshot::Readback {
    let deadline = Instant::now() + Duration::from_millis(200);
    loop {
        if let Some(frame) = worker::snapshot("gpu-probe-a").unwrap() {
            return frame;
        }
        assert!(Instant::now() < deadline, "GPU snapshot texture missing");
        std::thread::sleep(Duration::from_millis(2));
    }
}

fn assert_snapshot(frame: super::snapshot::Readback, rgb: [u8; 3]) {
    let encoded = frame.encode().unwrap();
    let timestamp = u64::from_le_bytes(encoded[..8].try_into().unwrap());
    assert!(timestamp > 0 && timestamp <= crate::live_capture_now_ms());
    let decoded = image::load_from_memory(&encoded[8..]).unwrap().to_rgb8();
    assert_eq!(decoded.dimensions(), (64, 64));
    assert_eq!(decoded.get_pixel(16, 16).0, rgb);
    assert_eq!(decoded.get_pixel(48, 48).0, rgb);
}

fn create_windows() -> OwnedWindows {
    // A test runner has no Tauri host apartment. Keep WinRT alive through capture
    // and compositor teardown, including gaps between their worker threads.
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.unwrap();
    let dpi = unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let mut owned = OwnedWindows(Vec::new(), dpi);
    for (x, width, title) in [
        (40, 160, w!("Hook GPU source probe")),
        (260, 280, w!("Hook GPU output probe")),
    ] {
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOPMOST,
                w!("STATIC"),
                title,
                WS_POPUP | WS_VISIBLE,
                x,
                80,
                width,
                140,
                None,
                None,
                None,
                None,
            )
        }
        .unwrap();
        owned.0.push(hwnd);
    }
    owned
}

#[test]
#[ignore = "interactive desktop: creates only two short-lived owned probe windows"]
fn native_gpu_crop_present_multi_surface_and_cleanup() {
    let _probe = PROBE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let owned = create_windows();
    let (source, target) = (owned.0[0], owned.0[1]);
    let layout = Layout {
        x: 8.0,
        y: 8.0,
        width: 112.0,
        height: 112.0,
        inset: 0.0,
    };
    let second = Layout { x: 144.0, ..layout };
    worker::configure(target.0 as usize, "gpu-probe-a", Some(layout)).unwrap();
    worker::configure(target.0 as usize, "gpu-probe-b", Some(second)).unwrap();
    let mut device = None;
    unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            None,
        )
    }
    .unwrap();
    let interop =
        windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().unwrap();
    let item = unsafe { interop.CreateForWindow(source) }.unwrap();
    let settings = scap_direct3d::Settings {
        pixel_format: scap_direct3d::PixelFormat::B8G8R8A8Unorm,
        crop: Some(D3D11_BOX {
            left: 64,
            top: 16,
            right: 128,
            bottom: 80,
            front: 0,
            back: 1,
        }),
        is_cursor_capture_enabled: Some(false),
        is_border_required: Some(false),
        fps: Some(60),
        ..Default::default()
    };
    let mut capture = scap_direct3d::Capturer::new(
        item,
        settings,
        |frame| {
            worker::submit("gpu-probe-a", &frame, None);
            worker::submit("gpu-probe-b", &frame, None);
            Ok(())
        },
        || Ok(()),
        device,
    )
    .unwrap();
    capture.start().unwrap();
    let mut results = Vec::new();
    let mut retained_snapshot = None;
    for (phase, color) in [0x0000ff00, 0x0000ffff].into_iter().enumerate() {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut matched = false;
        while Instant::now() < deadline {
            pump();
            fill(
                source,
                RECT {
                    left: 0,
                    top: 0,
                    right: 160,
                    bottom: 140,
                },
                0x000000ff,
            );
            fill(
                source,
                RECT {
                    left: 64,
                    top: 16,
                    right: 128,
                    bottom: 80,
                },
                color,
            );
            let status = worker::configure(target.0 as usize, "gpu-probe-a", Some(layout)).unwrap();
            assert!(
                status.error.is_none(),
                "native presenter failed: {:?}",
                status.error
            );
            if phase == 0 {
                worker::configure(target.0 as usize, "gpu-probe-b", Some(second)).unwrap();
            }
            std::thread::sleep(Duration::from_millis(25));
            let first = pixel(target, 20, 20);
            let other = pixel(target, 156, 20);
            if first == color
                && pixel(target, 110, 110) == color
                && (phase > 0 || (other == color && pixel(target, 246, 110) == color))
            {
                results.push((status.submitted_frames, first, other));
                matched = true;
                break;
            }
        }
        assert!(
            matched,
            "GPU output pixels did not match cropped source phase {phase}: {:?}",
            results
        );
        if phase == 0 {
            retained_snapshot = Some(snapshot());
            worker::configure(target.0 as usize, "gpu-probe-b", None).unwrap();
            std::thread::sleep(Duration::from_millis(80));
            assert_ne!(
                pixel(target, 156, 20),
                color,
                "disabled sibling must disappear"
            );
            worker::remove("gpu-probe-b");
            assert!(
                worker::has_service(),
                "a surviving Live still owns the compositor"
            );
        } else {
            assert_snapshot(snapshot(), [255, 255, 0]);
            // WGC and the GPU pool have since reused their textures. A prepared
            // snapshot must still contain its original pixels, without CPU caching.
            assert_snapshot(retained_snapshot.take().unwrap(), [0, 255, 0]);
        }
    }
    std::thread::sleep(Duration::from_millis(100));
    assert_ne!(
        pixel(target, 156, 20),
        0x0000ff00,
        "removed sibling must disappear"
    );
    capture.stop().unwrap();
    // No new source frames: fallback must use the retained texture after lease loss.
    // No renewal: a stalled/disappeared WebView cannot leave its native plane behind.
    std::thread::sleep(Duration::from_millis(400));
    assert_ne!(
        pixel(target, 60, 60),
        0x0000ffff,
        "expired lease must hide the plane"
    );
    worker::configure(target.0 as usize, "gpu-probe-a", None).unwrap();
    let budget = super::work_budget::CaptureBudget::register("gpu-probe-a", 60);
    let (fallback, at, _permit) = worker::fallback("gpu-probe-a", 0, &budget)
        .unwrap()
        .expect("static GPU fallback");
    assert_eq!(fallback.get_pixel(16, 16).0, [255, 255, 0]);
    assert!(worker::fallback("gpu-probe-a", at, &budget)
        .unwrap()
        .is_none());
    assert_snapshot(snapshot(), [255, 255, 0]);
    std::thread::sleep(Duration::from_millis(100));
    pump();
    assert_ne!(
        pixel(target, 60, 60),
        0x0000ffff,
        "disabled plane must disappear"
    );
    worker::invalidate("gpu-probe-a");
    assert!(worker::snapshot("gpu-probe-a").unwrap().is_none());
    worker::remove("gpu-probe-a");
    assert!(
        !worker::has_service(),
        "last Live must stop and join the compositor"
    );
    for _ in 0..3 {
        worker::configure(target.0 as usize, "gpu-reopened", Some(layout)).unwrap();
        assert!(worker::has_service(), "a new Live recreates the compositor");
        worker::remove("gpu-reopened");
        assert!(
            !worker::has_service(),
            "repeated teardown leaves no service"
        );
    }
    println!("GPU_PROBE passed: WGC crop -> owned GPU texture -> two swapchains; lossless snapshots survived reuse; source changed; sibling removed; disable removed plane. samples={results:?}");
}

struct CaptureGuard(crate::LiveCaptureSession);
impl Drop for CaptureGuard {
    fn drop(&mut self) {
        let _ = self.0.stop_and_join();
    }
}

#[test]
#[ignore = "interactive desktop: owned windows, real capture worker, no mouse/keyboard input"]
fn native_capture_worker_suppresses_cpu_and_restores_static_fallback() {
    let _probe = PROBE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    use std::sync::{atomic::AtomicU64, mpsc, Arc, Mutex};
    let owned = create_windows();
    let (source, target) = (owned.0[0], owned.0[1]);
    let id = "gpu-capture-worker";
    let layout = Layout {
        x: 8.0,
        y: 8.0,
        width: 112.0,
        height: 112.0,
        inset: 0.0,
    };
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
            left: 64,
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
    let dropped = Arc::new(AtomicU64::new(0));
    let (stop_tx, stop_rx) = mpsc::sync_channel(1);
    let join = crate::screenshot::spawn_live_capture_worker(
        config,
        state.clone(),
        frames.clone(),
        dropped.clone(),
        stop_rx,
    )
    .unwrap();
    let _capture = CaptureGuard(crate::LiveCaptureSession {
        state: state.clone(),
        frames: frames.clone(),
        dropped_frames: dropped,
        stop_tx: Mutex::new(Some(stop_tx)),
        join: Mutex::new(Some(join)),
        source_window: None,
    });
    let start = Instant::now();
    let mut latest = super::PreviewStatus::default();
    let mut changes = 0;
    while start.elapsed() < Duration::from_millis(6500) {
        pump();
        fill(
            source,
            RECT {
                left: 64,
                top: 16,
                right: 128,
                bottom: 80,
            },
            if changes % 2 == 0 {
                0x0000ff00
            } else {
                0x0000ffff
            },
        );
        changes += 1;
        latest = worker::configure(target.0 as usize, id, Some(layout)).unwrap();
        assert!(latest.error.is_none(), "GPU error: {:?}", latest.error);
        std::thread::sleep(Duration::from_millis(25));
    }
    let before = state.lock().unwrap().snapshot(0);
    assert_eq!(before.capture_state, "streaming");
    assert_eq!(
        before.epoch, 1,
        "GPU-only frames must maintain capture health past five seconds"
    );
    assert!(
        latest.cpu_readbacks_skipped > 20,
        "actual capture callback must skip CPU conversion"
    );
    assert!(latest.submitted_frames > 20);
    assert!(
        before.frame_id < latest.cpu_readbacks_skipped,
        "JPEG must not run in parallel for every frame"
    );
    worker::configure(target.0 as usize, id, None).unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    let restored = loop {
        pump();
        if let Some(frame) = frames.lock().unwrap().latest_after(before.frame_id) {
            break frame;
        }
        assert!(
            Instant::now() < deadline,
            "disabling GPU must restore a decoded fallback without source painting"
        );
        std::thread::sleep(Duration::from_millis(25));
    };
    assert_eq!((restored.width, restored.height), (64, 64));
    assert!(restored.capture_timestamp_ms >= before.last_frame_at_ms.unwrap());
    let bytes = frames
        .lock()
        .unwrap()
        .take_bytes_for(restored.frame_id)
        .unwrap();
    assert_eq!(image::load_from_memory(&bytes).unwrap().width(), 64);
    println!(
        "GPU_CAPTURE_PIPELINE passed: encoded={} skipped={} submitted={} epoch={} restored={}",
        before.frame_id,
        latest.cpu_readbacks_skipped,
        latest.submitted_frames,
        before.epoch,
        restored.frame_id
    );
}
