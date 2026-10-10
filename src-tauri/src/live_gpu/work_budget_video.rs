//! GPU 编码只要求 WGC 保持活跃，不要求额外 CPU readback/JPEG。
pub(crate) struct GpuFrameConsumer {
    _demand: std::sync::Arc<()>,
}
impl GpuFrameConsumer {
    pub fn acquire(id: &str) -> Result<Self, String> {
        let budget = super::BUDGET
            .lock()
            .map_err(|_| "live work budget poisoned")?;
        let demand = budget
            .demands
            .get(id)
            .ok_or("live capture budget unavailable")?;
        Ok(Self {
            _demand: demand.gpu_consumers.clone(),
        })
    }
}
