//! Current-user Windows login startup. Never modifies machine-wide startup or other applications.
#[cfg(target_os = "windows")]
mod registry {
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::System::Registry::*;

    const RUN: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
    const APPROVED: PCWSTR =
        w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run");
    const NAME: PCWSTR = w!("Otter");

    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }

    fn read(path: PCWSTR, kind: REG_ROUTINE_FLAGS) -> Result<Option<Vec<u8>>, String> {
        let mut bytes = vec![0u8; 4096];
        let mut len = bytes.len() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                path,
                NAME,
                kind,
                None,
                Some(bytes.as_mut_ptr().cast()),
                Some(&mut len),
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        status.ok().map_err(|error| error.to_string())?;
        bytes.truncate(len as usize);
        Ok(Some(bytes))
    }

    fn write(path: PCWSTR, kind: REG_VALUE_TYPE, bytes: &[u8]) -> Result<(), String> {
        let mut handle = HKEY::default();
        unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                path,
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                None,
                &mut handle,
                None,
            )
        }
        .ok()
        .map_err(|error| error.to_string())?;
        let key = Key(handle);
        unsafe { RegSetValueExW(key.0, NAME, None, kind, Some(bytes)) }
            .ok()
            .map_err(|error| error.to_string())
    }

    pub fn enabled() -> Result<bool, String> {
        let present = read(RUN, RRF_RT_REG_SZ)?.is_some_and(|bytes| bytes.len() > 2);
        let approved = read(APPROVED, RRF_RT_REG_BINARY)?;
        Ok(present && !super::startup_disabled(approved.as_deref()))
    }

    pub fn set_enabled(enabled: bool) -> Result<(), String> {
        if !enabled {
            let status = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN, NAME) };
            return if status == ERROR_FILE_NOT_FOUND {
                Ok(())
            } else {
                status.ok().map_err(|error| error.to_string())
            };
        }
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let command = super::startup_command(&executable)?;
        let bytes: Vec<u8> = command
            .encode_utf16()
            .chain(Some(0))
            .flat_map(u16::to_le_bytes)
            .collect();
        write(RUN, REG_SZ, &bytes)?;
        // Respect Task Manager's disabled state until the user explicitly checks this menu item.
        if read(APPROVED, RRF_RT_REG_BINARY)?.is_some() {
            write(APPROVED, REG_BINARY, &[2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])?;
        }
        Ok(())
    }
}

fn startup_disabled(value: Option<&[u8]>) -> bool {
    value
        .and_then(|bytes| bytes.first())
        .is_some_and(|state| *state == 3 || *state == 7)
}

fn startup_command(executable: &std::path::Path) -> Result<String, String> {
    let path = executable.to_str().ok_or("自启动路径无法编码")?;
    if path.is_empty() || path.contains(['"', '\0', '\r', '\n']) {
        return Err("自启动路径无效".into());
    }
    // Quoting is required for portable installations containing spaces or Chinese characters.
    Ok(format!("\"{path}\""))
}

#[cfg(target_os = "windows")]
pub use registry::{enabled, set_enabled};
#[cfg(not(target_os = "windows"))]
pub fn enabled() -> Result<bool, String> {
    Ok(false)
}
#[cfg(not(target_os = "windows"))]
pub fn set_enabled(_: bool) -> Result<(), String> {
    Err("此平台暂不支持自启动".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quotes_portable_executable_without_shell_interpretation() {
        assert_eq!(
            startup_command(std::path::Path::new("C:\\我的应用\\Otter app\\otter.exe")).unwrap(),
            "\"C:\\我的应用\\Otter app\\otter.exe\""
        );
        assert!(startup_command(std::path::Path::new("bad\"path")).is_err());
    }
    #[test]
    fn honors_task_manager_disabled_state() {
        assert!(!startup_disabled(None));
        assert!(!startup_disabled(Some(&[2, 0, 0, 0])));
        assert!(startup_disabled(Some(&[3, 0, 0, 0])));
        assert!(startup_disabled(Some(&[7, 0, 0, 0])));
    }
}
