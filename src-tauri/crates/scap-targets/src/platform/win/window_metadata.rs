// Owns process metadata, version descriptions, and window icon source selection.

impl WindowImpl {
    pub fn owner_name(&self) -> Option<String> {
        unsafe {
            let mut process_id = 0u32;
            GetWindowThreadProcessId(self.0, Some(&mut process_id));

            if process_id == 0 {
                return None;
            }

            let process_handle =
                OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id).ok()?;

            let mut buffer = [0u16; 1024];
            let mut buffer_size = buffer.len() as u32;

            let result = QueryFullProcessImageNameW(
                process_handle,
                PROCESS_NAME_FORMAT::default(),
                PWSTR(buffer.as_mut_ptr()),
                &mut buffer_size,
            );

            let _ = CloseHandle(process_handle);

            if result.is_ok() && buffer_size > 0 {
                let path_str = String::from_utf16_lossy(&buffer[..buffer_size as usize]);

                // Try to get the friendly name from version info first
                if let Some(friendly_name) = self.get_file_description(&path_str) {
                    return Some(friendly_name);
                }

                // Fallback to file stem
                std::path::Path::new(&path_str)
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
            } else {
                None
            }
        }
    }

    fn get_file_description(&self, file_path: &str) -> Option<String> {
        unsafe {
            let wide_path: Vec<u16> = file_path.encode_utf16().chain(std::iter::once(0)).collect();

            let size = GetFileVersionInfoSizeW(PCWSTR(wide_path.as_ptr()), None);
            if size == 0 {
                return None;
            }

            let mut buffer = vec![0u8; size as usize];
            if GetFileVersionInfoW(
                PCWSTR(wide_path.as_ptr()),
                Some(0),
                size,
                buffer.as_mut_ptr() as *mut _,
            )
            .is_err()
            {
                return None;
            }

            let mut len = 0u32;
            let mut value_ptr: *mut u16 = std::ptr::null_mut();

            let query = "\\StringFileInfo\\040904B0\\FileDescription\0"
                .encode_utf16()
                .collect::<Vec<u16>>();

            if VerQueryValueW(
                buffer.as_ptr() as *const _,
                PCWSTR(query.as_ptr()),
                &mut value_ptr as *mut _ as *mut *mut _,
                &mut len,
            )
            .as_bool()
                && !value_ptr.is_null()
                && len > 0
            {
                let slice = std::slice::from_raw_parts(value_ptr, len as usize - 1);
                Some(String::from_utf16_lossy(slice))
            } else {
                None
            }
        }
    }

    pub fn app_icon(&self) -> Option<Vec<u8>> {
        unsafe {
            // Target size for acceptable icon quality - early termination threshold
            const GOOD_SIZE_THRESHOLD: i32 = 256;

            let executable_path = self.get_executable_path();
            if let Some(exe_path) = executable_path.as_deref()
                && let Some(icon_data) = self.extract_shell_icon_high_res(exe_path, 512)
            {
                return Some(icon_data);
            }

            if let Some(exe_path) = executable_path.as_deref()
                && let Some(icon_data) = self.extract_executable_icons_high_res(exe_path)
            {
                return Some(icon_data);
            }

            // Method 3: Try to get the window's large icon
            let large_icon = SendMessageW(
                self.0,
                WM_GETICON,
                Some(WPARAM(1usize)),
                Some(LPARAM(0isize)),
            ); // ICON_BIG = 1

            if large_icon.0 != 0
                && let Some(result) = self.hicon_to_png_bytes_optimized(HICON(large_icon.0 as _))
                && result.1 >= GOOD_SIZE_THRESHOLD
            {
                return Some(result.0);
            }

            // Method 4: Try executable file extraction (fallback to original method)
            if let Some(exe_path) = executable_path.as_deref() {
                let wide_path: Vec<u16> =
                    exe_path.encode_utf16().chain(std::iter::once(0)).collect();

                let mut large_icon: HICON = HICON::default();
                let mut small_icon: HICON = HICON::default();

                let extracted = ExtractIconExW(
                    PCWSTR(wide_path.as_ptr()),
                    0, // Only try the first (main) icon
                    Some(&mut large_icon),
                    Some(&mut small_icon),
                    1,
                );

                if extracted > 0 {
                    // Try large icon first
                    let large_result = if large_icon.is_invalid() {
                        None
                    } else {
                        let result = self.hicon_to_png_bytes_optimized(large_icon);
                        let _ = DestroyIcon(large_icon);
                        result
                    };
                    if let Some(result) = large_result
                        && result.1 >= GOOD_SIZE_THRESHOLD
                    {
                        if !small_icon.is_invalid() {
                            let _ = DestroyIcon(small_icon);
                        }
                        return Some(result.0);
                    }

                    // Try small icon as fallback
                    if !small_icon.is_invalid() {
                        let result = self.hicon_to_png_bytes_optimized(small_icon);
                        let _ = DestroyIcon(small_icon);
                        if let Some(result) = result {
                            return Some(result.0);
                        }
                    }
                }
            }

            // Method 5: Try small window icon as fallback
            let small_icon = SendMessageW(
                self.0,
                WM_GETICON,
                Some(WPARAM(0usize)),
                Some(LPARAM(0isize)),
            ); // ICON_SMALL = 0

            if small_icon.0 != 0
                && let Some(result) = self.hicon_to_png_bytes_optimized(HICON(small_icon.0 as _))
            {
                return Some(result.0);
            }

            let class_icon = GetClassLongPtrW(self.0, GCLP_HICON) as isize;
            if class_icon != 0
                && let Some(result) = self.hicon_to_png_bytes_optimized(HICON(class_icon as _))
            {
                return Some(result.0);
            }

            None
        }
    }
}
