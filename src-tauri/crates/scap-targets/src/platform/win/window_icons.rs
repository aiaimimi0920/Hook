// Owns shell/executable icon extraction and bounded HICON-to-PNG conversion.

const MAX_ICON_DIMENSION: i32 = 1024;

fn icon_rgba_buffer_len(size: i32) -> Option<usize> {
    let side = usize::try_from(size).ok()?;
    if side == 0 || size > MAX_ICON_DIMENSION {
        return None;
    }
    side.checked_mul(side)?.checked_mul(4)
}

impl WindowImpl {
    fn extract_shell_icon_high_res(&self, exe_path: &str, target_size: i32) -> Option<Vec<u8>> {
        unsafe {
            let wide_path: Vec<u16> = exe_path.encode_utf16().chain(std::iter::once(0)).collect();

            // Try different shell icon sizes
            let icon_flags = [
                SHGFI_ICON | SHGFI_LARGEICON, // Large system icon
                SHGFI_ICON | SHGFI_SMALLICON, // Small system icon as fallback
            ];

            for flags in icon_flags {
                let mut file_info = SHFILEINFOW::default();
                let result = SHGetFileInfoW(
                    windows::core::PCWSTR(wide_path.as_ptr()),
                    FILE_FLAGS_AND_ATTRIBUTES(0),
                    Some(&mut file_info),
                    std::mem::size_of::<SHFILEINFOW>() as u32,
                    flags,
                );

                if result != 0 && !file_info.hIcon.is_invalid() {
                    let icon_result = self.hicon_to_png_bytes_optimized(file_info.hIcon);
                    let _ = DestroyIcon(file_info.hIcon);
                    if let Some(result) = icon_result
                        && result.1 >= target_size / 2
                    {
                        // Accept if at least half target size.
                        return Some(result.0);
                    }
                }
            }

            None
        }
    }

    fn extract_executable_icons_high_res(&self, exe_path: &str) -> Option<Vec<u8>> {
        unsafe {
            let wide_path: Vec<u16> = exe_path.encode_utf16().chain(std::iter::once(0)).collect();

            let mut path_buffer = [0u16; 260];
            let copy_len = wide_path.len().min(path_buffer.len());
            path_buffer[..copy_len].copy_from_slice(&wide_path[..copy_len]);

            let icon_count = ExtractIconExW(PCWSTR(wide_path.as_ptr()), -1, None, None, 0);

            let total_icons = if icon_count > 0 {
                icon_count as usize
            } else {
                1
            };

            let max_icons_to_try = total_icons.min(8);
            let size_candidates: [i32; 12] = [512, 400, 256, 192, 128, 96, 72, 64, 48, 32, 24, 16];

            let mut best_icon: Option<Vec<u8>> = None;
            let mut best_size: i32 = 0;

            for &size in &size_candidates {
                for index in 0..max_icons_to_try {
                    let mut icon_slot = [HICON::default(); 1];

                    let extracted = PrivateExtractIconsW(
                        &path_buffer,
                        index as i32,
                        size,
                        size,
                        Some(&mut icon_slot),
                        None,
                        0,
                    );

                    if extracted == 0 {
                        continue;
                    }

                    let icon_handle = icon_slot[0];
                    if icon_handle.is_invalid() {
                        continue;
                    }

                    let icon_result = self.hicon_to_png_bytes_optimized(icon_handle);
                    let _ = DestroyIcon(icon_handle);

                    if let Some((png_data, realized_size)) = icon_result
                        && realized_size > best_size
                    {
                        best_size = realized_size;
                        best_icon = Some(png_data);

                        if best_size >= 256 {
                            return best_icon;
                        }
                    }
                }
            }

            best_icon
        }
    }

    fn get_executable_path(&self) -> Option<String> {
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
                Some(String::from_utf16_lossy(&buffer[..buffer_size as usize]))
            } else {
                None
            }
        }
    }

    fn get_icon_size(&self, icon: HICON) -> Option<(i32, i32)> {
        unsafe {
            let mut icon_info = ICONINFO::default();
            if GetIconInfo(icon, &mut icon_info).is_err() {
                return None;
            }

            // Get bitmap info to determine actual size
            let mut bitmap_info = BITMAP::default();
            let result = GetObjectA(
                HGDIOBJ(icon_info.hbmColor.0),
                mem::size_of::<BITMAP>() as i32,
                Some(&mut bitmap_info as *mut _ as *mut _),
            );

            // Clean up bitmap handles
            let _ = DeleteObject(icon_info.hbmColor.into());
            let _ = DeleteObject(icon_info.hbmMask.into());

            if result > 0 {
                Some((bitmap_info.bmWidth, bitmap_info.bmHeight))
            } else {
                None
            }
        }
    }

    fn hicon_to_png_bytes_optimized(&self, icon: HICON) -> Option<(Vec<u8>, i32)> {
        unsafe {
            let screen_dc = GetDC(Some(HWND::default()));
            if screen_dc.is_invalid() {
                return None;
            }
            let mem_dc = CreateCompatibleDC(Some(screen_dc));
            if mem_dc.is_invalid() {
                let _ = ReleaseDC(Some(HWND::default()), screen_dc);
                return None;
            }

            let native_size = self.get_icon_size(icon);
            let target_sizes: Vec<i32> = if let Some((width, height)) = native_size {
                let native_dim = width.max(height).min(MAX_ICON_DIMENSION);
                if native_dim > 0 {
                    let mut sizes = Vec::with_capacity(10);
                    sizes.push(native_dim);
                    for &candidate in &[256, 192, 128, 96, 64, 48, 32, 24, 16] {
                        if candidate > 0 && candidate < native_dim {
                            sizes.push(candidate);
                        }
                    }
                    if sizes.is_empty() {
                        vec![native_dim]
                    } else {
                        sizes
                    }
                } else {
                    vec![256, 192, 128, 96, 64, 48, 32, 24, 16]
                }
            } else {
                vec![512, 256, 192, 128, 96, 64, 48, 32, 24, 16]
            };

            let mut deduped = Vec::new();
            for size in target_sizes.into_iter() {
                if !deduped.contains(&size) {
                    deduped.push(size);
                }
            }

            for size in deduped.into_iter().filter(|size| *size > 0) {
                if let Some((png_data, realized_size)) =
                    self.try_convert_icon_to_png(icon, size, screen_dc, mem_dc)
                {
                    let _ = DeleteDC(mem_dc);
                    let _ = ReleaseDC(Some(HWND::default()), screen_dc);

                    return Some((png_data, realized_size));
                }
            }

            let _ = DeleteDC(mem_dc);
            let _ = ReleaseDC(Some(HWND::default()), screen_dc);

            None
        }
    }

    fn try_convert_icon_to_png(
        &self,
        icon: HICON,
        size: i32,
        screen_dc: HDC,
        mem_dc: HDC,
    ) -> Option<(Vec<u8>, i32)> {
        unsafe {
            let buffer_len = icon_rgba_buffer_len(size)?;
            let width = size;
            let height = size;
            let height_u32 = u32::try_from(height).ok()?;

            let mut bitmap_info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: height.checked_neg()?,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    biSizeImage: 0,
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [Default::default(); 1],
            };

            let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
            if bitmap.is_invalid() {
                return None;
            }

            let old_bitmap = SelectObject(mem_dc, bitmap.into());
            if old_bitmap.is_invalid() {
                let _ = DeleteObject(bitmap.into());
                return None;
            }

            let brush = CreateSolidBrush(windows::Win32::Foundation::COLORREF(0));
            if brush.is_invalid() {
                let _ = SelectObject(mem_dc, old_bitmap);
                let _ = DeleteObject(bitmap.into());
                return None;
            }
            let rect = RECT {
                left: 0,
                top: 0,
                right: width,
                bottom: height,
            };
            let _ = FillRect(mem_dc, &rect, brush);
            let _ = DeleteObject(brush.into());

            let draw_result = DrawIconEx(
                mem_dc,
                0,
                0,
                icon,
                width,
                height,
                0,
                Some(HBRUSH::default()),
                DI_FLAGS(0x0003),
            );

            let mut result: Option<(Vec<u8>, i32)> = None;

            if draw_result.is_ok() {
                let mut buffer = vec![0u8; buffer_len];
                let get_bits_result = GetDIBits(
                    mem_dc,
                    bitmap,
                    0,
                    height_u32,
                    Some(buffer.as_mut_ptr() as *mut _),
                    &mut bitmap_info,
                    DIB_RGB_COLORS,
                );

                if get_bits_result > 0 {
                    let has_content = buffer.chunks_exact(4).any(|chunk| chunk[3] != 0);

                    if has_content {
                        for chunk in buffer.chunks_exact_mut(4) {
                            chunk.swap(0, 2);
                        }

                        if let Some(img) = image::RgbaImage::from_raw(
                            u32::try_from(width).ok()?,
                            height_u32,
                            buffer,
                        )
                        {
                            let mut png_data = Vec::new();
                            if img
                                .write_to(
                                    &mut std::io::Cursor::new(&mut png_data),
                                    image::ImageFormat::Png,
                                )
                                .is_ok()
                            {
                                result = Some((png_data, width));
                            }
                        }
                    }
                }
            }

            let _ = SelectObject(mem_dc, old_bitmap);
            let _ = DeleteObject(bitmap.into());

            result
        }
    }
}

#[cfg(test)]
mod tests {
    use super::icon_rgba_buffer_len;

    #[test]
    fn icon_rgba_buffer_is_bounded_and_checked() {
        assert_eq!(icon_rgba_buffer_len(256), Some(256 * 256 * 4));
        assert_eq!(icon_rgba_buffer_len(0), None);
        assert_eq!(icon_rgba_buffer_len(-1), None);
        assert_eq!(icon_rgba_buffer_len(1025), None);
        assert_eq!(icon_rgba_buffer_len(i32::MAX), None);
    }
}
