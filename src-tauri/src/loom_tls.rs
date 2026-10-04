//! Operator-provided CA trust belongs to one HTTPS Loom origin, never the OS store.
use reqwest::Url;
use rustls::pki_types::{pem::PemObject, CertificateDer};
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, OnceLock};

const MAX_CA_BYTES: usize = 32 * 1024;
const MAX_CA_CERTIFICATES: usize = 8;
static TRUST: OnceLock<Result<Option<ScopedTrust>, TrustError>> = OnceLock::new();

#[derive(Clone, Copy, Debug, thiserror::Error)]
#[error("Hook Loom TLS configuration: {0}")]
pub(crate) struct TrustError(&'static str);

#[derive(Debug, thiserror::Error)]
pub(crate) enum ClientBuildError {
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error(transparent)]
    Trust(#[from] TrustError),
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(crate) struct TrustKey {
    origin: String,
    ca_sha256: [u8; 32],
}

pub(crate) struct ScopedTrust {
    pub(crate) key: TrustKey,
    config: Arc<rustls::ClientConfig>,
}

fn scope_origin(value: &str) -> Result<String, TrustError> {
    let url = Url::parse(value).map_err(|_| TrustError("origin must be a valid HTTPS origin"))?;
    if value.bytes().any(|byte| byte.is_ascii_whitespace())
        || url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(TrustError(
            "origin must contain only HTTPS scheme, host and port",
        ));
    }
    Ok(url.origin().ascii_serialization())
}

impl ScopedTrust {
    pub(crate) fn from_pem(origin: &str, pem: &[u8]) -> Result<Self, TrustError> {
        let origin = scope_origin(origin)?;
        if pem.len() > MAX_CA_BYTES {
            return Err(TrustError("CA file exceeds 32768 bytes"));
        }
        let mut remaining = std::str::from_utf8(pem)
            .map_err(|_| TrustError("CA file must contain certificate PEM only"))?;
        let mut roots = rustls::RootCertStore::empty();
        let mut count = 0;
        while !remaining.trim().is_empty() {
            remaining = remaining.trim_start();
            if !remaining.starts_with("-----BEGIN CERTIFICATE-----") {
                return Err(TrustError("CA file must contain certificate PEM only"));
            }
            let end = remaining
                .find("-----END CERTIFICATE-----")
                .ok_or(TrustError("CA certificate PEM is incomplete"))?
                + "-----END CERTIFICATE-----".len();
            let cert = CertificateDer::from_pem_slice(remaining[..end].as_bytes())
                .map_err(|_| TrustError("CA certificate PEM is invalid"))?;
            roots
                .add(cert)
                .map_err(|_| TrustError("CA certificate DER is invalid"))?;
            count += 1;
            if count > MAX_CA_CERTIFICATES {
                return Err(TrustError("CA file exceeds 8 certificates"));
            }
            remaining = &remaining[end..];
        }
        if count == 0 {
            return Err(TrustError("CA file contains no certificates"));
        }
        roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let config = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(|_| TrustError("TLS protocol configuration is unavailable"))?
        .with_root_certificates(roots)
        .with_no_client_auth();
        Ok(Self {
            key: TrustKey {
                origin,
                ca_sha256: Sha256::digest(pem).into(),
            },
            config: Arc::new(config),
        })
    }

    pub(crate) fn matches(&self, endpoint: &str) -> bool {
        let Ok(mut url) = Url::parse(endpoint) else {
            return false;
        };
        if !url.username().is_empty() || url.password().is_some() {
            return false;
        }
        if url.scheme() == "wss" {
            let _ = url.set_scheme("https");
        }
        url.scheme() == "https" && url.origin().ascii_serialization() == self.key.origin
    }

    pub(crate) fn apply_http(&self, builder: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
        builder
            .use_preconfigured_tls((*self.config).clone())
            .redirect(reqwest::redirect::Policy::none())
    }

    pub(crate) fn apply_blocking(
        &self,
        builder: reqwest::blocking::ClientBuilder,
    ) -> reqwest::blocking::ClientBuilder {
        builder
            .use_preconfigured_tls((*self.config).clone())
            .redirect(reqwest::redirect::Policy::none())
    }

    fn connector(&self) -> tungstenite::Connector {
        tungstenite::Connector::Rustls(self.config.clone())
    }
}

fn load_config(
    origin: Option<OsString>,
    path: Option<OsString>,
) -> Result<Option<ScopedTrust>, TrustError> {
    let (origin, path) = match (origin, path) {
        (None, None) => return Ok(None),
        (Some(origin), Some(path)) => (origin, path),
        _ => {
            return Err(TrustError(
                "HOOK_LOOM_TLS_ORIGIN and HOOK_LOOM_TLS_CA_FILE must be set together",
            ))
        }
    };
    let origin = origin.to_str().ok_or(TrustError("origin must be UTF-8"))?;
    scope_origin(origin)?;
    let path = Path::new(&path);
    if !path.is_absolute() {
        return Err(TrustError("CA file path must be absolute"));
    }
    let file = std::fs::File::open(path).map_err(|_| TrustError("CA file cannot be opened"))?;
    if !file
        .metadata()
        .map_err(|_| TrustError("CA file cannot be inspected"))?
        .is_file()
    {
        return Err(TrustError("CA path must be a regular file"));
    }
    let mut bytes = Vec::new();
    file.take((MAX_CA_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| TrustError("CA file cannot be read"))?;
    ScopedTrust::from_pem(origin, &bytes).map(Some)
}

pub(crate) fn for_endpoint(endpoint: &str) -> Result<Option<&'static ScopedTrust>, TrustError> {
    // Immutable for this process: rotating the operator CA requires a restart, not polling I/O.
    TRUST
        .get_or_init(|| {
            load_config(
                std::env::var_os("HOOK_LOOM_TLS_ORIGIN"),
                std::env::var_os("HOOK_LOOM_TLS_CA_FILE"),
            )
        })
        .as_ref()
        .map(|trust| trust.as_ref().filter(|trust| trust.matches(endpoint)))
        .map_err(|error| *error)
}

pub(crate) fn websocket_connector(url: &Url) -> Result<Option<tungstenite::Connector>, TrustError> {
    Ok(for_endpoint(url.as_str())?.map(ScopedTrust::connector))
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_config;
#[cfg(test)]
pub(crate) mod tests_support;
