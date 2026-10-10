// Verifies image limits and clipboard-cache directory cleanup policies.

    #[test]
    fn remote_image_tls_transports_pin_the_validated_address_and_deny_redirects() {
        use std::io::{Read, Write};
        let _guard = crate::network_proxy::tests::TEST_GUARD.lock().unwrap();
        crate::network_proxy::tests::use_system_proxy();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        for redirect in [false, true] {
            let mut builders = vec![reqwest::Client::builder().use_rustls_tls().no_proxy()];
            #[cfg(windows)]
            builders.push(reqwest::Client::builder().use_native_tls().no_proxy());
            for builder in builders {
                let source = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
                let target = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
                target.set_nonblocking(true).unwrap();
                let source_addr = source.local_addr().unwrap();
                let target_addr = target.local_addr().unwrap();
                let worker = std::thread::spawn(move || {
                    source.set_nonblocking(true).unwrap();
                    let deadline = Instant::now() + Duration::from_secs(5);
                    let mut stream = loop {
                        if let Ok((stream, _)) = source.accept() { break stream; }
                        assert!(Instant::now() < deadline, "pinned socket was not contacted");
                        std::thread::sleep(Duration::from_millis(5));
                    };
                    // Windows accepted sockets can inherit the listener's nonblocking mode.
                    stream.set_nonblocking(false).unwrap();
                    stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                    let mut request = [0u8; 4096];
                    let mut size = 0;
                    while !request[..size].windows(4).any(|window| window == b"\r\n\r\n") {
                        assert!(size < request.len(), "request headers exceed fixture limit");
                        let count = stream.read(&mut request[size..]).unwrap();
                        assert!(count > 0, "request ended before headers");
                        size += count;
                    }
                    assert!(String::from_utf8_lossy(&request[..size]).contains("validated-image.invalid"));
                    let reply = if redirect {
                        format!("HTTP/1.1 302 Found\r\nLocation: http://{target_addr}/private\r\nContent-Length: 0\r\n\r\n")
                    } else {
                        "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".to_string()
                    };
                    stream.write_all(reply.as_bytes()).unwrap();
                });
                // This non-resolving hostname succeeds only through the already-validated pin.
                let url = ValidatedRemoteImageUrl {
                    normalized: format!("http://validated-image.invalid:{}/image", source_addr.port()),
                    host: "validated-image.invalid".to_string(), resolved: source_addr,
                };
                let result = runtime.block_on(download_remote_image_bytes_with_client(&url, None, builder));
                worker.join().unwrap();
                if redirect { assert!(result.unwrap_err().contains("HTTP 302")); }
                else { assert_eq!(result.unwrap().1, b"ok"); }
                assert_eq!(target.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
            }
        }
    }

    #[test]
    fn image_data_decoder_rejects_oversized_payload_before_decoding() {
        let oversized = format!(
            "data:image/png;base64,{}",
            "A".repeat(MAX_BASE64_IMAGE_ENCODED_BYTES + 1)
        );

        let error = decode_base64_image_data(&oversized).expect_err("oversized input is rejected");

        assert!(error.contains("Image payload too large"));
        assert!(error.contains("67108864"));
    }

    #[test]
    fn image_data_decoder_validates_decoded_image_dimensions() {
        let not_an_image = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(b"not an image")
        );

        let error =
            decode_base64_image_data(&not_an_image).expect_err("non-image input is rejected");

        assert!(error.contains("Image load failed"));
    }

    #[test]
    fn rgba_layout_rejects_oversized_dimensions_and_mismatched_buffers() {
        let oversized = validate_rgba_image_layout(MAX_IMAGE_PIXELS as usize + 1, 1, 0)
            .expect_err("oversized clipboard image must be rejected before allocation");
        assert!(oversized.contains("Image dimensions too large"));

        let mismatch = validate_rgba_image_layout(2, 2, 15)
            .expect_err("clipboard RGBA length must match dimensions");
        assert!(mismatch.contains("Image RGBA byte count mismatch"));
    }

    #[test]
    fn remote_image_network_policy_rejects_local_and_metadata_addresses() {
        for address in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "198.18.0.1",
            "0.0.0.0",
            "::1",
            "fe80::1",
            "fc00::1",
            "::ffff:127.0.0.1",
        ] {
            let address: std::net::IpAddr = address.parse().unwrap();
            assert!(remote_ip_is_disallowed(address), "{address} must be blocked");
        }
        assert!(!remote_ip_is_disallowed("8.8.8.8".parse().unwrap()));
        assert!(!remote_ip_is_disallowed(
            "2606:4700:4700::1111".parse().unwrap()
        ));
    }

    #[test]
    fn clipboard_cache_dir_prefers_explicit_env_override_for_tests_and_portable_builds() {
        let _env_guard = clipboard_cache_env_lock();
        let env_name = "HOOK_CLIPBOARD_CACHE_DIR";
        let cache_dir =
            std::env::temp_dir().join(format!("hook-cache-dir-test-{}", std::process::id()));
        std::env::set_var(env_name, &cache_dir);

        let resolved = clipboard_cache_dir();

        std::env::remove_var(env_name);
        assert_eq!(resolved, cache_dir);
    }

    #[test]
    fn clipboard_cache_cleanup_removes_old_files_and_trims_total_size() {
        let root = std::env::temp_dir().join(format!(
            "hook-cache-cleanup-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create cache test dir");
        let old_file = root.join("old.png");
        let new_file = root.join("new.png");
        let extra_file = root.join("extra.png");
        std::fs::write(&old_file, vec![1u8; 80]).expect("write old file");
        std::fs::write(&new_file, vec![2u8; 80]).expect("write new file");
        std::fs::write(&extra_file, vec![3u8; 80]).expect("write extra file");

        let now = SystemTime::now();
        let old_time = now - std::time::Duration::from_secs(CLIPBOARD_CACHE_MAX_AGE_SECS + 60);
        set_file_modified_time_for_test(&old_file, old_time).expect("set old file mtime");

        cleanup_clipboard_cache_dir(&root, now, 160, 100).expect("cleanup succeeds");

        assert!(!old_file.exists(), "old cache file should be removed");
        let remaining_size: u64 = std::fs::read_dir(&root)
            .expect("read cache test dir")
            .filter_map(Result::ok)
            .filter_map(|entry| entry.metadata().ok())
            .map(|metadata| metadata.len())
            .sum();
        let _ = std::fs::remove_dir_all(&root);
        assert!(
            remaining_size <= 100,
            "cache should be trimmed to target size"
        );
    }

    #[test]
    fn clipboard_cache_cleanup_keeps_recent_files_when_capacity_is_unlimited() {
        let root = std::env::temp_dir().join(format!(
            "hook-cache-unlimited-test-{}-{}",
            std::process::id(),
            file_timestamp_component()
        ));
        std::fs::create_dir_all(&root).expect("create unlimited cache test dir");
        let first = root.join("first.png");
        let second = root.join("second.png");
        std::fs::write(&first, vec![1u8; 80]).expect("write first file");
        std::fs::write(&second, vec![2u8; 80]).expect("write second file");

        cleanup_clipboard_cache_dir(&root, SystemTime::now(), 0, 0)
            .expect("unlimited cleanup succeeds");

        assert!(first.is_file());
        assert!(second.is_file());
        let _ = std::fs::remove_dir_all(root);
    }
