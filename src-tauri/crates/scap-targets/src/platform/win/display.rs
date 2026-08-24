// Owns monitor enumeration, DPI geometry, identity, naming, and capture-item conversion.

#[derive(Clone, Copy)]
pub struct DisplayImpl(HMONITOR);

unsafe impl Send for DisplayImpl {}

impl DisplayImpl {
    pub fn primary() -> Self {
        // Find the primary monitor by checking the MONITORINFOF_PRIMARY flag
        const MONITORINFOF_PRIMARY: u32 = 1u32;

        for display in Self::list() {
            let mut info = MONITORINFOEXW::default();
            info.monitorInfo.cbSize = mem::size_of::<MONITORINFOEXW>() as u32;

            unsafe {
                if GetMonitorInfoW(display.0, &mut info as *mut _ as *mut _).as_bool()
                    && (info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY) != 0
                {
                    return display;
                }
            }
        }

        // Fallback to the old method if no primary monitor is found
        let point = POINT { x: 0, y: 0 };
        let monitor = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST) };
        Self(monitor)
    }

    pub fn list() -> Vec<Self> {
        unsafe extern "system" fn monitor_enum_proc(
            hmonitor: HMONITOR,
            _hdc: HDC,
            _lprc_clip: *mut RECT,
            lparam: LPARAM,
        ) -> BOOL {
            let list = unsafe { &mut *(lparam.0 as *mut Vec<DisplayImpl>) };
            list.push(DisplayImpl(hmonitor));
            TRUE
        }

        let mut list = vec![];
        unsafe {
            let _ = EnumDisplayMonitors(
                None,
                None,
                Some(monitor_enum_proc),
                LPARAM(std::ptr::addr_of_mut!(list) as isize),
            );
        }

        list
    }

    pub fn inner(&self) -> HMONITOR {
        self.0
    }

    pub fn raw_id(&self) -> DisplayIdImpl {
        DisplayIdImpl(self.0.0 as u64)
    }

    pub fn from_id(id: String) -> Option<Self> {
        let parsed_id = id.parse::<u64>().ok()?;
        Self::list().into_iter().find(|d| d.raw_id().0 == parsed_id)
    }

    pub fn logical_size(&self) -> Option<LogicalSize> {
        let physical_size = self.physical_size()?;

        let dpi = unsafe {
            let mut dpi_x = 0;
            GetDpiForMonitor(self.0, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut 0).ok()?;
            dpi_x
        };

        let scale = (dpi > 0).then_some(dpi as f64 / 96.0)?;

        Some(LogicalSize::new(
            physical_size.width() / scale,
            physical_size.height() / scale,
        ))
    }

    pub fn logical_bounds(&self) -> Option<LogicalBounds> {
        let physical_bounds = self.physical_bounds()?;

        let dpi = unsafe {
            let mut dpi_x = 0;
            GetDpiForMonitor(self.0, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut 0).ok()?;
            dpi_x
        };

        let scale = (dpi > 0).then_some(dpi as f64 / 96.0)?;

        Some(LogicalBounds::new(
            LogicalPosition::new(
                physical_bounds.position().x() / scale,
                physical_bounds.position().y() / scale,
            ),
            LogicalSize::new(
                physical_bounds.size().width() / scale,
                physical_bounds.size().height() / scale,
            ),
        ))
    }

    pub fn get_containing_cursor() -> Option<Self> {
        let cursor = get_cursor_position()?;
        let point = POINT {
            x: cursor.x() as i32,
            y: cursor.y() as i32,
        };

        let monitor = unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONULL) };
        if monitor.0 as usize != 0 {
            Some(Self(monitor))
        } else {
            None
        }
    }

    pub fn physical_bounds(&self) -> Option<PhysicalBounds> {
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = mem::size_of::<MONITORINFOEXW>() as u32;

        unsafe { GetMonitorInfoW(self.0, &mut info as *mut _ as *mut _) }
            .as_bool()
            .then(|| {
                let rect = info.monitorInfo.rcMonitor;
                let width = rect.right as f64 - rect.left as f64;
                let height = rect.bottom as f64 - rect.top as f64;
                (width > 0.0 && height > 0.0).then(|| PhysicalBounds::new(
                    PhysicalPosition::new(rect.left as f64, rect.top as f64),
                    PhysicalSize::new(width, height),
                ))
            })
            .flatten()
    }

    pub fn physical_position(&self) -> Option<PhysicalPosition> {
        Some(self.physical_bounds()?.position())
    }

    pub fn physical_size(&self) -> Option<PhysicalSize> {
        Some(self.physical_bounds()?.size())
    }

    pub fn refresh_rate(&self) -> f64 {
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = mem::size_of::<MONITORINFOEXW>() as u32;

        unsafe {
            if GetMonitorInfoW(self.0, &mut info as *mut _ as *mut _).as_bool() {
                let device_name = info.szDevice;
                let mut devmode = DEVMODEW {
                    dmSize: mem::size_of::<DEVMODEW>() as u16,
                    ..Default::default()
                };

                if EnumDisplaySettingsW(
                    PCWSTR(device_name.as_ptr()),
                    ENUM_CURRENT_SETTINGS,
                    &mut devmode,
                )
                .as_bool()
                {
                    devmode.dmDisplayFrequency as f64
                } else {
                    0.0
                }
            } else {
                0.0
            }
        }
    }

    pub fn name(&self) -> Option<String> {
        unsafe {
            let mut monitor_info = MONITORINFOEXW {
                monitorInfo: windows::Win32::Graphics::Gdi::MONITORINFO {
                    cbSize: mem::size_of::<MONITORINFOEXW>() as u32,
                    rcMonitor: RECT::default(),
                    rcWork: RECT::default(),
                    dwFlags: 0,
                },
                szDevice: [0; 32],
            };

            if GetMonitorInfoW(self.0, &mut monitor_info as *mut _ as *mut _).as_bool() {
                let device_name = PCWSTR::from_raw(monitor_info.szDevice.as_ptr());

                let mut display_device = DISPLAY_DEVICEW {
                    cb: mem::size_of::<DISPLAY_DEVICEW>() as u32,
                    DeviceName: [0; 32],
                    DeviceString: [0; 128],
                    StateFlags: DISPLAY_DEVICE_STATE_FLAGS(0),
                    DeviceID: [0; 128],
                    DeviceKey: [0; 128],
                };

                if EnumDisplayDevicesW(device_name, 0, &mut display_device, 0).as_bool() {
                    let device_string = display_device.DeviceString;
                    let len = device_string
                        .iter()
                        .position(|&x| x == 0)
                        .unwrap_or(device_string.len());

                    return Some(String::from_utf16_lossy(&device_string[..len]));
                }
            }
        }

        None
    }

    pub fn try_as_capture_item(&self) -> windows::core::Result<GraphicsCaptureItem> {
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        unsafe { interop.CreateForMonitor(self.0) }
    }
}
