// Allows same-user input only down the UIPI boundary, on the active default desktop.
#[cfg(target_os = "windows")]
fn live_source_input_preflight(process_id: u32) -> Result<(), String> {
    ensure_live_input_desktop()?;
    let mut current_session = 0u32;
    let mut source_session = 0u32;
    unsafe {
        windows::Win32::System::RemoteDesktop::ProcessIdToSessionId(
            std::process::id(),
            &mut current_session,
        )
        .map_err(|_| "different_session".to_string())?;
        windows::Win32::System::RemoteDesktop::ProcessIdToSessionId(
            process_id,
            &mut source_session,
        )
        .map_err(|_| "different_session".to_string())?;
    }
    if current_session != source_session {
        return Err("different_session".to_string());
    }
    let current = live_input_process_identity(std::process::id())?;
    let source = live_input_process_identity(process_id)?;
    if !live_input_identity_allows(&current, &source) {
        return Err("permission_denied".to_string());
    }
    Ok(())
}

fn live_input_integrity_allows(controller: u32, source: u32) -> bool {
    controller >= source
}

struct LiveInputProcessIdentity {
    integrity_level: u32,
    user_sid: Vec<u8>,
}

fn live_input_identity_allows(
    controller: &LiveInputProcessIdentity,
    source: &LiveInputProcessIdentity,
) -> bool {
    !controller.user_sid.is_empty()
        && controller.user_sid == source.user_sid
        && live_input_integrity_allows(controller.integrity_level, source.integrity_level)
}

#[cfg(target_os = "windows")]
fn ensure_live_input_desktop() -> Result<(), String> {
    use windows::Win32::System::StationsAndDesktops::{
        CloseDesktop, GetThreadDesktop, OpenInputDesktop, DESKTOP_CONTROL_FLAGS,
        DESKTOP_READOBJECTS,
    };

    let current =
        unsafe { GetThreadDesktop(windows::Win32::System::Threading::GetCurrentThreadId()) }
            .map_err(|_| "secure_desktop".to_string())?;
    let input = unsafe { OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_READOBJECTS) }
        .map_err(|_| "secure_desktop".to_string())?;
    let result = (|| {
        let current_name = live_desktop_name(current)?;
        let input_name = live_desktop_name(input)?;
        if !current_name.eq_ignore_ascii_case("default")
            || !input_name.eq_ignore_ascii_case("default")
            || !current_name.eq_ignore_ascii_case(&input_name)
        {
            return Err("secure_desktop".to_string());
        }
        Ok(())
    })();
    let _ = unsafe { CloseDesktop(input) };
    result
}

#[cfg(test)]
mod live_source_security_tests {
    use super::*;
    include!("tests/live_source_security_tests.rs");
}

#[cfg(target_os = "windows")]
fn live_desktop_name(
    desktop: windows::Win32::System::StationsAndDesktops::HDESK,
) -> Result<String, String> {
    use windows::Win32::System::StationsAndDesktops::{GetUserObjectInformationW, UOI_NAME};

    let mut needed = 0u32;
    let _ = unsafe {
        GetUserObjectInformationW(
            windows::Win32::Foundation::HANDLE(desktop.0),
            UOI_NAME,
            None,
            0,
            Some(&mut needed),
        )
    };
    if needed < 2 || needed > 1024 {
        return Err("secure_desktop".to_string());
    }
    let mut name = vec![0u16; (needed as usize).div_ceil(2)];
    unsafe {
        GetUserObjectInformationW(
            windows::Win32::Foundation::HANDLE(desktop.0),
            UOI_NAME,
            Some(name.as_mut_ptr().cast()),
            needed,
            Some(&mut needed),
        )
    }
    .map_err(|_| "secure_desktop".to_string())?;
    let length = name
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(name.len());
    String::from_utf16(&name[..length]).map_err(|_| "secure_desktop".to_string())
}

#[cfg(target_os = "windows")]
fn live_input_process_identity(process_id: u32) -> Result<LiveInputProcessIdentity, String> {
    let process = unsafe {
        windows::Win32::System::Threading::OpenProcess(
            windows::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            process_id,
        )
    }
    .map_err(|_| "permission_denied".to_string())?;
    let mut token = windows::Win32::Foundation::HANDLE::default();
    let result = (|| {
        unsafe {
            windows::Win32::System::Threading::OpenProcessToken(
                process,
                windows::Win32::Security::TOKEN_QUERY,
                &mut token,
            )
        }
        .map_err(|_| "permission_denied".to_string())?;
        let storage = live_input_token_information(
            token,
            windows::Win32::Security::TokenIntegrityLevel,
        )?;
        let label = unsafe {
            &*(storage.as_ptr() as *const windows::Win32::Security::TOKEN_MANDATORY_LABEL)
        };
        let count = unsafe { *windows::Win32::Security::GetSidSubAuthorityCount(label.Label.Sid) };
        if count == 0 {
            return Err("permission_denied".to_string());
        }
        let integrity_level = unsafe {
            *windows::Win32::Security::GetSidSubAuthority(label.Label.Sid, u32::from(count - 1))
        };
        let user_storage =
            live_input_token_information(token, windows::Win32::Security::TokenUser)?;
        let user = unsafe {
            &*(user_storage.as_ptr() as *const windows::Win32::Security::TOKEN_USER)
        };
        let sid_len = unsafe { windows::Win32::Security::GetLengthSid(user.User.Sid) } as usize;
        if !(8..=68).contains(&sid_len) {
            return Err("permission_denied".to_string());
        }
        // Copy only the SID bytes while the token information buffer is alive.
        let user_sid = unsafe {
            std::slice::from_raw_parts(user.User.Sid.0.cast::<u8>(), sid_len).to_vec()
        };
        Ok(LiveInputProcessIdentity { integrity_level, user_sid })
    })();
    if !token.is_invalid() {
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(token) };
    }
    let _ = unsafe { windows::Win32::Foundation::CloseHandle(process) };
    result
}

#[cfg(target_os = "windows")]
fn live_input_token_information(
    token: windows::Win32::Foundation::HANDLE,
    class: windows::Win32::Security::TOKEN_INFORMATION_CLASS,
) -> Result<Vec<usize>, String> {
    use windows::Win32::Security::GetTokenInformation;
    let mut needed = 0u32;
    let _ = unsafe { GetTokenInformation(token, class, None, 0, &mut needed) };
    if needed < std::mem::size_of::<windows::Win32::Security::TOKEN_USER>() as u32
        || needed > 65_536
    {
        return Err("permission_denied".to_string());
    }
    let mut storage = vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
    unsafe { GetTokenInformation(token, class, Some(storage.as_mut_ptr().cast()), needed, &mut needed) }
        .map_err(|_| "permission_denied".to_string())?;
    Ok(storage)
}
