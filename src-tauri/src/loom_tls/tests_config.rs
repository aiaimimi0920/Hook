use super::tests_support::TlsFixture;
use super::*;

#[test]
fn environment_configuration_is_fail_closed_and_frozen_per_process() {
    if let Ok(mode) = std::env::var("HOOK_TLS_TEST_CHILD") {
        let origin = "https://loom.test";
        let path = std::env::var_os("HOOK_LOOM_TLS_CA_FILE").unwrap();
        if mode == "valid" {
            assert!(for_endpoint(origin).unwrap().is_some());
            assert!(for_endpoint("https://other.test").unwrap().is_none());
            assert!(for_endpoint("http://127.0.0.1").unwrap().is_none());
            assert!(
                websocket_connector(&Url::parse("wss://loom.test/v1/live/media").unwrap())
                    .unwrap()
                    .is_some()
            );
            crate::network_proxy::shared_client(origin, None).unwrap();
            crate::network_proxy::blocking_client(origin, None).unwrap();
            std::fs::write(&path, b"").unwrap();
            assert!(for_endpoint(origin).unwrap().is_some());
        } else {
            assert!(for_endpoint(origin).is_err());
            assert!(for_endpoint("http://127.0.0.1").is_err());
            std::fs::write(&path, std::env::var("HOOK_TLS_TEST_CA_PEM").unwrap()).unwrap();
            assert!(for_endpoint(origin).is_err());
            assert!(crate::network_proxy::shared_client(origin, None).is_err());
            assert!(crate::network_proxy::blocking_client(origin, None).is_err());
            assert!(
                websocket_connector(&Url::parse("wss://loom.test/v1/live/media").unwrap()).is_err()
            );
        }
        return;
    }
    let fixture = TlsFixture::new(false, false);
    for mode in ["valid", "invalid"] {
        let path = std::env::temp_dir().join(format!("hook-tls-{}.pem", uuid::Uuid::new_v4()));
        std::fs::write(
            &path,
            if mode == "valid" {
                fixture.ca_pem.as_bytes()
            } else {
                b""
            },
        )
        .unwrap();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "loom_tls::tests_config::environment_configuration_is_fail_closed_and_frozen_per_process", "--test-threads=1"])
            .env("HOOK_TLS_TEST_CHILD", mode)
            .env("HOOK_LOOM_TLS_ORIGIN", "https://loom.test")
            .env("HOOK_LOOM_TLS_CA_FILE", &path)
            .env("HOOK_TLS_TEST_CA_PEM", &fixture.ca_pem)
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
            .spawn().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
        let timed_out = loop {
            if child.try_wait().unwrap().is_some() {
                break false;
            }
            if std::time::Instant::now() >= deadline {
                let _ = child.kill();
                break true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        };
        let result = child.wait_with_output().unwrap();
        std::fs::remove_file(path).unwrap();
        assert!(
            !timed_out
                && result.status.success()
                && String::from_utf8_lossy(&result.stdout).contains("1 passed;"),
            "{}",
            String::from_utf8_lossy(&result.stdout)
        );
    }
}

#[test]
fn regular_ca_files_are_read_with_the_same_byte_budget() {
    let fixture = TlsFixture::new(false, false);
    let path = std::env::temp_dir().join(format!("hook-tls-{}.pem", uuid::Uuid::new_v4()));
    std::fs::write(&path, &fixture.ca_pem).unwrap();
    let load = || {
        load_config(
            Some("https://loom.test".into()),
            Some(path.clone().into_os_string()),
        )
    };
    assert!(load().unwrap().is_some());
    std::fs::write(&path, vec![b' '; MAX_CA_BYTES + 1]).unwrap();
    assert!(load().is_err());
    std::fs::remove_file(&path).unwrap();
    assert!(load().is_err());
}
