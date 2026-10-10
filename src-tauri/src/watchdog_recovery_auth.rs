// Recovery authority is ephemeral: only the capturing Hook process can sign a journal.
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use std::sync::OnceLock;

pub(crate) const MAX_JOURNAL_BYTES: usize = 64 * 1024;

fn signing_key() -> &'static SigningKey {
    static KEY: OnceLock<SigningKey> = OnceLock::new();
    KEY.get_or_init(|| SigningKey::generate(&mut rand_core::OsRng))
}

pub(crate) fn public_key() -> [u8; 32] {
    signing_key().verifying_key().to_bytes()
}

pub(crate) fn sign(payload: &[u8]) -> Result<Vec<u8>, String> {
    if payload.len() + 64 > MAX_JOURNAL_BYTES {
        return Err("Recovery journal exceeds limit".into());
    }
    let mut bytes = signing_key().sign(payload).to_bytes().to_vec();
    bytes.extend_from_slice(payload);
    Ok(bytes)
}

pub(crate) fn verify<'a>(bytes: &'a [u8], key: &[u8; 32]) -> Result<&'a [u8], String> {
    if bytes.len() < 64 || bytes.len() > MAX_JOURNAL_BYTES {
        return Err("Invalid recovery journal size".into());
    }
    let key = VerifyingKey::from_bytes(key).map_err(|_| "Invalid recovery public key")?;
    let signature =
        Signature::from_slice(&bytes[..64]).map_err(|_| "Invalid recovery signature")?;
    key.verify_strict(&bytes[64..], &signature)
        .map_err(|_| "Unauthenticated recovery journal")?;
    Ok(&bytes[64..])
}

#[cfg(windows)]
pub(crate) fn read_parent_key(
    parent: windows::Win32::Foundation::HANDLE,
    parent_pid: u32,
) -> Result<[u8; 32], String> {
    use std::io::Read;
    use std::os::windows::io::{AsRawHandle, FromRawHandle};
    use windows_sys::Win32::System::Pipes::{GetNamedPipeServerProcessId, PeekNamedPipe};
    use windows_sys::Win32::System::Threading::QueryFullProcessImageNameW;
    let mut image = vec![0u16; 32768];
    let mut length = image.len() as u32;
    if unsafe { QueryFullProcessImageNameW(parent.0, 0, image.as_mut_ptr(), &mut length) } == 0 {
        return Err("Cannot authenticate watchdog parent image".into());
    }
    let parent_image = std::fs::canonicalize(String::from_utf16_lossy(&image[..length as usize]))
        .map_err(|_| "Cannot resolve watchdog parent image")?;
    let self_image = std::fs::canonicalize(
        std::env::current_exe().map_err(|_| "Cannot resolve watchdog image")?,
    )
    .map_err(|_| "Cannot canonicalize watchdog image")?;
    if !parent_image
        .to_string_lossy()
        .eq_ignore_ascii_case(&self_image.to_string_lossy())
    {
        return Err("Watchdog parent is not the same Hook executable".into());
    }
    let input = std::io::stdin();
    let handle = input.as_raw_handle();
    let mut creator_pid = 0;
    // An arbitrary launcher cannot authenticate by supplying its own key or spoofed parent PID.
    if unsafe { GetNamedPipeServerProcessId(handle, &mut creator_pid) } == 0
        || creator_pid != parent_pid
    {
        return Err("Recovery key pipe does not belong to the Hook parent".into());
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let mut available = 0;
        if unsafe {
            PeekNamedPipe(
                handle,
                std::ptr::null_mut(),
                0,
                std::ptr::null_mut(),
                &mut available,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err("Recovery key pipe closed".into());
        }
        if available >= 32 {
            break;
        }
        if std::time::Instant::now() >= deadline {
            return Err("Recovery key handshake timed out".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    let mut key = [0; 32];
    // Avoid Stdin's buffered reader: prefetch would hide subsequent frames from PeekNamedPipe.
    let mut reader = std::mem::ManuallyDrop::new(unsafe { std::fs::File::from_raw_handle(handle) });
    reader
        .read_exact(&mut key)
        .map_err(|_| "Cannot read recovery key")?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn authenticated_key_pipe_child() {
        let Ok(pid) = std::env::var("HOOK_TEST_RECOVERY_PARENT") else {
            return;
        };
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
        let pid = pid.parse().unwrap();
        let parent = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.unwrap();
        let key = read_parent_key(parent, pid);
        let _ = unsafe { CloseHandle(parent) };
        if std::env::var_os("HOOK_TEST_RECOVERY_REJECT").is_some() {
            assert!(key.is_err());
        } else if std::env::var_os("HOOK_TEST_RECOVERY_FRAMES").is_some() {
            let key = key.unwrap();
            let mut feed = crate::watchdog_recovery_feed::Reader::default();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            loop {
                feed.poll(&key).unwrap();
                if feed
                    .latest()
                    .is_some_and(|bytes| verify(bytes, &key).unwrap() == b"empty")
                {
                    break;
                }
                assert!(std::time::Instant::now() < deadline);
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
        } else {
            assert_eq!(key.unwrap(), [42; 32]);
        }
    }

    #[cfg(windows)]
    #[test]
    fn authenticated_key_pipe_requires_a_real_parent_owned_pipe() {
        use std::io::Write;
        use std::process::{Command, Stdio};
        for mode in 0..3 {
            let valid = mode != 0;
            let mut command = Command::new(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    "watchdog_recovery_auth::tests::authenticated_key_pipe_child",
                    "--nocapture",
                ])
                .env("HOOK_TEST_RECOVERY_PARENT", std::process::id().to_string());
            if valid {
                command.stdin(Stdio::piped());
            } else {
                command
                    .stdin(Stdio::null())
                    .env("HOOK_TEST_RECOVERY_REJECT", "1");
            }
            if mode == 2 {
                command.env("HOOK_TEST_RECOVERY_FRAMES", "1");
            }
            let mut child = command.spawn().unwrap();
            if valid {
                let mut pipe = child.stdin.take().unwrap();
                pipe.write_all(&if mode == 2 { public_key() } else { [42; 32] })
                    .unwrap();
                if mode == 2 {
                    for payload in [vec![b'a'; 60_000], b"empty".to_vec()] {
                        let signed = sign(&payload).unwrap();
                        pipe.write_all(&(signed.len() as u32).to_le_bytes())
                            .unwrap();
                        pipe.write_all(&signed).unwrap();
                    }
                }
            }
            assert!(child.wait().unwrap().success());
        }
    }

    #[test]
    fn forged_modified_and_previous_process_journals_are_rejected() {
        let payload = br#"{"hookProcessId":42,"records":[]}"#;
        let signed = sign(payload).unwrap();
        assert_eq!(verify(&signed, &public_key()).unwrap(), payload);
        let other = SigningKey::generate(&mut rand_core::OsRng)
            .verifying_key()
            .to_bytes();
        assert!(verify(&signed, &other).is_err());
        let mut modified = signed.clone();
        *modified.last_mut().unwrap() ^= 1;
        assert!(verify(&modified, &public_key()).is_err());
        assert!(verify(payload, &public_key()).is_err());
        assert!(verify(&vec![0; MAX_JOURNAL_BYTES + 1], &public_key()).is_err());
    }
}
