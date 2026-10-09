//! C1 单源 GPU 订阅：只替换尚未编码的原始帧，捕获池纹理永不跨回调保存。
use crate::live_gpu::{work_budget::GpuFrameConsumer, GpuFrame};
use std::sync::{Arc, LazyLock, Mutex, Weak};
use windows::Win32::Graphics::Direct3D11::{ID3D11Device, ID3D11Texture2D, D3D11_BOX};

type Registry = Option<(String, Weak<Mutex<Slot>>)>;
static SUBSCRIBER: LazyLock<Mutex<Registry>> = LazyLock::new(|| Mutex::new(None));

#[derive(Default)]
struct Slot {
    frame: Option<Result<Captured, String>>,
    generation: u64,
    closed: bool,
}

/// 纹理从捕获池复制后仅交给一个编码 owner；调用方不得写入或回收到捕获池。
pub struct Captured {
    pub texture: ID3D11Texture2D,
    pub device: ID3D11Device,
    pub width: u32,
    pub height: u32,
    pub captured_at_ms: u64,
    pub generation: u64,
}

pub struct Subscription {
    id: String,
    slot: Arc<Mutex<Slot>>,
    _demand: GpuFrameConsumer,
}

impl Subscription {
    pub fn acquire(id: &str) -> Result<Self, String> {
        let demand = GpuFrameConsumer::acquire(id)?;
        let mut registry = SUBSCRIBER
            .lock()
            .map_err(|_| "video capture registry poisoned")?;
        if registry
            .as_ref()
            .is_some_and(|(_, slot)| slot.upgrade().is_some())
        {
            return Err("C1 hardware video supports one source per process".into());
        }
        let slot = Arc::new(Mutex::new(Slot::default()));
        *registry = Some((id.to_owned(), Arc::downgrade(&slot)));
        Ok(Self {
            id: id.to_owned(),
            slot,
            _demand: demand,
        })
    }

    pub fn take(&self) -> Result<Option<Captured>, String> {
        let mut slot = self
            .slot
            .lock()
            .map_err(|_| "video capture slot poisoned")?;
        if slot.closed {
            return Err("video capture ended".into());
        }
        slot.frame.take().transpose()
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        if let Ok(mut registry) = SUBSCRIBER.lock() {
            if registry.as_ref().is_some_and(|(id, slot)| {
                id == &self.id && slot.ptr_eq(&Arc::downgrade(&self.slot))
            }) {
                *registry = None;
            }
        }
    }
}

fn slot(id: &str) -> Option<Arc<Mutex<Slot>>> {
    SUBSCRIBER
        .lock()
        .ok()?
        .as_ref()
        .filter(|(source, _)| source == id)
        .and_then(|(_, weak)| weak.upgrade())
}

pub(crate) fn offer(id: &str, frame: &scap_direct3d::Frame, crop: Option<D3D11_BOX>) {
    let Some(slot) = slot(id) else {
        return;
    };
    let Ok(mut slot) = slot.try_lock() else {
        return;
    };
    if slot.closed {
        return;
    }
    let generation = slot.generation;
    // None 强制独立分配；正在编码的上一帧绝不作为 reusable 纹理。
    slot.frame = Some(GpuFrame::copy(frame, crop, None).map(|frame| Captured {
        texture: frame.texture,
        device: frame.device,
        width: frame.width,
        height: frame.height,
        captured_at_ms: frame.captured_at_ms,
        generation,
    }));
}

pub(crate) fn invalidate(id: &str, closed: bool) {
    if let Some(slot) = slot(id) {
        if let Ok(mut slot) = slot.lock() {
            slot.frame = None;
            slot.generation = slot.generation.saturating_add(1);
            // 终止不可逆；同名新捕获的 reset 不能复活旧订阅。
            slot.closed |= closed;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::live_gpu::work_budget::CaptureBudget;
    #[test]
    fn single_source_lease_reset_and_stop_are_generation_fenced() {
        let budget = CaptureBudget::register("video-subscription-test", 30);
        let first = Subscription::acquire("video-subscription-test").unwrap();
        assert!(!budget.needs_encoded_frames());
        assert!(Subscription::acquire("video-subscription-test").is_err());
        invalidate("unrelated", true);
        assert!(first.take().unwrap().is_none());
        invalidate("video-subscription-test", false);
        assert_eq!(first.slot.lock().unwrap().generation, 1);
        invalidate("video-subscription-test", true);
        assert!(first.take().is_err());
        invalidate("video-subscription-test", false);
        assert!(first.take().is_err());
        drop(first);
        let second = Subscription::acquire("video-subscription-test").unwrap();
        assert!(second.take().unwrap().is_none());
        drop(second);
    }
}
