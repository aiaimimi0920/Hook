use scap_targets::Display;
use windows::core::Interface;
use windows::Win32::Devices::Display::{
    DisplayConfigGetDeviceInfo, GetDisplayConfigBufferSizes, QueryDisplayConfig,
    DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO,
    DISPLAYCONFIG_DEVICE_INFO_GET_SDR_WHITE_LEVEL, DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME,
    DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO,
    DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO, DISPLAYCONFIG_SDR_WHITE_LEVEL,
    DISPLAYCONFIG_SOURCE_DEVICE_NAME, QDC_ONLY_ACTIVE_PATHS,
};
use windows::Win32::Graphics::Dxgi::Common::{
    DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020, DXGI_COLOR_SPACE_RGB_STUDIO_G2084_NONE_P2020,
};
use windows::Win32::Graphics::Dxgi::{
    CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput6, DXGI_OUTPUT_DESC1,
};

use super::hdr_analysis::HdrDisplayInfo;

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

/// Reads the active Windows HDR flag and the system SDR white level for a display.
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

pub(super) fn hdr_display_info_for(display: &Display) -> Option<HdrDisplayInfo> {
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
