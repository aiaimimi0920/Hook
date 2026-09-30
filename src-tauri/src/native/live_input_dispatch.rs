// Foreign-window message handling must not block the WebView's UI/message pump.
const LIVE_INPUT_MAX_IN_FLIGHT: usize = 16;
static LIVE_INPUT_IN_FLIGHT: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

struct LiveInputPermit<'a>(&'a std::sync::atomic::AtomicUsize);
impl<'a> LiveInputPermit<'a> {
    fn acquire(counter: &'a std::sync::atomic::AtomicUsize, limit: usize) -> Result<Self, String> {
        use std::sync::atomic::Ordering;
        counter
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |active| {
                (active < limit).then_some(active + 1)
            })
            .map(|_| Self(counter))
            .map_err(|_| "live_input_dispatch_busy".to_string())
    }
}
impl Drop for LiveInputPermit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, std::sync::atomic::Ordering::AcqRel);
    }
}

async fn run_live_input_job(
    operation: impl FnOnce() -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    // Admission is before spawn, so the blocking pool cannot accumulate an unbounded queue.
    let permit = LiveInputPermit::acquire(&LIVE_INPUT_IN_FLIGHT, LIVE_INPUT_MAX_IN_FLIGHT)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        operation()
    })
    .await
    .map_err(|error| format!("live input worker failed: {error}"))?
}

fn deliver_live_capture_input(
    session: &LiveCaptureSession,
    session_id: &str,
    request: &LiveCaptureInputRequest,
) -> Result<(), String> {
    let mut source = session
        .source_window
        .as_ref()
        .expect("validated live source")
        .lock()
        .map_err(|_| "live source window lock poisoned".to_string())?;
    let was_enabled = source.interaction_enabled;
    if let Err(error) = source.send_input(request) {
        let _ = source.set_interaction_enabled(false);
        update_live_source_status(session, &source)?;
        if was_enabled {
            append_runtime_log_line(&format!(
                "live_capture_input_disabled :: session={session_id}"
            ));
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod live_input_dispatch_tests {
    use super::*;
    #[test]
    fn permits_bound_pending_work_and_release_on_error_or_unwind() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let counter = AtomicUsize::new(0);
        let first = LiveInputPermit::acquire(&counter, 2).unwrap();
        let second = LiveInputPermit::acquire(&counter, 2).unwrap();
        assert!(LiveInputPermit::acquire(&counter, 2).is_err());
        drop(first);
        drop(second);
        let _ = std::panic::catch_unwind(|| {
            let _permit = LiveInputPermit::acquire(&counter, 2).unwrap();
            panic!("test unwind");
        });
        assert_eq!(counter.load(Ordering::Acquire), 0);
    }
    #[test]
    fn target_work_runs_off_the_command_callers_thread_and_keeps_errors() {
        let caller = std::thread::current().id();
        let result = tauri::async_runtime::block_on(run_live_input_job(move || {
            assert_ne!(std::thread::current().id(), caller);
            Err("owned target failure".to_string())
        }));
        assert_eq!(result.unwrap_err(), "owned target failure");
    }
}
