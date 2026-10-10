#[test]
#[ignore = "interactive owned HWND: C1 product source policy/demand and static IDR recovery"]
fn native_video_source_owner_switches_demands_and_recovers_static_idr() {
    let _probe = PROBE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let owned = create_windows();
    let window = owned.0[0];
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::*;
        SetWindowPos(
            window,
            None,
            0,
            0,
            400,
            300,
            SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .unwrap();
    }
    let id = "c1-owned-source-worker";
    let capture = capture(id, window);
    super::super::work_budget::set_visible(id, false);
    let state = Mutex::new(crate::LiveRelayRuntimeState::starting(1, Vec::new(), None));
    let stop = AtomicBool::new(false);
    let mut source = crate::LiveRelayVideoSource::new(id.into(), 1);
    source
        .policy(r#"{"type":"video_policy","epoch":1,"h264_allowed":true,"keyframe_sequence":1}"#)
        .unwrap();
    let mut decoder = crate::live_video::Decoder::new(Format::new(320, 240, 30).unwrap()).unwrap();
    let mut count = 0;
    let deadline = Instant::now() + Duration::from_secs(15);
    while count < 12 && Instant::now() < deadline {
        pump();
        fill(
            window,
            RECT {
                left: 0,
                top: 0,
                right: 400,
                bottom: 300,
            },
            (32 + count as u32 * 4) * 0x010101,
        );
        let mut timing = crate::LiveRelaySourceIteration::new(&state);
        if let Some(wire) = source
            .next(
                &capture.0,
                crate::LiveRelayMediaProfile::H264,
                count + 1,
                &stop,
                &mut timing,
            )
            .unwrap()
        {
            if wire[57] == 2 {
                let frame = crate::decode_live_relay_binary_frame("r", "s", &wire).unwrap();
                let image = decoder
                    .decode(&frame.payload, count as i64 + 1, wire[5] == 1, &stop)
                    .unwrap();
                assert_eq!(image.unwrap().bgra.len(), 320 * 240 * 4);
                assert!(source.encoded.is_none());
                count += 1;
            }
        }
        std::thread::sleep(Duration::from_millis(35));
    }
    assert_eq!(count, 12, "product source did not produce video");
    // No painting/pumping: requests must eventually reuse the last independent input texture.
    let mut reused = false;
    for sequence in 2..=12 {
        std::thread::sleep(Duration::from_millis(80));
        let previous = source.cached.as_ref().unwrap().captured_at_ms;
        source
            .policy(
                &serde_json::json!({"type":"video_policy","epoch":1,
            "h264_allowed":true,"keyframe_sequence":sequence})
                .to_string(),
            )
            .unwrap();
        let mut timing = crate::LiveRelaySourceIteration::new(&state);
        let wire = source
            .next(
                &capture.0,
                crate::LiveRelayMediaProfile::H264,
                12 + sequence,
                &stop,
                &mut timing,
            )
            .unwrap()
            .unwrap();
        assert_eq!(wire[5], 1);
        if source.cached.as_ref().unwrap().captured_at_ms == previous {
            reused = true;
            break;
        }
    }
    assert!(
        reused,
        "static recovery did not use its bounded retained texture"
    );
    source
        .policy(r#"{"type":"video_policy","epoch":1,"h264_allowed":false,"keyframe_sequence":12}"#)
        .unwrap();
    assert!(source.encoder.is_none() && source.subscription.is_none() && source.cached.is_none());
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut fallback = false;
    while Instant::now() < deadline {
        pump();
        fill(
            window,
            RECT {
                left: 0,
                top: 0,
                right: 400,
                bottom: 300,
            },
            0x808080,
        );
        let mut timing = crate::LiveRelaySourceIteration::new(&state);
        if let Some(wire) = source
            .next(
                &capture.0,
                crate::LiveRelayMediaProfile::H264,
                99,
                &stop,
                &mut timing,
            )
            .unwrap()
        {
            assert_eq!(wire[57], 3);
            assert!(source.encoded.is_some());
            fallback = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(35));
    }
    assert!(fallback, "policy disable did not restore JPEG demand");
    drop(source);
    capture.0.stop_and_join().unwrap();
    println!("C1_SOURCE_OWNER passed: video=12 decoded=12 JPEG-demand=released static-IDR=retained policy-fallback=JPEG stop=joined");
}
