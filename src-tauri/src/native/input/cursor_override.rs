// Applies and restores the system crosshair cursor during capture.

#[cfg(target_os = "windows")]
fn set_system_cursor_to_crosshair(cursor_id: SYSTEM_CURSOR_ID) -> bool {
    let Ok(cursor) = (unsafe { LoadCursorW(None, IDC_CROSS) }) else {
        return false;
    };
    let Ok(cursor_copy) = (unsafe { CopyIcon(HICON(cursor.0)) }) else {
        return false;
    };
    unsafe { SetSystemCursor(HCURSOR(cursor_copy.0), cursor_id) }.is_ok()
}

#[cfg(target_os = "windows")]
fn set_capture_cursor_crosshair() {
    if CAPTURE_SYSTEM_CURSOR_OVERRIDDEN.load(Ordering::SeqCst) {
        return;
    }

    let mut updated_any = false;
    for cursor_id in [
        OCR_NORMAL,
        OCR_IBEAM,
        OCR_CROSS,
        OCR_HAND,
        OCR_NO,
        OCR_SIZEALL,
        OCR_SIZENESW,
        OCR_SIZENS,
        OCR_SIZENWSE,
        OCR_SIZEWE,
        OCR_UP,
    ] {
        updated_any |= set_system_cursor_to_crosshair(cursor_id);
    }

    if updated_any {
        CAPTURE_SYSTEM_CURSOR_OVERRIDDEN.store(true, Ordering::SeqCst);
        append_runtime_log_line("capture_cursor_crosshair_enabled");
    } else {
        append_runtime_log_line("capture_cursor_crosshair_failed");
    }
}

#[cfg(not(target_os = "windows"))]
fn set_capture_cursor_crosshair() {}

#[cfg(target_os = "windows")]
fn clear_capture_cursor_crosshair() {
    if CAPTURE_SYSTEM_CURSOR_OVERRIDDEN.swap(false, Ordering::SeqCst) {
        restore_system_cursors_unconditionally();
    }
}

#[cfg(not(target_os = "windows"))]
fn clear_capture_cursor_crosshair() {}

#[cfg(target_os = "windows")]
fn restore_system_cursors_unconditionally() {
    CAPTURE_SYSTEM_CURSOR_OVERRIDDEN.store(false, Ordering::SeqCst);
    match unsafe { SystemParametersInfoW(SPI_SETCURSORS, 0, None, Default::default()) } {
        Ok(()) => append_runtime_log_line("system_cursors_restored_unconditionally"),
        Err(error) => {
            append_runtime_log_line(&format!("system_cursors_restore_failed :: {}", error))
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn restore_system_cursors_unconditionally() {}
