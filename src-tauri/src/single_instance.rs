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

/// Build the per-install single-instance mutex name.
///
/// Appending a stable hash of the current executable path keeps separate
/// installs (or a portable copy) from blocking each other, and raises the bar
/// for a hostile process trying to pre-create a same-named mutex to deny
/// startup: it must also know the exact install location.
#[cfg(target_os = "windows")]
pub(crate) fn single_instance_name() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let exe = std::env::current_exe().unwrap_or_default();
    let mut hasher = DefaultHasher::new();
    exe.hash(&mut hasher);
    format!("{}.{:016x}", HOOK_SINGLE_INSTANCE_NAME, hasher.finish())
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
    fn single_instance_name_is_install_scoped_and_stable() {
        let first = single_instance_name();
        let second = single_instance_name();
        assert_eq!(first, second, "name must be stable within one install");
        assert!(
            first.starts_with(HOOK_SINGLE_INSTANCE_NAME),
            "name must keep the base prefix, got {first}"
        );
        assert_ne!(
            first, HOOK_SINGLE_INSTANCE_NAME,
            "name must be scoped past the bare base prefix"
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
            "second acquire should detect an existing Hook instance"
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
