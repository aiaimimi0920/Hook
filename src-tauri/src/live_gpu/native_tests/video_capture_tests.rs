//! 隔离自有 HWND 的真实 WGC -> GPU 转换 -> 持续硬件 H264，输出供独立 decoder 验证。
use super::*;
use crate::live_video::{capture::Subscription, Encoder, Format};
use std::{
    io::Write,
    sync::{
        atomic::{AtomicBool, AtomicU64},
        mpsc, Arc, Mutex,
    },
};

fn capture(id: &str, source: HWND) -> CaptureGuard {
    let config = crate::LiveCaptureWorkerConfig {
        session_id: id.into(),
        window_id: Some(format!("{:x}", source.0 as usize)),
        expected_process_id: Some(std::process::id()),
        source_title: None,
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        target_fps: 30,
        window_region: Some(crate::LiveCapturePhysicalRegion {
            left: 32,
            top: 16,
            width: 320,
            height: 240,
        }),
        display_metrics: crate::CaptureWindowMetrics {
            physical_origin_x: 0.0,
            physical_origin_y: 0.0,
            scale_factor: 1.0,
            logical_width: 1920.0,
            logical_height: 1080.0,
        },
        source_window: None,
    };
    let state = Arc::new(Mutex::new(crate::LiveCaptureSessionState::starting(
        &config,
    )));
    let frames = Arc::new(Mutex::new(crate::LiveCaptureFrameBuffer::new()));
    let dropped = Arc::new(AtomicU64::new(0));
    let (stop_tx, stop_rx) = mpsc::sync_channel(1);
    let join = crate::screenshot::spawn_live_capture_worker(
        config,
        state.clone(),
        frames.clone(),
        dropped.clone(),
        stop_rx,
    )
    .unwrap();
    CaptureGuard(crate::LiveCaptureSession {
        state,
        frames,
        dropped_frames: dropped,
        stop_tx: Mutex::new(Some(stop_tx)),
        join: Mutex::new(Some(join)),
        source_window: None,
    })
}

#[test]
#[ignore = "interactive desktop: owns fixture windows, requires HOOK_C1_NATIVE_OUTPUT new absolute directory"]
fn native_wgc_continuous_h264_and_stop() {
    let _probe = PROBE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    let output = std::path::PathBuf::from(
        std::env::var_os("HOOK_C1_NATIVE_OUTPUT").expect("explicit output required"),
    );
    assert!(output.is_absolute());
    std::fs::create_dir(&output).unwrap();
    let owned = create_windows();
    let source = owned.0[0];
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::*;
        SetWindowPos(
            source,
            None,
            0,
            0,
            400,
            300,
            SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .unwrap();
    }
    let id = "c1-owned-wgc-video";
    let capture = capture(id, source);
    let subscription = Subscription::acquire(id).unwrap();
    super::super::work_budget::set_visible(id, false);
    let stop = AtomicBool::new(false);
    let mut encoder = None::<Encoder>;
    let mut bytes = Vec::new();
    let mut packets = Vec::new();
    let mut previous_capture = 0;
    let mut last_texture = None;
    for index in 0..24 {
        let gray = 32 + index as u8 * 4;
        let deadline = Instant::now() + Duration::from_secs(5);
        let frame = loop {
            pump();
            fill(
                source,
                RECT {
                    left: 0,
                    top: 0,
                    right: 400,
                    bottom: 300,
                },
                u32::from(gray) * 0x010101,
            );
            if let Some(frame) = subscription.take().unwrap() {
                assert_eq!((frame.width, frame.height), (320, 240));
                // 仅测试 oracle 做 GPU readback，确认选中的 WGC 帧对应当前夹具，不让调度延迟混入序列。
                let oracle = super::super::GpuFrame {
                    copy_id: 0,
                    texture: frame.texture.clone(),
                    device: frame.device.clone(),
                    context: unsafe { frame.device.GetImmediateContext() }.unwrap(),
                    width: frame.width,
                    height: frame.height,
                    captured_at_ms: frame.captured_at_ms,
                };
                let (pixels, _) = super::super::Readback::copy(&oracle)
                    .unwrap()
                    .into_rgb()
                    .unwrap();
                if frame.captured_at_ms > previous_capture
                    && pixels.pixels().all(|pixel| pixel.0 == [gray; 3])
                {
                    break frame;
                }
            }
            assert!(
                Instant::now() < deadline,
                "owned WGC fixture frame missing: {index}"
            );
            std::thread::sleep(Duration::from_millis(15));
        };
        previous_capture = frame.captured_at_ms;
        let encoder = encoder.get_or_insert_with(|| {
            Encoder::new(frame.device.clone(), Format::new(320, 240, 30).unwrap()).unwrap()
        });
        let packet = encoder.encode(&frame.texture, index == 12, &stop).unwrap();
        assert!(index != 0 && index != 12 || packet.keyframe);
        packets.push(
            serde_json::json!({"offset": bytes.len(), "length": packet.bytes.len(),
            "timestamp100ns": packet.timestamp, "keyframe": packet.keyframe}),
        );
        bytes.extend_from_slice(&packet.bytes);
        last_texture = Some(frame.texture);
        assert!(bytes.len() <= 4 * 1024 * 1024);
    }
    assert!(packets.iter().any(|packet| packet["keyframe"] == false));
    let name = encoder.as_ref().unwrap().name().to_owned();
    stop.store(true, std::sync::atomic::Ordering::Release);
    assert!(encoder
        .as_mut()
        .unwrap()
        .encode(last_texture.as_ref().unwrap(), false, &stop)
        .is_err());
    stop.store(false, std::sync::atomic::Ordering::Release);
    assert!(
        encoder
            .as_mut()
            .unwrap()
            .encode(last_texture.as_ref().unwrap(), false, &stop)
            .is_err(),
        "cancelled reference chain must not be reused"
    );
    assert!(
        capture.0.state.lock().unwrap().frame_id <= 1,
        "GPU-only hidden demand must not keep JPEG encoding active"
    );
    drop(encoder);
    capture.0.stop_and_join().unwrap();
    assert!(
        subscription.take().is_err(),
        "stop must revoke and clear GPU delivery"
    );
    drop(subscription);
    let mut stream = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(output.join("synthetic.h264"))
        .unwrap();
    stream.write_all(&bytes).unwrap();
    let report = serde_json::json!({"status": "hardware_encode_passed", "encoder": name,
        "input": "wgc_owned_window_bgra_nv12", "gpuTextureInput": true, "hardwareOnly": true,
        "width": 320, "height": 240, "fps": 30, "forcedKeyframeInput": 12,
        "bytes": bytes.len(), "frames": packets, "captureStoppedAndCleared": true,
        "liveRelayIntegrated": false, "testOracleReadback": true});
    let mut file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(output.join("summary.json"))
        .unwrap();
    serde_json::to_writer_pretty(&mut file, &report).unwrap();
    writeln!(file).unwrap();
    println!("C1_WGC_ENCODE passed: 24 ordered frames, IDR at 0/12, stopped and cleared");
}
