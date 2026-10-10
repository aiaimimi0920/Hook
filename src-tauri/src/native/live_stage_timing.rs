// 采集与relay共用的固定大小计时值；不负责策略、时钟校准或帧历史。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveStageTiming {
    attempts: u64,
    succeeded: u64,
    failed: u64,
    empty: u64,
    total_micros: u64,
    max_micros: u64,
}

enum LiveTimingOutcome {
    Succeeded,
    Failed,
    Empty,
}

impl LiveStageTiming {
    fn record(&mut self, elapsed: Duration, outcome: LiveTimingOutcome) {
        let micros = elapsed.as_micros().min(u64::MAX as u128) as u64;
        self.attempts = self.attempts.saturating_add(1);
        match outcome {
            LiveTimingOutcome::Succeeded => self.succeeded = self.succeeded.saturating_add(1),
            LiveTimingOutcome::Failed => self.failed = self.failed.saturating_add(1),
            LiveTimingOutcome::Empty => self.empty = self.empty.saturating_add(1),
        }
        self.total_micros = self.total_micros.saturating_add(micros);
        self.max_micros = self.max_micros.max(micros);
    }

    fn merge(&mut self, next: &Self) {
        self.attempts = self.attempts.saturating_add(next.attempts);
        self.succeeded = self.succeeded.saturating_add(next.succeeded);
        self.failed = self.failed.saturating_add(next.failed);
        self.empty = self.empty.saturating_add(next.empty);
        self.total_micros = self.total_micros.saturating_add(next.total_micros);
        self.max_micros = self.max_micros.max(next.max_micros);
    }
}
