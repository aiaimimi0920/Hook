//! Independent output media consumers. No capture handles, Surface attachments or controllers.
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex, OnceLock,
};
use std::time::{Duration, Instant};
mod packet;
mod socket;
mod stats;
pub(crate) use stats::WallLiveStats;

const MAX_STREAMS: usize = 4;
const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
static STREAMS: OnceLock<Mutex<HashMap<String, Arc<Stream>>>> = OnceLock::new();

#[derive(Clone, Copy, Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WallMediaFormat {
    RawBgra,
    Png,
}
impl WallMediaFormat {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::RawBgra => "raw_bgra",
            Self::Png => "png",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WallLiveRequest {
    endpoint_id: String,
    lease_id: String,
    revision: u64,
    session_id: String,
    format: WallMediaFormat,
}

struct Stream {
    stop: AtomicBool,
    state: Mutex<FrameState>,
}

struct FrameState {
    frame: Option<Vec<u8>>,
    last_read: Instant,
    last_frame: Instant,
    failure: Option<&'static str>,
}

struct Permit;
impl Drop for Permit {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::SeqCst);
    }
}

fn streams() -> &'static Mutex<HashMap<String, Arc<Stream>>> {
    STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub(crate) async fn wall_live_open(
    app: tauri::AppHandle,
    request: WallLiveRequest,
) -> Result<String, &'static str> {
    request.validate()?;
    ACTIVE
        .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
            (count < MAX_STREAMS).then_some(count + 1)
        })
        .map_err(|_| "wall_live_stream_limit")?;
    let permit = Permit;
    let manifest =
        crate::loom_connector::read_default_loom_manifest().map_err(|_| "wall_loom_unavailable")?;
    crate::loom_connector::classify_loom_base_url(&manifest.transport.base_url)
        .map_err(|_| "wall_invalid_origin")?;
    let authorization = crate::device_session::authorize_tile_request(&app, &manifest)
        .await
        .map_err(|_| "wall_pairing_required")?;
    let id = uuid::Uuid::new_v4().to_string();
    let stream = Arc::new(Stream {
        stop: AtomicBool::new(false),
        state: Mutex::new(FrameState {
            frame: None,
            last_read: Instant::now(),
            last_frame: Instant::now(),
            failure: None,
        }),
    });
    {
        let mut entries = streams().lock().map_err(|_| "wall_live_unavailable")?;
        entries.retain(|_, entry| {
            entry.state.lock().is_ok_and(|state| {
                state.failure.is_none() || state.last_read.elapsed() < Duration::from_secs(5)
            })
        });
        if entries.len() >= MAX_STREAMS {
            return Err("wall_live_stream_limit");
        }
        entries.insert(id.clone(), Arc::clone(&stream));
    }
    let worker_id = id.clone();
    let worker = std::thread::Builder::new()
        .name("hook-wall-live".into())
        .spawn(move || {
            // Closing/cancelling does not release admission until the worker has actually stopped.
            let _permit = permit;
            let outcome = socket::run(
                &stream,
                &manifest.transport.base_url,
                &authorization,
                &request,
            );
            let abandoned = if let Ok(mut state) = stream.state.lock() {
                state.frame = None;
                state.failure = Some(outcome.err().unwrap_or("wall_live_closed"));
                state.last_read.elapsed() >= Duration::from_secs(5)
            } else {
                true
            };
            // Keep a bounded terminal error until read, so capability/source failures reach the UI.
            if abandoned || stream.stop.load(Ordering::SeqCst) {
                if let Ok(mut entries) = streams().lock() {
                    entries.remove(&worker_id);
                }
            }
        });
    if worker.is_err() {
        streams()
            .lock()
            .map_err(|_| "wall_live_unavailable")?
            .remove(&id);
        return Err("wall_live_worker_failed");
    }
    Ok(id)
}

#[tauri::command]
pub(crate) fn wall_live_read(stream_id: String) -> Result<tauri::ipc::Response, &'static str> {
    let stream = streams()
        .lock()
        .map_err(|_| "wall_live_unavailable")?
        .get(&stream_id)
        .cloned()
        .ok_or("wall_live_closed")?;
    let mut state = stream.state.lock().map_err(|_| "wall_live_unavailable")?;
    state.last_read = Instant::now();
    if let Some(error) = state.failure {
        drop(state);
        streams()
            .lock()
            .map_err(|_| "wall_live_unavailable")?
            .remove(&stream_id);
        return Err(error);
    }
    if state.last_frame.elapsed() > Duration::from_secs(5) {
        return Err("wall_live_frame_timeout");
    }
    let frame = state.frame.take().unwrap_or_default();
    if !frame.is_empty() {
        stats::read();
    }
    Ok(tauri::ipc::Response::new(frame))
}

#[tauri::command]
pub(crate) fn wall_live_stats() -> WallLiveStats {
    stats::snapshot(ACTIVE.load(Ordering::SeqCst))
}

#[tauri::command]
pub(crate) fn wall_live_close(stream_id: String) -> Result<(), &'static str> {
    if let Some(stream) = streams()
        .lock()
        .map_err(|_| "wall_live_unavailable")?
        .remove(&stream_id)
    {
        stream.stop.store(true, Ordering::SeqCst);
        if let Ok(mut state) = stream.state.lock() {
            state.frame = None;
        }
    }
    Ok(())
}

impl WallLiveRequest {
    fn validate(&self) -> Result<(), &'static str> {
        for id in [&self.endpoint_id, &self.lease_id, &self.session_id] {
            if id.is_empty()
                || id.len() > 160
                || !id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-.:/".contains(&b))
            {
                return Err("wall_live_invalid_request");
            }
        }
        if self.revision == 0 || self.revision > 9_007_199_254_740_991 {
            return Err("wall_live_invalid_request");
        }
        Ok(())
    }
}
