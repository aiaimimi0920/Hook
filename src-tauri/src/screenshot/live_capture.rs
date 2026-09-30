use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use scap_direct3d::Capturer;
use windows::Graphics::Capture::GraphicsCaptureItem;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

use super::display_selection::capture_plan;
use super::wgc_session::{shared_d3d_device, windows_capture_settings};
mod codec {
    include!("live_frame_codec.rs");
}
mod handoff {
    include!("live_frame_handoff.rs");
}
mod shared {
    include!("live_shared_source.rs");
}
pub(crate) fn live_shared_pool_count() -> usize {
    shared::active_pool_count()
}
use crate::{
    append_runtime_log_line, live_capture_now_ms, live_capture_surface_crop, LiveCaptureFrame,
    LiveCaptureFrameBuffer, LiveCaptureFrameDescriptor, LiveCaptureSessionState,
    LiveCaptureWorkerConfig,
};
use codec::encode_live_jpeg;
use handoff::FrameMailbox;

const LIVE_CAPTURE_FRAME_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const LIVE_CAPTURE_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(400);
const LIVE_CAPTURE_MAX_BUILD_FAILURES: u8 = 3;

struct ActiveLiveCapturer {
    producer: ActiveProducer,
    item: GraphicsCaptureItem,
    width: i32,
    height: i32,
    interval: std::time::Duration,
}

enum LiveCaptureBuildError {
    SourceClosed(&'static str),
    Retry(String),
}

struct BuiltCaptureSource {
    item: GraphicsCaptureItem,
    crop: Option<windows::Win32::Graphics::Direct3D11::D3D11_BOX>,
    process_id: Option<u32>,
    title: Option<String>,
}

include!("live_resource_admission.rs");

pub(crate) fn spawn_live_capture_worker(
    mut config: LiveCaptureWorkerConfig,
    state: std::sync::Arc<std::sync::Mutex<LiveCaptureSessionState>>,
    frames: std::sync::Arc<std::sync::Mutex<LiveCaptureFrameBuffer>>,
    dropped_frames: std::sync::Arc<AtomicU64>,
    stop_rx: std::sync::mpsc::Receiver<()>,
) -> Result<std::thread::JoinHandle<()>, String> {
    let reservation = reserve_live_source(&mut config)?;
    std::thread::Builder::new()
        .name(format!("hook-live-capture-{}", config.session_id))
        .spawn(move || {
            let gpu_session = config.session_id.clone();
            if let Err((code, message, detail)) = run_live_capture_worker(
                config,
                state.clone(),
                frames.clone(),
                dropped_frames,
                stop_rx,
            ) {
                append_runtime_log_line(&format!(
                    "live_capture_failed :: code={code} detail={detail}"
                ));
                if let Ok(mut value) = state.lock() {
                    value.mark_failed(code, message);
                    if code == "source_closed" {
                        value.mark_source_window_closed();
                    }
                }
                if let Ok(mut queue) = frames.lock() {
                    queue.clear();
                }
            }
            crate::live_gpu::remove(&gpu_session);
            drop(reservation);
        })
        .map_err(|error| format!("failed to spawn live capture worker: {error}"))
}

fn run_live_capture_worker(
    mut config: LiveCaptureWorkerConfig,
    state: std::sync::Arc<std::sync::Mutex<LiveCaptureSessionState>>,
    frames: std::sync::Arc<std::sync::Mutex<LiveCaptureFrameBuffer>>,
    dropped_frames: std::sync::Arc<AtomicU64>,
    stop_rx: std::sync::mpsc::Receiver<()>,
) -> Result<(), (&'static str, &'static str, String)> {
    let (frame_ready_tx, frame_ready_rx) = std::sync::mpsc::sync_channel(1);
    let mailbox = std::sync::Arc::new(FrameMailbox::new(
        &config.session_id,
        config.target_fps,
        dropped_frames.clone(),
        frame_ready_tx,
    ));
    let item_closed = std::sync::Arc::new(AtomicBool::new(false));
    let mut epoch = 1u64;
    let mut frame_id = 0u64;
    let mut build_failures = 0u8;

    append_runtime_log_line(&format!(
        "live_capture_worker_started :: session={} source={} fps={}",
        config.session_id,
        if config.window_id.is_some() {
            "window"
        } else {
            "region"
        },
        config.target_fps
    ));

    'owner: loop {
        if stop_rx.try_recv().is_ok() {
            break;
        }
        item_closed.store(false, Ordering::Release);
        mailbox.reset();
        crate::live_gpu::invalidate(&config.session_id);
        let mut active =
            match build_active_capturer(&mut config, mailbox.clone(), item_closed.clone()) {
                Ok((active, process_id, title)) => {
                    build_failures = 0;
                    if let Ok(mut value) = state.lock() {
                        value.set_source_identity(process_id, title);
                    }
                    active
                }
                Err(LiveCaptureBuildError::SourceClosed(detail)) => {
                    return Err((
                        "source_closed",
                        "源窗口已关闭或身份已变化",
                        detail.to_string(),
                    ));
                }
                Err(LiveCaptureBuildError::Retry(detail)) => {
                    build_failures = build_failures.saturating_add(1);
                    if build_failures >= LIVE_CAPTURE_MAX_BUILD_FAILURES {
                        return Err(("capture_unavailable", "无法建立持续捕获", detail));
                    }
                    mark_recovering(&state, epoch, "capture_start_retry", "正在重新建立持续捕获");
                    if stop_rx.recv_timeout(LIVE_CAPTURE_RETRY_DELAY).is_ok() {
                        break;
                    }
                    continue;
                }
            };
        let mut last_frame_at = std::time::Instant::now();
        let mut observed_capture = 0;
        let mut encoded_at = 0;
        let mut last_geometry_check = std::time::Instant::now();
        let mut last_source_window_check = std::time::Instant::now();

        loop {
            // Wake on a new latest frame, not a second FPS timer after JPEG work.
            // The short timeout keeps stop and source-health checks responsive while idle.
            let _ = frame_ready_rx.recv_timeout(std::time::Duration::from_millis(16));
            if !matches!(
                stop_rx.try_recv(),
                Err(std::sync::mpsc::TryRecvError::Empty)
            ) {
                active.producer.stop();
                break 'owner;
            }

            let arrived = mailbox.arrived_at();
            if arrived > observed_capture {
                observed_capture = arrived;
                last_frame_at = std::time::Instant::now();
                if let Ok(mut value) = state.lock() {
                    value.mark_capture(epoch, arrived);
                }
            }
            let next = mailbox
                .next(&config.session_id, encoded_at)
                .map_err(|detail| ("frame_handoff_failed", "实时画面交接失败", detail))?;
            if let Some(raw) = next {
                let bytes = encode_live_jpeg(&raw.image)
                    .map_err(|detail| ("frame_encode_failed", "实时画面编码失败", detail))?;
                frame_id = frame_id.checked_add(1).ok_or((
                    "frame_sequence_exhausted",
                    "实时画面序列已耗尽",
                    "u64 frame sequence exhausted".to_string(),
                ))?;
                let descriptor = LiveCaptureFrameDescriptor {
                    session_id: config.session_id.clone(),
                    epoch,
                    frame_id,
                    capture_timestamp_ms: raw.captured_at_ms,
                    encode_timestamp_ms: live_capture_now_ms(),
                    width: raw.image.width(),
                    height: raw.image.height(),
                    mime: "image/jpeg".to_string(),
                    byte_length: bytes.len(),
                    dropped_frames: 0,
                };
                let stored_descriptor = {
                    let mut queue = frames.lock().map_err(|_| {
                        (
                            "frame_buffer_poisoned",
                            "实时画面缓冲区不可用",
                            "frame buffer lock poisoned".to_string(),
                        )
                    })?;
                    queue.push(LiveCaptureFrame { descriptor, bytes }, &dropped_frames);
                    queue.latest_after(frame_id.saturating_sub(1)).ok_or((
                        "frame_buffer_failed",
                        "实时画面缓冲失败",
                        "stored frame missing".to_string(),
                    ))?
                };
                if let Ok(mut value) = state.lock() {
                    value.mark_frame(&stored_descriptor);
                }
                encoded_at = encoded_at.max(raw.captured_at_ms);
            }

            if item_closed.load(Ordering::Acquire) {
                mark_recovering(
                    &state,
                    epoch,
                    "capture_item_closed",
                    "捕获资源已关闭，正在恢复",
                );
                active.producer.stop();
                epoch = next_epoch(epoch)?;
                continue 'owner;
            }
            if last_source_window_check.elapsed() >= std::time::Duration::from_millis(250) {
                last_source_window_check = std::time::Instant::now();
                inspect_live_source_window(&config, &state)?;
                let interval = mailbox.budget.interval();
                if interval != active.interval {
                    active.producer.set_interval(interval).map_err(|error| {
                        (
                            "capture_cadence_failed",
                            "无法调整采集频率",
                            error.to_string(),
                        )
                    })?;
                    active.interval = interval;
                }
            }
            if last_geometry_check.elapsed() >= std::time::Duration::from_secs(1) {
                last_geometry_check = std::time::Instant::now();
                let size = active.item.Size().map_err(|error| {
                    (
                        "source_geometry_failed",
                        "无法读取源窗口尺寸",
                        format!("item size failed: {error:?}"),
                    )
                })?;
                if size.Width != active.width || size.Height != active.height {
                    mark_recovering(
                        &state,
                        epoch,
                        "source_resized",
                        "源尺寸已变化，正在重建捕获",
                    );
                    active.producer.stop();
                    epoch = next_epoch(epoch)?;
                    continue 'owner;
                }
            }
            if last_frame_at.elapsed() >= LIVE_CAPTURE_FRAME_TIMEOUT {
                let errors = mailbox.take_errors();
                mark_recovering(&state, epoch, "frame_timeout", "实时画面超时，正在恢复");
                append_runtime_log_line(&format!(
                    "live_capture_frame_timeout :: session={} callback_errors={errors}",
                    config.session_id
                ));
                active.producer.stop();
                epoch = next_epoch(epoch)?;
                continue 'owner;
            }
        }
    }

    append_runtime_log_line(&format!(
        "live_capture_worker_stopped :: session={}",
        config.session_id
    ));
    if let Ok(mut value) = state.lock() {
        value.mark_closed();
    }
    Ok(())
}

fn inspect_live_source_window(
    config: &LiveCaptureWorkerConfig,
    state: &std::sync::Arc<std::sync::Mutex<LiveCaptureSessionState>>,
) -> Result<(), (&'static str, &'static str, String)> {
    let Some(source_window) = &config.source_window else {
        return Ok(());
    };
    let mut source = source_window.lock().map_err(|_| {
        (
            "source_control_unavailable",
            "源窗口控制不可用",
            "live source window lock poisoned".to_string(),
        )
    })?;
    let changed = source.intercept_native_minimize().map_err(|detail| {
        let source_closed = matches!(
            detail.as_str(),
            "source_window_closed" | "source_identity_changed" | "source_identity_unavailable"
        );
        if source_closed {
            ("source_closed", "源窗口已关闭或身份已变化", detail)
        } else {
            ("logical_hide_unsupported", "无法保持源窗口后台渲染", detail)
        }
    })?;
    if changed {
        append_runtime_log_line(&format!(
            "live_source_native_minimize_intercepted :: session={}",
            config.session_id
        ));
    }
    if let Ok(mut value) = state.lock() {
        value.set_source_window_status(&source);
    }
    Ok(())
}

include!("live_capture_producer.rs");

fn build_capture_source(
    config: &mut LiveCaptureWorkerConfig,
) -> Result<BuiltCaptureSource, LiveCaptureBuildError> {
    if let Some(window_id) = config.window_id.clone() {
        return build_window_capture_source(&window_id, config);
    }
    let plan = capture_plan(
        config.x,
        config.y,
        config.width,
        config.height,
        Some(config.display_metrics),
    )
    .map_err(|error| LiveCaptureBuildError::Retry(error.to_string()))?;
    let item = plan
        .display
        .raw_handle()
        .try_as_capture_item()
        .map_err(|error| LiveCaptureBuildError::Retry(format!("display item failed: {error:?}")))?;
    Ok(BuiltCaptureSource {
        item,
        crop: Some(plan.crop),
        process_id: None,
        title: config.source_title.clone(),
    })
}

fn build_window_capture_source(
    window_id: &str,
    config: &mut LiveCaptureWorkerConfig,
) -> Result<BuiltCaptureSource, LiveCaptureBuildError> {
    let raw = u64::from_str_radix(window_id.trim_start_matches("0x"), 16)
        .ok()
        .filter(|value| *value != 0)
        .ok_or(LiveCaptureBuildError::SourceClosed("invalid hwnd"))?;
    let hwnd = HWND(raw as *mut std::ffi::c_void);
    if !unsafe { windows::Win32::UI::WindowsAndMessaging::IsWindow(Some(hwnd)) }.as_bool() {
        return Err(LiveCaptureBuildError::SourceClosed(
            "hwnd is no longer valid",
        ));
    }
    let mut process_id = 0u32;
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
            hwnd,
            Some(&mut process_id),
        )
    };
    if process_id == 0
        || config
            .expected_process_id
            .is_some_and(|expected| expected != process_id)
    {
        return Err(LiveCaptureBuildError::SourceClosed(
            "hwnd process identity changed",
        ));
    }
    config.expected_process_id.get_or_insert(process_id);
    let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
        .map_err(|error| {
            LiveCaptureBuildError::Retry(format!("capture factory failed: {error:?}"))
        })?;
    let item: GraphicsCaptureItem = unsafe { interop.CreateForWindow(hwnd) }.map_err(|error| {
        LiveCaptureBuildError::Retry(format!("CreateForWindow failed: {error:?}"))
    })?;
    let crop = config
        .window_region
        .map(|region| {
            let size = item
                .Size()
                .map_err(|error| format!("item size failed: {error:?}"))?;
            let width =
                u32::try_from(size.Width).map_err(|_| "item width is invalid".to_string())?;
            let height =
                u32::try_from(size.Height).map_err(|_| "item height is invalid".to_string())?;
            live_capture_surface_crop(region, width, height)
        })
        .transpose()
        .map_err(LiveCaptureBuildError::Retry)?;
    Ok(BuiltCaptureSource {
        item,
        crop,
        process_id: Some(process_id),
        title: window_title(hwnd).or_else(|| config.source_title.clone()),
    })
}

fn window_title(hwnd: HWND) -> Option<String> {
    let length = unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowTextLengthW(hwnd) };
    if length <= 0 {
        return None;
    }
    let mut buffer = vec![0u16; length as usize + 1];
    let copied =
        unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowTextW(hwnd, &mut buffer) };
    (copied > 0).then(|| String::from_utf16_lossy(&buffer[..copied as usize]))
}

fn mark_recovering(
    state: &std::sync::Arc<std::sync::Mutex<LiveCaptureSessionState>>,
    epoch: u64,
    code: &str,
    message: &str,
) {
    if let Ok(mut value) = state.lock() {
        value.mark_recovering(epoch, code, message);
    }
}

fn next_epoch(epoch: u64) -> Result<u64, (&'static str, &'static str, String)> {
    epoch.checked_add(1).ok_or((
        "epoch_exhausted",
        "实时会话恢复序列已耗尽",
        "u64 epoch exhausted".to_string(),
    ))
}
