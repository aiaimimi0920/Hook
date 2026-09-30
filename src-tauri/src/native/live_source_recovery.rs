// Persists source-window restoration data for the independent emergency watchdog.

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveSourceRecoveryRecord {
    hwnd: u64,
    source_process_id: u32,
    source_thread_id: u32,
    rect: [i32; 4],
    placement_flags: u32,
    placement_show_command: u32,
    placement_min_position: [i32; 2],
    placement_max_position: [i32; 2],
    placement_normal_position: [i32; 4],
    ex_style: isize,
    layered_color_key: Option<u32>,
    layered_alpha: Option<u8>,
    layered_flags: Option<u32>,
    was_iconic: bool,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveSourceRecoveryJournal {
    schema_version: u8,
    hook_process_id: u32,
    records: Vec<LiveSourceRecoveryRecord>,
}

#[cfg(target_os = "windows")]
fn live_source_recovery_records(
) -> &'static Mutex<std::collections::BTreeMap<u64, LiveSourceRecoveryRecord>> {
    static RECORDS: OnceLock<Mutex<std::collections::BTreeMap<u64, LiveSourceRecoveryRecord>>> =
        OnceLock::new();
    RECORDS.get_or_init(|| Mutex::new(std::collections::BTreeMap::new()))
}

#[cfg(target_os = "windows")]
fn live_source_recovery_path(hook_process_id: u32) -> Result<PathBuf, String> {
    let root = dirs::data_local_dir()
        .ok_or_else(|| "live source recovery directory is unavailable".to_string())?
        .join("Hook")
        .join("recovery");
    fs::create_dir_all(&root)
        .map_err(|error| format!("create live source recovery directory: {error}"))?;
    Ok(root.join(format!("live-source-{hook_process_id}.json")))
}

#[cfg(target_os = "windows")]
fn persist_live_source_recovery_records(
    records: &std::collections::BTreeMap<u64, LiveSourceRecoveryRecord>,
) -> Result<(), String> {
    let hook_process_id = std::process::id();
    let path = live_source_recovery_path(hook_process_id)?;
    if records.is_empty() {
        match fs::remove_file(&path) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(format!("remove live source recovery journal: {error}")),
        }
    }
    let journal = LiveSourceRecoveryJournal {
        schema_version: 1,
        hook_process_id,
        records: records.values().cloned().collect(),
    };
    let bytes = serde_json::to_vec(&journal)
        .map_err(|error| format!("serialize live source recovery journal: {error}"))?;
    let temporary = path.with_extension(format!("json.tmp-{hook_process_id}"));
    let mut file = fs::File::create(&temporary)
        .map_err(|error| format!("create live source recovery journal: {error}"))?;
    std::io::Write::write_all(&mut file, &bytes)
        .map_err(|error| format!("write live source recovery journal: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("flush live source recovery journal: {error}"))?;
    drop(file);
    commit_live_source_recovery_journal(&temporary, &path)
}

#[cfg(target_os = "windows")]
fn commit_live_source_recovery_journal(temporary: &Path, path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    let temporary_wide = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let path_wide = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileExW(
            temporary_wide.as_ptr(),
            path_wide.as_ptr(),
            windows_sys::Win32::Storage::FileSystem::MOVEFILE_REPLACE_EXISTING
                | windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved != 0 {
        Ok(())
    } else {
        let error = std::io::Error::last_os_error();
        let _ = fs::remove_file(temporary);
        Err(format!("commit live source recovery journal: {error}"))
    }
}

#[cfg(target_os = "windows")]
fn register_live_source_recovery(record: LiveSourceRecoveryRecord) -> Result<(), String> {
    let mut records = live_source_recovery_records()
        .lock()
        .map_err(|_| "live source recovery registry poisoned".to_string())?;
    let previous = records.insert(record.hwnd, record.clone());
    if let Err(error) = persist_live_source_recovery_records(&records) {
        if let Some(previous) = previous {
            records.insert(record.hwnd, previous);
        } else {
            records.remove(&record.hwnd);
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn unregister_live_source_recovery(hwnd: u64) -> Result<(), String> {
    let mut records = live_source_recovery_records()
        .lock()
        .map_err(|_| "live source recovery registry poisoned".to_string())?;
    let removed = records.remove(&hwnd);
    if let Err(error) = persist_live_source_recovery_records(&records) {
        if let Some(removed) = removed {
            records.insert(hwnd, removed);
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn restore_live_source_windows_for_parent(
    hook_process_id: u32,
) -> Result<usize, String> {
    let path = live_source_recovery_path(hook_process_id)?;
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(format!("read live source recovery journal: {error}")),
    };
    let journal: LiveSourceRecoveryJournal = serde_json::from_slice(&bytes)
        .map_err(|error| format!("parse live source recovery journal: {error}"))?;
    if journal.schema_version != 1 || journal.hook_process_id != hook_process_id {
        return Err("live source recovery journal identity mismatch".to_string());
    }
    let mut restored = 0;
    let mut errors = Vec::new();
    for record in &journal.records {
        match restore_live_source_recovery_record(record) {
            Ok(true) => restored += 1,
            Ok(false) => {}
            Err(error) => errors.push(error),
        }
    }
    if errors.is_empty() {
        let _ = fs::remove_file(path);
        Ok(restored)
    } else {
        Err(errors.join("; "))
    }
}

#[cfg(target_os = "windows")]
fn restore_live_source_recovery_record(record: &LiveSourceRecoveryRecord) -> Result<bool, String> {
    let hwnd = windows::Win32::Foundation::HWND(record.hwnd as *mut std::ffi::c_void);
    let (thread_id, process_id) = match live_source_window_identity(hwnd) {
        Ok(identity) => identity,
        Err(_) => return Ok(false),
    };
    if thread_id != record.source_thread_id || process_id != record.source_process_id {
        return Ok(false);
    }
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::SetWindowLongPtrW(
            hwnd,
            windows::Win32::UI::WindowsAndMessaging::GWL_EXSTYLE,
            record.ex_style,
        );
    }
    if let (Some(color), Some(alpha), Some(flags)) = (
        record.layered_color_key,
        record.layered_alpha,
        record.layered_flags,
    ) {
        unsafe {
            windows::Win32::UI::WindowsAndMessaging::SetLayeredWindowAttributes(
                hwnd,
                windows::Win32::Foundation::COLORREF(color),
                alpha,
                windows::Win32::UI::WindowsAndMessaging::LAYERED_WINDOW_ATTRIBUTES_FLAGS(flags),
            )
        }
        .map_err(|error| format!("watchdog restore layered source: {error}"))?;
    }
    let insert_after =
        if record.ex_style & windows::Win32::UI::WindowsAndMessaging::WS_EX_TOPMOST.0 as isize != 0
        {
            windows::Win32::UI::WindowsAndMessaging::HWND_TOPMOST
        } else {
            windows::Win32::UI::WindowsAndMessaging::HWND_NOTOPMOST
        };
    unsafe {
        windows::Win32::UI::WindowsAndMessaging::SetWindowPos(
            hwnd,
            Some(insert_after),
            record.rect[0],
            record.rect[1],
            (record.rect[2] - record.rect[0]).max(1),
            (record.rect[3] - record.rect[1]).max(1),
            windows::Win32::UI::WindowsAndMessaging::SWP_NOACTIVATE
                | windows::Win32::UI::WindowsAndMessaging::SWP_FRAMECHANGED,
        )
    }
    .map_err(|error| format!("watchdog restore source bounds: {error}"))?;
    let placement = windows::Win32::UI::WindowsAndMessaging::WINDOWPLACEMENT {
        length: std::mem::size_of::<windows::Win32::UI::WindowsAndMessaging::WINDOWPLACEMENT>()
            as u32,
        flags: windows::Win32::UI::WindowsAndMessaging::WINDOWPLACEMENT_FLAGS(
            record.placement_flags,
        ),
        showCmd: if record.was_iconic {
            windows::Win32::UI::WindowsAndMessaging::SW_RESTORE.0 as u32
        } else {
            record.placement_show_command
        },
        ptMinPosition: windows::Win32::Foundation::POINT {
            x: record.placement_min_position[0],
            y: record.placement_min_position[1],
        },
        ptMaxPosition: windows::Win32::Foundation::POINT {
            x: record.placement_max_position[0],
            y: record.placement_max_position[1],
        },
        rcNormalPosition: windows::Win32::Foundation::RECT {
            left: record.placement_normal_position[0],
            top: record.placement_normal_position[1],
            right: record.placement_normal_position[2],
            bottom: record.placement_normal_position[3],
        },
    };
    unsafe { windows::Win32::UI::WindowsAndMessaging::SetWindowPlacement(hwnd, &placement) }
        .map_err(|error| format!("watchdog restore source placement: {error}"))?;
    Ok(true)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn restore_live_source_windows_for_parent(
    _hook_process_id: u32,
) -> Result<usize, String> {
    Ok(0)
}
