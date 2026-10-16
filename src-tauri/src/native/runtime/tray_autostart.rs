struct TrayAutostartItem(tauri::menu::CheckMenuItem<tauri::Wry>);

fn create_tray_autostart(
    app: &tauri::App,
) -> tauri::Result<tauri::menu::CheckMenuItem<tauri::Wry>> {
    let status = autostart::enabled();
    if let Err(error) = &status {
        append_runtime_log_line(&format!("autostart_read_failed :: {error}"));
    }
    tauri::menu::CheckMenuItem::with_id(
        app,
        "autostart",
        "自启动",
        cfg!(target_os = "windows") && status.is_ok(),
        status.unwrap_or(false),
        None::<&str>,
    )
}

fn toggle_tray_autostart(app: &tauri::AppHandle) {
    let Some(item) = app.try_state::<TrayAutostartItem>() else {
        return;
    };
    // Native check items toggle before delivering the click event.
    let result = item
        .0
        .is_checked()
        .map_err(|error| error.to_string())
        .and_then(autostart::set_enabled);
    let actual = autostart::enabled();
    let _ = item
        .0
        .set_checked(actual.as_ref().copied().unwrap_or(false));
    if let Err(error) = result.and(actual.map(|_| ())) {
        append_runtime_log_line(&format!("autostart_update_failed :: {error}"));
        #[cfg(target_os = "windows")]
        unsafe {
            use windows::core::w;
            use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
            let _ = MessageBoxW(
                None,
                w!("无法更新自启动设置，请检查当前用户权限后重试。"),
                w!("Otter"),
                MB_OK | MB_ICONERROR,
            );
        }
    }
}
