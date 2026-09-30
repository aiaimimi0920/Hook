// The WGC session and WinRT apartment are created and destroyed on this owner.
use super::{mpsc, Arc, Duration, GraphicsCaptureItem, Instant, Ordering, SourceState};
use scap_direct3d::Capturer;
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

static ACTIVE_POOLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
pub(super) fn active_pool_count() -> usize {
    ACTIVE_POOLS.load(Ordering::Acquire)
}

struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}

struct Pool {
    capturer: Capturer,
}
impl Drop for Pool {
    fn drop(&mut self) {
        let _ = self.capturer.stop();
        ACTIVE_POOLS.fetch_sub(1, Ordering::AcqRel);
    }
}

fn build(item: &GraphicsCaptureItem, state: &Arc<SourceState>) -> Result<Pool, String> {
    let generation = state.advance_generation()?;
    let mut settings = super::super::windows_capture_settings(None);
    settings.fps = Some(60);
    settings.latest_frame_only = true;
    settings.min_update_interval = Some(state.interval());
    let frames = state.clone();
    let closed = state.clone();
    let mut capturer = Capturer::new(
        item.clone(),
        settings,
        move |frame| {
            let Ok(mut subscribers) = frames.subscribers.lock() else {
                return Ok(());
            };
            if !frames.alive.load(Ordering::Acquire)
                || frames.generation.load(Ordering::Acquire) != generation
            {
                return Ok(());
            }
            let now = Instant::now();
            let interval = subscribers
                .values()
                .map(|subscriber| subscriber.interval)
                .min()
                .unwrap_or(Duration::from_secs(1));
            for (id, subscriber) in subscribers.iter_mut() {
                if subscriber.due(now, interval) {
                    subscriber.mailbox.capture(id, &frame, subscriber.crop);
                }
            }
            Ok(())
        },
        move || {
            if closed.generation.load(Ordering::Acquire) == generation {
                closed.close();
            }
            Ok(())
        },
        super::super::shared_d3d_device().ok().cloned(),
    )
    .map_err(|error| error.to_string())?;
    capturer.start().map_err(|error| error.to_string())?;
    ACTIVE_POOLS.fetch_add(1, Ordering::AcqRel);
    Ok(Pool { capturer })
}

pub(super) fn run(
    item: GraphicsCaptureItem,
    state: Arc<SourceState>,
    stop: mpsc::Receiver<()>,
    ready: mpsc::SyncSender<Result<(), String>>,
) {
    let initialized =
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(|error| error.to_string());
    if let Err(error) = initialized {
        let _ = ready.try_send(Err(error));
        state.close();
        return;
    }
    let _apartment = Apartment;
    let mut pool = match build(&item, &state) {
        Ok(pool) => {
            let _ = ready.try_send(Ok(()));
            Some(pool)
        }
        Err(error) => {
            let _ = ready.try_send(Err(error));
            state.close();
            return;
        }
    };
    let mut interval = state.interval();
    while state.alive.load(Ordering::Acquire) {
        if !matches!(
            stop.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ) {
            break;
        }
        if state.refresh.swap(false, Ordering::AcqRel) {
            // Reject any in-flight old callback before closing and replacing its pool.
            if state.advance_generation().is_err() {
                break;
            }
            drop(pool.take());
            match build(&item, &state) {
                Ok(next) => {
                    pool = Some(next);
                    interval = state.interval();
                }
                Err(error) => {
                    crate::append_runtime_log_line(&format!(
                        "live_shared_source_refresh_failed :: {error}"
                    ));
                    break;
                }
            }
        } else {
            let next = state.interval();
            if next != interval {
                let Some(active) = pool.as_ref() else {
                    break;
                };
                if active
                    .capturer
                    .session()
                    .SetMinUpdateInterval(next.into())
                    .is_err()
                {
                    break;
                }
                interval = next;
            }
        }
    }
    state.close();
    drop(pool);
}
