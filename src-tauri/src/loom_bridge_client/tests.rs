use super::*;
use rustls::{pki_types::PrivatePkcs8KeyDer, ServerConfig, ServerConnection};
use sha2::{Digest, Sha256};
use std::{net::TcpListener, thread};

pub(super) fn fixture() -> (TcpListener, BridgeIdentity, Arc<ServerConfig>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let rcgen::CertifiedKey { cert, key_pair } =
        rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
    let identity = BridgeIdentity {
        protocol: "loom.local-bridge.v1".into(),
        instance_id: uuid::Uuid::new_v4().to_string(),
        endpoint: format!("wss://127.0.0.1:{}/", listener.local_addr().unwrap().port()),
        certificate_der_base64: base64::engine::general_purpose::STANDARD.encode(cert.der()),
        certificate_sha256: format!("{:x}", Sha256::digest(cert.der())),
        auth_token: "a1".repeat(32),
    };
    let config =
        ServerConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_protocol_versions(&[&rustls::version::TLS13])
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(
                vec![cert.der().clone()],
                PrivatePkcs8KeyDer::from(key_pair.serialize_der()).into(),
            )
            .unwrap();
    (listener, identity, Arc::new(config))
}

#[test]
fn disabled_connector_rejects_before_discovery_or_network() {
    if std::env::var_os("HOOK_BRIDGE_DISABLED_TEST_CHILD").is_some() {
        assert!(!enabled());
        assert!(
            matches!(connect(Duration::from_millis(1)), Err(error) if error == "Loom integration is disabled")
        );
        return;
    }
    for value in [None, Some("0"), Some("false")] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "loom_bridge_client::tests::disabled_connector_rejects_before_discovery_or_network",
                "--test-threads=1",
            ])
            .env("HOOK_BRIDGE_DISABLED_TEST_CHILD", "1")
            .env_remove("HOOK_ENABLE_LOOM_HOOK")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        if let Some(value) = value {
            command.env("HOOK_ENABLE_LOOM_HOOK", value);
        }
        let mut child = command.spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        while child.try_wait().unwrap().is_none() {
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("Disabled connector child did not terminate");
            }
            thread::sleep(Duration::from_millis(10));
        }
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stdout)
        );
    }
}

#[test]
fn pinned_client_proves_discovery_authority_before_application_messages() {
    let (listener, identity, config) = fixture();
    let expected = identity.clone();
    let worker = thread::spawn(move || {
        let mut stream = BridgeStream::handshake(
            listener.accept().unwrap().0,
            Instant::now() + HANDSHAKE_LIMIT,
        )
        .unwrap();
        let mut tls = ServerConnection::new(config).unwrap();
        while tls.is_handshaking() {
            tls.complete_io(&mut stream).unwrap();
        }
        let context = format!("{}:{}", expected.instance_id, expected.auth_token);
        let proof = tls
            .export_keying_material(
                [0u8; 32],
                b"EXPORTER-Loom-Local-Bridge-v1",
                Some(context.as_bytes()),
            )
            .unwrap();
        let proof: String = proof.iter().map(|b| format!("{b:02x}")).collect();
        let mut socket = tungstenite::accept_hdr(
            StreamOwned::new(tls, stream),
            |request: &tungstenite::handshake::server::Request, response| {
                assert_eq!(
                    request.headers()["authorization"],
                    format!("LoomBridgeProof {proof}")
                );
                assert_eq!(
                    request.headers()["x-loom-bridge-instance"],
                    expected.instance_id
                );
                assert!(!format!("{request:?}").contains(&expected.auth_token));
                Ok(response)
            },
        )
        .unwrap();
        let message = socket.read().unwrap();
        socket.send(message).unwrap();
    });
    let mut socket = connect_identity(&identity, Duration::from_secs(2)).unwrap();
    socket
        .send(tungstenite::Message::Text("authenticated".into()))
        .unwrap();
    assert_eq!(socket.read().unwrap().to_text().unwrap(), "authenticated");
    worker.join().unwrap();
}

#[test]
fn wrong_certificate_cannot_receive_client_upgrade() {
    let (listener, mut identity, config) = fixture();
    let (_, other, _) = fixture();
    identity.certificate_der_base64 = other.certificate_der_base64;
    identity.certificate_sha256 = other.certificate_sha256;
    let worker = thread::spawn(move || {
        let mut stream = BridgeStream::handshake(
            listener.accept().unwrap().0,
            Instant::now() + HANDSHAKE_LIMIT,
        )
        .unwrap();
        let mut tls = ServerConnection::new(config).unwrap();
        loop {
            if tls.complete_io(&mut stream).is_err() {
                break;
            }
            if !tls.is_handshaking() {
                break;
            }
        }
        let mut bytes = [0u8; 1024];
        use std::io::Read;
        assert!(!matches!(tls.reader().read(&mut bytes), Ok(n) if n > 0));
    });
    assert!(connect_identity(&identity, Duration::from_secs(1)).is_err());
    worker.join().unwrap();
}

#[test]
fn discovery_rejects_plaintext_external_endpoints_and_serialized_secrets() {
    let (_, identity, _) = fixture();
    for endpoint in [
        "ws://127.0.0.1:19820",
        "wss://example.com:19820/",
        "wss://127.0.0.1:19820/?token=x",
    ] {
        let mut candidate = identity.clone();
        candidate.endpoint = endpoint.into();
        assert!(candidate.address().is_err());
    }
    assert!(!format!("{identity:?}").contains(&identity.auth_token));
    let manifest: crate::loom_connector::LoomManifest = serde_json::from_value(serde_json::json!({
        "schemaVersion":1,"appId":"loom","displayName":"Loom","version":"0.2.1",
        "transport":{"type":"http","baseUrl":"http://127.0.0.1:1"},
        "hookBridge":{"protocol":identity.protocol,"instanceId":identity.instance_id,"endpoint":identity.endpoint,
            "certificateDerBase64":identity.certificate_der_base64,"certificateSha256":identity.certificate_sha256,"authToken":identity.auth_token}
    })).unwrap();
    assert!(manifest.hook_bridge.is_some());
    assert!(serde_json::to_value(manifest)
        .unwrap()
        .get("hookBridge")
        .is_none());
}
