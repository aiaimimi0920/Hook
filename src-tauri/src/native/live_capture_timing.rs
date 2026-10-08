#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveCaptureTiming {
    cpu_admission: Option<crate::live_gpu::work_budget::CpuAdmissionSnapshot>,
    readback: LiveReadbackTiming,
    handoff: LiveStageTiming,
    jpeg_encode: LiveStageTiming,
    frame_store: LiveStageTiming,
}

enum LiveCaptureTimingStage {
    JpegEncode,
    FrameStore,
}

struct LiveCaptureIteration<'a> {
    state: &'a Mutex<LiveCaptureSessionState>,
    pending: LiveCaptureTiming,
}

impl<'a> LiveCaptureIteration<'a> {
    fn admission(&mut self, value: crate::live_gpu::work_budget::CpuAdmissionSnapshot) {
        self.pending.cpu_admission = Some(value);
    }
    fn new(state: &'a Mutex<LiveCaptureSessionState>) -> Self {
        Self {
            state,
            pending: LiveCaptureTiming::default(),
        }
    }

    fn handoff<T, E>(
        &mut self,
        work: impl FnOnce(&mut LiveReadbackTiming) -> Result<Option<T>, E>,
    ) -> Result<Option<T>, E> {
        let start = Instant::now();
        let result = work(&mut self.pending.readback);
        let outcome = match &result {
            Ok(Some(_)) => LiveTimingOutcome::Succeeded,
            Ok(None) => LiveTimingOutcome::Empty,
            Err(_) => LiveTimingOutcome::Failed,
        };
        self.pending.handoff.record(start.elapsed(), outcome);
        result
    }

    fn result<T, E>(
        &mut self,
        stage: LiveCaptureTimingStage,
        work: impl FnOnce() -> Result<T, E>,
    ) -> Result<T, E> {
        let start = Instant::now();
        let result = work();
        let outcome = if result.is_ok() {
            LiveTimingOutcome::Succeeded
        } else {
            LiveTimingOutcome::Failed
        };
        let target = match stage {
            LiveCaptureTimingStage::JpegEncode => &mut self.pending.jpeg_encode,
            LiveCaptureTimingStage::FrameStore => &mut self.pending.frame_store,
        };
        target.record(start.elapsed(), outcome);
        result
    }
}

impl Drop for LiveCaptureIteration<'_> {
    fn drop(&mut self) {
        // 不接管raw/CPU permit；只合并已返回阶段，不跨图像或入队工作持锁。
        if let Ok(mut state) = self.state.lock() {
            let timing = state
                .capture_timing
                .get_or_insert_with(LiveCaptureTiming::default);
            timing.handoff.merge(&self.pending.handoff);
            timing.readback.merge(&self.pending.readback);
            timing.jpeg_encode.merge(&self.pending.jpeg_encode);
            timing.frame_store.merge(&self.pending.frame_store);
            if self.pending.cpu_admission.is_some() {
                timing.cpu_admission = self.pending.cpu_admission.take();
            }
        }
    }
}

#[cfg(test)]
include!("tests/live_capture_timing_tests.rs");
