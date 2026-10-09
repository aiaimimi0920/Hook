//! C1 独立合成画面探针；不启动 Hook、不采集桌面、不连接 Loom。
#[path = "live_h264_probe/annex_b.rs"]
mod annex_b;
#[cfg(windows)]
#[path = "live_h264_probe/encoder.rs"]
mod encoder;
#[cfg(windows)]
#[path = "live_h264_probe/gpu_device.rs"]
mod gpu_device;
#[cfg(windows)]
#[path = "live_h264_probe/gpu_input.rs"]
mod gpu_input;
#[cfg(windows)]
#[path = "live_h264_probe/samples.rs"]
mod samples;

#[cfg(windows)]
fn main() -> anyhow::Result<()> {
    use anyhow::ensure;
    use std::io::Write;
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    ensure!(
        (args.len() == 2 || (args.len() == 3 && args[2] == "--gpu")) && args[0] == "--output",
        "usage: live_h264_probe --output <new-directory> [--gpu]"
    );
    let output = std::path::PathBuf::from(&args[1]);
    ensure!(output.is_absolute(), "output directory must be absolute");
    std::fs::create_dir(&output)?;
    let gpu = args.len() == 3;
    let result = encoder::run(gpu);
    let report = match &result {
        Ok(encoded) => {
            let mut stream = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(output.join("synthetic.h264"))?;
            stream.write_all(&encoded.bytes)?;
            serde_json::json!({
                "status": "hardware_encode_passed", "encoder": encoded.name,
                "width": samples::WIDTH, "height": samples::HEIGHT, "fps": samples::FPS,
                "input": if gpu { "synthetic_gpu_bgra_nv12" } else { "synthetic_cpu_nv12" },
                "hardwareOnly": true, "gpuTextureInput": gpu,
                "gpuCaptureZeroCopy": false, "liveRelayIntegrated": false,
                "frames": encoded.frames, "bytes": encoded.bytes.len(),
                "forcedKeyframeInput": samples::FORCE_KEYFRAME_AT,
            })
        }
        Err(error) => serde_json::json!({
            "status": "hardware_encode_failed", "error": format!("{error:#}"),
            "liveRelayIntegrated": false, "softwareEncoderFallbackAttempted": false,
        }),
    };
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output.join("summary.json"))?;
    serde_json::to_writer_pretty(&mut file, &report)?;
    writeln!(file)?;
    println!("{}", serde_json::to_string(&report)?);
    result.map(|_| ())
}

#[cfg(not(windows))]
fn main() {
    eprintln!("live_h264_probe requires Windows Media Foundation");
    std::process::exit(1);
}
