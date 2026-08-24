//! Platform storage protection for the device identity private key.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;

pub(super) const LEGACY_IDENTITY_SCHEMA_VERSION: u32 = 1;
pub(super) const PROTECTED_IDENTITY_SCHEMA_VERSION: u32 = 2;
const DPAPI_PREFIX: &str = "DPAPI1:";

pub(super) struct DecodedPrivateKey {
    pub(super) encoded: String,
    pub(super) needs_migration: bool,
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use std::slice;
    use windows::core::w;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    struct LocalBlob(CRYPT_INTEGER_BLOB);

    impl Drop for LocalBlob {
        fn drop(&mut self) {
            if !self.0.pbData.is_null() {
                unsafe {
                    slice::from_raw_parts_mut(self.0.pbData, self.0.cbData as usize).fill(0);
                    let _ = LocalFree(Some(HLOCAL(self.0.pbData.cast::<c_void>())));
                }
            }
        }
    }

    fn input_blob(bytes: &mut [u8]) -> Result<CRYPT_INTEGER_BLOB, String> {
        Ok(CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(bytes.len())
                .map_err(|_| "Hook device private key is too large".to_owned())?,
            pbData: bytes.as_mut_ptr(),
        })
    }

    pub(super) fn protect(encoded: &str) -> Result<String, String> {
        let mut plaintext = BASE64
            .decode(encoded.trim())
            .map_err(|_| "Hook device private key is not valid Base64".to_owned())?;
        if plaintext.len() != 32 {
            plaintext.fill(0);
            return Err("Hook device private key must contain 32 Ed25519 bytes".to_owned());
        }
        let input = input_blob(&mut plaintext)?;
        let mut output = LocalBlob(CRYPT_INTEGER_BLOB::default());
        let result = unsafe {
            CryptProtectData(
                &input,
                w!("Hook device identity"),
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output.0,
            )
        };
        plaintext.fill(0);
        result.map_err(|_| "protect Hook device identity private key".to_owned())?;
        if output.0.pbData.is_null() || output.0.cbData == 0 {
            return Err("protect Hook device identity private key".to_owned());
        }
        let protected = unsafe { slice::from_raw_parts(output.0.pbData, output.0.cbData as usize) };
        Ok(format!("{DPAPI_PREFIX}{}", BASE64.encode(protected)))
    }

    pub(super) fn unprotect(stored: &str) -> Result<String, String> {
        let payload = stored
            .strip_prefix(DPAPI_PREFIX)
            .ok_or_else(|| "Hook device identity has an invalid DPAPI envelope".to_owned())?;
        let mut protected = BASE64
            .decode(payload)
            .map_err(|_| "Hook device identity has an invalid DPAPI envelope".to_owned())?;
        let input = input_blob(&mut protected)?;
        let mut output = LocalBlob(CRYPT_INTEGER_BLOB::default());
        unsafe {
            CryptUnprotectData(
                &input,
                None,
                None,
                None,
                None,
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output.0,
            )
        }
        .map_err(|_| "unprotect Hook device identity private key".to_owned())?;
        if output.0.pbData.is_null() || output.0.cbData != 32 {
            return Err("unprotect Hook device identity private key".to_owned());
        }
        let plaintext = unsafe { slice::from_raw_parts(output.0.pbData, output.0.cbData as usize) };
        Ok(BASE64.encode(plaintext))
    }
}

pub(super) fn encode_for_storage(encoded: &str) -> Result<(u32, String), String> {
    #[cfg(windows)]
    {
        return platform::protect(encoded)
            .map(|protected| (PROTECTED_IDENTITY_SCHEMA_VERSION, protected));
    }
    #[cfg(not(windows))]
    {
        Ok((LEGACY_IDENTITY_SCHEMA_VERSION, encoded.to_owned()))
    }
}

pub(super) fn decode_from_storage(
    schema_version: u32,
    stored: &str,
) -> Result<DecodedPrivateKey, String> {
    match schema_version {
        LEGACY_IDENTITY_SCHEMA_VERSION => Ok(DecodedPrivateKey {
            encoded: stored.to_owned(),
            needs_migration: cfg!(windows),
        }),
        PROTECTED_IDENTITY_SCHEMA_VERSION => {
            #[cfg(windows)]
            {
                platform::unprotect(stored).map(|encoded| DecodedPrivateKey {
                    encoded,
                    needs_migration: false,
                })
            }
            #[cfg(not(windows))]
            {
                let _ = stored;
                Err("Hook device identity requires Windows DPAPI".to_owned())
            }
        }
        version => Err(format!("unsupported Hook device identity schema {version}")),
    }
}
