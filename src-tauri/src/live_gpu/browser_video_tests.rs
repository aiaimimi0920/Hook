//! Opt-in real browser video oracle; the launcher owns the source, this test only its target.
use super::{browser_video_oracle, worker, Layout};
use std::sync::{atomic::AtomicU64, mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use windows::core::{w, BOOL};
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::{
    SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, DispatchMessageW, EnumWindows, GetWindowTextW, PeekMessageW,
    SetWindowPos, TranslateMessage, MSG, PM_REMOVE, SWP_NOACTIVATE, WS_EX_NOACTIVATE,
    WS_EX_NOREDIRECTIONBITMAP, WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
};

pub(super) struct Target(
    pub HWND,
    pub windows::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT,
);
impl Drop for Target {
    fn drop(&mut self) {
        worker::shutdown();
        let _ = unsafe { DestroyWindow(self.0) };
        unsafe {
            SetThreadDpiAwarenessContext(self.1);
            RoUninitialize();
        }
    }
}
pub(super) struct Capture(pub crate::LiveCaptureSession);
impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.0.stop_and_join();
    }
}
pub(super) fn pump() {
    unsafe {
        let mut message = MSG::default();
        while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }
}
pub(super) fn source_window(title: &str) -> HWND {
    struct Search<'a> {
        title: &'a str,
        found: Option<HWND>,
    }
    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> BOOL {
        let search = unsafe { &mut *(data.0 as *mut Search<'_>) };
        let mut text = [0u16; 256];
        let length = unsafe { GetWindowTextW(hwnd, &mut text) } as usize;
        if String::from_utf16_lossy(&text[..length]).starts_with(search.title) {
            search.found = Some(hwnd);
            return BOOL(0);
        }
        BOOL(1)
    }
    let mut search = Search { title, found: None };
    let _ = unsafe {
        EnumWindows(
            Some(visit),
            LPARAM((&mut search as *mut Search<'_>) as isize),
        )
    };
    search.found.expect("owned browser window not found")
}
fn nonblack(image: &image::RgbImage) -> f64 {
    let mut total = 0;
    let mut visible = 0;
    for y in (image.height() / 3..image.height() * 2 / 3).step_by(8) {
        for x in (image.width() / 4..image.width() * 3 / 4).step_by(8) {
            total += 1;
            if image.get_pixel(x, y).0.iter().any(|v| *v > 16) {
                visible += 1;
            }
        }
    }
    visible as f64 / total.max(1) as f64
}

pub(super) fn video_colors(image: &image::RgbImage) -> usize {
    let mut colors = std::collections::BTreeSet::new();
    for y in (image.height() / 3..image.height() * 2 / 3).step_by(4) {
        for x in (image.width() / 4..image.width() * 3 / 4).step_by(4) {
            colors.insert(image.get_pixel(x, y).0.map(|v| v / 32));
        }
    }
    colors.len()
}

fn latest_image(phase: &str, frames: &Mutex<crate::LiveCaptureFrameBuffer>) -> image::RgbImage {
    if phase == "jpeg" {
        let mut frames = frames.lock().unwrap();
        let frame = frames.latest_after(0).unwrap();
        image::load_from_memory(&frames.take_bytes_for(frame.frame_id).unwrap())
            .unwrap()
            .to_rgb8()
    } else {
        worker::snapshot("browser-video")
            .unwrap()
            .unwrap()
            .into_rgb()
            .unwrap()
            .0
    }
}

#[test]
#[ignore = "requires scripts/tests/live-browser-video-probe.ts owned non-DRM browser video"]
fn browser_video_source_and_native_presentation() {
    let title = std::env::var("HOOK_BROWSER_VIDEO_TITLE").unwrap();
    assert!(title.starts_with("HookLiveVideoProbe-"));
    let output = std::path::PathBuf::from(std::env::var("HOOK_BROWSER_VIDEO_OUTPUT").unwrap());
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.unwrap();
    let dpi = unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let hwnd = source_window(&title);
    let mut bounds = RECT::default();
    unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&raw mut bounds).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    }
    .unwrap();
    let width = (bounds.right - bounds.left) as u32;
    let height = (bounds.bottom - bounds.top) as u32;
    let target = Target(
        unsafe {
            CreateWindowExW(
                WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_NOREDIRECTIONBITMAP,
                w!("STATIC"),
                w!("Hook owned video GPU output"),
                WS_POPUP | WS_VISIBLE,
                bounds.right + 20,
                bounds.top,
                width as i32,
                height as i32,
                None,
                None,
                None,
                None,
            )
        }
        .unwrap(),
        dpi,
    );
    let metrics = crate::CaptureWindowMetrics {
        physical_origin_x: 0.0,
        physical_origin_y: 0.0,
        scale_factor: 1.0,
        logical_width: 3840.0,
        logical_height: 2160.0,
    };
    let (source_samples, source_backend) = browser_video_oracle::desktop_samples(hwnd);
    source_samples
        .save(output.join("desktop-source-samples.png"))
        .unwrap();
    let config = crate::LiveCaptureWorkerConfig {
        session_id: "browser-video".into(),
        window_id: Some(format!("{:x}", hwnd.0 as usize)),
        expected_process_id: None,
        source_title: None,
        x: 0,
        y: 0,
        width,
        height,
        target_fps: 60,
        window_region: Some(crate::LiveCapturePhysicalRegion {
            left: width / 10,
            top: height / 10,
            width: width * 4 / 5,
            height: height * 4 / 5,
        }),
        display_metrics: metrics,
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
    let _capture = Capture(crate::LiveCaptureSession {
        state: state.clone(),
        frames: frames.clone(),
        dropped_frames: dropped,
        stop_tx: Mutex::new(Some(stop_tx)),
        join: Mutex::new(Some(join)),
        source_window: None,
    });
    let layout = Layout {
        x: 0.0,
        y: 0.0,
        width: width as f32,
        height: height as f32,
        inset: 0.0,
    };
    let mut results = Vec::new();
    for phase in ["jpeg", "gpu-away", "gpu-overlap", "gpu-transparent"] {
        if phase == "gpu-transparent" {
            browser_video_oracle::make_transparent(target.0);
        }
        if phase == "gpu-overlap" {
            unsafe {
                SetWindowPos(
                    target.0,
                    None,
                    bounds.left,
                    bounds.top,
                    width as i32,
                    height as i32,
                    SWP_NOACTIVATE,
                )
            }
            .unwrap();
        }
        let start = Instant::now();
        browser_video_oracle::take_capture_ages();
        let mut status = super::PreviewStatus::default();
        let mut earlier = None;
        while start.elapsed() < Duration::from_secs(4) {
            pump();
            if phase != "jpeg" {
                status =
                    worker::configure(target.0 .0 as usize, "browser-video", Some(layout)).unwrap();
            }
            if earlier.is_none() && start.elapsed() >= Duration::from_secs(2) {
                earlier = Some((
                    latest_image(phase, &frames),
                    status.submitted_frames,
                    state.lock().unwrap().snapshot(0).frame_id,
                ));
            }
            std::thread::sleep(Duration::from_millis(16));
        }
        let image = latest_image(phase, &frames);
        let (earlier_image, earlier_submitted, earlier_encoded) = earlier.unwrap();
        let changed = image.as_raw() != earlier_image.as_raw();
        image.save(output.join(format!("{phase}.png"))).unwrap();
        let desktop = (phase != "jpeg").then(|| {
            let (samples, backend) = browser_video_oracle::desktop_samples(target.0);
            samples
                .save(output.join(format!("{phase}-desktop-samples.png")))
                .unwrap();
            serde_json::json!({ "nonblack": nonblack(&samples), "videoColors": video_colors(&samples), "backend": backend.as_str() })
        });
        let current = state.lock().unwrap().snapshot(0);
        if phase == "jpeg" {
            assert!(
                current.frame_id > earlier_encoded,
                "JPEG stream stopped advancing"
            );
        } else {
            assert!(status.available && status.presenting && status.error.is_none());
            assert!(
                status.submitted_frames > earlier_submitted,
                "GPU stream stopped advancing"
            );
        }
        results.push(serde_json::json!({ "phase": phase, "nonblack": nonblack(&image),
            "desktop": desktop, "videoColors": video_colors(&image), "changed": changed,
            "captureAge": browser_video_oracle::take_capture_ages(),
            "gpu": status, "capture": { "state": current.capture_state, "epoch": current.epoch, "encoded": current.frame_id } }));
    }
    let summary = serde_json::json!({ "desktopSourceNonblack": nonblack(&source_samples),
        "desktopSourceColors": video_colors(&source_samples), "desktopSourceBackend": source_backend.as_str(), "phases": results });
    std::fs::write(
        output.join("native-summary.json"),
        serde_json::to_vec_pretty(&summary).unwrap(),
    )
    .unwrap();
    for result in results {
        assert!(
            result["changed"].as_bool().unwrap(),
            "frozen video: {result}"
        );
        assert!(
            result["videoColors"].as_u64().unwrap() > 12,
            "missing test pattern: {result}"
        );
        assert!(
            result["nonblack"].as_f64().unwrap() > 0.5,
            "black video: {result}"
        );
        if let Some(desktop) = result["desktop"]["nonblack"].as_f64() {
            assert!(desktop > 0.5, "black desktop output: {result}");
            // This tighter desktop crop can contain only two solid test-pattern bars.
            assert!(
                result["desktop"]["videoColors"].as_u64().unwrap() >= 2,
                "desktop contains a monochrome fill instead of video: {result}"
            );
        }
    }
}
