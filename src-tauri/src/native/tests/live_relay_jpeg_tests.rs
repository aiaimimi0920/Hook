mod live_relay_jpeg_tests {
    use super::*;
    const FIXTURE: &[u8] = include_bytes!("../../../../protocol/fixtures/live-jpeg-v1.nllv");

    fn capture() -> LiveCaptureFrame {
        LiveCaptureFrame {
            descriptor: LiveCaptureFrameDescriptor {
                session_id: "capture:jpeg".to_owned(),
                epoch: 1,
                frame_id: 9,
                capture_timestamp_ms: 100,
                encode_timestamp_ms: 110,
                width: 64,
                height: 32,
                mime: "image/jpeg".to_owned(),
                byte_length: FIXTURE.len() - 64,
                dropped_frames: 0,
            },
            bytes: Arc::new(FIXTURE[64..].to_vec()),
        }
    }

    #[test]
    fn live_relay_jpeg_preserves_capture_bytes_and_legacy_pixels() {
        let frame = capture();
        let jpeg = encode_live_relay_capture_frame(&frame, LiveRelayMediaProfile::Jpeg, 1).unwrap();
        assert_eq!(&jpeg[64..], &FIXTURE[64..]);
        let decoded = decode_live_relay_binary_frame("relay:a", "live:a", &jpeg).unwrap();
        assert_eq!(decoded.descriptor.codec, "jpeg");
        assert_eq!(
            (decoded.descriptor.width, decoded.descriptor.height),
            (64, 32)
        );
        let raw =
            encode_live_relay_capture_frame(&frame, LiveRelayMediaProfile::Legacy, 1).unwrap();
        assert_eq!(raw[57], 1);
        let raw = decode_live_relay_binary_frame("relay:a", "live:a", &raw).unwrap();
        let mut expected = image::load_from_memory(&frame.bytes)
            .unwrap()
            .into_rgba8()
            .into_raw();
        for pixel in expected.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }
        assert_eq!(raw.payload, expected);
        assert!(decoded.payload.len() * 2 < raw.payload.len());
        assert_eq!(decoded.descriptor.frame_id, raw.descriptor.frame_id);
    }

    #[test]
    #[ignore = "release-profile paired adaptation evidence; synthetic input, no desktop or network"]
    fn live_relay_paired_adaptation_benchmark() {
        use sha2::{Digest, Sha256};
        use std::time::Instant;

        for (width, height) in [(658, 407), (1280, 720), (1920, 1080)] {
            let image = image::RgbImage::from_fn(width, height, |x, y| {
                image::Rgb([
                    ((x * 3 + y) % 256) as u8,
                    ((x + y * 2) % 256) as u8,
                    ((x / 8 + y / 8) % 256) as u8,
                ])
            });
            let mut payload = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut payload, 82)
                .encode_image(&image)
                .unwrap();
            let fixture_sha256 = format!("{:x}", Sha256::digest(&payload));
            let mut frame = capture();
            frame.descriptor.width = width;
            frame.descriptor.height = height;
            frame.descriptor.byte_length = payload.len();
            frame.bytes = Arc::new(payload);
            let mut expected = image::load_from_memory(&frame.bytes)
                .unwrap()
                .into_rgba8()
                .into_raw();
            for pixel in expected.chunks_exact_mut(4) {
                pixel.swap(0, 2);
            }
            let profiles = [LiveRelayMediaProfile::Jpeg, LiveRelayMediaProfile::Legacy];
            let mut samples = Vec::new();
            let mut wire_bytes = [0; 2];
            // Alternate order and retain every measured pair; assertions and fixture encoding
            // are outside timing. This isolates adaptation, not capture or receiver rendering.
            for iteration in 0..24 {
                let mut elapsed_ms = [0.0; 2];
                for offset in 0..2 {
                    let index = (iteration + offset) % 2;
                    let start = Instant::now();
                    let bytes = encode_live_relay_capture_frame(
                        std::hint::black_box(&frame),
                        profiles[index],
                        1,
                    )
                    .unwrap();
                    elapsed_ms[index] = start.elapsed().as_secs_f64() * 1000.0;
                    wire_bytes[index] = bytes.len();
                    let decoded =
                        decode_live_relay_binary_frame("relay:a", "live:a", &bytes).unwrap();
                    assert_eq!(decoded.descriptor.frame_id, frame.descriptor.frame_id);
                    if index == 0 {
                        assert_eq!(decoded.descriptor.codec, "jpeg");
                        assert_eq!(decoded.payload, *frame.bytes);
                    } else {
                        assert_eq!(decoded.descriptor.codec, "raw_bgra");
                        assert_eq!(decoded.payload, expected);
                        assert_eq!(bytes.len(), 64 + width as usize * height as usize * 4);
                    }
                }
                if iteration >= 4 {
                    samples.push(serde_json::json!({
                        "jpegMs": elapsed_ms[0], "legacyRawMs": elapsed_ms[1],
                        "first": if iteration % 2 == 0 { "jpeg" } else { "legacyRaw" },
                    }));
                }
            }
            println!(
                "paired_adaptation={}",
                serde_json::json!({
                    "schemaVersion": 1, "evidence": "synthetic-source-adaptation-only",
                    "width": width, "height": height, "fixtureSha256": fixture_sha256,
                    "warmupPairs": 4, "samples": samples,
                    "jpegWireBytes": wire_bytes[0], "legacyRawWireBytes": wire_bytes[1],
                    "pixelParity": "legacy-equals-decoded-input-jpeg",
                    "endToEndVerdict": "not-established",
                })
            );
        }
    }

    #[test]
    fn live_relay_jpeg_rejects_unnegotiated_truncated_and_oversized_frames() {
        assert!(LiveRelayMediaProfile::Legacy
            .validate_wire(FIXTURE)
            .is_err());
        assert!(LiveRelayMediaProfile::Jpeg.validate_wire(FIXTURE).is_ok());
        for protocol in [None, Some("unknown"), Some(LIVE_RELAY_MEDIA_OFFER)] {
            assert!(LiveRelayMediaProfile::negotiated(protocol).is_err());
        }
        for (offset, value) in [(5, 0), (40, 1), (44, 1), (56, 2), (64, 0)] {
            let mut bytes = FIXTURE.to_vec();
            bytes[offset] = value;
            assert!(decode_live_relay_binary_frame("a", "b", &bytes).is_err());
        }
        assert!(decode_live_relay_binary_frame("a", "b", &FIXTURE[..FIXTURE.len() - 1]).is_err());
        let mut frame = capture();
        assert!(encode_live_relay_capture_frame(&frame, LiveRelayMediaProfile::Jpeg, 0).is_err());
        frame.descriptor.width = 63;
        assert!(encode_live_relay_capture_frame(&frame, LiveRelayMediaProfile::Jpeg, 1).is_err());
        assert!(live_relay_jpeg_decoder(&FIXTURE[64..], 16_384, 16_384).is_err());
    }

    #[test]
    fn live_relay_jpeg_negotiates_new_peer_and_falls_back_to_old_peer() {
        use tungstenite::client::IntoClientRequest;
        use tungstenite::http::header::SEC_WEBSOCKET_PROTOCOL;
        for protocol in [LIVE_RELAY_PROTOCOL_VERSION, LIVE_RELAY_JPEG_PROTOCOL] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url =
                reqwest::Url::parse(&format!("ws://{}/", listener.local_addr().unwrap())).unwrap();
            let worker = std::thread::spawn(move || {
                let (tcp, _) = listener.accept().unwrap();
                tcp.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                tcp.set_write_timeout(Some(Duration::from_secs(3))).unwrap();
                let socket = tungstenite::accept_hdr(
                    tcp,
                    |request: &tungstenite::handshake::server::Request,
                     mut response: tungstenite::handshake::server::Response| {
                        assert_eq!(
                            request.headers()[SEC_WEBSOCKET_PROTOCOL],
                            LIVE_RELAY_MEDIA_OFFER
                        );
                        response
                            .headers_mut()
                            .insert(SEC_WEBSOCKET_PROTOCOL, protocol.parse().unwrap());
                        Ok(response)
                    },
                );
                socket.is_ok()
            });
            let mut request = url.as_str().into_client_request().unwrap();
            request.headers_mut().insert(
                SEC_WEBSOCKET_PROTOCOL,
                LIVE_RELAY_MEDIA_OFFER.parse().unwrap(),
            );
            let result = connect_live_relay_transport(request, &url, LiveRelayRole::Viewer);
            let server_ok = worker.join().unwrap();
            let connection = result.unwrap();
            assert!(server_ok);
            assert_eq!(
                connection.profile,
                LiveRelayMediaProfile::negotiated(Some(protocol)).unwrap()
            );
        }
    }
}
