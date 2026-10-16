// 仅测同步CPU调用范围；CopyResource返回不是GPU完成确认。
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveReadbackTiming {
    staging_copy: LiveStageTiming,
    map_rgb: LiveStageTiming,
}

impl LiveReadbackTiming {
    fn staging_copy<T, E>(&mut self, work: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
        Self::measure(&mut self.staging_copy, work)
    }

    fn map_rgb<T, E>(&mut self, work: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
        Self::measure(&mut self.map_rgb, work)
    }

    fn measure<T, E>(stage: &mut LiveStageTiming, work: impl FnOnce() -> Result<T, E>) -> Result<T, E> {
        let start = Instant::now();
        let result = work();
        let outcome = if result.is_ok() {
            LiveTimingOutcome::Succeeded
        } else {
            LiveTimingOutcome::Failed
        };
        stage.record(start.elapsed(), outcome);
        result
    }

    fn merge(&mut self, next: &Self) {
        self.staging_copy.merge(&next.staging_copy);
        self.map_rgb.merge(&next.map_rgb);
    }
}
