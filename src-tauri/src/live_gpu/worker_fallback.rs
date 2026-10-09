//! 隐藏或租约失效后，按CPU预算将保留的单帧纹理转换为RGB。
use super::SERVICE;
use crate::live_gpu::snapshot::Readback;
use crate::live_gpu::work_budget::{CaptureBudget, CpuPermit};

pub(crate) fn fallback(
    id: &str,
    after_ms: u64,
    budget: &CaptureBudget,
    timing: &mut crate::LiveReadbackTiming,
) -> Result<Option<(image::RgbImage, u64, CpuPermit)>, String> {
    let (readback, permit) = {
        let service = SERVICE.lock().map_err(|_| "GPU service poisoned")?;
        let Some(service) = service.as_ref() else {
            return Ok(None);
        };
        let slots = service.slots.lock().map_err(|_| "GPU slots poisoned")?;
        let Some(slot) = slots.get(id) else {
            return Ok(None);
        };
        if slot.cpu_suppressed() && !budget.needs_encoded_frames() {
            budget.cancel_cpu();
            return Ok(None);
        }
        let Some(frame) = slot
            .latest
            .as_ref()
            .or(slot.in_flight.as_ref())
            .or(slot.spare.as_ref())
            .filter(|frame| frame.captured_at_ms > after_ms)
        else {
            return Ok(None);
        };
        let Some(permit) = budget.try_cpu(frame.width, frame.height) else {
            return Ok(None);
        };
        // 源纹理复用前完成独立staging copy；Map仍在service/slots锁之外。
        (timing.staging_copy(|| Readback::copy(frame))?, permit)
    };
    let (image, timestamp) = timing.map_rgb(|| readback.into_rgb())?;
    Ok(Some((image, timestamp, permit)))
}
