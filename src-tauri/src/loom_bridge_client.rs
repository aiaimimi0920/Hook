//! Hook-owned implementation of the public loom.local-bridge.v1 transport contract.
//! Discovery secrets stay native; no anonymous or endpoint-only override is supported.
mod identity;
mod stream;

use base64::Engine;
pub(crate) use identity::BridgeIdentity;
use rustls::{
    pki_types::{CertificateDer, ServerName},
    ClientConfig, ClientConnection, RootCertStore, StreamOwned,
};
use std::{
    net::TcpStream,
    sync::Arc,
    time::{Duration, Instant},
};
use stream::BridgeStream;
use tungstenite::{client::IntoClientRequest, http::HeaderValue, WebSocket};

pub(crate) type BridgeSocket = WebSocket<StreamOwned<ClientConnection, BridgeStream>>;
const HANDSHAKE_LIMIT: Duration = Duration::from_secs(3);

pub(crate) fn enabled() -> bool {
    crate::read_env_bool("HOOK_ENABLE_LOOM_HOOK", false)
}

pub(crate) fn require_enabled() -> Result<(), String> {
    if enabled() {
        Ok(())
    } else {
        Err("Loom integration is disabled".into())
    }
}

pub(crate) fn connect(timeout: Duration) -> Result<BridgeSocket, String> {
    require_enabled()?;
    let manifest = crate::loom_connector::read_default_loom_manifest()
        .map_err(|_| "Trusted Loom discovery is unavailable")?;
    let identity = manifest
        .hook_bridge
        .ok_or("Authenticated Loom bridge is unavailable")?;
    if let Ok(endpoint) = std::env::var("LOOM_HOOK_WS_URL") {
        if !endpoint.trim().is_empty() && endpoint.trim() != identity.endpoint {
            return Err("Loom bridge endpoint override does not match trusted discovery".into());
        }
    }
    connect_identity(&identity, timeout).map_err(|_| "Loom bridge authentication failed".into())
}

fn connect_identity(identity: &BridgeIdentity, timeout: Duration) -> anyhow::Result<BridgeSocket> {
    let address = identity.address()?;
    let certificate =
        base64::engine::general_purpose::STANDARD.decode(&identity.certificate_der_base64)?;
    let mut trust = RootCertStore::empty();
    trust.add(CertificateDer::from(certificate.clone()))?;
    let config =
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_protocol_versions(&[&rustls::version::TLS13])?
            .with_root_certificates(trust)
            .with_no_client_auth();
    let deadline = Instant::now() + HANDSHAKE_LIMIT;
    let tcp = TcpStream::connect_timeout(&address, HANDSHAKE_LIMIT)?;
    let mut stream = BridgeStream::handshake(tcp, deadline)?;
    let mut tls = ClientConnection::new(Arc::new(config), ServerName::try_from("localhost")?)?;
    while tls.is_handshaking() {
        tls.complete_io(&mut stream)?;
    }
    anyhow::ensure!(
        tls.peer_certificates()
            .and_then(|chain| chain.first())
            .is_some_and(|leaf| leaf.as_ref() == certificate),
        "Unexpected Loom leaf certificate"
    );
    // TLS exporter avoids putting the raw token in tungstenite's serialized TRACE logs.
    let context = format!("{}:{}", identity.instance_id, identity.auth_token);
    let proof = tls.export_keying_material(
        [0u8; 32],
        b"EXPORTER-Loom-Local-Bridge-v1",
        Some(context.as_bytes()),
    )?;
    let proof: String = proof.iter().map(|byte| format!("{byte:02x}")).collect();
    let mut request = identity.endpoint.as_str().into_client_request()?;
    let mut auth = HeaderValue::from_str(&format!("LoomBridgeProof {proof}"))?;
    auth.set_sensitive(true);
    request.headers_mut().insert("authorization", auth);
    request
        .headers_mut()
        .insert("x-loom-bridge-instance", identity.instance_id.parse()?);
    let config = tungstenite::protocol::WebSocketConfig {
        max_message_size: Some(64 * 1024 * 1024),
        max_frame_size: Some(64 * 1024 * 1024),
        max_write_buffer_size: 65 * 1024 * 1024,
        ..Default::default()
    };
    let (mut socket, _) = tungstenite::client::client_with_config(
        request,
        StreamOwned::new(tls, stream),
        Some(config),
    )
    .map_err(|_| anyhow::anyhow!("Authenticated bridge upgrade failed"))?;
    socket.get_mut().sock.application(timeout)?;
    Ok(socket)
}

#[cfg(test)]
mod ipc_tests;
#[cfg(test)]
mod tests;
