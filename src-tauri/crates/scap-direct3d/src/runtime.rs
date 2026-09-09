//! Keep WinRT factory caches valid across short-lived capture apartments.

use std::sync::OnceLock;
use windows::Win32::System::Com::CoIncrementMTAUsage;
use windows::core::{Error, HRESULT};

pub(crate) fn ensure_runtime() -> windows::core::Result<()> {
    // windows-rs caches agile factories for the process lifetime. Tearing down
    // the last MTA apartment unloads their implementation but not those caches.
    // One process-lifetime usage cookie keeps COM metadata alive, NOT capture
    // sessions, frame pools, D3D devices, textures, or compositor threads.
    // Do not decrement per capture: factories may be reused by the next one.
    static MTA_USAGE: OnceLock<Result<usize, HRESULT>> = OnceLock::new();
    match MTA_USAGE.get_or_init(|| {
        unsafe { CoIncrementMTAUsage() }
            .map(|cookie| cookie.0 as usize)
            .map_err(|error| error.code())
    }) {
        Ok(_) => Ok(()),
        Err(code) => Err(Error::from(*code)),
    }
}
