// Window source ownership is separate from each Unit's mailbox and input lifecycle.
use super::handoff::FrameMailbox;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc, Arc, LazyLock, Mutex, Weak,
};
use std::time::{Duration, Instant};
use windows::Graphics::Capture::GraphicsCaptureItem;
use windows::Win32::Graphics::Direct3D11::D3D11_BOX;

mod owner {
    include!("live_shared_source_worker.rs");
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub(super) struct SourceKey {
    hwnd: u64,
    process_id: u32,
    width: i32,
    height: i32,
}

impl SourceKey {
    pub fn budget_key(&self) -> String {
        format!(
            "{:x}:{}:{}:{}",
            self.hwnd, self.process_id, self.width, self.height
        )
    }

    pub fn new(window: &str, process_id: u32, width: i32, height: i32) -> Result<Self, String> {
        let hwnd = u64::from_str_radix(window.trim_start_matches("0x"), 16)
            .map_err(|_| "invalid shared source window")?;
        if hwnd == 0 || process_id == 0 || width <= 0 || height <= 0 {
            return Err("invalid shared source identity or dimensions".to_string());
        }
        Ok(Self {
            hwnd,
            process_id,
            width,
            height,
        })
    }
}

struct Subscriber {
    mailbox: Arc<FrameMailbox>,
    crop: Option<D3D11_BOX>,
    closed: Arc<AtomicBool>,
    interval: Duration,
    next_due: Option<Instant>,
}

impl Subscriber {
    fn due(&mut self, now: Instant, source_interval: Duration) -> bool {
        // WGC already paces the fastest subscribers; a second jitter-sensitive
        // deadline here would unnecessarily discard their arriving frames.
        if self.interval <= source_interval {
            self.next_due = None;
            return true;
        }
        if self.next_due.is_some_and(|next| now < next) {
            return false;
        }
        self.next_due = Some(
            self.next_due
                .map(|next| next + self.interval)
                .filter(|next| *next > now)
                .unwrap_or(now + self.interval),
        );
        true
    }
    fn set_interval(&mut self, interval: Duration) {
        if interval < self.interval {
            self.next_due = None;
        }
        self.interval = interval;
    }
}

struct SourceState {
    subscribers: Mutex<HashMap<String, Subscriber>>,
    alive: AtomicBool,
    refresh: AtomicBool,
    generation: AtomicU64,
}

impl SourceState {
    fn advance_generation(&self) -> Result<u64, String> {
        // Finish an old callback's owned copies before its WGC pool is closed.
        let _subscribers = self
            .subscribers
            .lock()
            .map_err(|_| "shared subscribers poisoned")?;
        self.generation
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                value.checked_add(1)
            })
            .map(|previous| previous + 1)
            .map_err(|_| "shared source generation exhausted".to_string())
    }
    fn close(&self) {
        self.alive.store(false, Ordering::Release);
        if let Ok(subscribers) = self.subscribers.lock() {
            for subscriber in subscribers.values() {
                subscriber.closed.store(true, Ordering::Release);
            }
        }
    }
    fn interval(&self) -> Duration {
        self.subscribers
            .lock()
            .ok()
            .and_then(|subscribers| {
                subscribers
                    .values()
                    .map(|subscriber| subscriber.interval)
                    .min()
            })
            .unwrap_or(Duration::from_secs(1))
    }
}

struct Source {
    state: Arc<SourceState>,
    stop: mpsc::SyncSender<()>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl Drop for Source {
    fn drop(&mut self) {
        let _ = self.stop.try_send(());
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

static SOURCES: LazyLock<Mutex<HashMap<SourceKey, Weak<Source>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(super) struct Subscription {
    source: Arc<Source>,
    id: String,
}

impl Subscription {
    pub fn set_interval(&self, interval: Duration) -> Result<(), String> {
        let mut subscribers = self
            .source
            .state
            .subscribers
            .lock()
            .map_err(|_| "shared subscribers poisoned")?;
        let subscriber = subscribers
            .get_mut(&self.id)
            .ok_or("shared subscriber missing")?;
        subscriber.set_interval(interval);
        Ok(())
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        // Exclude callbacks before the caller removes this Unit's native GPU slot.
        if let Ok(mut subscribers) = self.source.state.subscribers.lock() {
            subscribers.remove(&self.id);
        }
    }
}

pub(super) fn subscribe(
    key: SourceKey,
    item: GraphicsCaptureItem,
    id: &str,
    mailbox: Arc<FrameMailbox>,
    crop: Option<D3D11_BOX>,
    closed: Arc<AtomicBool>,
    interval: Duration,
) -> Result<Subscription, String> {
    let mut registry = SOURCES
        .lock()
        .map_err(|_| "shared capture registry poisoned")?;
    registry.retain(|_, source| source.strong_count() > 0);
    let subscriber = Subscriber {
        mailbox,
        crop,
        closed,
        interval,
        next_due: None,
    };
    if let Some(source) = registry.get(&key).and_then(Weak::upgrade) {
        if source.state.alive.load(Ordering::Acquire) {
            let mut subscribers = source
                .state
                .subscribers
                .lock()
                .map_err(|_| "shared subscribers poisoned")?;
            if subscribers.contains_key(id) || subscribers.len() >= crate::LIVE_CAPTURE_MAX_SESSIONS
            {
                return Err("shared subscriber limit or duplicate identity".to_string());
            }
            subscribers.insert(id.to_string(), subscriber);
            source.state.refresh.store(true, Ordering::Release);
            drop(subscribers);
            return Ok(Subscription {
                source,
                id: id.to_string(),
            });
        }
    }
    if registry.len() >= crate::LIVE_CAPTURE_MAX_SESSIONS && !registry.contains_key(&key) {
        return Err("shared capture source limit reached".to_string());
    }
    let state = Arc::new(SourceState {
        subscribers: Mutex::new(HashMap::from([(id.to_string(), subscriber)])),
        alive: AtomicBool::new(true),
        refresh: AtomicBool::new(false),
        generation: AtomicU64::new(0),
    });
    let (stop, stop_rx) = mpsc::sync_channel(1);
    let (ready, ready_rx) = mpsc::sync_channel(1);
    let shared = state.clone();
    let join = std::thread::Builder::new()
        .name("hook-live-window-source".to_string())
        .spawn(move || owner::run(item, shared, stop_rx, ready))
        .map_err(|error| error.to_string())?;
    let source = Arc::new(Source {
        state,
        stop,
        join: Some(join),
    });
    ready_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())??;
    registry.insert(key, Arc::downgrade(&source));
    Ok(Subscription {
        source,
        id: id.to_string(),
    })
}

pub(super) fn active_pool_count() -> usize {
    owner::active_pool_count()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_key_normalizes_handles_but_separates_identity_and_resize() {
        let key = SourceKey::new("0xABC", 7, 800, 600).unwrap();
        assert_eq!(key, SourceKey::new("abc", 7, 800, 600).unwrap());
        assert_ne!(key, SourceKey::new("abc", 8, 800, 600).unwrap());
        assert_ne!(key, SourceKey::new("abc", 7, 900, 600).unwrap());
        assert!(SourceKey::new("0", 7, 800, 600).is_err());
        assert!(SourceKey::new("abc", 0, 800, 600).is_err());
    }
    #[test]
    fn slower_subscriber_is_throttled_and_visibility_restore_is_immediate() {
        let (ready, _) = mpsc::sync_channel(1);
        let mut subscriber = Subscriber {
            mailbox: Arc::new(FrameMailbox::new(
                "shared-cadence-test",
                60,
                Arc::new(AtomicU64::new(0)),
                ready,
            )),
            crop: None,
            closed: Arc::new(AtomicBool::new(false)),
            interval: Duration::from_secs(1),
            next_due: None,
        };
        let now = Instant::now();
        let source_interval = Duration::from_millis(10);
        assert!(subscriber.due(now, source_interval));
        assert!(!subscriber.due(now + Duration::from_millis(100), source_interval));
        subscriber.set_interval(Duration::from_millis(30));
        assert!(subscriber.due(now + Duration::from_millis(101), source_interval));
        assert!(!subscriber.due(now + Duration::from_millis(110), source_interval));
        assert!(subscriber.due(now + Duration::from_millis(111), Duration::from_millis(30)));
        assert!(subscriber.due(now + Duration::from_millis(140), Duration::from_millis(30)));
    }
}
