// Owns precise selection and physical screen-color sampling commands.

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenColorSample {
    pub hex: String,
    pub rgb: ScreenColorRgb,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScreenColorRgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[tauri::command]
async fn get_precise_selection(
    _app: tauri::AppHandle,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<Option<SimpleRect>, String> {
    #[cfg(target_os = "windows")]
    {
        // Offload to a blocking thread to avoid freezing the main UI thread.
        // Tokio's spawn_blocking handles the thread pool.
        let result = tokio::task::spawn_blocking(move || {
            console_line!(
                "[Precise] get_precise_selection: ({}, {}, {}, {})",
                x,
                y,
                w,
                h
            );

            // Initialization
            let automation = match UIAutomation::new() {
                Ok(a) => a,
                Err(e) => {
                    console_line!("[Precise] ERROR: UIAutomation init failed: {}", e);
                    return None;
                }
            };

            // Define User Selection Rect
            let sel_left = x as i32;
            let sel_top = y as i32;
            let sel_right = (x + w) as i32;
            let sel_bottom = (y + h) as i32;
            let center_x = x as i32 + (w as i32 / 2);
            let center_y = y as i32 + (h as i32 / 2);

            let root = automation.get_root_element().ok()?;
            let walker = automation.get_control_view_walker().ok()?;

            // Walk top-level windows
            let mut target_window = None;
            let mut child = walker.get_first_child(&root);
            while let Ok(ref w) = child {
                if let Ok(rect) = w.get_bounding_rectangle() {
                    // Check intersection with center
                    if center_x >= rect.get_left()
                        && center_x <= rect.get_right()
                        && center_y >= rect.get_top()
                        && center_y <= rect.get_bottom()
                    {
                        let pid = w.get_process_id().unwrap_or(0);
                        let my_pid = std::process::id();

                        if pid != my_pid {
                            target_window = Some(w.clone());
                            break;
                        }
                    }
                }
                child = walker.get_next_sibling(w);
            }

            let search_root = target_window.unwrap_or(root);

            // Now Find All Descendants of this window that are FULLY contained in selection
            let mut contained_rects = Vec::new();

            // DFS Helper
            let mut stack = vec![search_root];
            let mut count = 0;

            while let Some(el) = stack.pop() {
                count += 1;
                if count > 5000 {
                    console_line!(
                        "[Precise] Warning: Element limit reached (5000). Stopping traversal."
                    );
                    break;
                }

                let mut should_descend = true;

                if let Ok(rect) = el.get_bounding_rectangle() {
                    let r_left = rect.get_left();
                    let r_top = rect.get_top();
                    let r_right = rect.get_right();
                    let r_bottom = rect.get_bottom();

                    // Check containment (Match)
                    if r_left >= sel_left
                        && r_right <= sel_right
                        && r_top >= sel_top
                        && r_bottom <= sel_bottom
                    {
                        let r_w = r_right - r_left;
                        let r_h = r_bottom - r_top;

                        // Fully contained!
                        if r_w > 0 && r_h > 0 {
                            // Valid rect
                            contained_rects.push(SimpleRect {
                                x: r_left as f64,
                                y: r_top as f64,
                                w: r_w as f64,
                                h: r_h as f64,
                            });
                            should_descend = false;
                        }
                    }

                    if r_right < sel_left
                        || r_left > sel_right
                        || r_bottom < sel_top
                        || r_top > sel_bottom
                    {
                        should_descend = false;
                    }
                }

                if should_descend {
                    if let Ok(child_walker) = automation.get_control_view_walker() {
                        if let Ok(first_child) = child_walker.get_first_child(&el) {
                            stack.push(first_child.clone());

                            let mut current_sibling = first_child;
                            while let Ok(next) = child_walker.get_next_sibling(&current_sibling) {
                                stack.push(next.clone());
                                current_sibling = next;
                            }
                        }
                    }
                }
            }

            if contained_rects.is_empty() {
                return None;
            }

            // Compute Union of all contained rects
            let mut min_x = f64::MAX;
            let mut min_y = f64::MAX;
            let mut max_x = f64::MIN;
            let mut max_y = f64::MIN;

            for r in contained_rects {
                if r.x < min_x {
                    min_x = r.x;
                }
                if r.y < min_y {
                    min_y = r.y;
                }
                if (r.x + r.w) > max_x {
                    max_x = r.x + r.w;
                }
                if (r.y + r.h) > max_y {
                    max_y = r.y + r.h;
                }
            }

            Some(SimpleRect {
                x: min_x,
                y: min_y,
                w: max_x - min_x,
                h: max_y - min_y,
            })
        })
        .await
        .unwrap_or(None);

        Ok(result)
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}

#[tauri::command]
async fn pick_screen_color_at_cursor() -> Result<ScreenColorSample, String> {
    let (x, y) = current_cursor_position_physical()
        .ok_or_else(|| "Cursor position unavailable".to_string())?;
    sample_screen_color_physical(x.round() as i32, y.round() as i32)
}

#[cfg(target_os = "windows")]
fn sample_screen_color_physical(x: i32, y: i32) -> Result<ScreenColorSample, String> {
    use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};

    let screen_dc = unsafe { GetDC(None) };
    if screen_dc.is_invalid() {
        return Err("Screen DC unavailable".to_string());
    }

    let color = unsafe { GetPixel(screen_dc, x, y) };
    unsafe {
        ReleaseDC(None, screen_dc);
    }

    if color.0 == u32::MAX {
        return Err("Screen pixel unavailable".to_string());
    }

    let raw = color.0;
    let r = (raw & 0x0000_00ff) as u8;
    let g = ((raw & 0x0000_ff00) >> 8) as u8;
    let b = ((raw & 0x00ff_0000) >> 16) as u8;

    Ok(ScreenColorSample {
        hex: format!("#{r:02x}{g:02x}{b:02x}"),
        rgb: ScreenColorRgb { r, g, b },
    })
}

#[cfg(not(target_os = "windows"))]
fn sample_screen_color_physical(_x: i32, _y: i32) -> Result<ScreenColorSample, String> {
    Err("Screen color picking is only supported on Windows".to_string())
}

#[tauri::command]
fn pick_screen_color_at(x: f64, y: f64) -> Result<ScreenColorSample, String> {
    sample_screen_color_physical(x.round() as i32, y.round() as i32)
}

