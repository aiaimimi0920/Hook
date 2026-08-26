use image::RgbImage;
use scap_direct3d::{Capturer, PixelFormat};
use windows::Win32::Graphics::Direct3D11::D3D11_BOX;

use super::capture_pixels::{frame_to_hdr_decision, frame_to_rgb, HdrFrameDecision};
use super::hdr_analysis::{HdrCaptureMode, HdrDisplayInfo};
use super::wgc_frame_policy::wgc_cached_frame_is_usable;
use super::wgc_session::{
    shared_d3d_device, windows_capture_settings, windows_capture_settings_for,
    windows_fast_path_available,
};

pub(super) fn try_fast_capture_transient(
    display_id: scap_targets::DisplayId,
    crop_rect: Option<D3D11_BOX>,
) -> Option<RgbImage> {
    use std::sync::mpsc::sync_channel;
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
    // A hardware-accelerated surface can produce a compositor warm-up or
    // protected-content frame that is technically valid but visually black.
    // Treat that frame as a fast-path miss so dispatch falls back to GDI.
    if !wgc_cached_frame_is_usable(&image, crop_rect.as_ref()) {
        if diag {
            crate::append_runtime_log_line(
                "capture_area fast_fail :: reason=unusable_transient_frame",
            );
        }
        return None;
    }
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
            if super::capture_area_verbose_logging_enabled() {
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
