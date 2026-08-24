use image::RgbImage;

#[cfg(target_os = "windows")]
use anyhow::anyhow;
#[cfg(target_os = "windows")]
use scap_direct3d::{Frame, PixelFormat};

#[cfg(target_os = "windows")]
use super::hdr_analysis::{
    analyze_scrgb_buffer, content_exceeds_sdr_white, read_scrgb_pixel, HdrCaptureMode,
    HdrDisplayInfo, HdrFrameAnalysis,
};

/// HDR pixels and luminance metadata ready for 16-bit BT.2020 PQ encoding.
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

#[cfg(target_os = "windows")]
pub(super) enum HdrFrameDecision {
    Sdr(RgbImage),
    Hdr(HdrPqImage),
}

#[derive(Clone, Copy)]
pub(super) enum ChannelOrder {
    Rgba,
    Bgra,
}

pub(super) fn rgb_from_rgba(
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
fn srgb_oetf(linear: f32) -> f32 {
    let linear = linear.clamp(0.0, 1.0);
    if linear <= 0.003_130_8 {
        12.92 * linear
    } else {
        1.055 * linear.powf(1.0 / 2.4) - 0.055
    }
}

#[cfg(target_os = "windows")]
pub(super) fn scrgb_buffer_to_sdr_rgb(
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
pub(super) fn pq_oetf_from_nits(nits: f32) -> f32 {
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
pub(super) fn scrgb_buffer_to_hdr_pq(
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
pub(super) fn frame_to_hdr_decision(
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
pub(super) fn frame_to_rgb(frame: &Frame) -> anyhow::Result<RgbImage> {
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
