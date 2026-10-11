// Opt-in owned Chromium oracle. No global input or personal browser window is used.
use super::*;
use std::time::{Duration, Instant};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};

#[path = "live_browser_recovery_tests.rs"]
mod recovery;

fn owned_window(title: &str, pid: u32) -> HWND {
    struct Search<'a> {
        title: &'a str,
        pid: u32,
        found: HWND,
    }
    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> windows::core::BOOL {
        let search = unsafe { &mut *(data.0 as *mut Search<'_>) };
        let mut text = [0u16; 256];
        let n = unsafe { GetWindowTextW(hwnd, &mut text) } as usize;
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
        }
        if pid == search.pid && String::from_utf16_lossy(&text[..n]).starts_with(search.title) {
            search.found = hwnd;
            return windows::core::BOOL(0);
        }
        windows::core::BOOL(1)
    }
    let mut search = Search {
        title,
        pid,
        found: HWND::default(),
    };
    let _ = unsafe {
        EnumWindows(
            Some(visit),
            LPARAM((&mut search as *mut Search<'_>) as isize),
        )
    };
    assert!(!search.found.0.is_null(), "owned Chromium HWND missing");
    search.found
}

fn wait_until(mut predicate: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while !predicate() {
        assert!(Instant::now() < deadline, "source transition timed out");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
#[ignore = "requires isolated Chrome launched by live-browser-input-probe.mjs"]
fn cropped_video_controls_survive_minimize_and_restore() {
    let _lock = WATCHDOG_TEST_LOCK.lock().unwrap();
    let _watchdog = crate::emergency_watchdog::tests::start_interactive_test_watchdog();
    let ready: serde_json::Value = serde_json::from_slice(
        &std::fs::read(crate::brand_env::var("HOOK_BROWSER_INPUT_FIXTURE").unwrap()).unwrap(),
    )
    .unwrap();
    let title = ready["title"].as_str().unwrap();
    assert!(title.starts_with("OtterLiveInputProbe-"));
    let hwnd = owned_window(title, ready["pid"].as_u64().unwrap() as u32);
    let _dpi = enter_live_source_dpi_context(hwnd).unwrap();
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let oracle = || -> serde_json::Value {
        client
            .get(format!(
                "http://127.0.0.1:{}/oracle",
                ready["port"].as_u64().unwrap()
            ))
            .send()
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .unwrap()
    };
    for maximized in [false, true] {
        unsafe {
            let _ = ShowWindowAsync(hwnd, if maximized { SW_MAXIMIZE } else { SW_RESTORE });
        }
        wait_until(|| {
            unsafe { IsZoomed(hwnd) }.as_bool() == maximized && !unsafe { IsIconic(hwnd) }.as_bool()
        });
        std::thread::sleep(Duration::from_millis(200));
        let data = oracle();
        let n = |key: &str| data[key].as_f64().unwrap();
        let mut bounds = RECT::default();
        let mut client_rect = RECT::default();
        unsafe {
            windows::Win32::Graphics::Dwm::DwmGetWindowAttribute(
                hwnd,
                windows::Win32::Graphics::Dwm::DWMWA_EXTENDED_FRAME_BOUNDS,
                (&raw mut bounds).cast(),
                std::mem::size_of::<RECT>() as u32,
            )
            .unwrap();
            GetClientRect(hwnd, &mut client_rect).unwrap();
        }
        let scale = n("dpr");
        let mut origin = POINT {
            x: ((f64::from(client_rect.right) - n("innerWidth") * scale) / 2.0).round() as i32,
            y: (f64::from(client_rect.bottom) - n("innerHeight") * scale).round() as i32,
        };
        assert!(
            unsafe { windows::Win32::Graphics::Gdi::ClientToScreen(hwnd, &mut origin) }.as_bool()
        );
        let region = LiveCapturePhysicalRegion {
            left: (origin.x - bounds.left + (n("left") * scale).round() as i32) as u32,
            top: (origin.y - bounds.top + (n("top") * scale).round() as i32) as u32,
            width: (n("width") * scale).round() as u32,
            height: (n("height") * scale).round() as u32,
        };
        let x = ((n("x") - n("left")) * scale) / f64::from(region.width - 1);
        let y = ((n("y") - n("top")) * scale) / f64::from(region.height - 1);
        let mut source = LiveSourceWindowLifecycle::new_with_region(
            &format!("{:x}", hwnd.0 as usize),
            Some(region),
        )
        .unwrap();
        source.set_interaction_enabled(true).unwrap();
        let mut sequence = 0;
        for stage in ["visible", "hidden", "hidden", "hidden", "restored"] {
            if stage == "hidden" && source.source_window_state() != "logically_hidden" {
                unsafe {
                    let _ = ShowWindowAsync(hwnd, SW_MINIMIZE);
                }
                wait_until(|| unsafe { IsIconic(hwnd) }.as_bool());
                sequence += 1;
                let request = serde_json::from_value(serde_json::json!({
                    "kind": "mouse_move", "sequence": sequence, "normalizedX": x, "normalizedY": y
                }))
                .unwrap();
                assert_eq!(
                    send_live_input_with_recovery(&mut source, &request).unwrap_err(),
                    "source_window_transition"
                );
                assert!(source.interaction_enabled);
                assert!(source.intercept_native_minimize().unwrap());
                wait_until(|| !unsafe { IsIconic(hwnd) }.as_bool());
                std::thread::sleep(Duration::from_millis(250));
                assert_eq!(source.source_window_state(), "logically_hidden");
            } else if stage == "restored" {
                source.sync_native_visibility(hwnd).unwrap();
                std::thread::sleep(Duration::from_millis(250));
            }
            let before = oracle();
            for kind in ["mouse_move", "mouse_button_down", "mouse_button_up"] {
                sequence += 1;
                let request = serde_json::from_value(serde_json::json!({
                    "kind": kind, "sequence": sequence, "normalizedX": x, "normalizedY": y, "button": "left"
                })).unwrap();
                send_live_input_with_recovery(&mut source, &request)
                    .unwrap_or_else(|e| panic!("{stage} maximized={maximized} {kind}: {e}"));
                std::thread::sleep(Duration::from_millis(80));
                if stage == "hidden" {
                    source.intercept_native_minimize().unwrap();
                    assert_eq!(
                        source.source_window_state(),
                        "logically_hidden",
                        "forwarded input must not reopen the browser"
                    );
                }
            }
            wait_until(|| {
                oracle()["clicks"].as_u64() == Some(before["clicks"].as_u64().unwrap() + 1)
            });
            let after = oracle();
            assert_ne!(
                after["paused"], before["paused"],
                "video playback state did not toggle"
            );
            assert!(source.interaction_enabled);
            if stage == "hidden" {
                for _ in 0..5 {
                    std::thread::sleep(Duration::from_millis(100));
                    source.intercept_native_minimize().unwrap();
                    assert_eq!(source.source_window_state(), "logically_hidden");
                    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
                    assert_eq!(
                        live_source_layered_attributes(hwnd, style)
                            .unwrap()
                            .unwrap()
                            .alpha,
                        1
                    );
                }
            }
            println!(
                "PASS {stage} maximized={maximized}: clicks {} -> {}, paused {} -> {}",
                before["clicks"], after["clicks"], before["paused"], after["paused"]
            );
        }
        source.restore().unwrap();
    }
}
