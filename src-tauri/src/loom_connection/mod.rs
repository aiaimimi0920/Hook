//! Process-wide connection owner. UI closure does not stop the lease; disconnect invalidates late work.
mod discovery;
mod history;
#[cfg(all(test, feature = "remote-surface"))]
mod paired_tests;
pub(crate) mod projection;
mod protocol;
mod resume;
pub(crate) use resume::startup;
#[cfg(test)]
mod resume_tests;
#[cfg(feature = "remote-surface")]
mod worker;
#[cfg(not(feature = "remote-surface"))]
mod worker {
    pub(super) async fn run(
        _: &tauri::AppHandle,
        _: u64,
        _: &std::path::Path,
        _: &[super::history::Target],
        _: &str,
        _: &str,
        _: String,
    ) -> Result<(), String> {
        Err("此构建未启用 Loom 设备连接".into())
    }
}
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct View {
    phase: String,
    loom_id: Option<String>,
    name: Option<String>,
    origin: Option<String>,
    error: Option<String>,
    expires_at: u64,
}
impl Default for View {
    fn default() -> Self {
        Self {
            phase: "disconnected".into(),
            loom_id: None,
            name: None,
            origin: None,
            error: None,
            expires_at: 0,
        }
    }
}
#[derive(Clone)]
struct Receipt {
    origin: String,
    body: serde_json::Value,
}
#[derive(Default)]
struct Runtime {
    exiting: bool,
    generation: u64,
    view: View,
    receipt: Option<Receipt>,
    projection: Option<projection::Session>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
}
static OWNER: OnceLock<Mutex<Runtime>> = OnceLock::new();
fn owner() -> &'static Mutex<Runtime> {
    OWNER.get_or_init(|| Mutex::new(Runtime::default()))
}

fn publish(app: &tauri::AppHandle, generation: u64, view: View) -> bool {
    let Ok(mut state) = owner().lock() else {
        return false;
    };
    if generation != state.generation {
        return false;
    }
    state.view = view;
    if state.view.phase != "connected" {
        state.projection = None;
    }
    let _ = app.emit("loom-connection-state", &state.view);
    true
}

fn replace(
    app: &tauri::AppHandle,
    view: View,
    clear_resume: Option<&std::path::Path>,
    expected: Option<u64>,
) -> Result<(u64, Option<Receipt>), String> {
    let mut state = owner()
        .lock()
        .map_err(|_| "Loom 连接状态不可用".to_string())?;
    if state.exiting {
        return Err("Otter 正在退出".into());
    }
    resume::prepare_replace(&state, expected, clear_resume)?;
    state.generation = state.generation.wrapping_add(1);
    if let Some(task) = state.task.take() {
        task.abort();
    }
    let previous = state.receipt.take();
    state.projection = None;
    state.view = view;
    let _ = app.emit("loom-connection-state", &state.view);
    Ok((state.generation, previous))
}

async fn cancel(receipt: Receipt) {
    let _ = protocol::request(
        &receipt.origin,
        "/v1/otter/connections/cancel",
        Some(receipt.body),
        None,
    )
    .await;
}

#[tauri::command]
pub(crate) fn loom_connection_view(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let state = owner()
        .lock()
        .map_err(|_| "Loom 连接状态不可用".to_string())?;
    let mut view = state.view.clone();
    if view.phase == "connected" && view.expires_at <= protocol::now() {
        view = View {
            error: Some("Loom 连接已过期".into()),
            ..View::default()
        };
    }
    let history = history::load(&crate::effective_app_data_dir(&app)?)?;
    Ok(serde_json::json!({"state":view,"history":history}))
}

#[tauri::command]
pub(crate) async fn loom_connection_probe(origin: String) -> Result<protocol::LoomInfo, String> {
    protocol::probe(&protocol::origin(&origin)?).await
}

#[tauri::command]
pub(crate) async fn loom_connection_discover() -> Result<Vec<discovery::Candidate>, String> {
    discovery::discover().await
}

#[tauri::command]
pub(crate) async fn loom_connection_connect(
    app: tauri::AppHandle,
    origin: String,
    expected_id: String,
    password: String,
) -> Result<(), String> {
    connect(app, origin, expected_id, password, None).await
}

async fn connect(
    app: tauri::AppHandle,
    origin: String,
    expected_id: String,
    password: String,
    startup_generation: Option<u64>,
) -> Result<(), String> {
    let origin = protocol::origin(&origin)?;
    if password.len() > 256 || expected_id.len() > 160 || !expected_id.starts_with("loom-") {
        return Err("连接参数无效".into());
    }
    let root = crate::effective_app_data_dir(&app)?;
    let history = history::load(&root)?;
    let (generation, previous) = replace(
        &app,
        View {
            phase: "connecting".into(),
            origin: Some(origin.clone()),
            ..View::default()
        },
        if startup_generation.is_none() {
            Some(&root)
        } else {
            None
        },
        startup_generation,
    )?;
    let handle = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        if let Some(previous) = previous {
            cancel(previous).await;
        }
        let result = worker::run(
            &handle,
            generation,
            &root,
            &history,
            &origin,
            &expected_id,
            password,
        )
        .await;
        let receipt = {
            let Ok(mut state) = owner().lock() else {
                return;
            };
            if state.generation != generation {
                return;
            }
            state.receipt.take()
        };
        if let Err(error) = result {
            publish(
                &handle,
                generation,
                View {
                    error: Some(error),
                    ..View::default()
                },
            );
        }
        if let Some(receipt) = receipt {
            cancel(receipt).await;
        }
    });
    let mut state = owner()
        .lock()
        .map_err(|_| "Loom 连接状态不可用".to_string())?;
    if state.generation == generation {
        state.task = Some(task);
    } else {
        task.abort();
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn loom_connection_disconnect(app: tauri::AppHandle) -> Result<(), String> {
    let root = crate::effective_app_data_dir(&app)?;
    let (_, receipt) = replace(&app, View::default(), Some(&root), None)?;
    if let Some(receipt) = receipt {
        cancel(receipt).await;
    }
    Ok(())
}

pub(crate) fn shutdown() {
    if let Ok(mut state) = owner().lock() {
        state.exiting = true;
        state.generation = state.generation.wrapping_add(1);
        if let Some(task) = state.task.take() {
            task.abort();
        }
        // No network wait on application exit; the server lease expires within 30 seconds.
        state.receipt = None;
        state.projection = None;
        state.view = View::default();
    }
}
