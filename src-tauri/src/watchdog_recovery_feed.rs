// Only the parent-owned pipe selects the current snapshot; disk copies cannot replay it.
use crate::watchdog_recovery_auth::{self as auth, MAX_JOURNAL_BYTES};
use std::io::{Read, Write};
use std::process::ChildStdin;
use std::sync::{Mutex, OnceLock};

fn writer() -> &'static Mutex<Option<ChildStdin>> {
    static WRITER: OnceLock<Mutex<Option<ChildStdin>>> = OnceLock::new();
    WRITER.get_or_init(|| Mutex::new(None))
}

#[cfg(all(windows, test))]
pub(crate) fn uninstall_for_test() {
    if let Ok(mut guard) = writer().lock() {
        *guard = None;
    }
}

pub(crate) fn install(mut pipe: ChildStdin) -> Result<(), String> {
    pipe.write_all(&auth::public_key())
        .map_err(|_| "Cannot send recovery key")?;
    *writer().lock().map_err(|_| "Recovery pipe lock poisoned")? = Some(pipe);
    Ok(())
}

pub(crate) fn publish(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_JOURNAL_BYTES {
        return Err("Recovery snapshot exceeds limit".into());
    }
    let mut guard = writer().lock().map_err(|_| "Recovery pipe lock poisoned")?;
    let pipe = guard
        .as_mut()
        .ok_or("Authenticated watchdog is unavailable")?;
    pipe.write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|_| pipe.write_all(bytes))
        .map_err(|_| "Cannot publish current recovery snapshot".into())
}

#[derive(Default)]
pub(crate) struct Reader {
    pending: Vec<u8>,
    latest: Option<Vec<u8>>,
}

impl Reader {
    fn ingest(&mut self, bytes: &[u8], key: &[u8; 32]) -> Result<(), String> {
        if self.pending.len() + bytes.len() > MAX_JOURNAL_BYTES + 4100 {
            return Err("Recovery buffer exceeded limit".into());
        }
        self.pending.extend_from_slice(bytes);
        while self.pending.len() >= 4 {
            let length = u32::from_le_bytes(self.pending[..4].try_into().unwrap()) as usize;
            if !(64..=MAX_JOURNAL_BYTES).contains(&length) {
                return Err("Invalid recovery frame size".into());
            }
            if self.pending.len() < length + 4 {
                break;
            }
            let signed = self.pending[4..length + 4].to_vec();
            auth::verify(&signed, key)?;
            self.latest = Some(signed);
            self.pending.drain(..length + 4);
        }
        Ok(())
    }
    pub(crate) fn latest(&self) -> Option<&[u8]> {
        self.latest.as_deref()
    }

    #[cfg(windows)]
    pub(crate) fn poll(&mut self, key: &[u8; 32]) -> Result<(), String> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle};
        use windows_sys::Win32::System::Pipes::PeekNamedPipe;
        let input = std::io::stdin();
        // Borrow without closing stdin, and never prefetch past the announced frame bytes.
        let mut reader = std::mem::ManuallyDrop::new(unsafe {
            std::fs::File::from_raw_handle(input.as_raw_handle())
        });
        for _ in 0..32 {
            let mut available = 0;
            if unsafe {
                PeekNamedPipe(
                    input.as_raw_handle(),
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null_mut(),
                    &mut available,
                    std::ptr::null_mut(),
                )
            } == 0
            {
                if std::io::Error::last_os_error().raw_os_error() == Some(109) {
                    return Ok(());
                }
                return Err("Recovery pipe read failed".into());
            }
            if available == 0 {
                return Ok(());
            }
            let mut bytes = [0; 4096];
            let length = (available as usize).min(bytes.len());
            reader
                .read_exact(&mut bytes[..length])
                .map_err(|_| "Recovery frame read failed")?;
            self.ingest(&bytes[..length], key)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn current_parent_snapshot_replaces_revoked_records() {
        let mut reader = Reader::default();
        for payload in [b"active".as_slice(), b"empty".as_slice()] {
            let signed = auth::sign(payload).unwrap();
            let frame = [(signed.len() as u32).to_le_bytes().as_slice(), &signed].concat();
            for chunk in frame.chunks(7) {
                reader.ingest(chunk, &auth::public_key()).unwrap();
            }
            assert_eq!(
                auth::verify(reader.latest().unwrap(), &auth::public_key()).unwrap(),
                payload
            );
        }
        assert!(reader
            .ingest(&u32::MAX.to_le_bytes(), &auth::public_key())
            .is_err());
    }
}
