// Owns bounded live-capture session state shared by Tauri commands and WGC workers.

const LIVE_CAPTURE_MAX_SESSIONS: usize = live_resources::HARD_LIMIT;
const LIVE_CAPTURE_FRAME_BUFFER: usize = 3;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveCaptureStartRequest {
    #[serde(default)]
    window_id: Option<String>,
    #[serde(default)]
    source_title: Option<String>,
    #[serde(default)]
    window_region: Option<LiveCaptureWindowRegion>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    #[serde(default = "default_live_capture_fps")]
    target_fps: u16,
}

fn default_live_capture_fps() -> u16 {
    60
}

#[derive(Clone, Debug)]
struct LiveCaptureWorkerConfig {
    session_id: String,
    window_id: Option<String>,
    expected_process_id: Option<u32>,
    source_title: Option<String>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    window_region: Option<LiveCapturePhysicalRegion>,
    target_fps: u16,
    display_metrics: CaptureWindowMetrics,
    source_window: Option<Arc<Mutex<LiveSourceWindowLifecycle>>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveCaptureFrameDescriptor {
    session_id: String,
    epoch: u64,
    frame_id: u64,
    capture_timestamp_ms: u64,
    encode_timestamp_ms: u64,
    width: u32,
    height: u32,
    mime: String,
    byte_length: usize,
    dropped_frames: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveCaptureStatusSnapshot {
    session_id: String,
    source_kind: String,
    source_window_id: Option<String>,
    source_title: Option<String>,
    source_process_id: Option<u32>,
    capture_state: String,
    visibility_state: String,
    target_fps: u16,
    max_buffered_frames: usize,
    epoch: u64,
    frame_id: u64,
    width: u32,
    height: u32,
    dropped_frames: u64,
    created_at_ms: u64,
    last_frame_at_ms: Option<u64>,
    error_code: Option<String>,
    error_message: Option<String>,
    source_window_state: String,
    input_capability: String,
    interaction_enabled: bool,
    logical_hide_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveCapturePollResponse {
    status: LiveCaptureStatusSnapshot,
    frame: Option<LiveCaptureFrameDescriptor>,
}

#[derive(Clone, Debug)]
struct LiveCaptureFrame {
    descriptor: LiveCaptureFrameDescriptor,
    bytes: Vec<u8>,
}

#[derive(Debug)]
struct LiveCaptureFrameBuffer {
    frames: std::collections::VecDeque<LiveCaptureFrame>,
}

impl LiveCaptureFrameBuffer {
    fn new() -> Self {
        Self {
            frames: std::collections::VecDeque::with_capacity(LIVE_CAPTURE_FRAME_BUFFER),
        }
    }

    fn push(&mut self, mut frame: LiveCaptureFrame, dropped_frames: &std::sync::atomic::AtomicU64) {
        if self.frames.len() == LIVE_CAPTURE_FRAME_BUFFER {
            self.frames.pop_front();
            dropped_frames.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        frame.descriptor.dropped_frames = dropped_frames.load(std::sync::atomic::Ordering::Relaxed);
        self.frames.push_back(frame);
    }

    fn latest_after(&self, frame_id: u64) -> Option<LiveCaptureFrameDescriptor> {
        self.frames
            .back()
            .filter(|frame| frame.descriptor.frame_id > frame_id)
            .map(|frame| frame.descriptor.clone())
    }

    fn clone_latest_after(&self, frame_id: u64) -> Option<LiveCaptureFrame> {
        self.frames
            .back()
            .filter(|frame| frame.descriptor.frame_id > frame_id)
            .cloned()
    }

    fn take_bytes_for(&mut self, frame_id: u64) -> Option<Vec<u8>> {
        let position = self
            .frames
            .iter()
            .position(|frame| frame.descriptor.frame_id == frame_id)?;
        self.frames
            .drain(..=position)
            .last()
            .map(|frame| frame.bytes)
    }

    fn clear(&mut self) {
        self.frames.clear();
    }
}

#[derive(Debug)]
struct LiveCaptureSessionState {
    session_id: String,
    source_kind: String,
    source_window_id: Option<String>,
    source_title: Option<String>,
    source_process_id: Option<u32>,
    capture_state: String,
    visibility_state: String,
    target_fps: u16,
    epoch: u64,
    frame_id: u64,
    width: u32,
    height: u32,
    created_at_ms: u64,
    last_frame_at_ms: Option<u64>,
    error_code: Option<String>,
    error_message: Option<String>,
    source_window_state: String,
    input_capability: String,
    interaction_enabled: bool,
    logical_hide_reason: Option<String>,
}

impl LiveCaptureSessionState {
    fn starting(config: &LiveCaptureWorkerConfig) -> Self {
        let (source_window_state, input_capability) = config
            .source_window
            .as_ref()
            .and_then(|source| source.lock().ok())
            .map(|source| {
                (
                    source.source_window_state().to_string(),
                    source.input_capability.clone(),
                )
            })
            .unwrap_or_else(|| {
                if config.window_id.is_some() {
                    ("unsupported".to_string(), "unavailable".to_string())
                } else {
                    (
                        "not_applicable".to_string(),
                        "unsupported_region".to_string(),
                    )
                }
            });
        Self {
            session_id: config.session_id.clone(),
            source_kind: if config.window_id.is_some() {
                "window"
            } else {
                "region"
            }
            .to_string(),
            source_window_id: config.window_id.clone(),
            source_title: config.source_title.clone(),
            source_process_id: config.expected_process_id,
            capture_state: "starting".to_string(),
            visibility_state: "capture_recovering".to_string(),
            target_fps: config.target_fps,
            epoch: 1,
            frame_id: 0,
            width: config.width,
            height: config.height,
            created_at_ms: live_capture_now_ms(),
            last_frame_at_ms: None,
            error_code: None,
            error_message: None,
            source_window_state,
            input_capability,
            interaction_enabled: false,
            logical_hide_reason: None,
        }
    }

    fn mark_recovering(&mut self, epoch: u64, code: &str, message: &str) {
        self.epoch = epoch;
        self.capture_state = "recovering".to_string();
        self.visibility_state = "capture_recovering".to_string();
        self.error_code = Some(code.to_string());
        self.error_message = Some(message.to_string());
    }

    fn mark_failed(&mut self, code: &str, message: &str) {
        self.capture_state = "failed".to_string();
        self.visibility_state = "capture_failed".to_string();
        self.error_code = Some(code.to_string());
        self.error_message = Some(message.to_string());
    }

    fn mark_frame(&mut self, descriptor: &LiveCaptureFrameDescriptor) {
        self.mark_capture(descriptor.epoch, descriptor.capture_timestamp_ms);
        self.frame_id = descriptor.frame_id;
    }

    // Capture arrival is independent of optional CPU readback and JPEG delivery.
    fn mark_capture(&mut self, epoch: u64, captured_at_ms: u64) {
        self.capture_state = "streaming".to_string();
        self.visibility_state = "visible".to_string();
        self.epoch = epoch;
        // Status dimensions stay in Hook logical coordinates for the complete
        // session. Frame descriptors are physical pixels and must not silently
        // change the unit consumed by view geometry and normalized input.
        self.last_frame_at_ms = Some(self.last_frame_at_ms.unwrap_or(0).max(captured_at_ms));
        self.error_code = None;
        self.error_message = None;
    }

    fn mark_closed(&mut self) {
        self.capture_state = "closed".to_string();
        self.visibility_state = "closed".to_string();
    }

    fn set_source_identity(&mut self, process_id: Option<u32>, title: Option<String>) {
        self.source_process_id = process_id;
        if title.is_some() {
            self.source_title = title;
        }
    }

    fn set_source_window_status(&mut self, source: &LiveSourceWindowLifecycle) {
        self.source_window_state = source.source_window_state().to_string();
        self.input_capability = source.input_capability.clone();
        self.interaction_enabled = source.interaction_enabled;
        self.logical_hide_reason = source.logical_hide_reason();
    }

    fn mark_source_window_closed(&mut self) {
        self.source_window_state = "closed".to_string();
        self.interaction_enabled = false;
    }

    fn snapshot(&self, dropped_frames: u64) -> LiveCaptureStatusSnapshot {
        LiveCaptureStatusSnapshot {
            session_id: self.session_id.clone(),
            source_kind: self.source_kind.clone(),
            source_window_id: self.source_window_id.clone(),
            source_title: self.source_title.clone(),
            source_process_id: self.source_process_id,
            capture_state: self.capture_state.clone(),
            visibility_state: self.visibility_state.clone(),
            target_fps: self.target_fps,
            max_buffered_frames: LIVE_CAPTURE_FRAME_BUFFER,
            epoch: self.epoch,
            frame_id: self.frame_id,
            width: self.width,
            height: self.height,
            dropped_frames,
            created_at_ms: self.created_at_ms,
            last_frame_at_ms: self.last_frame_at_ms,
            error_code: self.error_code.clone(),
            error_message: self.error_message.clone(),
            source_window_state: self.source_window_state.clone(),
            input_capability: self.input_capability.clone(),
            interaction_enabled: self.interaction_enabled,
            logical_hide_reason: self.logical_hide_reason.clone(),
        }
    }
}

struct LiveCaptureSession {
    state: Arc<Mutex<LiveCaptureSessionState>>,
    frames: Arc<Mutex<LiveCaptureFrameBuffer>>,
    dropped_frames: Arc<std::sync::atomic::AtomicU64>,
    stop_tx: Mutex<Option<mpsc::SyncSender<()>>>,
    join: Mutex<Option<std::thread::JoinHandle<()>>>,
    source_window: Option<Arc<Mutex<LiveSourceWindowLifecycle>>>,
}

impl LiveCaptureSession {
    fn stop_and_join(&self) -> Result<(), String> {
        if let Ok(mut sender) = self.stop_tx.lock() {
            if let Some(sender) = sender.take() {
                let _ = sender.try_send(());
            }
        }
        let join = self
            .join
            .lock()
            .map_err(|_| "live capture join lock poisoned".to_string())?
            .take();
        let worker_error = join.and_then(|join| {
            join.join()
                .err()
                .map(|_| "live capture worker panicked during shutdown".to_string())
        });
        let restore_error = self.source_window.as_ref().and_then(|source| {
            source
                .lock()
                .map_err(|_| "live source window lock poisoned".to_string())
                .and_then(|mut source| source.restore())
                .err()
        });
        if let Ok(mut frames) = self.frames.lock() {
            frames.clear();
        }
        if let Ok(mut state) = self.state.lock() {
            state.mark_closed();
        }
        match (worker_error, restore_error) {
            (None, None) => Ok(()),
            (Some(error), None) | (None, Some(error)) => Err(error),
            (Some(worker), Some(restore)) => Err(format!("{worker}; {restore}")),
        }
    }
}

#[derive(Clone, Default)]
struct SharedLiveCaptureSessions(Arc<Mutex<HashMap<String, Arc<LiveCaptureSession>>>>);

impl SharedLiveCaptureSessions {
    fn new() -> Self {
        Self::default()
    }

    fn get(&self, session_id: &str) -> Result<Arc<LiveCaptureSession>, String> {
        self.0
            .lock()
            .map_err(|_| "live capture session map poisoned".to_string())?
            .get(session_id)
            .cloned()
            .ok_or_else(|| "live capture session not found".to_string())
    }

    fn insert(&self, session_id: String, session: Arc<LiveCaptureSession>) -> Result<(), String> {
        let mut sessions = self
            .0
            .lock()
            .map_err(|_| "live capture session map poisoned".to_string())?;
        if sessions.len() >= LIVE_CAPTURE_MAX_SESSIONS {
            return Err("live capture session limit reached".to_string());
        }
        if sessions.contains_key(&session_id) {
            return Err("live capture session id collision".to_string());
        }
        sessions.insert(session_id, session);
        Ok(())
    }

    fn remove(&self, session_id: &str) -> Result<Arc<LiveCaptureSession>, String> {
        self.0
            .lock()
            .map_err(|_| "live capture session map poisoned".to_string())?
            .remove(session_id)
            .ok_or_else(|| "live capture session not found".to_string())
    }

    fn shutdown_all(&self) {
        let sessions = self
            .0
            .lock()
            .map(|mut sessions| sessions.drain().map(|(_, value)| value).collect::<Vec<_>>())
            .unwrap_or_default();
        for session in sessions {
            let _ = session.stop_and_join();
        }
    }
}

fn next_live_capture_session_id() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let sequence = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!(
        "live-{}-{}-{sequence}",
        std::process::id(),
        live_capture_now_ms()
    )
}

fn live_capture_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod live_capture_sessions_tests {
    include!("tests/live_capture_sessions_tests.rs");
}

#[cfg(test)]
mod live_capture_type_tests {
    use super::*;

    fn frame(id: u64) -> LiveCaptureFrame {
        LiveCaptureFrame {
            descriptor: LiveCaptureFrameDescriptor {
                session_id: "live-test".to_string(),
                epoch: 1,
                frame_id: id,
                capture_timestamp_ms: id,
                encode_timestamp_ms: id,
                width: 1,
                height: 1,
                mime: "image/jpeg".to_string(),
                byte_length: 1,
                dropped_frames: 0,
            },
            bytes: vec![id as u8],
        }
    }

    #[test]
    fn live_frame_buffer_drops_oldest_and_keeps_three_latest_frames() {
        let dropped = std::sync::atomic::AtomicU64::new(0);
        let mut buffer = LiveCaptureFrameBuffer::new();
        for id in 1..=4 {
            buffer.push(frame(id), &dropped);
        }
        assert_eq!(dropped.load(std::sync::atomic::Ordering::Relaxed), 1);
        assert!(buffer.take_bytes_for(1).is_none());
        assert_eq!(buffer.take_bytes_for(4), Some(vec![4]));
        assert!(buffer.latest_after(0).is_none());
    }

    #[test]
    fn frame_updates_do_not_replace_logical_status_size_with_physical_pixels() {
        let config = LiveCaptureWorkerConfig {
            session_id: "live-dpi-test".to_string(),
            window_id: None,
            expected_process_id: None,
            source_title: None,
            x: 0,
            y: 0,
            width: 800,
            height: 600,
            window_region: None,
            target_fps: 12,
            display_metrics: CaptureWindowMetrics {
                physical_origin_x: 0.0,
                physical_origin_y: 0.0,
                scale_factor: 1.5,
                logical_width: 800.0,
                logical_height: 600.0,
            },
            source_window: None,
        };
        let mut state = LiveCaptureSessionState::starting(&config);
        let mut physical_frame = frame(1).descriptor;
        physical_frame.width = 1_200;
        physical_frame.height = 900;

        state.mark_frame(&physical_frame);

        assert_eq!((state.width, state.height), (800, 600));
        state.mark_capture(1, 100);
        assert_eq!(state.last_frame_at_ms, Some(100));
        assert_eq!(state.frame_id, 1, "GPU arrival must not invent an encoded frame ID");
        state.mark_frame(&physical_frame);
        assert_eq!(state.last_frame_at_ms, Some(100), "late JPEG cannot rewind capture health");
    }
}
