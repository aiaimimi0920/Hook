use super::tests_support::{TlsFixture, OK_RESPONSE};
use super::*;
use std::time::Duration;
use tungstenite::client::IntoClientRequest;

#[test]
fn trust_matches_only_one_canonical_https_or_wss_origin() {
    let fixture = TlsFixture::new(false, false);
    let trust = ScopedTrust::from_pem("https://LOOM.test:443/", fixture.ca_pem.as_bytes()).unwrap();
    for endpoint in [
        "https://loom.test/v1/devices",
        "wss://loom.test/v1/live/media?sessionId=x",
    ] {
        assert!(trust.matches(endpoint), "{endpoint}");
    }
    for endpoint in [
        "https://loom.test:444",
        "https://other.test",
        "http://loom.test",
        "ws://loom.test",
        "https://user@loom.test",
        "https://loom.test.evil",
    ] {
        assert!(!trust.matches(endpoint), "{endpoint}");
    }
}

#[test]
fn configured_origin_and_environment_pairs_fail_closed() {
    for origin in [
        "http://127.0.0.1",
        "wss://loom.test",
        "https://u:p@loom.test",
        "https://loom.test/path",
        "https://loom.test/?q=x",
        "https://loom.test/#x",
        " https://loom.test",
        "https://loo\tm.test",
    ] {
        assert!(scope_origin(origin).is_err(), "{origin}");
    }
    assert!(load_config(None, None).unwrap().is_none());
    assert!(load_config(Some("https://loom.test".into()), None).is_err());
    assert!(load_config(None, Some("ca.pem".into())).is_err());
    assert!(load_config(
        Some("https://loom.test".into()),
        Some("relative.pem".into())
    )
    .is_err());
    assert!(load_config(
        Some("https://loom.test".into()),
        Some(std::env::temp_dir().into_os_string())
    )
    .is_err());
}

#[test]
fn pem_requires_bounded_nonempty_certificates_and_rejects_keys_or_junk() {
    let fixture = TlsFixture::new(false, false);
    for pem in [
        b"".as_slice(),
        b" ",
        b"-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----",
        b"-----BEGIN CERTIFICATE-----\nx",
        b"-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----",
    ] {
        assert!(ScopedTrust::from_pem("https://loom.test", pem).is_err());
    }
    assert!(ScopedTrust::from_pem("https://loom.test", &vec![b' '; MAX_CA_BYTES + 1]).is_err());
    assert!(
        ScopedTrust::from_pem("https://loom.test", fixture.ca_pem.repeat(9).as_bytes()).is_err()
    );
    assert!(ScopedTrust::from_pem(
        "https://loom.test",
        format!("{}junk", fixture.ca_pem).as_bytes()
    )
    .is_err());
    assert!(ScopedTrust::from_pem(
        "https://loom.test",
        format!("{}\n", fixture.ca_pem).as_bytes()
    )
    .is_ok());
}

#[test]
fn cache_identity_includes_origin_and_ca_digest() {
    let first = TlsFixture::new(false, false);
    let second = TlsFixture::new(false, false);
    let a = ScopedTrust::from_pem("https://loom.test", first.ca_pem.as_bytes()).unwrap();
    let b = ScopedTrust::from_pem("https://other.test", first.ca_pem.as_bytes()).unwrap();
    let c = ScopedTrust::from_pem("https://loom.test", second.ca_pem.as_bytes()).unwrap();
    assert_ne!(a.key, b.key);
    assert_ne!(a.key, c.key);
}

#[test]
fn blocking_https_accepts_only_valid_scoped_certificates() {
    for (wrong_name, expired, custom_ca, expected) in [
        (false, false, true, true),
        (false, false, false, false),
        (true, false, true, false),
        (false, true, true, false),
    ] {
        let fixture = TlsFixture::new(wrong_name, expired);
        let (origin, thread) = fixture.serve(Some(OK_RESPONSE));
        let trust = ScopedTrust::from_pem(&origin, fixture.ca_pem.as_bytes()).unwrap();
        let builder = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(3));
        let builder = if custom_ca {
            trust.apply_blocking(builder)
        } else {
            builder
        };
        let response = builder.build().unwrap().get(&origin).send();
        let response = response.and_then(|response| response.text());
        let server = thread.join().unwrap();
        assert_eq!(
            response.is_ok(),
            expected,
            "wrong_name={wrong_name}, expired={expired}, custom_ca={custom_ca}, error={:?}, server={server:?}", response.as_ref().err()
        );
        if let Ok(body) = response {
            assert_eq!(body, "ok");
            assert!(server.is_ok());
        }
    }
}

#[tokio::test]
async fn async_https_uses_the_same_trust_without_disabling_certificate_checks() {
    for (wrong_name, expired, custom_ca, expected) in [
        (false, false, true, true),
        (false, false, false, false),
        (true, false, true, false),
        (false, true, true, false),
    ] {
        let fixture = TlsFixture::new(wrong_name, expired);
        let (origin, thread) = fixture.serve(Some(OK_RESPONSE));
        let trust = ScopedTrust::from_pem(&origin, fixture.ca_pem.as_bytes()).unwrap();
        let builder = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(3));
        let builder = if custom_ca {
            trust.apply_http(builder)
        } else {
            builder
        };
        let response = builder.build().unwrap().get(&origin).send().await;
        let response = match response {
            Ok(response) => response.text().await,
            Err(error) => Err(error),
        };
        let server = thread.join().unwrap();
        assert_eq!(
            response.is_ok(),
            expected,
            "wrong_name={wrong_name}, expired={expired}, custom_ca={custom_ca}, error={:?}, server={server:?}", response.as_ref().err()
        );
        if let Ok(body) = response {
            assert_eq!(body, "ok");
            assert!(server.is_ok());
        }
    }
}

#[test]
fn blocking_private_ca_clients_do_not_follow_redirects() {
    let fixture = TlsFixture::new(false, false);
    let (origin, thread) = fixture.serve(Some("HTTP/1.1 302 Found\r\nLocation: https://other.test/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
    let trust = ScopedTrust::from_pem(&origin, fixture.ca_pem.as_bytes()).unwrap();
    let builder = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::limited(10));
    let response = trust
        .apply_blocking(builder)
        .build()
        .unwrap()
        .get(&origin)
        .send()
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::FOUND);
    drop(response);
    thread.join().unwrap().unwrap();
}

#[test]
fn websocket_uses_the_same_trust_and_rejects_untrusted_wrong_name_and_expired_certificates() {
    for (wrong_name, expired, custom_ca, expected) in [
        (false, false, true, true),
        (false, false, false, false),
        (true, false, true, false),
        (false, true, true, false),
    ] {
        let fixture = TlsFixture::new(wrong_name, expired);
        let (origin, thread) = fixture.serve(None);
        let trust = ScopedTrust::from_pem(&origin, fixture.ca_pem.as_bytes()).unwrap();
        let url = origin.replacen("https://", "wss://", 1);
        let request = url.as_str().into_client_request().unwrap();
        let tcp = std::net::TcpStream::connect(
            reqwest::Url::parse(&url)
                .unwrap()
                .socket_addrs(|| None)
                .unwrap()[0],
        )
        .unwrap();
        tcp.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        tcp.set_write_timeout(Some(Duration::from_secs(3))).unwrap();
        let connector = custom_ca.then(|| trust.connector());
        let response = tungstenite::client_tls_with_config(request, tcp, None, connector);
        let response = response.map(|(mut socket, _)| {
            let message = socket.read().unwrap().into_text().unwrap();
            let _ = socket.close(None);
            message
        });
        let server = thread.join().unwrap();
        assert_eq!(
            response.is_ok(),
            expected,
            "wrong_name={wrong_name}, expired={expired}, custom_ca={custom_ca}, error={:?}, server={server:?}", response.as_ref().err()
        );
        if let Ok(message) = response {
            assert_eq!(message, "verified");
            assert!(server.is_ok());
        }
    }
}
