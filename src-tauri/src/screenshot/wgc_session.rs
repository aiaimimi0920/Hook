use anyhow::anyhow;
use image::RgbImage;
use scap_direct3d::{Capturer, PixelFormat, Settings};
use std::sync::OnceLock;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, D3D11_BOX, D3D11_SDK_VERSION,
};

use super::capture_pixels::{frame_to_hdr_decision, frame_to_rgb, HdrFrameDecision};
use super::hdr_analysis::{HdrCaptureMode, HdrDisplayInfo};
use super::wgc_frame_policy::{
    crop_rgb, frame_has_suspicious_black_video_hole, frame_has_suspicious_black_video_hole_in_crop,
    frame_is_mostly_black, select_wgc_timeout_fallback_frame, wgc_cached_frame_is_usable,
    wgc_frame_wait_timeout, wgc_last_usable_fallback_max_age,
};
use super::{capture_area_verbose_logging_enabled, CaptureWorkloadProfile};

fn shared_d3d_device() -> anyhow::Result<&'static ID3D11Device> {
    static DEVICE: OnceLock<Option<ID3D11Device>> = OnceLock::new();

    let device = DEVICE.get_or_init(|| {
        let mut device = None;
        let result = unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                Default::default(),
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                None,
            )
        };
        if result.is_err() {
            return None;
        }
        device
    });

    device
        .as_ref()
        .ok_or_else(|| anyhow!("D3D11 device unavailable"))
}

// Disable WGC after repeated failures so session churn cannot exhaust system resources.
static WGC_DISABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static WGC_CONSECUTIVE_FAILURES: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0);
const WGC_MAX_CONSECUTIVE_FAILURES: u32 = 3;

pub(super) fn wgc_note_success() {
    WGC_CONSECUTIVE_FAILURES.store(0, std::sync::atomic::Ordering::Relaxed);
}

pub(super) fn wgc_note_failure() {
    let prior = WGC_CONSECUTIVE_FAILURES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if prior + 1 >= WGC_MAX_CONSECUTIVE_FAILURES {
        WGC_DISABLED.store(true, std::sync::atomic::Ordering::Relaxed);
        crate::append_runtime_log_line(
            "capture_area wgc_disabled :: reason=too_many_consecutive_failures",
        );
    }
}

fn windows_fast_path_available() -> bool {
    static AVAILABLE: OnceLock<bool> = OnceLock::new();

    if WGC_DISABLED.load(std::sync::atomic::Ordering::Relaxed) {
        return false;
    }

    *AVAILABLE.get_or_init(|| match scap_direct3d::is_supported() {
        Ok(true) => shared_d3d_device().is_ok(),
        _ => false,
    })
}

fn windows_capture_settings_for(rect: Option<D3D11_BOX>, pixel_format: PixelFormat) -> Settings {
    let mut settings = Settings {
        is_cursor_capture_enabled: Some(false),
        pixel_format,
        ..Default::default()
    };
    if let Ok(true) = Settings::can_is_border_required() {
        settings.is_border_required = Some(false);
    }
    settings.crop = rect;
    settings
}

fn windows_capture_settings(rect: Option<D3D11_BOX>) -> Settings {
    windows_capture_settings_for(rect, PixelFormat::B8G8R8A8Unorm)
}

pub(super) fn wgc_fast_path_mode() -> String {
    std::env::var("HOOK_WGC_FAST_PATH_MODE")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| matches!(value.as_str(), "auto" | "persistent" | "transient"))
        .unwrap_or_else(|| "auto".to_string())
}

pub(super) fn should_use_persistent_wgc(profile: CaptureWorkloadProfile) -> bool {
    match wgc_fast_path_mode().as_str() {
        "transient" => false,
        "persistent" => true,
        // Automatic mode remains transient. Blocking-pool threads must not strand
        // multiple full-screen COM capture sessions after long-capture sampling.
        _ => {
            let _ = profile;
            false
        }
    }
}

/// Bounds the opt-in persistent mode to one blocking worker per process. COM
/// capture objects remain thread-affine, while other workers safely use the
/// transient path instead of retaining another full-screen frame pool.
fn claim_process_persistent_wgc_thread() -> bool {
    static OWNER: OnceLock<std::sync::Mutex<Option<std::thread::ThreadId>>> = OnceLock::new();
    let current = std::thread::current().id();
    let Ok(mut owner) = OWNER.get_or_init(|| std::sync::Mutex::new(None)).lock() else {
        return false;
    };
    match *owner {
        Some(owner) => owner == current,
        None => {
            *owner = Some(current);
            true
        }
    }
}

/// Thread-affine WGC session. `Capturer` owns COM objects and must never be sent
/// to another blocking worker.
struct PersistentCapturer {
    #[allow(dead_code)]
    capturer: Capturer,
    display_id: scap_targets::DisplayId,
    latest: std::sync::Arc<std::sync::Mutex<Option<RgbImage>>>,
    frame_seq: std::sync::Arc<std::sync::atomic::AtomicU64>,
    last_usable: Option<(RgbImage, std::time::Instant)>,
}

thread_local! {
    static PERSISTENT_CAPTURER: std::cell::RefCell<Option<PersistentCapturer>> =
        const { std::cell::RefCell::new(None) };
}

fn build_persistent_capturer(display_id: &scap_targets::DisplayId) -> Option<PersistentCapturer> {
    let diag = capture_area_verbose_logging_enabled();
    let display = match scap_targets::Display::from_id(display_id) {
        Some(display) => display,
        None => {
            if diag {
                crate::append_runtime_log_line("capture_area fast_fail :: reason=display_from_id");
            }
            return None;
        }
    };
    let item = match display.raw_handle().try_as_capture_item() {
        Ok(item) => item,
        Err(error) => {
            if diag {
                crate::append_runtime_log_line(&format!(
                    "capture_area fast_fail :: reason=capture_item err={error:?}"
                ));
            }
            return None;
        }
    };

    // Persistent capture is full-screen; each caller applies its physical crop on CPU.
    let settings = windows_capture_settings(None);
    let device = shared_d3d_device().ok().cloned();
    let latest: std::sync::Arc<std::sync::Mutex<Option<RgbImage>>> =
        std::sync::Arc::new(std::sync::Mutex::new(None));
    let frame_seq = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let cb_latest = latest.clone();
    let cb_seq = frame_seq.clone();
    let mut capturer = match Capturer::new(
        item,
        settings,
        move |frame| {
            if let Ok(image) = frame_to_rgb(&frame) {
                if let Ok(mut slot) = cb_latest.lock() {
                    *slot = Some(image);
                    cb_seq.fetch_add(1, std::sync::atomic::Ordering::Release);
                }
            }
            Ok(())
        },
        || Ok(()),
        device,
    ) {
        Ok(capturer) => capturer,
        Err(error) => {
            if diag {
                crate::append_runtime_log_line(&format!(
                    "capture_area fast_fail :: reason=capturer_new err={error:?}"
                ));
            }
            return None;
        }
    };

    if let Err(error) = capturer.start() {
        if diag {
            crate::append_runtime_log_line(&format!(
                "capture_area fast_fail :: reason=capturer_start err={error:?}"
            ));
        }
        return None;
    }
    if diag {
        crate::append_runtime_log_line("capture_area wgc_persistent_started");
    }

    Some(PersistentCapturer {
        capturer,
        display_id: display_id.clone(),
        latest,
        frame_seq,
        last_usable: None,
    })
}

fn try_fast_capture_transient(
    display_id: scap_targets::DisplayId,
    crop_rect: Option<D3D11_BOX>,
) -> Option<RgbImage> {
    use std::sync::mpsc::sync_channel;
    use std::time::Duration;

    let diag = capture_area_verbose_logging_enabled();
    if !windows_fast_path_available() {
        if diag {
            crate::append_runtime_log_line(
                "capture_area fast_fail :: reason=fast_path_unavailable",
            );
        }
        return None;
    }

    let start = std::time::Instant::now();
    let display = scap_targets::Display::from_id(&display_id)?;
    let item = display.raw_handle().try_as_capture_item().ok()?;
    let settings = windows_capture_settings(crop_rect);
    let device = shared_d3d_device().ok().cloned();
    let (tx, rx) = sync_channel(1);
    let mut capturer = Capturer::new(
        item,
        settings,
        move |frame| {
            let result = frame_to_rgb(&frame);
            let _ = tx.try_send(result);
            Ok(())
        },
        || Ok(()),
        device,
    )
    .ok()?;

    capturer.start().ok()?;
    let result = rx.recv_timeout(Duration::from_millis(500));
    let _ = capturer.stop();
    let image = result.ok()?.ok()?;
    if diag {
        crate::append_runtime_log_line(&format!(
            "capture_area fast_elapsed :: mode=transient elapsed_ms={}",
            start.elapsed().as_millis()
        ));
    }
    Some(image)
}

pub(super) fn try_hdr_capture_transient(
    display_id: scap_targets::DisplayId,
    crop_rect: D3D11_BOX,
    display_info: HdrDisplayInfo,
    mode: HdrCaptureMode,
    overlay_gain: f32,
) -> Option<HdrFrameDecision> {
    use std::sync::mpsc::sync_channel;
    use std::time::Duration;

    if !windows_fast_path_available() {
        return None;
    }

    let started_at = std::time::Instant::now();
    let display = scap_targets::Display::from_id(&display_id)?;
    let item = display.raw_handle().try_as_capture_item().ok()?;
    let settings = windows_capture_settings_for(Some(crop_rect), PixelFormat::R16G16B16A16Float);
    let device = shared_d3d_device().ok().cloned();
    let (tx, rx) = sync_channel(1);
    let mut capturer = Capturer::new(
        item,
        settings,
        move |frame| {
            let result = frame_to_hdr_decision(&frame, display_info, mode, overlay_gain);
            let _ = tx.try_send(result);
            Ok(())
        },
        || Ok(()),
        device,
    )
    .ok()?;

    capturer.start().ok()?;
    let result = rx.recv_timeout(Duration::from_millis(800));
    let _ = capturer.stop();
    match result {
        Ok(Ok(frame)) => {
            if capture_area_verbose_logging_enabled() {
                crate::append_runtime_log_line(&format!(
                    "capture_area hdr_elapsed :: mode=transient elapsed_ms={}",
                    started_at.elapsed().as_millis()
                ));
            }
            Some(frame)
        }
        Ok(Err(error)) => {
            crate::append_runtime_log_line(&format!("capture_area hdr_frame_failure :: {error}"));
            None
        }
        Err(error) => {
            crate::append_runtime_log_line(&format!("capture_area hdr_timeout :: {error}"));
            None
        }
    }
}

pub(super) fn try_fast_capture(
    display_id: scap_targets::DisplayId,
    crop_rect: Option<D3D11_BOX>,
    profile: CaptureWorkloadProfile,
) -> Option<RgbImage> {
    use std::time::Duration;

    let diag = capture_area_verbose_logging_enabled();
    if !windows_fast_path_available() {
        if diag {
            crate::append_runtime_log_line(
                "capture_area fast_fail :: reason=fast_path_unavailable",
            );
        }
        return None;
    }

    let start = std::time::Instant::now();
    if !should_use_persistent_wgc(profile) || !claim_process_persistent_wgc_thread() {
        return try_fast_capture_transient(display_id, crop_rect);
    }

    PERSISTENT_CAPTURER.with(|cell| {
        let display_changed = cell
            .borrow()
            .as_ref()
            .map(|capturer| capturer.display_id != display_id)
            .unwrap_or(false);
        if display_changed {
            *cell.borrow_mut() = None;
            if diag {
                crate::append_runtime_log_line(
                    "capture_area wgc_persistent_display_changed :: rebuilding",
                );
            }
        }

        if cell.borrow().is_none() {
            let built = build_persistent_capturer(&display_id);
            if built.is_none() {
                return None;
            }
            *cell.borrow_mut() = built;
        }

        let mut guard = cell.borrow_mut();
        let persistent = guard.as_mut()?;
        let cached_frame = persistent
            .latest
            .lock()
            .ok()
            .and_then(|slot| slot.clone());
        let cached_usable_frame = cached_frame
            .as_ref()
            .filter(|image| wgc_cached_frame_is_usable(image, crop_rect.as_ref()))
            .cloned();
        let last_usable_backup = persistent
            .last_usable
            .as_ref()
            .filter(|(image, captured_at)| {
                captured_at.elapsed() <= wgc_last_usable_fallback_max_age()
                    && wgc_cached_frame_is_usable(image, crop_rect.as_ref())
            })
            .map(|(image, captured_at)| (image.clone(), *captured_at));
        let usable_backup = cached_usable_frame
            .map(|image| (image, std::time::Instant::now()))
            .or(last_usable_backup);
        let has_usable_cached_frame = usable_backup.is_some();
        let mut seq_seen = persistent
            .frame_seq
            .load(std::sync::atomic::Ordering::Acquire);
        let deadline = std::time::Instant::now() + wgc_frame_wait_timeout(has_usable_cached_frame);
        let mut frames_seen = 0u32;
        let mut black_frames = 0u32;
        let mut chosen: Option<RgbImage> = None;
        let mut latest_black_frame: Option<RgbImage> = None;

        loop {
            let seq_now = persistent
                .frame_seq
                .load(std::sync::atomic::Ordering::Acquire);
            if seq_now != seq_seen {
                seq_seen = seq_now;
                if let Ok(slot) = persistent.latest.lock() {
                    if let Some(ref image) = *slot {
                        frames_seen += 1;
                        let candidate_has_video_hole = crop_rect
                            .as_ref()
                            .map(|crop| frame_has_suspicious_black_video_hole_in_crop(image, crop))
                            .unwrap_or_else(|| frame_has_suspicious_black_video_hole(image));

                        if frame_is_mostly_black(image) || candidate_has_video_hole {
                            black_frames += 1;
                            latest_black_frame = Some(image.clone());
                        } else {
                            persistent.last_usable =
                                Some((image.clone(), std::time::Instant::now()));
                            chosen = Some(image.clone());
                            break;
                        }
                    }
                }
            }
            if std::time::Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(8));
        }

        if chosen.is_none() {
            let backup_age_ms = usable_backup
                .as_ref()
                .map(|(_, captured_at)| captured_at.elapsed().as_millis());
            chosen = select_wgc_timeout_fallback_frame(latest_black_frame, usable_backup);
            if diag || backup_age_ms.is_some() {
                crate::append_runtime_log_line(&format!(
                    "capture_area wgc_timeout_fallback :: used_recent_backup={} backup_age_ms={} frames_seen={} suspicious_frames={}",
                    backup_age_ms.is_some() && chosen.is_some(),
                    backup_age_ms
                        .map(|age| age.to_string())
                        .unwrap_or_else(|| "none".to_string()),
                    frames_seen,
                    black_frames
                ));
            }
        }

        let full = match chosen {
            Some(image) => image,
            None => {
                if diag {
                    crate::append_runtime_log_line(
                        "capture_area fast_fail :: reason=no_frame_persistent",
                    );
                }
                *guard = None;
                return None;
            }
        };
        let image = match crop_rect {
            Some(ref crop) => crop_rgb(&full, crop),
            None => full,
        };

        if diag {
            crate::append_runtime_log_line(&format!(
                "capture_area fast_elapsed :: elapsed_ms={} frames_seen={frames_seen} black_frames={black_frames} out={}x{}",
                start.elapsed().as_millis(),
                image.width(),
                image.height()
            ));
        }
        Some(image)
    })
}

#[cfg(test)]
mod tests {
    use super::claim_process_persistent_wgc_thread;

    #[test]
    fn persistent_wgc_is_bounded_to_one_process_thread() {
        assert!(claim_process_persistent_wgc_thread());
        let other_thread_claim = std::thread::spawn(claim_process_persistent_wgc_thread)
            .join()
            .expect("persistent WGC ownership probe should not panic");
        assert!(!other_thread_claim);
    }
}
