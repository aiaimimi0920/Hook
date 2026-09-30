// One-slot GPU mailbox. Capture callbacks never Map, convert pixels, or encode JPEG.
use crate::live_gpu::work_budget::{CaptureBudget, CpuPermit};
use crate::live_gpu::{GpuFrame, Readback, SubmitOutcome};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc, Arc, Mutex,
};

pub(super) struct RawLiveFrame {
    pub image: image::RgbImage,
    pub captured_at_ms: u64,
    _permit: CpuPermit,
}

pub(super) struct FrameMailbox {
    raw: Mutex<Option<GpuFrame>>,
    spare: Mutex<Option<GpuFrame>>,
    pub budget: CaptureBudget,
    arrived: AtomicU64,
    errors: AtomicU64,
    dropped: Arc<AtomicU64>,
    ready: mpsc::SyncSender<()>,
}

impl FrameMailbox {
    pub fn new(id: &str, fps: u16, dropped: Arc<AtomicU64>, ready: mpsc::SyncSender<()>) -> Self {
        Self {
            raw: Mutex::new(None),
            spare: Mutex::new(None),
            budget: CaptureBudget::register(id, fps),
            arrived: AtomicU64::new(0),
            errors: AtomicU64::new(0),
            dropped,
            ready,
        }
    }

    // Called only after the previous capturer has stopped, before a new epoch.
    pub fn reset(&self) {
        self.arrived.store(0, Ordering::Release);
        if let Ok(mut raw) = self.raw.lock() {
            *raw = None;
        }
        if let Ok(mut spare) = self.spare.lock() {
            *spare = None;
        }
        self.budget.cancel_cpu();
    }

    pub fn arrived_at(&self) -> u64 {
        self.arrived.load(Ordering::Acquire)
    }
    pub fn take_errors(&self) -> u64 {
        self.errors.swap(0, Ordering::Relaxed)
    }

    pub fn capture(
        &self,
        id: &str,
        frame: &scap_direct3d::Frame,
        crop: Option<windows::Win32::Graphics::Direct3D11::D3D11_BOX>,
    ) {
        #[cfg(test)]
        crate::live_gpu::browser_video_oracle::record_capture_age(id, frame);
        let captured_at_ms = crate::live_capture_now_ms();
        self.arrived.store(captured_at_ms, Ordering::Release);
        let _ = self.ready.try_send(());
        match crate::live_gpu::submit(id, frame, crop) {
            SubmitOutcome::Queued => return,
            SubmitOutcome::Busy | SubmitOutcome::Fallback => {}
        }
        let reusable = self
            .raw
            .lock()
            .ok()
            .and_then(|mut raw| {
                let previous = raw.take();
                if previous.is_some() {
                    self.dropped.fetch_add(1, Ordering::Relaxed);
                }
                previous
            })
            .or_else(|| self.spare.lock().ok().and_then(|mut spare| spare.take()));
        match GpuFrame::copy_for_readback(frame, crop, reusable) {
            Ok(frame) => {
                if let Ok(mut raw) = self.raw.lock() {
                    *raw = Some(frame);
                }
                let _ = self.ready.try_send(());
            }
            Err(error) => {
                self.errors.fetch_add(1, Ordering::Relaxed);
                crate::append_runtime_log_line(&format!(
                    "live_capture_frame_copy_failed :: session={id} error={error:?}"
                ));
            }
        }
    }

    pub fn next(&self, id: &str, encoded_at: u64) -> Result<Option<RawLiveFrame>, String> {
        let next = {
            let mut raw = self.raw.lock().map_err(|_| "live frame mailbox poisoned")?;
            if let Some(frame) = raw.as_ref() {
                if frame.captured_at_ms <= encoded_at {
                    *raw = None;
                }
            }
            if raw.is_some() {
                match crate::live_gpu::submit_pending(id, &mut raw) {
                    SubmitOutcome::Queued => {}
                    SubmitOutcome::Busy => return Ok(None),
                    SubmitOutcome::Fallback => {}
                }
            }
            match raw.as_ref() {
                Some(frame) => {
                    let Some(permit) = self.budget.try_cpu(frame.width, frame.height) else {
                        return Ok(None);
                    };
                    Some((raw.take().expect("pending frame"), permit))
                }
                None => None,
            }
        };
        if let Some((frame, permit)) = next {
            let readback = Readback::copy(&frame)?;
            // Only the independent staging copy is mapped; capture may now reuse the input.
            if let Ok(mut spare) = self.spare.lock() {
                *spare = Some(frame);
            }
            let (image, captured_at_ms) = readback.into_rgb()?;
            return Ok(Some(RawLiveFrame {
                image,
                captured_at_ms,
                _permit: permit,
            }));
        }
        crate::live_gpu::fallback(id, encoded_at, &self.budget).map(|frame| {
            frame.map(|(image, captured_at_ms, permit)| RawLiveFrame {
                image,
                captured_at_ms,
                _permit: permit,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_arrival_and_reset_are_independent_of_cpu_production() {
        let dropped = Arc::new(AtomicU64::new(0));
        let (tx, rx) = mpsc::sync_channel(1);
        let mailbox = FrameMailbox::new("mailbox-test", 60, dropped, tx);
        let _ = mailbox.ready.try_send(());
        let _ = mailbox.ready.try_send(());
        assert_eq!(rx.try_iter().count(), 1);
        mailbox.arrived.store(50, Ordering::Release);
        assert_eq!(mailbox.arrived_at(), 50);
        mailbox.reset();
        assert_eq!(mailbox.arrived_at(), 0);
        assert!(mailbox.raw.lock().unwrap().is_none());
    }
}
