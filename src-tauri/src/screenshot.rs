use crate::capture_coords::CaptureWindowMetrics;
use anyhow::anyhow;
#[cfg(target_os = "windows")]
use half::f16;
use image::RgbImage;
use std::sync::OnceLock;

// Scap Imports
use scap_targets::Display;

// Windows Imports
#[cfg(target_os = "windows")]
use scap_direct3d::{Capturer, Frame, PixelFormat, Settings};
#[cfg(target_os = "windows")]
use windows::core::Interface;
#[cfg(target_os = "windows")]
use windows::Win32::Devices::Display::{
    DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
    DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO,
    DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL, DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
    DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO,
    DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SDR_WHITE_LEVEL,
    DISPLAYCONFIG_SOURCE_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HMODULE;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, D3D11_BOX, D3D11_SDK_VERSION,
};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020, DXGI_COLOR_SPACE_RGB_STUDIO_G2084_NONE_P2020,
};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput6, DXGI_OUTPUT_DESC1,
};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, CAPTUREBLT, DIB_RGB_COLORS, HDC, SRCCOPY,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CaptureWorkloadProfile {
    StandardRegion,
    LongCapture,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CaptureBackend {
    WgcHdr,
    WgcSdr,
    Gdi,
}

impl CaptureBackend {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WgcHdr => "wgc-hdr-transient",
            Self::WgcSdr => "wgc-sdr",
            Self::Gdi => "gdi-sdr",
        }
    }
}

#[derive(Debug)]
pub struct HdrPqImage {
    pub width: u32,
    pub height: u32,
    pub rgb16_be: Vec<u8>,
    pub max_content_light_level_nits: f32,
    pub max_frame_average_light_level_nits: f32,
    pub mastering_min_luminance_nits: f32,
    pub mastering_max_luminance_nits: f32,
}

#[derive(Debug)]
pub enum DynamicCapturePixels {
    Sdr(RgbImage),
    Hdr(HdrPqImage),
}

#[derive(Debug)]
pub struct DynamicCaptureResult {
    pub pixels: DynamicCapturePixels,
    pub backend: CaptureBackend,
    pub downgraded_from_hdr: bool,
    pub overlay_compensated: bool,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum HdrCaptureMode {
    Auto,
    Hdr,
    Sdr,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug)]
struct HdrDisplayInfo {
    enabled: bool,
    sdr_white_level_nits: f32,
    min_luminance_nits: f32,
    max_luminance_nits: f32,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug)]
struct HdrFrameAnalysis {
    max_content_light_level_nits: f32,
    frame_average_light_level_nits: f32,
}

#[cfg(target_os = "windows")]
enum HdrFrameDecision {
    Sdr(RgbImage),
    Hdr(HdrPqImage),
}
#[cfg(target_os = "windows")]
// use windows::Win32::Storage::Xps::{PRINT_WINDOW_FLAGS, PrintWindow};
#[cfg(target_os = "windows")]
const WINDOWS_CAPTURE_UNSUPPORTED: &str =
    "Screen capture not supported on this device/driver. Update graphics drivers or OS.";

#[cfg(target_os = "windows")]
fn unsupported_error() -> anyhow::Error {
    anyhow!(WINDOWS_CAPTURE_UNSUPPORTED)
}

#[derive(Clone, Copy)]
enum ChannelOrder {
    Rgba,
    Bgra,
}

fn rgb_from_rgba(
    data: &[u8],
    width: usize,
    height: usize,
    bytes_per_row: usize,
    order: ChannelOrder,
) -> Option<RgbImage> {
    let row_bytes = width.checked_mul(4)?;
    if bytes_per_row < row_bytes {
        return None;
    }

    let required_len = height.checked_mul(bytes_per_row)?;
    if data.len() < required_len {
        return None;
    }

    let width_stride = width.checked_mul(3)?;
    let rgb_len = height.checked_mul(width_stride)?;
    let mut rgb = vec![0u8; rgb_len];

    for y in 0..height {
        let src_start = y.checked_mul(bytes_per_row)?;
        let src_end = src_start.checked_add(row_bytes)?;
        let dst_start = y.checked_mul(width_stride)?;
        let dst_end = dst_start.checked_add(width_stride)?;

        let src_row = data.get(src_start..src_end)?;
        let dst_row = rgb.get_mut(dst_start..dst_end)?;

        for (src, dst) in src_row.chunks_exact(4).zip(dst_row.chunks_exact_mut(3)) {
            let (r, b) = match order {
                ChannelOrder::Rgba => (src[0], src[2]),
                ChannelOrder::Bgra => (src[2], src[0]),
            };

            dst[0] = r;
            dst[1] = src[1];
            dst[2] = b;
        }
    }

    RgbImage::from_raw(width as u32, height as u32, rgb)
}

#[cfg(target_os = "windows")]
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

// Runtime circuit breaker for the WGC fast path. Repeated WGC start/capture
// failures can leave frame-pool/session cleanup lagging behind the next retry;
// enough churn can exhaust GPU/system resources and make every later
// StartCapture return 0x800705AA (ERROR_NO_SYSTEM_RESOURCES). If WGC keeps
// failing on this machine, stop retrying it for the rest of the session and
// fall back to GDI, so long capture does not spend hundreds of calls thrashing
// the same failing path.
#[cfg(target_os = "windows")]
static WGC_DISABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
#[cfg(target_os = "windows")]
static WGC_CONSECUTIVE_FAILURES: std::sync::atomic::AtomicU32 =
    std::sync::atomic::AtomicU32::new(0);
#[cfg(target_os = "windows")]
const WGC_MAX_CONSECUTIVE_FAILURES: u32 = 3;

#[cfg(target_os = "windows")]
fn wgc_note_success() {
    WGC_CONSECUTIVE_FAILURES.store(0, std::sync::atomic::Ordering::Relaxed);
}

#[cfg(target_os = "windows")]
fn wgc_note_failure() {
    let prior = WGC_CONSECUTIVE_FAILURES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if prior + 1 >= WGC_MAX_CONSECUTIVE_FAILURES {
        WGC_DISABLED.store(true, std::sync::atomic::Ordering::Relaxed);
        crate::append_runtime_log_line(
            "capture_area wgc_disabled :: reason=too_many_consecutive_failures",
        );
    }
}

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
fn hdr_capture_mode_for(value: Option<&str>) -> HdrCaptureMode {
    match value.map(|value| value.trim().to_ascii_lowercase()) {
        Some(value) if value == "hdr" => HdrCaptureMode::Hdr,
        Some(value) if value == "sdr" => HdrCaptureMode::Sdr,
        _ => HdrCaptureMode::Auto,
    }
}

#[cfg(target_os = "windows")]
fn hdr_capture_mode() -> HdrCaptureMode {
    hdr_capture_mode_for(std::env::var("HOOK_CAPTURE_DYNAMIC_RANGE").ok().as_deref())
}

#[cfg(target_os = "windows")]
fn should_attempt_hdr_capture(
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

#[cfg(target_os = "windows")]
fn should_report_hdr_downgrade_on_sdr_fallback(
    mode: HdrCaptureMode,
    attempted_hdr: bool,
    display_hdr_enabled: bool,
    windows_11_or_newer: bool,
) -> bool {
    attempted_hdr
        || (mode == HdrCaptureMode::Hdr && !display_hdr_enabled)
        || (mode != HdrCaptureMode::Sdr && display_hdr_enabled && !windows_11_or_newer)
}

#[cfg(target_os = "windows")]
fn content_exceeds_sdr_white(max_content_nits: f32, sdr_white_level_nits: f32) -> bool {
    max_content_nits.is_finite()
        && sdr_white_level_nits.is_finite()
        && max_content_nits > sdr_white_level_nits.max(1.0) + 5.0
}

#[cfg(target_os = "windows")]
fn normalized_overlay_gain(gain: f32) -> f32 {
    if gain.is_finite() {
        gain.clamp(1.0, 8.0)
    } else {
        1.0
    }
}

#[cfg(target_os = "windows")]
fn read_scrgb_pixel(src: &[u8], gain: f32) -> Option<[f32; 3]> {
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

#[cfg(target_os = "windows")]
fn analyze_scrgb_buffer(
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

#[cfg(target_os = "windows")]
fn srgb_oetf(linear: f32) -> f32 {
    let linear = linear.clamp(0.0, 1.0);
    if linear <= 0.003_130_8 {
        12.92 * linear
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    }
}

#[cfg(target_os = "windows")]
fn scrgb_buffer_to_sdr_rgb(
    data: &[u8],
    width: usize,
    height: usize,
    bytes_per_row: usize,
    sdr_white_level_nits: f32,
    gain: f32,
) -> Option<RgbImage> {
    const SCRGB_REFERENCE_WHITE_NITS: f32 = 80.0;
    let row_bytes = width.checked_mul(8)?;
    if bytes_per_row < row_bytes || data.len() < height.checked_mul(bytes_per_row)? {
        return None;
    }
    let white = if sdr_white_level_nits.is_finite() {
        sdr_white_level_nits.max(SCRGB_REFERENCE_WHITE_NITS)
    } else {
        203.0
    };
    let to_sdr = SCRGB_REFERENCE_WHITE_NITS / white;
    let rgb_len = width.checked_mul(height)?.checked_mul(3)?;
    let mut rgb = Vec::with_capacity(rgb_len);
    for y in 0..height {
        let row_start = y.checked_mul(bytes_per_row)?;
        let row = data.get(row_start..row_start.checked_add(row_bytes)?)?;
        for src in row.chunks_exact(8) {
            let channels = read_scrgb_pixel(src, gain)?;
            for channel in channels {
                rgb.push((srgb_oetf(channel * to_sdr) * 255.0).round() as u8);
            }
        }
    }
    RgbImage::from_raw(width as u32, height as u32, rgb)
}

#[cfg(target_os = "windows")]
fn pq_oetf_from_nits(nits: f32) -> f32 {
    const M1: f32 = 2610.0 / 16_384.0;
    const M2: f32 = 2523.0 / 32.0;
    const C1: f32 = 3424.0 / 4096.0;
    const C2: f32 = 2413.0 / 128.0;
    const C3: f32 = 2392.0 / 128.0;
    let normalized = (nits / 10_000.0).clamp(0.0, 1.0);
    let powered = normalized.powf(M1);
    ((C1 + C2 * powered) / (1.0 + C3 * powered)).powf(M2)
}

#[cfg(target_os = "windows")]
fn scrgb_to_bt2020_linear(rgb: [f32; 3]) -> [f32; 3] {
    let [r, g, b] = rgb;
    [
        0.627_404 * r + 0.329_282 * g + 0.043_313_6 * b,
        0.069_097 * r + 0.919_54 * g + 0.011_361_2 * b,
        0.016_391_6 * r + 0.088_013_2 * g + 0.895_595 * b,
    ]
}

#[cfg(target_os = "windows")]
fn scrgb_buffer_to_hdr_pq(
    data: &[u8],
    width: usize,
    height: usize,
    bytes_per_row: usize,
    analysis: HdrFrameAnalysis,
    display_info: HdrDisplayInfo,
    gain: f32,
) -> Option<HdrPqImage> {
    const SCRGB_REFERENCE_WHITE_NITS: f32 = 80.0;
    let row_bytes = width.checked_mul(8)?;
    if bytes_per_row < row_bytes || data.len() < height.checked_mul(bytes_per_row)? {
        return None;
    }
    let output_len = width.checked_mul(height)?.checked_mul(6)?;
    let mut rgb16_be = Vec::with_capacity(output_len);
    for y in 0..height {
        let row_start = y.checked_mul(bytes_per_row)?;
        let row = data.get(row_start..row_start.checked_add(row_bytes)?)?;
        for src in row.chunks_exact(8) {
            let bt2020 = scrgb_to_bt2020_linear(read_scrgb_pixel(src, gain)?);
            for channel in bt2020 {
                let pq = pq_oetf_from_nits(channel.max(0.0) * SCRGB_REFERENCE_WHITE_NITS);
                rgb16_be.extend_from_slice(&((pq * u16::MAX as f32).round() as u16).to_be_bytes());
            }
        }
    }

    Some(HdrPqImage {
        width: width as u32,
        height: height as u32,
        rgb16_be,
        max_content_light_level_nits: analysis.max_content_light_level_nits,
        max_frame_average_light_level_nits: analysis.frame_average_light_level_nits,
        mastering_min_luminance_nits: display_info.min_luminance_nits.max(0.0),
        mastering_max_luminance_nits: display_info
            .max_luminance_nits
            .max(analysis.max_content_light_level_nits)
            .clamp(1.0, 10_000.0),
    })
}

#[cfg(target_os = "windows")]
fn frame_to_hdr_decision(
    frame: &Frame,
    display_info: HdrDisplayInfo,
    mode: HdrCaptureMode,
    overlay_gain: f32,
) -> anyhow::Result<HdrFrameDecision> {
    let buffer = frame
        .as_buffer()
        .map_err(|error| anyhow!("Failed to map HDR frame buffer: {error:?}"))?;
    if buffer.pixel_format() != PixelFormat::R16G16B16A16Float {
        return Err(anyhow!("HDR capture returned an unexpected pixel format"));
    }
    let width = buffer.width() as usize;
    let height = buffer.height() as usize;
    let stride = buffer.stride() as usize;
    let analysis = analyze_scrgb_buffer(buffer.data(), width, height, stride, overlay_gain)
        .ok_or_else(|| anyhow!("Failed to analyze HDR frame"))?;

    if mode == HdrCaptureMode::Auto
        && !content_exceeds_sdr_white(
            analysis.max_content_light_level_nits,
            display_info.sdr_white_level_nits,
        )
    {
        let image = scrgb_buffer_to_sdr_rgb(
            buffer.data(),
            width,
            height,
            stride,
            display_info.sdr_white_level_nits,
            overlay_gain,
        )
        .ok_or_else(|| anyhow!("Failed to convert SDR-only scRGB content"))?;
        return Ok(HdrFrameDecision::Sdr(image));
    }

    let image = scrgb_buffer_to_hdr_pq(
        buffer.data(),
        width,
        height,
        stride,
        analysis,
        display_info,
        overlay_gain,
    )
    .ok_or_else(|| anyhow!("Failed to convert scRGB content to HDR PNG pixels"))?;
    Ok(HdrFrameDecision::Hdr(image))
}

#[cfg(target_os = "windows")]
fn frame_to_rgb(frame: &Frame) -> anyhow::Result<RgbImage> {
    let buffer = frame
        .as_buffer()
        .map_err(|e| anyhow!("Failed to get buffer: {e:?}"))?;

    let order = match buffer.pixel_format() {
        PixelFormat::R8G8B8A8Unorm => ChannelOrder::Rgba,
        PixelFormat::B8G8R8A8Unorm => ChannelOrder::Bgra,
        PixelFormat::R16G16B16A16Float => {
            return Err(anyhow!(
                "HDR frame cannot be converted through the SDR path"
            ));
        }
    };

    rgb_from_rgba(
        buffer.data(),
        buffer.width() as usize,
        buffer.height() as usize,
        buffer.stride() as usize,
        order,
    )
    .ok_or_else(|| anyhow!("Failed to create RgbImage"))
}

// Heuristic: is this frame almost entirely black? WGC's first frame(s) after
// StartCapture are commonly all-black until the compositor presents live
// content, so we use this to skip them and wait for a real frame. Samples a
// sparse grid (not every pixel) for speed. "Black" = all channels below a small
// threshold; we treat a frame as black if >=99% of sampled pixels are black.
#[cfg(target_os = "windows")]
fn frame_is_mostly_black(img: &RgbImage) -> bool {
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return true;
    }
    // Sample up to ~64x64 points across the image.
    let step_x = (w / 64).max(1);
    let step_y = (h / 64).max(1);
    let mut sampled: u64 = 0;
    let mut black: u64 = 0;
    let mut y = 0;
    while y < h {
        let mut x = 0;
        while x < w {
            let p = img.get_pixel(x, y).0;
            sampled += 1;
            if p[0] <= 8 && p[1] <= 8 && p[2] <= 8 {
                black += 1;
            }
            x += step_x;
        }
        y += step_y;
    }
    if sampled == 0 {
        return true;
    }
    // >=99% black samples: treat as a black frame.
    black * 100 >= sampled * 99
}

#[cfg(target_os = "windows")]
fn frame_has_suspicious_black_video_hole(img: &RgbImage) -> bool {
    let (w, h) = (img.width(), img.height());
    if w < 80 || h < 80 {
        return false;
    }

    // Video overlay failures usually look like: a large black playback area in
    // the middle, while normal web UI / subtitles / controls around it still
    // render. Sample the central area and ignore the bottom control strip.
    let left = w / 8;
    let right = w - left;
    let top = h / 8;
    let bottom = h * 3 / 4;
    let step_x = ((right - left) / 80).max(1);
    let step_y = ((bottom - top) / 80).max(1);
    let mut sampled: u64 = 0;
    let mut black: u64 = 0;

    let mut y = top;
    while y < bottom {
        let mut x = left;
        while x < right {
            let p = img.get_pixel(x, y).0;
            sampled += 1;
            if p[0] <= 10 && p[1] <= 10 && p[2] <= 10 {
                black += 1;
            }
            x += step_x;
        }
        y += step_y;
    }

    sampled > 0 && black * 100 >= sampled * 88
}

#[cfg(target_os = "windows")]
fn wgc_cached_frame_is_usable(img: &RgbImage, crop_rect: Option<&D3D11_BOX>) -> bool {
    if frame_is_mostly_black(img) {
        return false;
    }

    let has_video_hole = crop_rect
        .map(|crop| frame_has_suspicious_black_video_hole(&crop_rgb(img, crop)))
        .unwrap_or_else(|| frame_has_suspicious_black_video_hole(img));

    !has_video_hole
}

#[cfg(target_os = "windows")]
fn wgc_frame_wait_timeout(has_usable_cached_frame: bool) -> std::time::Duration {
    if has_usable_cached_frame {
        // When a persistent capturer already has a usable frame, wait only
        // briefly for a fresher frame. Static screens may not produce a new WGC
        // frame, and waiting for the full initial timeout would make normal
        // captures feel slow.
        std::time::Duration::from_millis(120)
    } else {
        // First capture after starting WGC can need a longer warm-up to skip
        // transient black compositor frames.
        std::time::Duration::from_millis(1200)
    }
}

#[cfg(target_os = "windows")]
fn wgc_last_usable_fallback_max_age() -> std::time::Duration {
    std::time::Duration::from_secs(12)
}

#[cfg(target_os = "windows")]
fn select_wgc_timeout_fallback_frame(
    latest_suspicious_frame: Option<RgbImage>,
    recent_usable_backup: Option<(RgbImage, std::time::Instant)>,
) -> Option<RgbImage> {
    match recent_usable_backup {
        Some((image, captured_at))
            if captured_at.elapsed() <= wgc_last_usable_fallback_max_age() =>
        {
            Some(image)
        }
        _ => latest_suspicious_frame,
    }
}

#[cfg(target_os = "windows")]
fn dxgi_output_desc_for_monitor(
    monitor: windows::Win32::Graphics::Gdi::HMONITOR,
) -> Option<DXGI_OUTPUT_DESC1> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1().ok()? };
    let mut adapter_index = 0u32;
    loop {
        let Ok(adapter) = (unsafe { factory.EnumAdapters1(adapter_index) }) else {
            break;
        };
        let mut output_index = 0u32;
        loop {
            let Ok(output) = (unsafe { adapter.EnumOutputs(output_index) }) else {
                break;
            };
            if let Ok(output6) = output.cast::<IDXGIOutput6>() {
                if let Ok(desc) = unsafe { output6.GetDesc1() } {
                    if desc.Monitor == monitor {
                        return Some(desc);
                    }
                }
            }
            output_index += 1;
        }
        adapter_index += 1;
    }
    None
}

#[cfg(target_os = "windows")]
fn null_terminated_utf16_eq(left: &[u16], right: &[u16]) -> bool {
    let left_len = left
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(left.len());
    let right_len = right
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(right.len());
    left_len == right_len
        && left[..left_len]
            .iter()
            .zip(&right[..right_len])
            .all(|(left, right)| {
                let fold_ascii = |value: u16| {
                    if (b'A' as u16..=b'Z' as u16).contains(&value) {
                        value + (b'a' - b'A') as u16
                    } else {
                        value
                    }
                };
                fold_ascii(*left) == fold_ascii(*right)
            })
}

#[cfg(target_os = "windows")]
fn display_config_hdr_state(device_name: &[u16; 32]) -> Option<(bool, f32)> {
    let mut path_count = 0u32;
    let mut mode_count = 0u32;
    if unsafe {
        GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
    }
    .0 != 0
    {
        return None;
    }
    let mut paths = vec![DISPLAYCONFIG_PATH_INFO::default(); path_count as usize];
    let mut modes = vec![DISPLAYCONFIG_MODE_INFO::default(); mode_count as usize];
    if unsafe {
        QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut path_count,
            paths.as_mut_ptr(),
            &mut mode_count,
            modes.as_mut_ptr(),
            None,
        )
    }
    .0 != 0
    {
        return None;
    }
    paths.truncate(path_count as usize);

    for path in paths {
        let mut source_name = DISPLAYCONFIG_SOURCE_DEVICE_NAME {
            header: DISPLAYCONFIG_DEVICE_INFO_HEADER {
                r#type: DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
                size: std::mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as u32,
                adapterId: path.sourceInfo.adapterId,
                id: path.sourceInfo.id,
            },
            ..Default::default()
        };
        if unsafe { DisplayConfigGetDeviceInfo(&mut source_name.header) } != 0
            || !null_terminated_utf16_eq(&source_name.viewGdiDeviceName, device_name)
        {
            continue;
        }

        let target_header = |r#type, size| DISPLAYCONFIG_DEVICE_INFO_HEADER {
            r#type,
            size,
            adapterId: path.targetInfo.adapterId,
            id: path.targetInfo.id,
        };
        let mut advanced = DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO {
            header: target_header(
                DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO,
                std::mem::size_of::<DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO>() as u32,
            ),
            ..Default::default()
        };
        if unsafe { DisplayConfigGetDeviceInfo(&mut advanced.header) } != 0 {
            return None;
        }
        let advanced_value = unsafe { advanced.Anonymous.value };
        let hdr_enabled = advanced_value & (1 << 1) != 0;

        let mut white_level = DISPLAYCONFIG_SDR_WHITE_LEVEL {
            header: target_header(
                DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL,
                std::mem::size_of::<DISPLAYCONFIG_SDR_WHITE_LEVEL>() as u32,
            ),
            ..Default::default()
        };
        let sdr_white_nits = if unsafe { DisplayConfigGetDeviceInfo(&mut white_level.header) } == 0
        {
            (80.0 * white_level.SDRWhiteLevel as f32 / 1_000.0).max(80.0)
        } else {
            203.0
        };
        return Some((hdr_enabled, sdr_white_nits));
    }
    None
}

#[cfg(target_os = "windows")]
fn hdr_display_info_for(display: &Display) -> Option<HdrDisplayInfo> {
    let desc = dxgi_output_desc_for_monitor(display.raw_handle().inner())?;
    let fallback_enabled = matches!(
        desc.ColorSpace,
        DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020 | DXGI_COLOR_SPACE_RGB_STUDIO_G2084_NONE_P2020
    );
    let (advanced_color_enabled, sdr_white_level_nits) =
        display_config_hdr_state(&desc.DeviceName).unwrap_or((fallback_enabled, 203.0));
    Some(HdrDisplayInfo {
        enabled: advanced_color_enabled && fallback_enabled,
        sdr_white_level_nits,
        min_luminance_nits: if desc.MinLuminance.is_finite() {
            desc.MinLuminance.max(0.0)
        } else {
            0.0
        },
        max_luminance_nits: if desc.MaxLuminance.is_finite() {
            desc.MaxLuminance.clamp(1.0, 10_000.0)
        } else {
            1_000.0
        },
    })
}

// Simplified capture settings just for Full Screen or Area.
#[cfg(target_os = "windows")]
fn windows_capture_settings_for(rect: Option<D3D11_BOX>, pixel_format: PixelFormat) -> Settings {
    let mut settings = Settings {
        is_cursor_capture_enabled: Some(false),
        pixel_format,
        ..Default::default()
    };

    if let Ok(true) = Settings::can_is_border_required() {
        settings.is_border_required = Some(false);
    }

    // Explicit Crop
    settings.crop = rect;

    settings
}

#[cfg(target_os = "windows")]
fn windows_capture_settings(rect: Option<D3D11_BOX>) -> Settings {
    windows_capture_settings_for(rect, PixelFormat::B8G8R8A8Unorm)
}

#[cfg(target_os = "windows")]
fn capture_bitmap_with(
    base_dc: HDC,
    width: i32,
    height: i32,
    mut fill: impl FnMut(HDC) -> anyhow::Result<()>,
) -> anyhow::Result<Vec<u8>> {
    if width <= 0 || height <= 0 {
        return Err(unsupported_error());
    }

    if base_dc.is_invalid() {
        return Err(unsupported_error());
    }

    let mem_dc = unsafe { CreateCompatibleDC(Some(base_dc)) };
    if mem_dc.is_invalid() {
        return Err(unsupported_error());
    }

    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: 0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [Default::default(); 1],
    };

    let mut data = std::ptr::null_mut();
    let bitmap =
        unsafe { CreateDIBSection(Some(mem_dc), &info, DIB_RGB_COLORS, &mut data, None, 0) };

    // Check if bitmap creation succeeded (bitmap != Err and handle != 0 and data != null)
    let bitmap = match bitmap {
        Ok(b) if !b.is_invalid() && !data.is_null() => b,
        _ => {
            unsafe {
                let _ = DeleteDC(mem_dc);
            }
            return Err(unsupported_error());
        }
    };

    let old_obj = unsafe { SelectObject(mem_dc, bitmap.into()) };

    let result = (|| {
        fill(mem_dc)?;

        let width = usize::try_from(width).map_err(|_| unsupported_error())?;
        let height = usize::try_from(height).map_err(|_| unsupported_error())?;
        let row_bytes = width.checked_mul(4).ok_or_else(unsupported_error)?;
        let len = height
            .checked_mul(row_bytes)
            .ok_or_else(unsupported_error)?;
        let slice = unsafe { std::slice::from_raw_parts(data as *const u8, len) };

        let mut buffer = vec![0u8; len];
        buffer.copy_from_slice(slice);
        Ok(buffer)
    })();

    unsafe {
        SelectObject(mem_dc, old_obj);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem_dc);
    }

    result
}

#[cfg(target_os = "windows")]
fn bgra_to_rgb(buffer: Vec<u8>, width: usize, height: usize) -> anyhow::Result<RgbImage> {
    let stride = width.checked_mul(4).ok_or_else(unsupported_error)?;
    rgb_from_rgba(&buffer, width, height, stride, ChannelOrder::Bgra).ok_or_else(unsupported_error)
}

#[cfg(target_os = "windows")]
fn capture_area_gdi(src_x: i32, src_y: i32, width: i32, height: i32) -> anyhow::Result<RgbImage> {
    let screen_dc = unsafe { GetDC(None) };
    let result = capture_bitmap_with(screen_dc, width, height, |mem_dc| {
        unsafe {
            BitBlt(
                mem_dc,
                0,
                0,
                width,
                height,
                Some(screen_dc),
                src_x,
                src_y,
                SRCCOPY | CAPTUREBLT,
            )
        }
        .map_err(|_| unsupported_error())
    });
    unsafe {
        ReleaseDC(None, screen_dc);
    }

    let buffer = result?;
    let width = usize::try_from(width).map_err(|_| unsupported_error())?;
    let height = usize::try_from(height).map_err(|_| unsupported_error())?;
    bgra_to_rgb(buffer, width, height)
}

#[cfg(target_os = "windows")]
fn capture_backend_mode() -> String {
    // Default to "auto": try the Windows Graphics Capture (Direct3D) fast path
    // first, then fall back to GDI. GDI's BitBlt cannot capture hardware-overlay
    // / GPU-composited video (players, hardware-accelerated browsers) - it reads
    // back the black color-key, which is why video came out black. WGC captures
    // the composited output like other screenshot tools do. Set
    // HOOK_CAPTURE_BACKEND=gdi to force the legacy path if a driver misbehaves.
    std::env::var("HOOK_CAPTURE_BACKEND")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "auto".to_string())
}

fn capture_area_verbose_logging_enabled_for(value: Option<&str>) -> bool {
    matches!(
        value.map(|value| value.trim().to_ascii_lowercase()),
        Some(value) if matches!(value.as_str(), "1" | "true" | "yes" | "on")
    )
}

fn capture_area_verbose_logging_enabled() -> bool {
    if cfg!(feature = "diag_capture") {
        return true;
    }

    capture_area_verbose_logging_enabled_for(
        std::env::var("HOOK_CAPTURE_AREA_VERBOSE_LOG")
            .ok()
            .as_deref(),
    )
}

#[cfg(target_os = "windows")]
fn wgc_fast_path_mode() -> String {
    std::env::var("HOOK_WGC_FAST_PATH_MODE")
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| matches!(value.as_str(), "auto" | "persistent" | "transient"))
        .unwrap_or_else(|| "auto".to_string())
}

#[cfg(target_os = "windows")]
fn should_use_persistent_wgc(profile: CaptureWorkloadProfile) -> bool {
    match wgc_fast_path_mode().as_str() {
        "transient" => false,
        "persistent" => true,
        // Default "auto" stays on transient WGC even for long capture. The
        // persistent capturer lives in thread-local state inside tokio's
        // blocking pool; repeated long-capture sampling can therefore strand
        // multiple full-screen WGC sessions on different worker threads, which
        // is exactly what drove post-capture idle memory/CPU far above the
        // single transient path. Keep persistent mode as an explicit override
        // only for future experiments.
        _ => {
            let _ = profile;
            false
        }
    }
}

// ---------------------------------------------------------------------------
// Plan A: a persistent, full-screen Windows Graphics Capture (WGC) session that
// is created ONCE and reused for every capture_area call, instead of building a
// fresh Capturer + capture session + frame pool per call.
//
// Why: WGC capture sessions and frame pools are limited system resources. The
// old code created and destroyed a Capturer on every call; in the long-capture
// loop that is hundreds of create/start/stop cycles in quick succession, and
// the OS could lag behind reclaiming those sessions. StartCapture could then
// begin returning 0x800705AA (ERROR_NO_SYSTEM_RESOURCES) for every call, so the
// fast path fell back to GDI - which cannot read hardware-overlay video,
// producing black video captures.
//
// The persistent capturer keeps ONE session alive for the whole process. It
// captures the full primary display and continuously writes the latest frame
// into a shared slot; each capture_area call just reads the newest non-black
// frame and crops it on the CPU. The COM objects are not Send, so the capturer
// lives in a thread_local and is reused per capture thread.
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
struct PersistentCapturer {
    // Held only to keep the WGC session alive for the lifetime of this struct;
    // dropping the Capturer calls stop() and ends capture. Never read directly.
    #[allow(dead_code)]
    capturer: Capturer,
    display_id: scap_targets::DisplayId,
    latest: std::sync::Arc<std::sync::Mutex<Option<RgbImage>>>,
    frame_seq: std::sync::Arc<std::sync::atomic::AtomicU64>,
    last_usable: Option<(RgbImage, std::time::Instant)>,
}

#[cfg(target_os = "windows")]
thread_local! {
    static PERSISTENT_CAPTURER: std::cell::RefCell<Option<PersistentCapturer>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(target_os = "windows")]
fn build_persistent_capturer(display_id: &scap_targets::DisplayId) -> Option<PersistentCapturer> {
    let diag = capture_area_verbose_logging_enabled();

    let display = match scap_targets::Display::from_id(display_id) {
        Some(d) => d,
        None => {
            if diag {
                crate::append_runtime_log_line("capture_area fast_fail :: reason=display_from_id");
            }
            return None;
        }
    };
    let item = match display.raw_handle().try_as_capture_item() {
        Ok(i) => i,
        Err(e) => {
            if diag {
                crate::append_runtime_log_line(&format!(
                    "capture_area fast_fail :: reason=capture_item err={e:?}"
                ));
            }
            return None;
        }
    };

    // Full-screen capture: no crop on the WGC side. We crop on the CPU per call
    // so the single persistent session can serve every rect.
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
            if let Ok(img) = frame_to_rgb(&frame) {
                if let Ok(mut slot) = cb_latest.lock() {
                    *slot = Some(img);
                    cb_seq.fetch_add(1, std::sync::atomic::Ordering::Release);
                }
            }
            Ok(())
        },
        || Ok(()),
        device,
    ) {
        Ok(c) => c,
        Err(e) => {
            if diag {
                crate::append_runtime_log_line(&format!(
                    "capture_area fast_fail :: reason=capturer_new err={e:?}"
                ));
            }
            return None;
        }
    };

    if let Err(e) = capturer.start() {
        if diag {
            crate::append_runtime_log_line(&format!(
                "capture_area fast_fail :: reason=capturer_start err={e:?}"
            ));
        }
        // Capturer's Drop calls stop() to release the session + frame pool.
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

/// Crop a full-screen RGB frame to the requested physical rect. Clamps to the
/// image bounds so an off-by-one scale never panics.
#[cfg(target_os = "windows")]
fn crop_rgb(full: &RgbImage, crop: &D3D11_BOX) -> RgbImage {
    let img_w = full.width();
    let img_h = full.height();
    let left = crop.left.min(img_w.saturating_sub(1));
    let top = crop.top.min(img_h.saturating_sub(1));
    let right = crop.right.min(img_w).max(left + 1);
    let bottom = crop.bottom.min(img_h).max(top + 1);
    let w = right - left;
    let h = bottom - top;

    let mut out = RgbImage::new(w, h);
    for row in 0..h {
        for col in 0..w {
            let px = full.get_pixel(left + col, top + row);
            out.put_pixel(col, row, *px);
        }
    }
    out
}

#[cfg(target_os = "windows")]
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
            let res = frame_to_rgb(&frame);
            let _ = tx.try_send(res);
            Ok(())
        },
        || Ok(()),
        device,
    )
    .ok()?;

    capturer.start().ok()?;
    let res = rx.recv_timeout(Duration::from_millis(500));
    let _ = capturer.stop();

    let image = res.ok()?.ok()?;
    if diag {
        crate::append_runtime_log_line(&format!(
            "capture_area fast_elapsed :: mode=transient elapsed_ms={}",
            start.elapsed().as_millis()
        ));
    }
    Some(image)
}

#[cfg(target_os = "windows")]
fn try_hdr_capture_transient(
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

#[cfg(target_os = "windows")]
fn try_fast_capture(
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

    if !should_use_persistent_wgc(profile) {
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

        // Lazily create (or recreate after a prior failure) the persistent
        // capturer. Reused across every call on this thread; this is what
        // stops the per-frame create/start/stop churn that exhausted WGC.
        if cell.borrow().is_none() {
            let built = build_persistent_capturer(&display_id);
            if built.is_none() {
                return None;
            }
            *cell.borrow_mut() = built;
        }

        let mut guard = cell.borrow_mut();
        let pc = guard.as_mut()?;

        // Wait for a fresh, non-black frame. WGC's very first frames after a
        // session starts are frequently black until the DWM composites live
        // hardware-overlay video, so we wait for either a non-black frame or a
        // deadline and take the newest available.
        let cached_frame = pc.latest.lock().ok().and_then(|slot| slot.clone());
        let cached_usable_frame = cached_frame
            .as_ref()
            .filter(|img| wgc_cached_frame_is_usable(img, crop_rect.as_ref()))
            .cloned();
        let last_usable_backup = pc
            .last_usable
            .as_ref()
            .filter(|(img, captured_at)| {
                captured_at.elapsed() <= wgc_last_usable_fallback_max_age()
                    && wgc_cached_frame_is_usable(img, crop_rect.as_ref())
            })
            .map(|(img, captured_at)| (img.clone(), *captured_at));
        let usable_backup = cached_usable_frame
            .map(|img| (img, std::time::Instant::now()))
            .or(last_usable_backup);
        let has_usable_cached_frame = usable_backup.is_some();
        let mut seq_seen = pc.frame_seq.load(std::sync::atomic::Ordering::Acquire);
        let deadline = std::time::Instant::now() + wgc_frame_wait_timeout(has_usable_cached_frame);
        let mut frames_seen = 0u32;
        let mut black_frames = 0u32;
        let mut chosen: Option<RgbImage> = None;
        let mut latest_black_frame: Option<RgbImage> = None;

        loop {
            let seq_now = pc.frame_seq.load(std::sync::atomic::Ordering::Acquire);
            if seq_now != seq_seen {
                // Only process genuinely new frames so a lingering black frame
                // is not recounted every iteration.
                seq_seen = seq_now;
                if let Ok(slot) = pc.latest.lock() {
                    if let Some(ref img) = *slot {
                        frames_seen += 1;
                        let candidate_has_video_hole = crop_rect
                            .as_ref()
                            .map(|crop| frame_has_suspicious_black_video_hole(&crop_rgb(img, crop)))
                            .unwrap_or_else(|| frame_has_suspicious_black_video_hole(img));

                        if frame_is_mostly_black(img) || candidate_has_video_hole {
                            black_frames += 1;
                            latest_black_frame = Some(img.clone());
                        } else {
                            pc.last_usable = Some((img.clone(), std::time::Instant::now()));
                            chosen = Some(img.clone());
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

        // Prefer a fresh non-black frame. If WGC only produces suspicious
        // hardware-video black frames during this call, reuse a recent known
        // good full-screen frame before accepting the black frame. This avoids
        // the observed intermittent pattern where the video plane is black but
        // page UI / subtitles / controls are still visible.
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
            Some(img) => img,
            None => {
                if diag {
                    crate::append_runtime_log_line(
                        "capture_area fast_fail :: reason=no_frame_persistent",
                    );
                }
                // Drop the capturer so the next call rebuilds a clean session.
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

// --- Public API ---

#[cfg(target_os = "windows")]
struct CapturePlan {
    display: Display,
    display_id: scap_targets::DisplayId,
    crop: D3D11_BOX,
    physical_origin_x: i32,
    physical_origin_y: i32,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, PartialEq)]
struct CaptureDisplayGeometry {
    physical_origin_x: i32,
    physical_origin_y: i32,
    physical_width: u32,
    physical_height: u32,
    logical_width: f64,
    logical_height: f64,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LocalPhysicalCaptureRect {
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
}

#[cfg(target_os = "windows")]
fn capture_display_geometry(display: &Display) -> Option<CaptureDisplayGeometry> {
    let physical_bounds = display.raw_handle().physical_bounds()?;
    let physical_position = physical_bounds.position();
    let physical_size = physical_bounds.size();
    let logical_size = display.logical_size()?;
    if physical_size.width() <= 0.0
        || physical_size.height() <= 0.0
        || logical_size.width() <= 0.0
        || logical_size.height() <= 0.0
    {
        return None;
    }

    Some(CaptureDisplayGeometry {
        physical_origin_x: physical_position.x().round() as i32,
        physical_origin_y: physical_position.y().round() as i32,
        physical_width: physical_size.width().round() as u32,
        physical_height: physical_size.height().round() as u32,
        logical_width: logical_size.width(),
        logical_height: logical_size.height(),
    })
}

#[cfg(target_os = "windows")]
fn capture_display_matches_metrics(
    geometry: CaptureDisplayGeometry,
    metrics: CaptureWindowMetrics,
) -> bool {
    let expected_width = metrics.logical_width * metrics.scale_factor;
    let expected_height = metrics.logical_height * metrics.scale_factor;
    (geometry.physical_origin_x as f64 - metrics.physical_origin_x).abs() <= 1.0
        && (geometry.physical_origin_y as f64 - metrics.physical_origin_y).abs() <= 1.0
        && (geometry.physical_width as f64 - expected_width).abs() <= 2.0
        && (geometry.physical_height as f64 - expected_height).abs() <= 2.0
}

#[cfg(target_os = "windows")]
fn select_capture_display_geometry_index(
    metrics: CaptureWindowMetrics,
    geometries: &[CaptureDisplayGeometry],
) -> Option<usize> {
    geometries
        .iter()
        .position(|geometry| capture_display_matches_metrics(*geometry, metrics))
        .or_else(|| {
            let expected_width = metrics.logical_width * metrics.scale_factor;
            let expected_height = metrics.logical_height * metrics.scale_factor;
            let center_x = metrics.physical_origin_x + expected_width / 2.0;
            let center_y = metrics.physical_origin_y + expected_height / 2.0;
            geometries.iter().position(|geometry| {
                center_x >= geometry.physical_origin_x as f64
                    && center_x < geometry.physical_origin_x as f64 + geometry.physical_width as f64
                    && center_y >= geometry.physical_origin_y as f64
                    && center_y
                        < geometry.physical_origin_y as f64 + geometry.physical_height as f64
            })
        })
}

#[cfg(target_os = "windows")]
fn local_logical_capture_rect_to_physical(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    geometry: CaptureDisplayGeometry,
) -> Option<LocalPhysicalCaptureRect> {
    if w == 0 || h == 0 || geometry.logical_width <= 0.0 || geometry.logical_height <= 0.0 {
        return None;
    }

    let scale_x = geometry.physical_width as f64 / geometry.logical_width;
    let scale_y = geometry.physical_height as f64 / geometry.logical_height;
    let left = (x as f64 * scale_x).floor();
    let top = (y as f64 * scale_y).floor();
    let right = (left + w as f64 * scale_x).ceil();
    let bottom = (top + h as f64 * scale_y).ceil();
    let left = left.max(0.0).min(geometry.physical_width as f64) as u32;
    let top = top.max(0.0).min(geometry.physical_height as f64) as u32;
    let right = right.max(left as f64).min(geometry.physical_width as f64) as u32;
    let bottom = bottom.max(top as f64).min(geometry.physical_height as f64) as u32;
    (right > left && bottom > top).then_some(LocalPhysicalCaptureRect {
        left,
        top,
        right,
        bottom,
    })
}

#[cfg(target_os = "windows")]
fn capture_display_for_metrics(
    metrics: Option<CaptureWindowMetrics>,
) -> anyhow::Result<(Display, CaptureDisplayGeometry)> {
    if let Some(metrics) = metrics {
        let candidates = Display::list()
            .into_iter()
            .filter_map(|display| {
                capture_display_geometry(&display).map(|geometry| (display, geometry))
            })
            .collect::<Vec<_>>();
        let geometries = candidates
            .iter()
            .map(|(_, geometry)| *geometry)
            .collect::<Vec<_>>();
        let index = select_capture_display_geometry_index(metrics, &geometries)
            .ok_or_else(|| anyhow!("Capture display no longer matches the active monitor"))?;
        return Ok(candidates[index]);
    }

    let display = Display::primary();
    let geometry = capture_display_geometry(&display)
        .ok_or_else(|| anyhow!("Primary display geometry is unavailable"))?;
    Ok((display, geometry))
}

#[cfg(target_os = "windows")]
struct SdrCaptureResult {
    image: RgbImage,
    backend: CaptureBackend,
}

#[cfg(target_os = "windows")]
fn capture_plan(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: Option<CaptureWindowMetrics>,
) -> anyhow::Result<CapturePlan> {
    let verbose_log = capture_area_verbose_logging_enabled();
    if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area enter :: x={} y={} w={} h={}",
            x, y, w, h
        ));
    }

    let (display, geometry) = capture_display_for_metrics(display_metrics)?;
    let display_id = display.id();
    if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area display :: id={} origin={},{} logical={}x{} physical={}x{} scale={}x{}",
            display_id,
            geometry.physical_origin_x,
            geometry.physical_origin_y,
            geometry.logical_width,
            geometry.logical_height,
            geometry.physical_width,
            geometry.physical_height,
            geometry.physical_width as f64 / geometry.logical_width,
            geometry.physical_height as f64 / geometry.logical_height,
        ));
    }

    let physical_rect = local_logical_capture_rect_to_physical(x, y, w, h, geometry)
        .ok_or_else(|| anyhow!("Capture rectangle is outside the target display"))?;
    let crop = D3D11_BOX {
        left: physical_rect.left,
        top: physical_rect.top,
        right: physical_rect.right,
        bottom: physical_rect.bottom,
        front: 0,
        back: 1,
    };
    if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area crop :: left={} top={} right={} bottom={}",
            crop.left, crop.top, crop.right, crop.bottom
        ));
    }

    Ok(CapturePlan {
        display,
        display_id,
        crop,
        physical_origin_x: geometry.physical_origin_x,
        physical_origin_y: geometry.physical_origin_y,
    })
}

#[cfg(target_os = "windows")]
fn capture_sdr_from_plan(
    plan: &CapturePlan,
    profile: CaptureWorkloadProfile,
) -> anyhow::Result<SdrCaptureResult> {
    let verbose_log = capture_area_verbose_logging_enabled();
    let backend_mode = capture_backend_mode();
    if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area dispatch :: mode={} profile={:?}",
            backend_mode, profile
        ));
    }
    if backend_mode == "auto" {
        if let Some(image) = try_fast_capture(plan.display_id.clone(), Some(plan.crop), profile) {
            wgc_note_success();
            if verbose_log {
                crate::append_runtime_log_line(&format!(
                    "capture_area fast_success :: width={} height={}",
                    image.width(),
                    image.height()
                ));
            }
            return Ok(SdrCaptureResult {
                image,
                backend: CaptureBackend::WgcSdr,
            });
        }
        wgc_note_failure();
        if verbose_log {
            crate::append_runtime_log_line("capture_area fast_path_none :: falling_back_to_gdi");
        }
    } else if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area fast_path_skipped :: mode={}",
            backend_mode
        ));
    }

    let width = plan.crop.right - plan.crop.left;
    let height = plan.crop.bottom - plan.crop.top;
    let image = capture_area_gdi(
        plan.physical_origin_x + plan.crop.left as i32,
        plan.physical_origin_y + plan.crop.top as i32,
        width as i32,
        height as i32,
    )?;
    if verbose_log {
        crate::append_runtime_log_line(&format!(
            "capture_area gdi_capture_success :: width={} height={}",
            image.width(),
            image.height()
        ));
    }
    Ok(SdrCaptureResult {
        image,
        backend: CaptureBackend::Gdi,
    })
}

pub fn capture_area_with_profile(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    profile: CaptureWorkloadProfile,
) -> anyhow::Result<RgbImage> {
    #[cfg(target_os = "windows")]
    {
        let plan = capture_plan(x, y, w, h, None)?;
        return capture_sdr_from_plan(&plan, profile).map(|result| result.image);
    }

    #[cfg(not(target_os = "windows"))]
    Err(anyhow!("Only Windows is supported"))
}

pub fn capture_region_with_dynamic_range(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    display_metrics: Option<CaptureWindowMetrics>,
    overlay_gain: f32,
) -> anyhow::Result<DynamicCaptureResult> {
    #[cfg(target_os = "windows")]
    {
        let profile = CaptureWorkloadProfile::StandardRegion;
        let plan = capture_plan(x, y, w, h, display_metrics)?;
        let mode = hdr_capture_mode();
        let display_info = hdr_display_info_for(&plan.display).unwrap_or(HdrDisplayInfo {
            enabled: false,
            sdr_white_level_nits: 203.0,
            min_luminance_nits: 0.0,
            max_luminance_nits: 1_000.0,
        });
        let windows_11_or_newer = scap_direct3d::WindowsVersion::detect()
            .map(|version| version.is_windows_11())
            .unwrap_or(false);
        let attempt_hdr =
            should_attempt_hdr_capture(mode, profile, windows_11_or_newer, display_info.enabled);

        if attempt_hdr {
            crate::append_runtime_log_line(&format!(
                "capture_area hdr_attempt :: mode={mode:?} sdr_white_nits={} max_luminance_nits={}",
                display_info.sdr_white_level_nits, display_info.max_luminance_nits
            ));
            if let Some(frame) = try_hdr_capture_transient(
                plan.display_id.clone(),
                plan.crop,
                display_info,
                mode,
                overlay_gain,
            ) {
                wgc_note_success();
                return Ok(match frame {
                    HdrFrameDecision::Hdr(image) => DynamicCaptureResult {
                        pixels: DynamicCapturePixels::Hdr(image),
                        backend: CaptureBackend::WgcHdr,
                        downgraded_from_hdr: false,
                        overlay_compensated: true,
                    },
                    HdrFrameDecision::Sdr(image) => DynamicCaptureResult {
                        pixels: DynamicCapturePixels::Sdr(image),
                        backend: CaptureBackend::WgcHdr,
                        downgraded_from_hdr: true,
                        overlay_compensated: true,
                    },
                });
            }
            crate::append_runtime_log_line(
                "capture_area hdr_failed :: falling_back_to_sdr_wgc_then_gdi",
            );
        }

        let sdr = capture_sdr_from_plan(&plan, profile)?;
        let downgraded_from_hdr = should_report_hdr_downgrade_on_sdr_fallback(
            mode,
            attempt_hdr,
            display_info.enabled,
            windows_11_or_newer,
        );
        return Ok(DynamicCaptureResult {
            pixels: DynamicCapturePixels::Sdr(sdr.image),
            backend: sdr.backend,
            downgraded_from_hdr,
            overlay_compensated: false,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let image = capture_area_with_profile(x, y, w, h, CaptureWorkloadProfile::StandardRegion)?;
        let _ = (display_metrics, overlay_gain);
        Ok(DynamicCaptureResult {
            pixels: DynamicCapturePixels::Sdr(image),
            backend: CaptureBackend::Gdi,
            downgraded_from_hdr: false,
            overlay_compensated: false,
        })
    }
}

#[allow(dead_code)]
pub fn capture_area(x: i32, y: i32, w: u32, h: u32) -> anyhow::Result<RgbImage> {
    capture_area_with_profile(x, y, w, h, CaptureWorkloadProfile::StandardRegion)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wgc_fast_path_mode_env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .expect("wgc fast path env lock should not be poisoned")
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn selects_the_display_matching_negative_origin_and_mixed_dpi_metrics() {
        let geometries = [
            CaptureDisplayGeometry {
                physical_origin_x: 0,
                physical_origin_y: 0,
                physical_width: 1920,
                physical_height: 1080,
                logical_width: 1920.0,
                logical_height: 1080.0,
            },
            CaptureDisplayGeometry {
                physical_origin_x: -2560,
                physical_origin_y: -200,
                physical_width: 2560,
                physical_height: 1440,
                logical_width: 2560.0 / 1.5,
                logical_height: 960.0,
            },
        ];
        let metrics = CaptureWindowMetrics {
            physical_origin_x: -2560.0,
            physical_origin_y: -200.0,
            scale_factor: 1.5,
            logical_width: 2560.0 / 1.5,
            logical_height: 960.0,
        };

        assert_eq!(
            select_capture_display_geometry_index(metrics, &geometries),
            Some(1),
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn display_selection_distinguishes_identical_monitors_by_virtual_desktop_origin() {
        let geometries = [
            CaptureDisplayGeometry {
                physical_origin_x: 0,
                physical_origin_y: 0,
                physical_width: 1920,
                physical_height: 1080,
                logical_width: 1536.0,
                logical_height: 864.0,
            },
            CaptureDisplayGeometry {
                physical_origin_x: 1920,
                physical_origin_y: 0,
                physical_width: 1920,
                physical_height: 1080,
                logical_width: 1536.0,
                logical_height: 864.0,
            },
        ];
        let metrics = CaptureWindowMetrics {
            physical_origin_x: 1920.0,
            physical_origin_y: 0.0,
            scale_factor: 1.25,
            logical_width: 1536.0,
            logical_height: 864.0,
        };

        assert_eq!(
            select_capture_display_geometry_index(metrics, &geometries),
            Some(1),
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn display_selection_falls_back_to_the_monitor_containing_the_reported_center() {
        let geometries = [
            CaptureDisplayGeometry {
                physical_origin_x: 0,
                physical_origin_y: 0,
                physical_width: 1920,
                physical_height: 1080,
                logical_width: 1920.0,
                logical_height: 1080.0,
            },
            CaptureDisplayGeometry {
                physical_origin_x: 1920,
                physical_origin_y: -100,
                physical_width: 2560,
                physical_height: 1440,
                logical_width: 2048.0,
                logical_height: 1152.0,
            },
        ];
        let slightly_rounded_metrics = CaptureWindowMetrics {
            physical_origin_x: 1917.0,
            physical_origin_y: -98.0,
            scale_factor: 1.25,
            logical_width: 2046.0,
            logical_height: 1150.0,
        };

        assert_eq!(
            select_capture_display_geometry_index(slightly_rounded_metrics, &geometries),
            Some(1),
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn converts_local_logical_capture_rect_using_the_selected_display_scale() {
        let geometry = CaptureDisplayGeometry {
            physical_origin_x: -2560,
            physical_origin_y: -200,
            physical_width: 2560,
            physical_height: 1440,
            logical_width: 2560.0 / 1.5,
            logical_height: 960.0,
        };

        let rect = local_logical_capture_rect_to_physical(100, 50, 400, 200, geometry)
            .expect("capture rect should intersect the selected display");
        assert_eq!(
            rect,
            LocalPhysicalCaptureRect {
                left: 150,
                top: 75,
                right: 750,
                bottom: 375,
            },
        );
        assert_eq!(geometry.physical_origin_x + rect.left as i32, -2410);
        assert_eq!(geometry.physical_origin_y + rect.top as i32, -125);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn live_display_metrics_resolve_back_to_the_same_capture_display() {
        let mut resolved_count = 0usize;
        for expected_display in Display::list() {
            let Some(geometry) = capture_display_geometry(&expected_display) else {
                continue;
            };
            let scale_factor = geometry.physical_width as f64 / geometry.logical_width;
            let metrics = CaptureWindowMetrics {
                physical_origin_x: geometry.physical_origin_x as f64,
                physical_origin_y: geometry.physical_origin_y as f64,
                scale_factor,
                logical_width: geometry.physical_width as f64 / scale_factor,
                logical_height: geometry.physical_height as f64 / scale_factor,
            };

            let (resolved_display, resolved_geometry) = capture_display_for_metrics(Some(metrics))
                .expect("live display metrics should resolve to a capture display");
            assert_eq!(resolved_display.id(), expected_display.id());
            assert_eq!(resolved_geometry, geometry);
            let plan = capture_plan(0, 0, 100, 100, Some(metrics))
                .expect("capture plan should use the resolved live display");
            assert_eq!(plan.display_id, expected_display.id());
            assert_eq!(plan.physical_origin_x, geometry.physical_origin_x);
            assert_eq!(plan.physical_origin_y, geometry.physical_origin_y);
            resolved_count += 1;
        }
        assert!(
            resolved_count > 0,
            "at least one capture display should resolve"
        );
    }

    #[test]
    fn capture_area_verbose_logging_is_opt_in() {
        assert!(!capture_area_verbose_logging_enabled_for(None));
        assert!(!capture_area_verbose_logging_enabled_for(Some("")));
        assert!(!capture_area_verbose_logging_enabled_for(Some("0")));
        assert!(!capture_area_verbose_logging_enabled_for(Some("false")));
        assert!(capture_area_verbose_logging_enabled_for(Some("1")));
        assert!(capture_area_verbose_logging_enabled_for(Some("true")));
        assert!(capture_area_verbose_logging_enabled_for(Some("yes")));
    }

    #[test]
    #[cfg(not(feature = "diag_capture"))]
    fn capture_area_verbose_logging_is_not_forced_in_normal_builds() {
        std::env::remove_var("HOOK_CAPTURE_AREA_VERBOSE_LOG");

        assert!(!capture_area_verbose_logging_enabled());
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn dynamic_range_mode_defaults_to_auto_and_accepts_explicit_overrides() {
        assert_eq!(hdr_capture_mode_for(None), HdrCaptureMode::Auto);
        assert_eq!(hdr_capture_mode_for(Some("")), HdrCaptureMode::Auto);
        assert_eq!(
            hdr_capture_mode_for(Some("unexpected")),
            HdrCaptureMode::Auto
        );
        assert_eq!(hdr_capture_mode_for(Some(" HDR ")), HdrCaptureMode::Hdr);
        assert_eq!(hdr_capture_mode_for(Some("sdr")), HdrCaptureMode::Sdr);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn hdr_is_transient_region_only_and_requires_windows_11_with_hdr_enabled() {
        assert!(should_attempt_hdr_capture(
            HdrCaptureMode::Auto,
            CaptureWorkloadProfile::StandardRegion,
            true,
            true,
        ));
        assert!(!should_attempt_hdr_capture(
            HdrCaptureMode::Auto,
            CaptureWorkloadProfile::LongCapture,
            true,
            true,
        ));
        assert!(!should_attempt_hdr_capture(
            HdrCaptureMode::Auto,
            CaptureWorkloadProfile::StandardRegion,
            false,
            true,
        ));
        assert!(!should_attempt_hdr_capture(
            HdrCaptureMode::Sdr,
            CaptureWorkloadProfile::StandardRegion,
            true,
            true,
        ));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn hdr_downgrade_metadata_tracks_the_selected_display_fallback_reason() {
        assert!(should_report_hdr_downgrade_on_sdr_fallback(
            HdrCaptureMode::Auto,
            true,
            true,
            true,
        ));
        assert!(should_report_hdr_downgrade_on_sdr_fallback(
            HdrCaptureMode::Hdr,
            false,
            false,
            true,
        ));
        assert!(should_report_hdr_downgrade_on_sdr_fallback(
            HdrCaptureMode::Auto,
            false,
            true,
            false,
        ));
        assert!(!should_report_hdr_downgrade_on_sdr_fallback(
            HdrCaptureMode::Auto,
            false,
            false,
            true,
        ));
        assert!(!should_report_hdr_downgrade_on_sdr_fallback(
            HdrCaptureMode::Sdr,
            false,
            true,
            false,
        ));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn hdr_content_detection_uses_the_windows_sdr_white_level() {
        assert!(!content_exceeds_sdr_white(205.0, 203.0));
        assert!(content_exceeds_sdr_white(209.0, 203.0));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn primary_display_hdr_probe_returns_sane_values_when_available() {
        if let Some(info) = hdr_display_info_for(&Display::primary()) {
            println!(
                "primary display HDR probe: enabled={} sdr_white={} min={} max={}",
                info.enabled,
                info.sdr_white_level_nits,
                info.min_luminance_nits,
                info.max_luminance_nits,
            );
            assert!(info.sdr_white_level_nits.is_finite());
            assert!(info.sdr_white_level_nits >= 80.0);
            assert!(info.min_luminance_nits.is_finite());
            assert!(info.max_luminance_nits.is_finite());
            assert!(info.max_luminance_nits >= 1.0);
        }
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn pq_encoding_matches_reference_luminance_points() {
        assert!((pq_oetf_from_nits(100.0) - 0.508).abs() < 0.002);
        assert!((pq_oetf_from_nits(1_000.0) - 0.752).abs() < 0.002);
        assert!((pq_oetf_from_nits(10_000.0) - 1.0).abs() < 0.0001);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn scrgb_float_pixels_convert_to_real_16_bit_bt2020_pq_payload() {
        let mut data = Vec::new();
        for value in [12.5f32, 0.0, 0.0, 1.0] {
            data.extend_from_slice(&f16::from_f32(value).to_le_bytes());
        }
        let analysis =
            analyze_scrgb_buffer(&data, 1, 1, 8, 1.0).expect("scRGB analysis should succeed");
        assert!(analysis.max_content_light_level_nits > 200.0);

        let image = scrgb_buffer_to_hdr_pq(
            &data,
            1,
            1,
            8,
            analysis,
            HdrDisplayInfo {
                enabled: true,
                sdr_white_level_nits: 203.0,
                min_luminance_nits: 0.001,
                max_luminance_nits: 1_000.0,
            },
            1.0,
        )
        .expect("HDR conversion should succeed");
        assert_eq!(image.rgb16_be.len(), 6);
        assert_ne!(image.rgb16_be, vec![0; 6]);
        assert_eq!(image.width, 1);
        assert_eq!(image.height, 1);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn sdr_only_float_capture_maps_system_sdr_white_to_srgb_white() {
        let mut data = Vec::new();
        let scrgb_sdr_white = 203.0 / 80.0;
        for value in [scrgb_sdr_white, scrgb_sdr_white, scrgb_sdr_white, 1.0] {
            data.extend_from_slice(&f16::from_f32(value).to_le_bytes());
        }

        let image = scrgb_buffer_to_sdr_rgb(&data, 1, 1, 8, 203.0, 1.0)
            .expect("SDR conversion should succeed");
        assert_eq!(image.get_pixel(0, 0).0, [255, 255, 255]);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn auto_wgc_mode_defaults_to_transient_for_both_standard_and_long_capture() {
        let _lock = wgc_fast_path_mode_env_lock();
        std::env::remove_var("HOOK_WGC_FAST_PATH_MODE");

        assert!(!should_use_persistent_wgc(
            CaptureWorkloadProfile::StandardRegion
        ));
        assert!(!should_use_persistent_wgc(
            CaptureWorkloadProfile::LongCapture
        ));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn explicit_persistent_override_enables_persistent_wgc_for_every_capture_profile() {
        let _lock = wgc_fast_path_mode_env_lock();
        std::env::set_var("HOOK_WGC_FAST_PATH_MODE", "persistent");

        assert!(should_use_persistent_wgc(
            CaptureWorkloadProfile::StandardRegion
        ));
        assert!(should_use_persistent_wgc(
            CaptureWorkloadProfile::LongCapture
        ));

        std::env::remove_var("HOOK_WGC_FAST_PATH_MODE");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn explicit_transient_override_disables_persistent_wgc_for_every_capture_profile() {
        let _lock = wgc_fast_path_mode_env_lock();
        std::env::set_var("HOOK_WGC_FAST_PATH_MODE", "transient");

        assert!(!should_use_persistent_wgc(
            CaptureWorkloadProfile::StandardRegion
        ));
        assert!(!should_use_persistent_wgc(
            CaptureWorkloadProfile::LongCapture
        ));

        std::env::remove_var("HOOK_WGC_FAST_PATH_MODE");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn wgc_uses_short_refresh_timeout_when_a_usable_cached_frame_exists() {
        assert!(
            wgc_frame_wait_timeout(true) < wgc_frame_wait_timeout(false),
            "cached WGC frames should not make static-screen captures wait for the full initial frame timeout"
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn detects_black_video_hole_with_bright_controls_as_suspicious() {
        let mut image = RgbImage::new(320, 220);
        for y in 0..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([0, 0, 0]));
            }
        }
        for y in 190..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([238, 238, 238]));
            }
        }
        for y in 10..30 {
            for x in 220..310 {
                image.put_pixel(x, y, image::Rgb([230, 230, 230]));
            }
        }

        assert!(frame_has_suspicious_black_video_hole(&image));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn detects_black_video_hole_even_when_some_overlay_text_reduces_black_ratio() {
        let mut image = RgbImage::new(320, 220);
        for y in 0..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([0, 0, 0]));
            }
        }
        // Bilibili-style page/player text can reduce the sampled black ratio to
        // about 90%, while the video plane is still clearly a black hole.
        for y in 30..45 {
            for x in 40..280 {
                image.put_pixel(x, y, image::Rgb([210, 210, 210]));
            }
        }
        for y in 190..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([238, 238, 238]));
            }
        }

        assert!(frame_has_suspicious_black_video_hole(&image));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn suspicious_black_video_hole_is_not_a_usable_cached_wgc_frame() {
        let mut image = RgbImage::new(320, 220);
        for y in 0..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([0, 0, 0]));
            }
        }
        for y in 190..220 {
            for x in 0..320 {
                image.put_pixel(x, y, image::Rgb([238, 238, 238]));
            }
        }

        assert!(!wgc_cached_frame_is_usable(&image, None));
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn wgc_timeout_fallback_prefers_recent_usable_backup_over_suspicious_frame() {
        let suspicious = RgbImage::from_pixel(2, 1, image::Rgb([0, 0, 0]));
        let recent_usable = RgbImage::from_pixel(2, 1, image::Rgb([20, 80, 160]));
        let selected = select_wgc_timeout_fallback_frame(
            Some(suspicious),
            Some((recent_usable, std::time::Instant::now())),
        )
        .expect("recent usable backup should be selected");

        assert_eq!(selected.get_pixel(0, 0).0, [20, 80, 160]);
    }
}
