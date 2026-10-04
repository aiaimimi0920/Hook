//! Ephemeral signing keys stay in memory; no private-key fixture enters Git.
use rcgen::{BasicConstraints, CertificateParams, IsCa, KeyPair, SanType};
use rustls::pki_types::PrivatePkcs8KeyDer;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

pub(crate) struct TlsFixture {
    pub(crate) ca_pem: String,
    config: Arc<rustls::ServerConfig>,
}

impl TlsFixture {
    pub(crate) fn new(wrong_name: bool, expired: bool) -> Self {
        let ca_key = KeyPair::generate().unwrap();
        let mut ca = CertificateParams::new(vec![]).unwrap();
        ca.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        let ca = ca.self_signed(&ca_key).unwrap();
        let key = KeyPair::generate().unwrap();
        let mut leaf = CertificateParams::new(vec![if wrong_name {
            "wrong-name.test".to_owned()
        } else {
            "localhost".to_owned()
        }])
        .unwrap();
        if !wrong_name {
            leaf.subject_alt_names
                .push(SanType::IpAddress("127.0.0.1".parse().unwrap()));
        }
        if expired {
            leaf.not_after = rcgen::date_time_ymd(2000, 1, 1);
        }
        let leaf = leaf.signed_by(&key, &ca, &ca_key).unwrap();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![leaf.der().clone()],
            PrivatePkcs8KeyDer::from(key.serialize_der()).into(),
        )
        .unwrap();
        Self {
            ca_pem: ca.pem(),
            config: Arc::new(config),
        }
    }

    pub(crate) fn serve(
        &self,
        response: Option<&'static str>,
    ) -> (String, JoinHandle<Result<(), String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("https://{}", listener.local_addr().unwrap());
        let config = self.config.clone();
        let thread = std::thread::spawn(move || {
            // Nonblocking accept also bounds cleanup if a regression prevents connection.
            listener.set_nonblocking(true).unwrap();
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let tcp = loop {
                match listener.accept() {
                    Ok((tcp, _)) => break tcp,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            std::time::Instant::now() < deadline,
                            "TLS fixture accept deadline"
                        );
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("TLS fixture accept: {error}"),
                }
            };
            // Windows accepted sockets inherit the listener's nonblocking mode.
            tcp.set_nonblocking(false).unwrap();
            tcp.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            tcp.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut tls =
                rustls::StreamOwned::new(rustls::ServerConnection::new(config).unwrap(), tcp);
            if let Some(response) = response {
                let mut request = Vec::new();
                let mut byte = [0];
                while request.len() < 8192 && !request.ends_with(b"\r\n\r\n") {
                    tls.read_exact(&mut byte)
                        .map_err(|error| format!("TLS fixture read: {error}"))?;
                    request.push(byte[0]);
                }
                tls.write_all(response.as_bytes())
                    .map_err(|error| format!("TLS fixture write: {error}"))?;
                tls.flush()
                    .map_err(|error| format!("TLS fixture flush: {error}"))?;
                // Orderly TLS shutdown avoids Windows resetting a still-active HTTP socket.
                tls.conn.send_close_notify();
                let _ = tls.flush();
                let _ = tls.sock.set_read_timeout(Some(Duration::from_millis(100)));
                let _ = tls.read(&mut byte);
            } else {
                let mut socket = tungstenite::accept(tls)
                    .map_err(|error| format!("TLS fixture WebSocket handshake: {error}"))?;
                socket
                    .send(tungstenite::Message::Text("verified".to_owned()))
                    .map_err(|error| format!("TLS fixture WebSocket send: {error}"))?;
                let _ = socket.read();
            }
            Ok(())
        });
        (origin, thread)
    }
}

pub(crate) const OK_RESPONSE: &str =
    "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";
