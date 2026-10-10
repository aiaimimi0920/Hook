use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::net::{Ipv4Addr, SocketAddr};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeIdentity {
    pub protocol: String,
    pub instance_id: String,
    pub endpoint: String,
    pub certificate_der_base64: String,
    pub certificate_sha256: String,
    pub auth_token: String,
}

impl std::fmt::Debug for BridgeIdentity {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("BridgeIdentity { [native credentials redacted] }")
    }
}

impl BridgeIdentity {
    pub(super) fn address(&self) -> anyhow::Result<SocketAddr> {
        anyhow::ensure!(
            self.protocol == "loom.local-bridge.v1",
            "Unsupported bridge protocol"
        );
        anyhow::ensure!(
            uuid::Uuid::parse_str(&self.instance_id).is_ok(),
            "Invalid bridge instance"
        );
        anyhow::ensure!(
            self.auth_token.len() == 64 && self.auth_token.bytes().all(|b| b.is_ascii_hexdigit()),
            "Invalid bridge credential"
        );
        let port = self
            .endpoint
            .strip_prefix("wss://127.0.0.1:")
            .and_then(|value| value.strip_suffix('/'))
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|port| *port != 0)
            .ok_or_else(|| anyhow::anyhow!("Nonlocal bridge endpoint"))?;
        anyhow::ensure!(
            self.endpoint == format!("wss://127.0.0.1:{port}/"),
            "Noncanonical bridge endpoint"
        );
        anyhow::ensure!(
            self.certificate_der_base64.len() <= 8192,
            "Oversized bridge certificate"
        );
        let der = base64::engine::general_purpose::STANDARD.decode(&self.certificate_der_base64)?;
        anyhow::ensure!(
            format!("{:x}", Sha256::digest(&der)) == self.certificate_sha256,
            "Invalid certificate pin"
        );
        Ok((Ipv4Addr::LOCALHOST, port).into())
    }
}
