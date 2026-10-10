//! One owned native socket. Polling is an explicit WebView lease, not an unbounded event sink.
use super::queue::TextQueue;
use crate::loom_bridge_client::BridgeSocket;
use serde::Serialize;
use std::{
    net::{Shutdown, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tungstenite::{Error, Message};

const POLL_LEASE: Duration = Duration::from_secs(30);
const IO_SLICE: Duration = Duration::from_millis(100);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PollResult {
    epoch: String,
    connected: bool,
    closed: bool,
    message: Option<String>,
}

struct Shared {
    outgoing: TextQueue,
    incoming: TextQueue,
    connected: bool,
    closed: bool,
    last_poll: Instant,
    interrupt: Option<TcpStream>,
}

pub(crate) struct Session {
    pub(crate) epoch: String,
    shared: Arc<Mutex<Shared>>,
    cancel: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl Session {
    pub(crate) fn finished(&self) -> bool {
        self.worker.as_ref().is_none_or(JoinHandle::is_finished)
    }

    pub(crate) fn start() -> Result<Self, String> {
        Self::start_with(|| crate::loom_bridge_client::connect(IO_SLICE))
    }

    pub(crate) fn start_with(
        connect: impl FnOnce() -> Result<BridgeSocket, String> + Send + 'static,
    ) -> Result<Self, String> {
        let shared = Arc::new(Mutex::new(Shared {
            outgoing: TextQueue::default(),
            incoming: TextQueue::default(),
            connected: false,
            closed: false,
            last_poll: Instant::now(),
            interrupt: None,
        }));
        let cancel = Arc::new(AtomicBool::new(false));
        let state = shared.clone();
        let cancelled = cancel.clone();
        let worker = thread::Builder::new()
            .name("extension-bridge".into())
            .spawn(move || {
                if let Ok(mut socket) = connect() {
                    let admitted = if let Ok(mut state) = state.lock() {
                        state.interrupt = socket.get_ref().sock.interrupt_handle().ok();
                        state.connected =
                            state.interrupt.is_some() && !cancelled.load(Ordering::Acquire);
                        state.connected
                    } else {
                        false
                    };
                    if admitted {
                        run(&mut socket, &state, &cancelled);
                    }
                }
                if let Ok(mut state) = state.lock() {
                    state.closed = true;
                    state.connected = false;
                    state.interrupt = None;
                }
            })
            .map_err(|_| "Cannot start extension bridge worker")?;
        Ok(Self {
            epoch: uuid::Uuid::new_v4().to_string(),
            shared,
            cancel,
            worker: Some(worker),
        })
    }

    pub(crate) fn send(&self, text: String) -> Result<(), String> {
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Extension bridge state unavailable")?;
        if !shared.connected || shared.closed {
            return Err("Extension bridge disconnected".into());
        }
        shared.outgoing.push(text)
    }

    pub(crate) fn poll(&self) -> Result<PollResult, String> {
        let mut shared = self
            .shared
            .lock()
            .map_err(|_| "Extension bridge state unavailable")?;
        shared.last_poll = Instant::now();
        let message = shared.incoming.pop();
        Ok(PollResult {
            epoch: self.epoch.clone(),
            connected: shared.connected,
            closed: shared.closed && shared.incoming.is_empty(),
            message,
        })
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Release);
        if let Ok(shared) = self.shared.lock() {
            if let Some(socket) = &shared.interrupt {
                let _ = socket.shutdown(Shutdown::Both);
            }
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn run(socket: &mut BridgeSocket, shared: &Mutex<Shared>, cancel: &AtomicBool) {
    while !cancel.load(Ordering::Acquire) {
        let outgoing = match shared.lock() {
            Ok(mut state) if state.last_poll.elapsed() < POLL_LEASE => state.outgoing.pop(),
            _ => break,
        };
        if let Some(text) = outgoing {
            socket
                .get_mut()
                .sock
                .operation_deadline(Duration::from_secs(5));
            if socket.send(Message::Text(text.into())).is_err() {
                break;
            }
        }
        // A single read cannot hold the worker forever with partial TLS/WS frames.
        socket.get_mut().sock.operation_deadline(IO_SLICE);
        match socket.read() {
            Ok(Message::Text(text)) => {
                if cancel.load(Ordering::Acquire) {
                    break;
                }
                let Ok(mut state) = shared.lock() else {
                    break;
                };
                if state.incoming.push(text.to_string()).is_err() {
                    break;
                }
            }
            Ok(Message::Ping(_)) => {
                if crate::loom_bridge_client::flush_control_reply(socket).is_err() {
                    break;
                }
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => (),
            Err(Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                ()
            }
            Err(_) => break,
        }
    }
}
