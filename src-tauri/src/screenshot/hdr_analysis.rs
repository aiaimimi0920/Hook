use half::f16;

use super::CaptureWorkloadProfile;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum HdrCaptureMode {
    Auto,
    Hdr,
    Sdr,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct HdrDisplayInfo {
    pub(super) enabled: bool,
    pub(super) sdr_white_level_nits: f32,
    pub(super) min_luminance_nits: f32,
    pub(super) max_luminance_nits: f32,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct HdrFrameAnalysis {
    pub(super) max_content_light_level_nits: f32,
    pub(super) frame_average_light_level_nits: f32,
}

pub(super) fn hdr_capture_mode_for(value: Option<&str>) -> HdrCaptureMode {
    match value.map(|value| value.trim().to_ascii_lowercase()) {
        Some(value) if value == "hdr" => HdrCaptureMode::Hdr,
        Some(value) if value == "sdr" => HdrCaptureMode::Sdr,
        _ => HdrCaptureMode::Auto,
    }
}

pub(super) fn hdr_capture_mode() -> HdrCaptureMode {
    hdr_capture_mode_for(std::env::var("HOOK_CAPTURE_DYNAMIC_RANGE").ok().as_deref())
}

pub(super) fn should_attempt_hdr_capture(
    mode: HdrCaptureMode,
    profile: CaptureWorkloadProfile,
    windows_11_or_newer: bool,
    display_hdr_enabled: bool,
) -> bool {
    profile == CaptureWorkloadProfile::StandardRegion
        && mode != HdrCaptureMode::Sdr
        && windows_11_or_newer
        && display_hdr_enabled
}

pub(super) fn should_report_hdr_downgrade_on_sdr_fallback(
    mode: HdrCaptureMode,
    attempted_hdr: bool,
    display_hdr_enabled: bool,
    windows_11_or_newer: bool,
) -> bool {
    attempted_hdr
        || (mode == HdrCaptureMode::Hdr && !display_hdr_enabled)
        || (mode != HdrCaptureMode::Sdr && display_hdr_enabled && !windows_11_or_newer)
}

pub(super) fn content_exceeds_sdr_white(max_content_nits: f32, sdr_white_level_nits: f32) -> bool {
    max_content_nits.is_finite()
        && sdr_white_level_nits.is_finite()
        && max_content_nits > sdr_white_level_nits.max(1.0) + 5.0
}

fn normalized_overlay_gain(gain: f32) -> f32 {
    if gain.is_finite() {
        gain.clamp(1.0, 8.0)
    } else {
        1.0
    }
}

pub(super) fn read_scrgb_pixel(src: &[u8], gain: f32) -> Option<[f32; 3]> {
    if src.len() < 8 {
        return None;
    }
    let gain = normalized_overlay_gain(gain);
    let channel = |offset: usize| {
        let value = f16::from_le_bytes([src[offset], src[offset + 1]]).to_f32();
        if value.is_finite() {
            value.max(0.0) * gain
        } else {
            0.0
        }
    };
    Some([channel(0), channel(2), channel(4)])
}

/// Scans an scRGB frame once to derive content and frame-average luminance metadata.
pub(super) fn analyze_scrgb_buffer(
    data: &[u8],
    width: usize,
    height: usize,
    bytes_per_row: usize,
    gain: f32,
) -> Option<HdrFrameAnalysis> {
    const SCRGB_REFERENCE_WHITE_NITS: f32 = 80.0;
    let row_bytes = width.checked_mul(8)?;
    if bytes_per_row < row_bytes || data.len() < height.checked_mul(bytes_per_row)? {
        return None;
    }

    let mut max_luminance = 0.0f32;
    let mut luminance_sum = 0.0f64;
    let mut pixel_count = 0u64;
    for y in 0..height {
        let row_start = y.checked_mul(bytes_per_row)?;
        let row = data.get(row_start..row_start.checked_add(row_bytes)?)?;
        for src in row.chunks_exact(8) {
            let [r, g, b] = read_scrgb_pixel(src, gain)?;
            let luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b).max(0.0);
            max_luminance = max_luminance.max(luminance);
            luminance_sum += luminance as f64;
            pixel_count += 1;
        }
    }

    let average_luminance = if pixel_count > 0 {
        (luminance_sum / pixel_count as f64) as f32
    } else {
        0.0
    };
    Some(HdrFrameAnalysis {
        max_content_light_level_nits: (max_luminance * SCRGB_REFERENCE_WHITE_NITS)
            .clamp(0.0, 10_000.0),
        frame_average_light_level_nits: (average_luminance * SCRGB_REFERENCE_WHITE_NITS)
            .clamp(0.0, 10_000.0),
    })
}
