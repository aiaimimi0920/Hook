//! Owns listener cancellation, socket interruption and join across local/remote transports.
use super::LoomHookState;
use std::{
    net::{Shutdown, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

#[derive(Default)]
pub(super) struct ListenerControl {
    cancelled: AtomicBool,
    socket: Mutex<Option<TcpStream>>,
}

impl ListenerControl {
    pub(super) fn cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(super) fn attach(&self, socket: TcpStream) -> Result<(), String> {
        // The caller bounds reads on the ORIGINAL stream before cloning. On Windows,
        // configuring only this interrupt handle does not bound the worker's recv.
        let mut slot = self
            .socket
            .lock()
            .map_err(|_| "Listener control unavailable")?;
        if self.cancelled() {
            return Err("Listener stopped".into());
        }
        *slot = Some(socket);
        Ok(())
    }

    pub(super) fn detach(&self) {
        if let Ok(mut socket) = self.socket.lock() {
            *socket = None;
        }
    }

    pub(super) fn wait(&self, duration: Duration) {
        if !self.cancelled() {
            thread::park_timeout(duration);
        }
    }

    #[cfg(feature = "remote-surface")]
    pub(super) async fn cancellation(&self) {
        while !self.cancelled() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
}

pub(super) struct ListenerTask {
    control: Arc<ListenerControl>,
    worker: Option<JoinHandle<()>>,
}

impl ListenerTask {
    pub(super) fn spawn(
        state: Arc<Mutex<LoomHookState>>,
        run: impl FnOnce(Arc<ListenerControl>) + Send + 'static,
    ) -> Result<Self, String> {
        let control = Arc::new(ListenerControl::default());
        let worker_control = control.clone();
        let worker = thread::Builder::new()
            .name("loom-hook-listener".into())
            .spawn(move || {
                struct Reset(Arc<Mutex<LoomHookState>>);
                impl Drop for Reset {
                    fn drop(&mut self) {
                        if let Ok(mut state) = self.0.lock() {
                            state.listener_started = false;
                            state.backend_connected = false;
                        }
                    }
                }
                let _reset = Reset(state);
                run(worker_control);
            })
            .map_err(|_| "Cannot start Loom listener")?;
        Ok(Self {
            control,
            worker: Some(worker),
        })
    }
}

impl Drop for ListenerTask {
    fn drop(&mut self) {
        self.control.cancelled.store(true, Ordering::Release);
        if let Ok(socket) = self.control.socket.lock() {
            if let Some(socket) = socket.as_ref() {
                let _ = socket.shutdown(Shutdown::Both);
            }
        }
        if let Some(worker) = self.worker.take() {
            worker.thread().unpark();
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests;
