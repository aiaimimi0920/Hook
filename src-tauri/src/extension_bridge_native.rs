//! Narrow, main-WebView-only IPC. Credentials and network destinations never cross IPC.
mod queue;
mod session;
#[cfg(test)]
pub(crate) use session::Session as TestSession;

use session::{PollResult, Session};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Manager, WebviewWindow};

#[derive(Default)]
pub(crate) struct ExtensionBridgeState {
    session: Mutex<Option<Session>>,
    exiting: AtomicBool,
}

fn require_owner(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Extension bridge is restricted to the main window".into());
    }
    crate::loom_bridge_client::require_enabled()
}

fn matching<'a>(slot: &'a Option<Session>, epoch: &str) -> Result<&'a Session, String> {
    slot.as_ref()
        .filter(|session| session.epoch == epoch)
        .ok_or_else(|| "Stale extension bridge session".into())
}

#[tauri::command]
pub(crate) async fn extension_bridge_open(window: WebviewWindow) -> Result<String, String> {
    require_owner(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ExtensionBridgeState>();
        let mut slot = state
            .session
            .lock()
            .map_err(|_| "Extension bridge state unavailable")?;
        if state.exiting.load(Ordering::Acquire) {
            return Err("Extension bridge is shutting down".into());
        }
        // A delayed open cannot replace a newer live owner. Reloads retry after cleanup/lease expiry.
        if slot.as_ref().is_some_and(|session| !session.finished()) {
            return Err("Extension bridge already has an active owner".into());
        }
        drop(slot.take());
        let session = Session::start()?;
        let epoch = session.epoch.clone();
        *slot = Some(session);
        Ok(epoch)
    })
    .await
    .map_err(|_| "Extension bridge task failed")?
}

#[tauri::command]
pub(crate) async fn extension_bridge_send(
    window: WebviewWindow,
    epoch: String,
    text: String,
) -> Result<(), String> {
    require_owner(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Parsing an image-bearing envelope must not block the UI or hold the owner lock.
        queue::validate_message(&text)?;
        let state = app.state::<ExtensionBridgeState>();
        let slot = state
            .session
            .lock()
            .map_err(|_| "Extension bridge state unavailable")?;
        matching(&slot, &epoch)?.send(text)
    })
    .await
    .map_err(|_| "Extension bridge task failed")?
}

#[tauri::command]
pub(crate) async fn extension_bridge_poll(
    window: WebviewWindow,
    epoch: String,
) -> Result<PollResult, String> {
    require_owner(&window)?;
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ExtensionBridgeState>();
        let slot = state
            .session
            .lock()
            .map_err(|_| "Extension bridge state unavailable")?;
        matching(&slot, &epoch)?.poll()
    })
    .await
    .map_err(|_| "Extension bridge task failed")?
}

#[tauri::command]
pub(crate) async fn extension_bridge_close(
    window: WebviewWindow,
    epoch: String,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Extension bridge is restricted to the main window".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ExtensionBridgeState>();
        let mut slot = state
            .session
            .lock()
            .map_err(|_| "Extension bridge state unavailable")?;
        if matching(&slot, &epoch).is_ok() {
            drop(slot.take());
        }
        Ok(())
    })
    .await
    .map_err(|_| "Extension bridge task failed")?
}

pub(crate) fn shutdown(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<ExtensionBridgeState>() {
        state.exiting.store(true, Ordering::Release);
        if let Ok(mut slot) = state.session.lock() {
            drop(slot.take());
        }
    }
}

#[cfg(test)]
mod tests;
