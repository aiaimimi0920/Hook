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
    let child = std::process::Command::new(executable)
        .arg(WATCHDOG_ARGUMENT)
        .arg(parent_pid.to_string())
        .creation_flags(CREATE_NO_WINDOW.0)
        .spawn()
        .map_err(|error| format!("spawn Hook emergency watchdog: {error}"))?;
    Ok(child.id())
}

#[cfg(not(target_os = "windows"))]
pub fn spawn_for_current_process() -> Result<u32, String> {
    Ok(0)
}

#[cfg(target_os = "windows")]
#[derive(Default)]
struct WatchdogEscapeTracker {
    last_press: Option<Instant>,
}

#[cfg(target_os = "windows")]
impl WatchdogEscapeTracker {
    fn record_press(&mut self, now: Instant) -> bool {
        let should_exit = self
            .last_press
            .map(|last| now.duration_since(last) < super::EMERGENCY_ESCAPE_WINDOW)
            .unwrap_or(false);
        self.last_press = Some(now);
        should_exit
    }
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
        OpenProcess, TerminateProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE, PROCESS_TERMINATE,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::VK_ESCAPE;

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
    let process =
        match unsafe { OpenProcess(PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, false, parent_pid) } {
            Ok(process) => process,
            Err(error) => {
                super::append_runtime_log_line_sync(&format!(
                    "emergency_watchdog_open_parent_failed :: parent_pid={} error={}",
                    parent_pid, error
                ));
                return 3;
            }
        };

    super::append_runtime_log_line_sync(&format!(
        "emergency_watchdog_started :: parent_pid={} watchdog_pid={}",
        parent_pid,
        std::process::id()
    ));
    let mut escape_tracker = WatchdogEscapeTracker::default();
    let mut escape_was_down = false;
    let mut chord_was_down = false;

    loop {
        match unsafe { WaitForSingleObject(process, 0) } {
            WAIT_OBJECT_0 => {
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

        let escape_is_down = physical_key_down(VK_ESCAPE);
        let double_escape =
            escape_is_down && !escape_was_down && escape_tracker.record_press(Instant::now());
        escape_was_down = escape_is_down;

        let chord_is_down = emergency_chord_down();
        let emergency_chord = chord_is_down && !chord_was_down;
        chord_was_down = chord_is_down;

        if double_escape || emergency_chord {
            let source = if double_escape {
                "double_escape"
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
mod tests {
    use super::*;

    #[test]
    fn parses_internal_watchdog_parent_pid() {
        let args = vec![WATCHDOG_ARGUMENT.to_string(), "4242".to_string()];
        assert_eq!(parse_parent_pid(&args).unwrap(), Some(4242));
        assert!(parse_parent_pid(&[WATCHDOG_ARGUMENT.to_string()]).is_err());
        assert!(parse_parent_pid(&[WATCHDOG_ARGUMENT.to_string(), "0".to_string()]).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn watchdog_uses_the_same_double_escape_window_as_the_main_hook() {
        let started_at = Instant::now();
        let mut tracker = WatchdogEscapeTracker::default();
        assert!(!tracker.record_press(started_at));
        assert!(tracker.record_press(
            started_at + super::super::EMERGENCY_ESCAPE_WINDOW - Duration::from_millis(1)
        ));

        let mut expired = WatchdogEscapeTracker::default();
        assert!(!expired.record_press(started_at));
        assert!(!expired.record_press(started_at + super::super::EMERGENCY_ESCAPE_WINDOW));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn watchdog_only_accepts_its_direct_parent_as_the_termination_target() {
        assert!(validate_direct_parent(4242, 4242).is_ok());
        assert!(validate_direct_parent(4242, 4343).is_err());
    }
}
