// Product connection owners, without launching or touching the daily Hook instance.
fn video_test_wire(id: u64, keyframe: bool, payload: &[u8]) -> Vec<u8> {
    encode_live_relay_binary_frame(
        &LiveRelayBinaryMetadata {
            epoch: 1,
            frame_id: id,
            capture_timestamp_ms: 1,
            encode_timestamp_ms: 2,
            width: 320,
            height: 240,
            dropped_frames: 0,
            keyframe,
            color_space: "srgb",
            codec: "h264",
        },
        payload,
    )
    .unwrap()
}

fn video_test_sockets() -> (
    tungstenite::WebSocket<tungstenite::stream::MaybeTlsStream<std::net::TcpStream>>,
    tungstenite::WebSocket<std::net::TcpStream>,
) {
    use tungstenite::protocol::Role;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let client = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (server, _) = listener.accept().unwrap();
    for stream in [&client, &server] {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
    }
    (
        tungstenite::WebSocket::from_raw_socket(
            tungstenite::stream::MaybeTlsStream::Plain(client),
            Role::Client,
            None,
        ),
        tungstenite::WebSocket::from_raw_socket(server, Role::Server, None),
    )
}

#[test]
fn video_policy_is_bounded_epoch_scoped_and_reenable_requires_idr() {
    let mut source = LiveRelayVideoSource::new("capture:test".into(), 3);
    let policy = |allowed, seq| {
        serde_json::json!({"type":"video_policy", "epoch":3,
        "h264_allowed":allowed,"keyframe_sequence":seq})
        .to_string()
    };
    source.policy(&policy(true, 2)).unwrap();
    assert!(source.allowed && source.force_keyframe);
    source.force_keyframe = false;
    source.policy(&policy(true, 2)).unwrap();
    assert!(!source.force_keyframe);
    assert!(source.policy(&policy(true, 1)).is_err());
    assert!(source
        .policy(&policy(true, 2).replace("\"epoch\":3", "\"epoch\":4"))
        .is_err());
    assert!(source
        .policy(&format!("{}{}", policy(true, 2), " ".repeat(257)))
        .is_err());
    assert!(source.policy(r#"{"type":"video_policy","epoch":3,"h264_allowed":true,"keyframe_sequence":2,"extra":0}"#).is_err());
    source.policy(&policy(false, 2)).unwrap();
    source.policy(&policy(true, 2)).unwrap();
    assert!(source.force_keyframe);
}

#[test]
fn video_requires_new_profile_and_preserves_jpeg_fallback() {
    let wire = video_test_wire(1, true, &[0, 0, 1, 0x65]);
    assert!(LiveRelayMediaProfile::Legacy.validate_wire(&wire).is_err());
    assert!(LiveRelayMediaProfile::Jpeg.validate_wire(&wire).is_err());
    assert!(LiveRelayMediaProfile::H264.validate_wire(&wire).is_ok());
    assert_eq!(
        LiveRelayMediaProfile::negotiated(Some(LIVE_RELAY_H264_PROTOCOL)).unwrap(),
        LiveRelayMediaProfile::H264
    );
    let mut invalid = wire.clone();
    invalid[56] = 2;
    assert!(decode_live_relay_binary_frame("r", "s", &invalid).is_err());
    invalid = wire;
    invalid[40..44].copy_from_slice(&321_u32.to_be_bytes());
    assert!(decode_live_relay_binary_frame("r", "s", &invalid).is_err());
}

#[test]
fn video_gap_requests_once_and_sticky_fallback_never_reenters_decoder() {
    let relay = viewer_relay("http://127.0.0.1:1".into());
    let (mut client, mut server) = video_test_sockets();
    let mut video = LiveRelayVideoViewer::default();
    video
        .receive(&relay, &mut client, &video_test_wire(2, false, &[1]))
        .unwrap();
    let control: serde_json::Value =
        serde_json::from_str(server.read().unwrap().to_text().unwrap()).unwrap();
    assert_eq!(
        control,
        serde_json::json!({"type":"keyframe_request","epoch":1})
    );
    video
        .receive(&relay, &mut client, &video_test_wire(3, false, &[1]))
        .unwrap();
    assert!(video.requested && video.decoder.is_none());
    video.fallback = true;
    video
        .receive(&relay, &mut client, &video_test_wire(4, true, &[1]))
        .unwrap();
    assert!(video.decoder.is_none());
    assert!(relay.frames.lock().unwrap().frames.is_empty());
    relay.stop.store(true, Ordering::SeqCst);
    assert!(video
        .receive(&relay, &mut client, &video_test_wire(5, true, &[1]))
        .is_err());
}

#[test]
#[ignore = "requires owned WGC HOOK_C1_DECODER_INPUT; native MF connection owner"]
fn native_video_viewer_decodes_before_cache_and_warms_reconnect_without_rollback() {
    let input = std::path::PathBuf::from(std::env::var_os("HOOK_C1_DECODER_INPUT").unwrap());
    let bytes = std::fs::read(input.join("synthetic.h264")).unwrap();
    let report: serde_json::Value =
        serde_json::from_slice(&std::fs::read(input.join("summary.json")).unwrap()).unwrap();
    assert_eq!(report["input"], "wgc_owned_window_bgra_nv12");
    let frames = report["frames"].as_array().unwrap();
    assert_eq!(frames.len(), 24);
    let (mut client, mut server) = video_test_sockets();
    for previous in [0, 20] {
        let relay = viewer_relay("http://127.0.0.1:1".into());
        relay.state.lock().unwrap().last_frame_id = previous;
        let mut video = LiveRelayVideoViewer::default();
        for (index, item) in frames.iter().enumerate() {
            let offset = item["offset"].as_u64().unwrap() as usize;
            let length = item["length"].as_u64().unwrap() as usize;
            let wire = video_test_wire(
                index as u64 + 1,
                item["keyframe"].as_bool().unwrap(),
                &bytes[offset..offset + length],
            );
            video.receive(&relay, &mut client, &wire).unwrap();
            assert!(!video.fallback);
            assert_eq!(
                relay.state.lock().unwrap().last_frame_id,
                previous.max(index as u64 + 1)
            );
            if index as u64 + 1 > previous {
                let buffer = relay.frames.lock().unwrap();
                let frame = buffer.frames.back().unwrap();
                assert_eq!(frame.descriptor.codec, "raw_bgra");
                assert_eq!(frame.payload.len(), 320 * 240 * 4);
                let gray = 32 + index as u8 * 4;
                assert!(frame.payload.chunks_exact(4).all(|pixel| pixel[3] == 255
                    && pixel[..3].iter().all(|value| value.abs_diff(gray) <= 4)));
            }
        }
        assert_eq!(relay.state.lock().unwrap().received_frames, 24 - previous);
        // A gap invalidates references and requests IDR; an invalid fresh IDR falls back once.
        video
            .receive(&relay, &mut client, &video_test_wire(26, false, &[1]))
            .unwrap();
        assert!(server
            .read()
            .unwrap()
            .to_text()
            .unwrap()
            .contains("keyframe_request"));
        video
            .receive(&relay, &mut client, &video_test_wire(27, true, &[1]))
            .unwrap();
        assert!(video.fallback && video.decoder.is_none());
        assert!(server
            .read()
            .unwrap()
            .to_text()
            .unwrap()
            .contains("video_fallback"));
        relay.stop_and_join().unwrap();
        assert!(relay.frames.lock().unwrap().frames.is_empty());
        assert!(video
            .receive(&relay, &mut client, &video_test_wire(28, true, &[1]))
            .is_err());
    }
    println!("C1_VIEWER_OWNER passed: full=24 warmup=20 new=4 pixels<=4 gap=request fallback=sticky stop=empty");
}
