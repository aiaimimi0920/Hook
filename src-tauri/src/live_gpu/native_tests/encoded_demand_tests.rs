//! 在真实 WGC/GPU 预览中核对 relay 使用的不可变 JPEG 快照与需求释放。
use super::*;
use crate::live_gpu::work_budget::EncodedFrameConsumer;
use std::collections::HashSet;

struct Sample {
    frames: u64,
    colors: HashSet<[u8; 3]>,
    submitted: u64,
    elapsed: Duration,
}

fn sample(
    source: HWND,
    target: HWND,
    id: &str,
    layout: Layout,
    capture: &crate::LiveCaptureSession,
) -> Sample {
    let start = Instant::now();
    let before = capture.state.lock().unwrap().snapshot(0).frame_id;
    let first = worker::configure(target.0 as usize, id, Some(layout)).unwrap();
    let mut latest = first.clone();
    let mut colors = HashSet::new();
    let mut last_frame = before;
    let mut changes = 0;
    while start.elapsed() < Duration::from_secs(1) {
        pump();
        fill(
            source,
            RECT {
                left: 64,
                top: 16,
                right: 128,
                bottom: 80,
            },
            if changes % 2 == 0 {
                0x0000ff00
            } else {
                0x0000ffff
            },
        );
        changes += 1;
        latest = worker::configure(target.0 as usize, id, Some(layout)).unwrap();
        assert!(latest.error.is_none(), "GPU error: {:?}", latest.error);
        let frame = capture
            .frames
            .lock()
            .unwrap()
            .clone_latest_after(last_frame);
        if let Some(frame) = frame {
            let decoded = image::load_from_memory(&frame.bytes).unwrap().to_rgb8();
            assert_eq!(decoded.dimensions(), (64, 64));
            colors.insert(decoded.get_pixel(32, 32).0);
            last_frame = frame.descriptor.frame_id;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    let after = capture.state.lock().unwrap().snapshot(0);
    assert_eq!(after.capture_state, "streaming");
    assert_eq!(after.epoch, 1);
    assert!(latest.presenting, "编码需求不能关闭本地 GPU 预览");
    assert!(latest.submitted_frames > first.submitted_frames + 5);
    Sample {
        frames: after.frame_id - before,
        colors,
        submitted: latest.submitted_frames - first.submitted_frames,
        elapsed: start.elapsed(),
    }
}

fn assert_encoding(sample: &Sample) {
    assert!(sample.frames >= 3, "GPU 预览期间远端需要持续 JPEG");
    assert!(sample.colors.len() >= 2, "不能重复发布同一旧画面");
    assert!(sample.frames <= (sample.elapsed.as_secs_f64() * 30.0).ceil() as u64 + 2);
}

pub(super) fn exercise(
    source: HWND,
    target: HWND,
    id: &str,
    layout: Layout,
    capture: &crate::LiveCaptureSession,
) {
    let first = EncodedFrameConsumer::acquire(id).unwrap();
    let second = EncodedFrameConsumer::acquire(id).unwrap();
    let both = sample(source, target, id, layout, capture);
    assert_encoding(&both);
    drop(first);
    let remaining = sample(source, target, id, layout, capture);
    assert_encoding(&remaining);
    drop(second);
    // 允许释放前已取得 CPU permit 的单帧完成，但不能留下持续编码需求。
    let released = sample(source, target, id, layout, capture);
    assert!(
        released.frames <= 1,
        "最后一个发布者退出后必须恢复 GPU-only"
    );
    println!(
        "GPU_ENCODED_DEMAND passed: both={} remaining={} released={} colors={}/{} gpu={}/{}/{}",
        both.frames,
        remaining.frames,
        released.frames,
        both.colors.len(),
        remaining.colors.len(),
        both.submitted,
        remaining.submitted,
        released.submitted
    );
}
