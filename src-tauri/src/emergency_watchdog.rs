use std::time::{Duration, Instant};

pub const WATCHDOG_ARGUMENT: &str = "--hook-emergency-watchdog";

pub fn parse_parent_pid(args: &[String]) -> Result<Option<u32>, String> {
    let Some(index) = args.iter().position(|arg| arg == WATCHDOG_ARGUMENT) else {
        return Ok(None);
    };
    let value = args
        .get(index + 1)
        .ok_or_else(|| format!("{WATCHDOG_ARGUMENT} requires a parent process id"))?;
    let parent_pid = value
        .parse::<u32>()
        .map_err(|_| format!("invalid emergency watchdog parent process id: {value}"))?;
    if parent_pid == 0 {
        return Err("emergency watchdog parent process id must be non-zero".to_string());
    }
    Ok(Some(parent_pid))
}

#[cfg(target_os = "windows")]
pub fn spawn_for_current_process() -> Result<u32, String> {
    use std::os::windows::process::CommandExt;
    use windows::Win32::System::Threading::CREATE_NO_WINDOW;

    let executable = std::env::current_exe()
        .map_err(|error| format!("resolve Hook executable for emergency watchdog: {error}"))?;
    let parent_pid = std::process::id();
    let mut child = std::process::Command::new(executable)
        .arg(WATCHDOG_ARGUMENT)
        .arg(parent_pid.to_string())
        .creation_flags(CREATE_NO_WINDOW.0)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("spawn Hook emergency watchdog: {error}"))?;
    if crate::watchdog_recovery_feed::install(
        child.stdin.take().ok_or("Missing watchdog key pipe")?,
    )
    .is_err()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Cannot initialize watchdog recovery authority".into());
    }
    Ok(child.id())
}

#[cfg(not(target_os = "windows"))]
pub fn spawn_for_current_process() -> Result<u32, String> {
    Ok(0)
}

#[cfg(target_os = "windows")]
fn physical_key_down(key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY) -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    (unsafe { GetAsyncKeyState(key.0 as i32) }) < 0
}

#[cfg(target_os = "windows")]
fn emergency_chord_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_CONTROL, VK_F12, VK_MENU, VK_SHIFT};
    physical_key_down(VK_CONTROL)
        && physical_key_down(VK_MENU)
        && physical_key_down(VK_SHIFT)
        && physical_key_down(VK_F12)
}

#[cfg(target_os = "windows")]
fn restore_input_state_from_watchdog() {
    use windows::Win32::UI::WindowsAndMessaging::{
        ClipCursor, SystemParametersInfoW, SPI_SETCURSORS,
    };
    let _ = unsafe { ClipCursor(None) };
    let _ = unsafe { SystemParametersInfoW(SPI_SETCURSORS, 0, None, Default::default()) };
}

#[cfg(target_os = "windows")]
fn current_parent_pid() -> Result<u32, String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|error| format!("snapshot processes for emergency watchdog: {error}"))?;
    let current_pid = std::process::id();
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut result = unsafe { Process32FirstW(snapshot, &mut entry) };
    let mut parent_pid = None;
    while result.is_ok() {
        if entry.th32ProcessID == current_pid {
            parent_pid = Some(entry.th32ParentProcessID);
            break;
        }
        result = unsafe { Process32NextW(snapshot, &mut entry) };
    }
    let _ = unsafe { CloseHandle(snapshot) };
    parent_pid
        .ok_or_else(|| format!("resolve emergency watchdog parent process for pid {current_pid}"))
}

#[cfg(target_os = "windows")]
fn validate_direct_parent(requested_parent_pid: u32, actual_parent_pid: u32) -> Result<(), String> {
    if requested_parent_pid == actual_parent_pid {
        Ok(())
    } else {
        Err(format!(
            "emergency watchdog target is not its direct parent: requested={requested_parent_pid} actual={actual_parent_pid}"
        ))
    }
}

#[cfg(target_os = "windows")]
pub fn run(parent_pid: u32) -> i32 {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, TerminateProcess, WaitForSingleObject,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{VK_DELETE, VK_ESCAPE};

    if parent_pid == std::process::id() {
        return 2;
    }
    let actual_parent_pid = match current_parent_pid() {
        Ok(actual_parent_pid) => actual_parent_pid,
        Err(error) => {
            super::append_runtime_log_line_sync(&format!(
                "emergency_watchdog_resolve_parent_failed :: requested_parent_pid={} error={}",
                parent_pid, error
            ));
            return 6;
        }
    };
    if let Err(error) = validate_direct_parent(parent_pid, actual_parent_pid) {
        super::append_runtime_log_line_sync(&format!(
            "emergency_watchdog_parent_mismatch :: requested_parent_pid={} actual_parent_pid={} error={}",
            parent_pid, actual_parent_pid, error
        ));
        return 7;
    }
    let process = match unsafe {
        OpenProcess(
            PROCESS_TERMINATE | PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            parent_pid,
        )
    } {
        Ok(process) => process,
        Err(error) => {
            super::append_runtime_log_line_sync(&format!(
                "emergency_watchdog_open_parent_failed :: parent_pid={} error={}",
                parent_pid, error
            ));
            return 3;
        }
    };

    let recovery_key = match crate::watchdog_recovery_auth::read_parent_key(process, parent_pid) {
        Ok(key) => key,
        Err(error) => {
            super::append_runtime_log_line_sync(&format!(
                "emergency_watchdog_auth_failed :: {error}"
            ));
            let _ = unsafe { CloseHandle(process) };
            return 8;
        }
    };
    super::append_runtime_log_line_sync(&format!(
        "emergency_watchdog_started :: parent_pid={} watchdog_pid={}",
        parent_pid,
        std::process::id()
    ));
    let mut exit_tracker = super::emergency_exit::EmergencyExitTracker::default();
    let mut chord_was_down = false;
    let mut recovery_feed = crate::watchdog_recovery_feed::Reader::default();

    loop {
        if recovery_feed.poll(&recovery_key).is_err() {
            let _ = unsafe { CloseHandle(process) };
            return 8;
        }
        match unsafe { WaitForSingleObject(process, 0) } {
            WAIT_OBJECT_0 => {
                let _ = recovery_feed.poll(&recovery_key);
                let mut exit_code = 0;
                match unsafe { GetExitCodeProcess(process, &mut exit_code) } {
                    Ok(()) => super::append_runtime_log_line_sync(&format!(
                        "[{}] emergency_watchdog_parent_exited :: parent_pid={} exit_code={} exit_code_hex=0x{:08X}",
                        super::runtime_log_timestamp(), parent_pid, exit_code, exit_code
                    )),
                    Err(error) => super::append_runtime_log_line_sync(&format!(
                        "[{}] emergency_watchdog_parent_exit_query_failed :: parent_pid={} error={}",
                        super::runtime_log_timestamp(), parent_pid, error
                    )),
                }
                let _ = super::restore_live_source_windows_from_snapshot(
                    parent_pid,
                    &recovery_key,
                    recovery_feed.latest(),
                )
                .map_err(|error| {
                    super::append_runtime_log_line_sync(&format!(
                        "emergency_watchdog_source_restore_failed :: parent_pid={} error={}",
                        parent_pid, error
                    ));
                });
                restore_input_state_from_watchdog();
                let _ = unsafe { CloseHandle(process) };
                return 0;
            }
            WAIT_TIMEOUT => {}
            other => {
                super::append_runtime_log_line_sync(&format!(
                    "emergency_watchdog_parent_wait_failed :: parent_pid={} wait={:?}",
                    parent_pid, other
                ));
                let _ = unsafe { CloseHandle(process) };
                return 4;
            }
        }

        let triple_esc_delete = exit_tracker.record_state(
            physical_key_down(VK_ESCAPE),
            physical_key_down(VK_DELETE),
            Instant::now(),
        ) == Some(3);

        let chord_is_down = emergency_chord_down();
        let emergency_chord = chord_is_down && !chord_was_down;
        chord_was_down = chord_is_down;

        if triple_esc_delete || emergency_chord {
            let source = if triple_esc_delete {
                "triple_esc_delete"
            } else {
                "ctrl_alt_shift_f12"
            };
            super::append_runtime_log_line_sync(&format!(
                "emergency_watchdog_terminate_parent :: parent_pid={} source={}",
                parent_pid, source
            ));
            restore_input_state_from_watchdog();
            let exit_code = match unsafe { TerminateProcess(process, 0) } {
                Ok(()) => {
                    let _ = unsafe { WaitForSingleObject(process, 5_000) };
                    let _ = recovery_feed.poll(&recovery_key);
                    let _ = super::restore_live_source_windows_from_snapshot(
                        parent_pid,
                        &recovery_key,
                        recovery_feed.latest(),
                    )
                    .map_err(|error| {
                        super::append_runtime_log_line_sync(&format!(
                            "emergency_watchdog_source_restore_failed :: parent_pid={} error={}",
                            parent_pid, error
                        ));
                    });
                    0
                }
                Err(error) => {
                    super::append_runtime_log_line_sync(&format!(
                        "emergency_watchdog_terminate_failed :: parent_pid={} error={}",
                        parent_pid, error
                    ));
                    5
                }
            };
            let _ = unsafe { CloseHandle(process) };
            return exit_code;
        }

        std::thread::sleep(Duration::from_millis(8));
    }
}

#[cfg(not(target_os = "windows"))]
pub fn run(_parent_pid: u32) -> i32 {
    0
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[cfg(windows)]
    pub(crate) struct TestWatchdog(std::process::Child);

    #[cfg(windows)]
    impl Drop for TestWatchdog {
        fn drop(&mut self) {
            crate::watchdog_recovery_feed::uninstall_for_test();
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    /// The libtest executable has no application CLI dispatch. Use its exact child entry
    /// while preserving the production parent-image and inherited-pipe authentication.
    #[cfg(windows)]
    pub(crate) fn start_interactive_test_watchdog() -> TestWatchdog {
        use std::os::windows::process::CommandExt;
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "emergency_watchdog::tests::watchdog_test_child",
                "--nocapture",
            ])
            .env(
                "HOOK_TEST_WATCHDOG_PARENT_PID",
                std::process::id().to_string(),
            )
            .creation_flags(windows::Win32::System::Threading::CREATE_NO_WINDOW.0)
            .stdin(std::process::Stdio::piped())
            .spawn()
            .expect("start real watchdog test child");
        let mut guard = TestWatchdog(child);
        crate::watchdog_recovery_feed::install(guard.0.stdin.take().unwrap())
            .expect("install authenticated watchdog test pipe");
        guard
    }

    #[cfg(windows)]
    #[test]
    fn watchdog_test_child() {
        let Ok(pid) = std::env::var("HOOK_TEST_WATCHDOG_PARENT_PID") else {
            return;
        };
        assert_eq!(run(pid.parse().unwrap()), 0);
    }

    #[test]
    fn parses_internal_watchdog_parent_pid() {
        let args = vec![WATCHDOG_ARGUMENT.to_string(), "4242".to_string()];
        assert_eq!(parse_parent_pid(&args).unwrap(), Some(4242));
        assert!(parse_parent_pid(&[WATCHDOG_ARGUMENT.to_string()]).is_err());
        assert!(parse_parent_pid(&[WATCHDOG_ARGUMENT.to_string(), "0".to_string()]).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn watchdog_uses_the_shared_esc_delete_tracker_and_full_release_gate() {
        let started_at = Instant::now();
        let mut tracker = super::super::emergency_exit::EmergencyExitTracker::default();
        assert_eq!(tracker.record_state(true, false, started_at), None);
        for count in 1..=3 {
            let at = started_at + Duration::from_millis(count * 100);
            assert_eq!(tracker.record_state(true, true, at), Some(count as u8));
            assert_eq!(tracker.record_state(false, true, at), None);
            assert_eq!(tracker.record_state(true, true, at), None);
            tracker.record_state(false, false, at);
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn watchdog_only_accepts_its_direct_parent_as_the_termination_target() {
        assert!(validate_direct_parent(4242, 4242).is_ok());
        assert!(validate_direct_parent(4242, 4343).is_err());
    }
}
