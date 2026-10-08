#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveRelaySourceTiming {
    socket_service: LiveStageTiming,
    latest_frame: LiveStageTiming,
    adaptation: LiveStageTiming,
    socket_send: LiveStageTiming,
}

impl LiveRelaySourceTiming {
    fn merge(&mut self, next: &Self) {
        self.socket_service.merge(&next.socket_service);
        self.latest_frame.merge(&next.latest_frame);
        self.adaptation.merge(&next.adaptation);
        self.socket_send.merge(&next.socket_send);
    }
}

enum LiveRelayTimingStage {
    SocketService,
    LatestFrame,
    Adaptation,
    SocketSend,
}

struct LiveRelaySourceIteration<'a> {
    state: &'a Mutex<LiveRelayRuntimeState>,
    pending: LiveRelaySourceTiming,
}

impl<'a> LiveRelaySourceIteration<'a> {
    fn new(state: &'a Mutex<LiveRelayRuntimeState>) -> Self {
        Self {
            state,
            pending: LiveRelaySourceTiming::default(),
        }
    }

    fn record(
        &mut self,
        stage: LiveRelayTimingStage,
        elapsed: Duration,
        outcome: LiveTimingOutcome,
    ) {
        let target = match stage {
            LiveRelayTimingStage::SocketService => &mut self.pending.socket_service,
            LiveRelayTimingStage::LatestFrame => &mut self.pending.latest_frame,
            LiveRelayTimingStage::Adaptation => &mut self.pending.adaptation,
            LiveRelayTimingStage::SocketSend => &mut self.pending.socket_send,
        };
        target.record(elapsed, outcome);
    }

    fn result<T, E>(
        &mut self,
        stage: LiveRelayTimingStage,
        work: impl FnOnce() -> Result<T, E>,
    ) -> Result<T, E> {
        let start = Instant::now();
        let result = work();
        let outcome = if result.is_ok() {
            LiveTimingOutcome::Succeeded
        } else {
            LiveTimingOutcome::Failed
        };
        self.record(stage, start.elapsed(), outcome);
        result
    }

    fn latest<T>(&mut self, work: impl FnOnce() -> Option<T>) -> Option<T> {
        let start = Instant::now();
        let result = work();
        let outcome = if result.is_some() {
            LiveTimingOutcome::Succeeded
        } else {
            LiveTimingOutcome::Empty
        };
        self.record(LiveRelayTimingStage::LatestFrame, start.elapsed(), outcome);
        result
    }
}

impl Drop for LiveRelaySourceIteration<'_> {
    fn drop(&mut self) {
        // 每次循环只加一次诊断锁；包括错误/停止早退，绝不持锁执行网络或图像工作。
        if let Ok(mut state) = self.state.lock() {
            state
                .source_timing
                .get_or_insert_with(LiveRelaySourceTiming::default)
                .merge(&self.pending);
        }
    }
}

#[cfg(test)]
include!("tests/live_relay_source_timing_tests.rs");
