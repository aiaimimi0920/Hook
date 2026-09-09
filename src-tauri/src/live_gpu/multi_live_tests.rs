//! Multiple production workers against an owned hardware-decoded browser video.
use super::browser_video_tests::{pump, source_window, video_colors, Capture, Target};
use super::{work_budget, worker, Layout};
use std::sync::{atomic::AtomicU64, mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use windows::core::w;
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::{
    SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, WS_EX_NOACTIVATE, WS_EX_NOREDIRECTIONBITMAP, WS_EX_TOPMOST, WS_POPUP,
    WS_VISIBLE,
};

fn frame_id(capture: &Capture) -> u64 {
    capture
        .0
        .frames
        .lock()
        .unwrap()
        .latest_after(0)
        .map(|f| f.frame_id)
        .unwrap_or(0)
}

fn central_pixels_changed(before: &image::RgbImage, after: &image::RgbImage) -> bool {
    if before.dimensions() != after.dimensions() {
        return false;
    }
    let (width, height) = before.dimensions();
    let (mut changed, mut total) = (0usize, 0usize);
    for y in (height / 3..height * 2 / 3).step_by(8) {
        for x in (width / 4..width * 3 / 4).step_by(8) {
            total += 1;
            changed += usize::from(before.get_pixel(x, y) != after.get_pixel(x, y));
        }
    }
    total > 0 && changed * 20 > total
}

#[test]
fn video_motion_requires_central_pixels_not_just_frame_counters_or_ui() {
    let before = image::RgbImage::new(96, 96);
    let mut after = before.clone();
    assert!(!central_pixels_changed(&before, &after));
    after.put_pixel(0, 0, image::Rgb([255, 0, 0]));
    assert!(!central_pixels_changed(&before, &after));
    for y in 32..64 {
        for x in 24..72 {
            after.put_pixel(x, y, image::Rgb([255, 0, 0]));
        }
    }
    assert!(central_pixels_changed(&before, &after));
}

fn run_phase(captures: &[Capture], target: usize, gpu: bool, seconds: u64) -> serde_json::Value {
    let before: Vec<_> = captures.iter().map(frame_id).collect();
    let baseline = work_budget::diagnostics();
    let deadline = Instant::now() + Duration::from_secs(seconds);
    let mut statuses = Vec::new();
    while Instant::now() < deadline {
        pump();
        statuses = captures
            .iter()
            .enumerate()
            .map(|(i, capture)| {
                let id = capture.0.state.lock().unwrap().session_id.clone();
                worker::configure(
                    target,
                    &id,
                    gpu.then_some(Layout {
                        x: (i % 2 * 320) as f32,
                        y: (i / 2 * 240) as f32,
                        width: 320.0,
                        height: 240.0,
                        inset: 0.0,
                    }),
                )
                .unwrap()
            })
            .collect();
        std::thread::sleep(Duration::from_millis(40));
    }
    let after: Vec<_> = captures.iter().map(frame_id).collect();
    for capture in captures {
        assert_eq!(capture.0.state.lock().unwrap().capture_state, "streaming");
    }
    let diagnostics = work_budget::diagnostics();
    let grants =
        diagnostics["cpuGrants"].as_u64().unwrap() - baseline["cpuGrants"].as_u64().unwrap();
    assert!(
        grants <= seconds * 30 + 1,
        "global CPU rate escaped its budget: {grants}"
    );
    let source_pools = crate::screenshot::live_shared_pool_count();
    assert_eq!(
        source_pools, 1,
        "same-window crops must share one live WGC pool"
    );
    serde_json::json!({ "beforeFrames": before, "afterFrames": after,
        "cpuGrants": grants, "budget": diagnostics, "gpu": statuses,
        "sharedSourcePools": source_pools, "resources": crate::live_resources::get_live_resource_status().unwrap() })
}

#[test]
#[ignore = "requires HOOK_BROWSER_VIDEO_MULTI=1 with the owned browser-video launcher"]
fn multi_live_video_workers_budget_fallback_visibility_and_cleanup() {
    let count: u32 = std::env::var("HOOK_BROWSER_VIDEO_COUNT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(4);
    assert!(matches!(count, 4 | 6));
    let title = std::env::var("HOOK_BROWSER_VIDEO_TITLE").unwrap();
    assert!(title.starts_with("HookLiveVideoProbe-"));
    let output = std::path::PathBuf::from(std::env::var("HOOK_BROWSER_VIDEO_OUTPUT").unwrap());
    unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.unwrap();
    let dpi = unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let source = source_window(&title);
    let mut bounds = RECT::default();
    unsafe {
        DwmGetWindowAttribute(
            source,
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
                w!("Hook owned multi-Live output"),
                WS_POPUP | WS_VISIBLE,
                bounds.right + 20,
                bounds.top,
                640,
                240 * (count / 2) as i32,
                None,
                None,
                None,
                None,
            )
        }
        .unwrap(),
        dpi,
    );
    let mut captures = Vec::new();
    for i in 0..count {
        let config = crate::LiveCaptureWorkerConfig {
            session_id: format!("multi-video-{i}"),
            window_id: Some(format!("{:x}", source.0 as usize)),
            expected_process_id: None,
            source_title: None,
            x: 0,
            y: 0,
            width,
            height,
            target_fps: 60,
            window_region: Some(crate::LiveCapturePhysicalRegion {
                left: width * (10 + i * 2) / 100,
                top: height / 10,
                width: width * 3 / 5,
                height: height * 4 / 5,
            }),
            display_metrics: crate::CaptureWindowMetrics {
                physical_origin_x: 0.0,
                physical_origin_y: 0.0,
                scale_factor: 1.0,
                logical_width: 3840.0,
                logical_height: 2160.0,
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
        captures.push(Capture(crate::LiveCaptureSession {
            state,
            frames,
            dropped_frames: dropped,
            stop_tx: Mutex::new(Some(stop_tx)),
            join: Mutex::new(Some(join)),
            source_window: None,
        }));
    }
    let hwnd = target.0 .0 as usize;
    let cpu = run_phase(&captures, hwnd, false, 5);
    for capture in &captures {
        assert!(frame_id(capture) >= 5);
    }
    let _ = run_phase(&captures, hwnd, true, 1);
    let earlier: Vec<_> = captures
        .iter()
        .enumerate()
        .map(|(i, capture)| {
            let id = capture.0.state.lock().unwrap().session_id.clone();
            let (image, _) = worker::snapshot(&id).unwrap().unwrap().into_rgb().unwrap();
            image
                .save(output.join(format!("multi-gpu-before-{i}.png")))
                .unwrap();
            image
        })
        .collect();
    let gpu = run_phase(&captures, hwnd, true, 5);
    for (i, capture) in captures.iter().enumerate() {
        let id = capture.0.state.lock().unwrap().session_id.clone();
        let (image, _) = worker::snapshot(&id).unwrap().unwrap().into_rgb().unwrap();
        assert_eq!(image.dimensions(), (width * 3 / 5, height * 4 / 5));
        image
            .save(output.join(format!("multi-gpu-{i}.png")))
            .unwrap();
        let colors = video_colors(&image);
        assert!(colors > 12, "{id}: central video colors={colors}");
        assert!(
            central_pixels_changed(&earlier[i], &image),
            "{id}: central video pixels froze"
        );
        assert!(gpu["gpu"][i]["submittedFrames"].as_u64().unwrap() > 20);
        assert!(gpu["gpu"][i]["cpuReadbacksSkipped"].as_u64().unwrap() > 0);
    }
    let fallback = run_phase(&captures, hwnd, false, 5);
    for i in 0..count as usize {
        assert!(
            fallback["afterFrames"][i].as_u64().unwrap()
                > fallback["beforeFrames"][i].as_u64().unwrap() + 4
        );
    }
    for i in 1..count {
        work_budget::set_visible(&format!("multi-video-{i}"), false);
    }
    let hidden = run_phase(&captures, hwnd, false, 3);
    for i in 1..count as usize {
        assert!(
            hidden["afterFrames"][i].as_u64().unwrap()
                <= hidden["beforeFrames"][i].as_u64().unwrap() + 1
        );
        assert_eq!(
            hidden["budget"]["intervalsMs"][format!("multi-video-{i}")],
            1000.0
        );
        work_budget::set_visible(&format!("multi-video-{i}"), true);
    }
    drop(captures.remove(0));
    let resumed = run_phase(&captures, hwnd, false, 3);
    for i in 0..(count - 1) as usize {
        assert!(
            resumed["afterFrames"][i].as_u64().unwrap()
                > resumed["beforeFrames"][i].as_u64().unwrap()
        );
    }
    drop(captures);
    let cleaned = work_budget::diagnostics();
    assert_eq!(cleaned["active"], 0);
    assert_eq!(cleaned["cpuBusy"], false);
    let resources = crate::live_resources::get_live_resource_status().unwrap();
    assert_eq!(resources.active_sources, 0);
    assert_eq!(crate::screenshot::live_shared_pool_count(), 0);
    let result = serde_json::json!({ "sourceCount": count, "cpu": cpu, "gpu": gpu, "fallback": fallback,
        "hidden": hidden, "resumedAfterSiblingStop": resumed, "cleanup": cleaned,
        "resourceCleanup": resources, "sharedSourcePoolsAfterCleanup": crate::screenshot::live_shared_pool_count() });
    std::fs::write(
        output.join("native-summary.json"),
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .unwrap();
    println!("{result}");
}
