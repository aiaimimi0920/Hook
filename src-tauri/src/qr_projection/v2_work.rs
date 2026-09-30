//! Bound v2 requests across network waits and cancellation of blocking image work.
use tokio::sync::{Semaphore, SemaphorePermit};

static REQUESTS: Semaphore = Semaphore::const_new(2);

pub(super) fn acquire() -> Result<SemaphorePermit<'static>, String> {
    REQUESTS
        .try_acquire()
        .map_err(|_| "projection_busy".to_owned())
}

pub(super) async fn run<T: Send + 'static>(
    permit: SemaphorePermit<'static>,
    error: &'static str,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<(T, SemaphorePermit<'static>), String> {
    // The closure owns the permit: dropping the IPC future must not admit more
    // decoders while an uncancellable blocking task is still running.
    tauri::async_runtime::spawn_blocking(move || work().map(|value| (value, permit)))
        .await
        .map_err(|_| error.to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn projection_v2_work_keeps_budget_until_cancelled_decoder_finishes() {
        let async_thread = std::thread::current().id();
        let (worker_thread, permit) = run(acquire().unwrap(), "join_failed", || {
            Ok(std::thread::current().id())
        })
        .await
        .unwrap();
        assert_ne!(worker_thread, async_thread);
        drop(permit);
        assert!(run(acquire().unwrap(), "join_failed", || Err::<(), _>(
            "bad_png".to_owned()
        ))
        .await
        .is_err());

        let held = acquire().unwrap();
        let decoding = acquire().unwrap();
        assert_eq!(acquire().unwrap_err(), "projection_busy");
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let task = tokio::spawn(run(decoding, "join_failed", move || {
            started_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            Ok(())
        }));
        tokio::time::timeout(Duration::from_secs(5), started_rx)
            .await
            .unwrap()
            .unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert_eq!(acquire().unwrap_err(), "projection_busy");
        release_tx.send(()).unwrap();
        let returned = tokio::time::timeout(Duration::from_secs(5), REQUESTS.acquire())
            .await
            .unwrap()
            .unwrap();
        drop(returned);
        drop(held);
        assert_eq!(REQUESTS.available_permits(), 2);
    }
}
