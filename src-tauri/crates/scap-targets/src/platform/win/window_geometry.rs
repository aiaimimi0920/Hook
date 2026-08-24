// Owns window DPI geometry, display mapping, naming, validity, and capture conversion.

impl WindowImpl {
    fn checked_rect_dimensions(rect: RECT) -> Option<(f64, f64)> {
        let width = i64::from(rect.right).checked_sub(i64::from(rect.left))?;
        let height = i64::from(rect.bottom).checked_sub(i64::from(rect.top))?;
        (width > 0 && height > 0).then_some((width as f64, height as f64))
    }

    pub fn logical_size(&self) -> Option<LogicalSize> {
        let mut rect = RECT::default();

        unsafe {
            match GetProcessDpiAwareness(None) {
                Ok(PROCESS_PER_MONITOR_DPI_AWARE) => {}
                Err(e) => {
                    error!("Failed to get process DPI awareness: {e}");
                    return None;
                }
                Ok(v) => {
                    error!("Unsupported DPI awareness {v:?}");
                    return None;
                }
            }

            DwmGetWindowAttribute(
                self.0,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                (&raw mut rect).cast(),
                size_of::<RECT>() as u32,
            )
            .ok()?;

            const BASE_DPI: f64 = 96.0;
            let dpi = match GetDpiForWindow(self.0) {
                0 => BASE_DPI as u32,
                dpi => dpi,
            } as f64;
            let scale_factor = dpi / BASE_DPI;
            let (width, height) = Self::checked_rect_dimensions(rect)?;

            Some(LogicalSize {
                width: width / scale_factor,
                height: height / scale_factor,
            })
        }
    }

    pub fn physical_bounds(&self) -> Option<PhysicalBounds> {
        let mut rect = RECT::default();
        unsafe {
            match GetProcessDpiAwareness(None) {
                Ok(PROCESS_PER_MONITOR_DPI_AWARE) => {}
                Err(e) => {
                    error!("Failed to get process DPI awareness: {e}");
                    return None;
                }
                Ok(v) => {
                    error!("Unsupported DPI awareness {v:?}");
                    return None;
                }
            }

            DwmGetWindowAttribute(
                self.0,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                (&raw mut rect).cast(),
                size_of::<RECT>() as u32,
            )
            .ok()?;
            let (width, height) = Self::checked_rect_dimensions(rect)?;

            Some(PhysicalBounds {
                position: PhysicalPosition {
                    x: rect.left as f64,
                    y: rect.top as f64,
                },
                size: PhysicalSize {
                    width,
                    height,
                },
            })
        }
    }

    pub fn physical_size(&self) -> Option<PhysicalSize> {
        Some(self.physical_bounds()?.size())
    }

    pub fn physical_position(&self) -> Option<PhysicalPosition> {
        Some(self.physical_bounds()?.position())
    }

    pub fn display(&self) -> Option<DisplayImpl> {
        let hwmonitor = unsafe { MonitorFromWindow(self.0, MONITOR_DEFAULTTONULL) };
        if hwmonitor.is_invalid() {
            None
        } else {
            Some(DisplayImpl(hwmonitor))
        }
    }

    pub fn name(&self) -> Option<String> {
        let len = unsafe { GetWindowTextLengthW(self.0) };
        let capacity = usize::try_from(len).ok()?.checked_add(1)?;
        let mut name = vec![0u16; capacity];
        if len >= 1 {
            let copied = unsafe { GetWindowTextW(self.0, &mut name) };
            if copied == 0 {
                return Some(String::new());
            }
        }

        String::from_utf16(
            &name
                .as_slice()
                .iter()
                .take_while(|ch| **ch != 0x0000)
                .copied()
                .collect::<Vec<u16>>(),
        )
        .ok()
    }

    pub fn is_on_screen(&self) -> bool {
        if !unsafe { IsWindowVisible(self.0) }.as_bool() {
            return false;
        }

        let mut pvattribute_cloaked = 0u32;
        unsafe {
            DwmGetWindowAttribute(
                self.0,
                DWMWA_CLOAKED,
                &mut pvattribute_cloaked as *mut _ as *mut std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            )
        }
        .ok();

        if pvattribute_cloaked != 0 {
            return false;
        }

        let mut process_id = 0;
        unsafe { GetWindowThreadProcessId(self.0, Some(&mut process_id)) };

        let owner_process_path = match unsafe { pid_to_exe_path(process_id) } {
            Ok(path) => path,
            Err(_) => return false,
        };

        if owner_process_path.starts_with("C:\\Windows\\SystemApps") {
            return false;
        }

        true
    }

    pub fn is_valid(&self) -> bool {
        if !unsafe { IsWindowVisible(self.0).as_bool() } {
            return false;
        }

        let mut id = 0;
        unsafe { GetWindowThreadProcessId(self.0, Some(&mut id)) };
        if id == unsafe { GetCurrentProcessId() } {
            return false;
        }

        if let Ok(exe_path) = unsafe { pid_to_exe_path(id) }
            && let Some(exe_name) = exe_path.file_name().and_then(|n| n.to_str())
            && IGNORED_EXES.contains(&&*exe_name.to_lowercase())
        {
            return false;
        }

        let mut rect = RECT::default();
        let result = unsafe { GetClientRect(self.0, &mut rect) };
        if result.is_ok() {
            let styles = unsafe { GetWindowLongPtrW(self.0, GWL_STYLE) };
            let ex_styles = unsafe { GetWindowLongPtrW(self.0, GWL_EXSTYLE) };

            if (ex_styles & isize::try_from(WS_EX_TOOLWINDOW.0).unwrap()) != 0 {
                return false;
            }
            if (styles & isize::try_from(WS_CHILD.0).unwrap()) != 0 {
                return false;
            }
        } else {
            return false;
        }

        true
    }

    pub fn try_as_capture_item(&self) -> windows::core::Result<GraphicsCaptureItem> {
        let interop = windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        unsafe { interop.CreateForWindow(self.0) }
    }
}

#[cfg(test)]
mod geometry_tests {
    use super::WindowImpl;
    use windows::Win32::Foundation::RECT;

    #[test]
    fn window_rect_dimensions_reject_empty_or_reversed_bounds() {
        assert_eq!(
            WindowImpl::checked_rect_dimensions(RECT {
                left: -10,
                top: 20,
                right: 30,
                bottom: 70,
            }),
            Some((40.0, 50.0))
        );
        assert_eq!(
            WindowImpl::checked_rect_dimensions(RECT {
                left: 10,
                top: 10,
                right: 10,
                bottom: 20,
            }),
            None
        );
        assert_eq!(
            WindowImpl::checked_rect_dimensions(RECT {
                left: 20,
                top: 10,
                right: 10,
                bottom: 20,
            }),
            None
        );
    }
}
