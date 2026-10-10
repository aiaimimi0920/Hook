//! 使用已生成的自有窗口 WGC 码流验证产品 decoder，不启动/替换日常应用。
use super::*;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

#[test]
#[ignore = "requires HOOK_C1_DECODER_INPUT from owned WGC capture and new HOOK_C1_DECODER_OUTPUT"]
fn native_decoder_reads_continuous_wgc_h264_and_restarts_at_idr() {
    let input =
        PathBuf::from(std::env::var_os("HOOK_C1_DECODER_INPUT").expect("owned input required"));
    let output =
        PathBuf::from(std::env::var_os("HOOK_C1_DECODER_OUTPUT").expect("new output required"));
    assert!(input.is_absolute() && output.is_absolute());
    std::fs::create_dir(&output).unwrap();
    let bytes = std::fs::read(input.join("synthetic.h264")).unwrap();
    assert!(bytes.len() <= 4 * 1024 * 1024);
    let report: serde_json::Value =
        serde_json::from_slice(&std::fs::read(input.join("summary.json")).unwrap()).unwrap();
    assert_eq!(report["input"], "wgc_owned_window_bgra_nv12");
    assert_eq!(report["width"], 320);
    assert_eq!(report["height"], 240);
    let frames = report["frames"].as_array().unwrap();
    assert_eq!(frames.len(), 24);
    let format = Format::new(320, 240, 30).unwrap();
    let stop = AtomicBool::new(false);
    let mut max_error = 0;
    for first in [0, 12] {
        let mut decoder = Decoder::new(format).unwrap();
        let mut decoded = 0;
        for (index, frame) in frames.iter().enumerate().skip(first) {
            let offset = frame["offset"].as_u64().unwrap() as usize;
            let length = frame["length"].as_u64().unwrap() as usize;
            let timestamp = frame["timestamp100ns"].as_i64().unwrap();
            let result = decoder
                .decode(
                    &bytes[offset..offset + length],
                    timestamp,
                    frame["keyframe"].as_bool().unwrap(),
                    &stop,
                )
                .unwrap();
            let image = result.expect("low latency decoder must emit without another input");
            assert_eq!(image.timestamp, timestamp);
            assert_eq!(image.bgra.len(), 320 * 240 * 4);
            let gray = 32 + index as u8 * 4;
            for pixel in image.bgra.chunks_exact(4) {
                assert_eq!(pixel[3], 255);
                for channel in &pixel[..3] {
                    max_error = max_error.max(channel.abs_diff(gray));
                }
            }
            decoded += 1;
        }
        assert_eq!(decoded, 24 - first);
        stop.store(true, Ordering::Release);
        assert!(decoder.decode(&[], 99999999, false, &stop).is_err());
        stop.store(false, Ordering::Release);
        assert!(decoder.decode(&[], 99999999, false, &stop).is_err());
    }
    assert!(max_error <= 4, "decoded BGRA gray error: {max_error}");
    let receipt = serde_json::json!({"status":"passed", "decoder":"Windows synchronous MF H264",
        "fullFrames":24,"idrRestartFrames":12,"maximumGrayError":max_error,"allowedError":4,
        "cancelledChainNotReusable":true,"gpuDecode":false,"productRelayIntegrated":false});
    std::fs::write(
        output.join("decoder-receipt.json"),
        serde_json::to_vec_pretty(&receipt).unwrap(),
    )
    .unwrap();
    println!("C1_PRODUCT_DECODER passed: full=24 restart=12 grayError={max_error} cancelledChainRejected=true");
}

#[test]
#[ignore = "requires HOOK_C1_NETWORK_INPUT with owned WGC network AU evidence"]
fn native_decoder_reads_non_macroblock_aligned_network_frames() {
    let input =
        PathBuf::from(std::env::var_os("HOOK_C1_NETWORK_INPUT").expect("owned input required"));
    let bytes = std::fs::read(input.join("network.h264")).unwrap();
    assert!(bytes.len() <= 4 * 1024 * 1024);
    let packets: Vec<serde_json::Value> =
        serde_json::from_slice(&std::fs::read(input.join("network-packets.json")).unwrap())
            .unwrap();
    assert_eq!(packets.len(), 24);
    let format = Format::new(680, 430, 30).unwrap();
    let mut decoder = Decoder::new(format).unwrap();
    let stop = AtomicBool::new(false);
    for (index, packet) in packets.iter().enumerate() {
        assert_eq!(packet["width"], 680);
        assert_eq!(packet["height"], 430);
        let offset = packet["offset"].as_u64().unwrap() as usize;
        let length = packet["length"].as_u64().unwrap() as usize;
        let image = decoder
            .decode(
                &bytes[offset..offset + length],
                index as i64 + 1,
                packet["keyframe"].as_bool().unwrap(),
                &stop,
            )
            .unwrap()
            .unwrap();
        assert_eq!(image.bgra.len(), 680 * 430 * 4);
    }
    println!("C1_NON_MACROBLOCK_NETWORK_DECODE passed: 24 frames at 680x430");
}
