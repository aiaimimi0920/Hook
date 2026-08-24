// Owns stable display/window identifiers and process executable lookup.

#[derive(Clone, PartialEq, Debug)]
pub struct DisplayIdImpl(u64);

impl std::fmt::Display for DisplayIdImpl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for DisplayIdImpl {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        s.parse()
            .map(Self)
            .map_err(|_| "Invalid display ID".to_string())
    }
}

#[derive(Clone, PartialEq, Debug)]
pub struct WindowIdImpl(u64);

impl std::fmt::Display for WindowIdImpl {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl FromStr for WindowIdImpl {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        s.parse()
            .map(Self)
            .map_err(|_| "Invalid window ID".to_string())
    }
}

unsafe fn pid_to_exe_path(pid: u32) -> Result<PathBuf, windows::core::Error> {
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }?;
    if handle.is_invalid() {
        return Err(windows::core::Error::from_win32());
    }
    let mut lpexename = [0u16; 1024];
    let mut lpdwsize = lpexename.len() as u32;

    let query = unsafe {
        QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT::default(),
            windows::core::PWSTR(lpexename.as_mut_ptr()),
            &mut lpdwsize,
        )
    };
    unsafe { CloseHandle(handle) }.ok();
    query?;

    let os_str = &OsString::from_wide(&lpexename[..lpdwsize as usize]);
    Ok(PathBuf::from(os_str))
}
