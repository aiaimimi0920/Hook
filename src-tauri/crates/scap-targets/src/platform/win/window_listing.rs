// Owns window enumeration, cursor hit selection, identity, and z-level classification.

impl WindowImpl {
    pub fn list() -> Vec<Self> {
        struct EnumContext {
            list: Vec<WindowImpl>,
            current_process_id: u32,
        }

        unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let context = unsafe { &mut *(lparam.0 as *mut EnumContext) };

            if is_window_valid_for_enumeration(hwnd, context.current_process_id) {
                context.list.push(WindowImpl(hwnd));
            }

            TRUE
        }

        let mut context = EnumContext {
            list: vec![],
            current_process_id: unsafe { GetCurrentProcessId() },
        };

        unsafe {
            let _ = EnumChildWindows(
                Some(GetDesktopWindow()),
                Some(enum_windows_proc),
                LPARAM(std::ptr::addr_of_mut!(context) as isize),
            );
        }

        context.list
    }

    pub fn inner(&self) -> HWND {
        self.0
    }

    pub fn get_topmost_at_cursor() -> Option<Self> {
        let cursor = get_cursor_position()?;
        let point = POINT {
            x: cursor.x() as i32,
            y: cursor.y() as i32,
        };

        unsafe {
            // Use WindowFromPoint first as a quick check
            let hwnd_at_point = WindowFromPoint(point);
            if hwnd_at_point != HWND(std::ptr::null_mut()) {
                let current_process_id = GetCurrentProcessId();

                // Walk up the Z-order chain to find the topmost valid window
                let mut current_hwnd = hwnd_at_point;

                loop {
                    // Check if this window is valid for our purposes
                    if is_window_valid_for_topmost_selection(
                        current_hwnd,
                        current_process_id,
                        point,
                    ) {
                        return Some(Self(current_hwnd));
                    }

                    // Move to the next window in Z-order (towards background)
                    current_hwnd =
                        GetWindow(current_hwnd, GW_HWNDNEXT).unwrap_or(HWND(std::ptr::null_mut()));
                    if current_hwnd == HWND(std::ptr::null_mut()) {
                        break;
                    }

                    // Check if this window still contains the point
                    if !is_point_in_window(current_hwnd, point) {
                        continue;
                    }
                }
            }

            // Fallback to enumeration if WindowFromPoint fails
            Self::get_topmost_at_cursor_fallback(point)
        }
    }

    fn get_topmost_at_cursor_fallback(point: POINT) -> Option<Self> {
        struct HitTestData {
            pt: POINT,
            candidates: Vec<HWND>,
            current_process_id: u32,
        }

        unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let data = unsafe { &mut *(lparam.0 as *mut HitTestData) };

            if is_window_valid_for_topmost_selection(hwnd, data.current_process_id, data.pt) {
                data.candidates.push(hwnd);
            }

            TRUE
        }

        let mut data = HitTestData {
            pt: point,
            candidates: Vec::new(),
            current_process_id: unsafe { GetCurrentProcessId() },
        };

        unsafe {
            let _ = EnumWindows(
                Some(enum_windows_proc),
                LPARAM(std::ptr::addr_of_mut!(data) as isize),
            );

            // Sort candidates by Z-order (topmost first)
            data.candidates.sort_by(|&a, &b| {
                // Use GetWindowLong to check topmost status
                let a_topmost = (GetWindowLongW(a, GWL_EXSTYLE) & WS_EX_TOPMOST.0 as i32) != 0;
                let b_topmost = (GetWindowLongW(b, GWL_EXSTYLE) & WS_EX_TOPMOST.0 as i32) != 0;

                match (a_topmost, b_topmost) {
                    (true, false) => std::cmp::Ordering::Less, // a is more topmost
                    (false, true) => std::cmp::Ordering::Greater, // b is more topmost
                    _ => std::cmp::Ordering::Equal,            // Same topmost level
                }
            });

            data.candidates.first().map(|&hwnd| Self(hwnd))
        }
    }

    pub fn list_containing_cursor() -> Vec<Self> {
        let Some(cursor) = get_cursor_position() else {
            return vec![];
        };

        Self::list()
            .into_iter()
            .filter_map(|window| {
                let bounds = window.physical_bounds()?;
                bounds.contains_point(cursor).then_some(window)
            })
            .collect()
    }

    pub fn id(&self) -> WindowIdImpl {
        WindowIdImpl(self.0.0 as u64)
    }

    pub fn level(&self) -> Option<i32> {
        unsafe {
            // Windows doesn't have the same level concept as macOS, but we can approximate
            // using extended window styles and z-order information
            let ex_style = GetWindowLongW(self.0, GWL_EXSTYLE);

            // Check if window has topmost style
            if (ex_style & WS_EX_TOPMOST.0 as i32) != 0 {
                Some(3) // Higher level for topmost windows
            } else {
                Some(0) // Normal level for regular windows
            }
        }
    }
}
