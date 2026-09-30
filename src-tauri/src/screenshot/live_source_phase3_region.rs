use windows::Win32::Foundation::{HWND, POINT, RECT};

pub(super) fn client_region(hwnd: HWND) -> crate::LiveCapturePhysicalRegion {
    let _dpi_context = crate::enter_live_source_dpi_context(hwnd).expect("source DPI context");
    let mut bounds = RECT::default();
    if unsafe {
        windows::Win32::Graphics::Dwm::DwmGetWindowAttribute(
            hwnd,
            windows::Win32::Graphics::Dwm::DWMWA_EXTENDED_FRAME_BOUNDS,
            (&raw mut bounds).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
    }
    .is_err()
    {
        unsafe { windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut bounds) }
            .expect("source bounds");
    }
    let mut client = RECT::default();
    unsafe { windows::Win32::UI::WindowsAndMessaging::GetClientRect(hwnd, &mut client) }
        .expect("source client bounds");
    let mut origin = POINT::default();
    let mut extent = POINT {
        x: client.right,
        y: client.bottom,
    };
    for point in [&mut origin, &mut extent] {
        assert!(unsafe { windows::Win32::Graphics::Gdi::ClientToScreen(hwnd, point) }.as_bool());
        assert!(unsafe {
            windows::Win32::UI::HiDpi::LogicalToPhysicalPointForPerMonitorDPI(Some(hwnd), point)
        }
        .as_bool());
    }
    crate::LiveCapturePhysicalRegion {
        left: (origin.x - bounds.left).max(0) as u32,
        top: (origin.y - bounds.top).max(0) as u32,
        width: (extent.x - origin.x).max(1) as u32,
        height: (extent.y - origin.y).max(1) as u32,
    }
}
