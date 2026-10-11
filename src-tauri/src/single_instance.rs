#[cfg(target_os = "windows")]
use std::ffi::OsStr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::OsStrExt;

#[cfg(target_os = "windows")]
use windows::core::PCWSTR;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::CreateMutexW;

pub(crate) const HOOK_SINGLE_INSTANCE_NAME: &str = "Local\\ArtNexus.Hook.SingleInstance";

/// Build the app-wide single-instance mutex name.
///
/// Otter installs a global low-level mouse hook and registers global hotkeys, so
/// running multiple test builds side-by-side is unsafe: they race on the same
/// pointer stream and can swallow each other's events. Keep the mutex global so
/// only one Otter process can own those system-wide hooks at a time.
#[cfg(target_os = "windows")]
pub(crate) fn single_instance_name() -> String {
    HOOK_SINGLE_INSTANCE_NAME.to_string()
}

#[cfg(target_os = "windows")]
pub(crate) struct SingleInstanceGuard {
    handle: HANDLE,
}

#[cfg(target_os = "windows")]
impl Drop for SingleInstanceGuard {
    fn drop(&mut self) {
        let _ = unsafe { CloseHandle(self.handle) };
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn try_acquire_single_instance(
    name: &str,
) -> Result<Option<SingleInstanceGuard>, String> {
    let wide_name: Vec<u16> = OsStr::new(name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let handle = unsafe { CreateMutexW(None, false, PCWSTR(wide_name.as_ptr())) }
        .map_err(|e| format!("CreateMutexW failed: {:?}", e))?;

    let already_exists = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    if already_exists {
        let _ = unsafe { CloseHandle(handle) };
        return Ok(None);
    }

    Ok(Some(SingleInstanceGuard { handle }))
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn single_instance_name() -> String {
    HOOK_SINGLE_INSTANCE_NAME.to_string()
}

#[cfg(not(target_os = "windows"))]
pub(crate) struct SingleInstanceGuard;

#[cfg(not(target_os = "windows"))]
pub(crate) fn try_acquire_single_instance(
    _name: &str,
) -> Result<Option<SingleInstanceGuard>, String> {
    Ok(Some(SingleInstanceGuard))
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{single_instance_name, try_acquire_single_instance, HOOK_SINGLE_INSTANCE_NAME};
    use std::process;

    #[test]
    fn single_instance_name_is_app_scoped_and_stable() {
        let first = single_instance_name();
        let second = single_instance_name();
        assert_ne!(
            HOOK_SINGLE_INSTANCE_NAME, "",
            "base prefix must not be empty"
        );
        assert_eq!(first, second, "name must be stable within one app");
        assert_eq!(
            first, HOOK_SINGLE_INSTANCE_NAME,
            "Otter must use one app-wide mutex name so different release folders cannot run concurrent global hooks"
        );
    }

    #[test]
    fn second_acquire_reports_existing_instance_until_first_is_dropped() {
        let test_name = format!("{}.test.{}", HOOK_SINGLE_INSTANCE_NAME, process::id());
        let first = try_acquire_single_instance(&test_name).expect("first acquire should succeed");
        assert!(first.is_some(), "first acquire should own the mutex");

        let second =
            try_acquire_single_instance(&test_name).expect("second acquire should return cleanly");
        assert!(
            second.is_none(),
            "second acquire should detect an existing Otter instance"
        );

        drop(first);

        let third = try_acquire_single_instance(&test_name)
            .expect("third acquire should succeed after release");
        assert!(
            third.is_some(),
            "after dropping the guard, the mutex should be acquirable again"
        );
    }
}
