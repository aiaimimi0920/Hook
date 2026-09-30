//! OS output identity and physical geometry. Never persist an HMONITOR handle.
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TileOutput {
    pub output_id: String,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

fn output_identity(interface: &str) -> String {
    format!(
        "monitor-{:x}",
        Sha256::digest(interface.to_lowercase().as_bytes())
    )
}

#[cfg(target_os = "windows")]
pub fn enumerate() -> Result<Vec<TileOutput>, String> {
    use std::mem::size_of;
    use windows::core::{BOOL, PCWSTR};
    use windows::Win32::Foundation::{LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayDevicesW, EnumDisplayMonitors, GetMonitorInfoW, DISPLAY_DEVICEW, HDC, HMONITOR,
        MONITORINFO, MONITORINFOEXW,
    };
    use windows::Win32::UI::HiDpi::{
        SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT,
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    use windows::Win32::UI::WindowsAndMessaging::EDD_GET_DEVICE_INTERFACE_NAME;

    struct DpiScope(DPI_AWARENESS_CONTEXT);
    impl Drop for DpiScope {
        fn drop(&mut self) {
            unsafe {
                SetThreadDpiAwarenessContext(self.0);
            }
        }
    }
    // CLI startup precedes Tauri's DPI setup. Scope the query so both paths return physical pixels.
    let prior = unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    if prior.0.is_null() {
        return Err("tile_physical_coordinates_unavailable".into());
    }
    let _dpi = DpiScope(prior);

    fn wide(value: &[u16]) -> String {
        String::from_utf16_lossy(
            &value[..value.iter().position(|c| *c == 0).unwrap_or(value.len())],
        )
    }
    unsafe extern "system" fn visit(monitor: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        // EnumDisplayMonitors calls synchronously; the context lives until it returns.
        let outputs = &mut *(data.0 as *mut Vec<TileOutput>);
        if outputs.len() >= 64 {
            return BOOL(0);
        }
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = size_of::<MONITORINFOEXW>() as u32;
        if !GetMonitorInfoW(monitor, &mut info as *mut _ as *mut MONITORINFO).as_bool() {
            return BOOL(1);
        }
        let mut device = DISPLAY_DEVICEW {
            cb: size_of::<DISPLAY_DEVICEW>() as u32,
            ..Default::default()
        };
        if !EnumDisplayDevicesW(
            PCWSTR(info.szDevice.as_ptr()),
            0,
            &mut device,
            EDD_GET_DEVICE_INTERFACE_NAME,
        )
        .as_bool()
        {
            return BOOL(1);
        }
        let interface = wide(&device.DeviceID);
        let r = info.monitorInfo.rcMonitor;
        let width = r.right.saturating_sub(r.left);
        let height = r.bottom.saturating_sub(r.top);
        // Unsupported/anonymous displays are omitted instead of receiving an unstable fake identity.
        if interface.is_empty() || !(1..=16384).contains(&width) || !(1..=16384).contains(&height) {
            return BOOL(1);
        }
        outputs.push(TileOutput {
            output_id: output_identity(&interface),
            name: format!("{} · {}", wide(&info.szDevice), wide(&device.DeviceString)),
            x: r.left,
            y: r.top,
            width: width as u32,
            height: height as u32,
        });
        BOOL(1)
    }
    let mut outputs: Vec<TileOutput> = Vec::new();
    let ok = unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(visit),
            LPARAM(&mut outputs as *mut _ as isize),
        )
    };
    if !ok.as_bool() {
        return Err("tile_output_enumeration_failed".into());
    }
    outputs.sort_by(|a, b| a.output_id.cmp(&b.output_id));
    if outputs.windows(2).any(|p| p[0].output_id == p[1].output_id) {
        return Err("tile_output_identity_ambiguous".into());
    }
    Ok(outputs)
}

#[cfg(not(target_os = "windows"))]
pub fn enumerate() -> Result<Vec<TileOutput>, String> {
    Err("tile_outputs_unsupported_platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "windows")]
    #[test]
    fn physical_output_query_does_not_leak_thread_dpi_context() {
        use windows::Win32::UI::HiDpi::{
            AreDpiAwarenessContextsEqual, GetThreadDpiAwarenessContext,
        };
        let before = unsafe { GetThreadDpiAwarenessContext() };
        let _outputs = enumerate();
        let after = unsafe { GetThreadDpiAwarenessContext() };
        assert!(unsafe { AreDpiAwarenessContextsEqual(before, after) }.as_bool());
    }
    #[test]
    fn identity_is_case_insensitive_and_never_exposes_the_os_path() {
        let id = output_identity(r"\\?\DISPLAY#ACME#instance1");
        assert_eq!(id, output_identity(r"\\?\display#acme#INSTANCE1"));
        assert_ne!(id, output_identity(r"\\?\display#acme#instance2"));
        assert_eq!(id.len(), 72);
        assert!(id[8..].bytes().all(|c| c.is_ascii_hexdigit()));
    }
}
