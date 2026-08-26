use image::RgbImage;
use scap_direct3d::Capturer;
use windows::Win32::Graphics::Direct3D11::D3D11_BOX;

use super::capture_pixels::frame_to_rgb;
use super::wgc_frame_policy::{
    crop_rgb, frame_has_suspicious_black_video_hole, frame_has_suspicious_black_video_hole_in_crop,
    frame_is_mostly_black, select_wgc_timeout_fallback_frame, wgc_cached_frame_is_usable,
    wgc_frame_wait_timeout, wgc_last_usable_fallback_max_age,
};
use super::wgc_session::{
    claim_process_persistent_wgc_thread, shared_d3d_device, should_use_persistent_wgc,
    windows_capture_settings, windows_fast_path_available,
};
use super::CaptureWorkloadProfile;

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
    let diag = super::capture_area_verbose_logging_enabled();
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

pub(super) fn try_fast_capture(
    display_id: scap_targets::DisplayId,
    crop_rect: Option<D3D11_BOX>,
    profile: CaptureWorkloadProfile,
) -> Option<RgbImage> {
    use std::time::Duration;

    let diag = super::capture_area_verbose_logging_enabled();
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
        return super::wgc_session::try_fast_capture_transient(display_id, crop_rect);
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
