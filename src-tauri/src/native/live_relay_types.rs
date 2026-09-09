// Owns bounded Hook-side state for loom.live.v1 publishers and viewers.
const LIVE_RELAY_PROTOCOL_VERSION: &str = "loom.live.v1";
const LIVE_RELAY_MAX_SESSIONS: usize = 8;
const LIVE_RELAY_FRAME_BUFFER: usize = 3;
const LIVE_RELAY_MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayPublishRequest {
    capture_session_id: String,
    surface_instance_id: String,
    source_attachment_id: String,
    source_hook_id: String,
    #[serde(default)]
    live_session_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayJoinRequest {
    live_session_id: String,
    surface_instance_id: String,
    attachment_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LiveRelayControlAction {
    Acquire,
    Release,
    Revoke,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayControlRequest {
    relay_id: String,
    action: LiveRelayControlAction,
    #[serde(default)]
    lease_duration_ms: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayInputRequest {
    relay_id: String,
    input: LiveCaptureInputRequest,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum LiveRelayRole {
    Source,
    Viewer,
}

impl LiveRelayRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::Viewer => "viewer",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveRelayFrameDescriptor {
    relay_id: String,
    live_session_id: String,
    epoch: u64,
    frame_id: u64,
    capture_timestamp_ms: u64,
    encode_timestamp_ms: u64,
    received_timestamp_ms: u64,
    width: u32,
    height: u32,
    codec: String,
    color_space: String,
    byte_length: usize,
    dropped_frames: u32,
}

#[derive(Clone, Debug)]
struct LiveRelayFrame {
    descriptor: LiveRelayFrameDescriptor,
    payload: Vec<u8>,
}

#[derive(Debug)]
struct LiveRelayFrameBuffer {
    frames: VecDeque<LiveRelayFrame>,
    overwritten_frames: u64,
}

impl LiveRelayFrameBuffer {
    fn new() -> Self {
        Self {
            frames: VecDeque::with_capacity(LIVE_RELAY_FRAME_BUFFER),
            overwritten_frames: 0,
        }
    }

    fn push(&mut self, frame: LiveRelayFrame) {
        if self.frames.len() == LIVE_RELAY_FRAME_BUFFER {
            self.frames.pop_front();
            self.overwritten_frames = self.overwritten_frames.saturating_add(1);
        }
        self.frames.push_back(frame);
    }

    fn latest_after(&self, frame_id: u64) -> Option<LiveRelayFrameDescriptor> {
        self.frames
            .back()
            .filter(|frame| frame.descriptor.frame_id > frame_id)
            .map(|frame| frame.descriptor.clone())
    }

    fn take_payload_for(&mut self, frame_id: u64) -> Option<Vec<u8>> {
        let index = self
            .frames
            .iter()
            .position(|frame| frame.descriptor.frame_id == frame_id)?;
        self.frames
            .drain(..=index)
            .last()
            .map(|frame| frame.payload)
    }

    fn clear(&mut self) {
        self.frames.clear();
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveRelaySnapshot {
    relay_id: String,
    live_session_id: String,
    role: String,
    capture_session_id: Option<String>,
    connection_state: String,
    epoch: u64,
    last_frame_id: u64,
    received_frames: u64,
    reconnect_count: u64,
    overwritten_frames: u64,
    controller_owned: bool,
    remote_control_active: bool,
    last_input_sequence: u64,
    last_connected_at_ms: Option<u64>,
    last_frame_at_ms: Option<u64>,
    media_transport: String,
    network_scope: String,
    round_trip_latency_ms: Option<u64>,
    latency_state: String,
    observation_capabilities: Vec<String>,
    observation_state: String,
    observation_reason: Option<String>,
    observations: Vec<LiveRelayObservation>,
    triggers: Vec<LiveRelayTriggerRegistration>,
    trigger_audits: Vec<LiveRelayTriggerAudit>,
    error_code: Option<String>,
    error_message: Option<String>,
}

#[derive(Clone, Debug)]
struct LiveRelayRuntimeState {
    connection_state: String,
    epoch: u64,
    last_frame_id: u64,
    received_frames: u64,
    reconnect_count: u64,
    controller_owned: bool,
    remote_control_active: bool,
    controller_device_id: Option<String>,
    last_connected_at_ms: Option<u64>,
    last_frame_at_ms: Option<u64>,
    round_trip_latency_ms: Option<u64>,
    observation_capabilities: Vec<String>,
    observation_state: String,
    observation_reason: Option<String>,
    observations: std::collections::BTreeMap<String, LiveRelayObservation>,
    trigger_registrations: Vec<LiveRelayTriggerRegistration>,
    trigger_audits: std::collections::VecDeque<LiveRelayTriggerAudit>,
    error_code: Option<String>,
    error_message: Option<String>,
}

impl LiveRelayRuntimeState {
    fn starting(
        epoch: u64,
        observation_capabilities: Vec<String>,
        observation_reason: Option<String>,
    ) -> Self {
        let observation_state = if observation_capabilities.is_empty() {
            "unsupported"
        } else {
            "observing"
        };
        Self {
            connection_state: "connecting".to_owned(),
            epoch,
            last_frame_id: 0,
            received_frames: 0,
            reconnect_count: 0,
            controller_owned: false,
            remote_control_active: false,
            controller_device_id: None,
            last_connected_at_ms: None,
            last_frame_at_ms: None,
            round_trip_latency_ms: None,
            observation_capabilities,
            observation_state: observation_state.to_owned(),
            observation_reason,
            observations: std::collections::BTreeMap::new(),
            trigger_registrations: Vec::new(),
            trigger_audits: std::collections::VecDeque::with_capacity(
                LIVE_RELAY_TRIGGER_AUDIT_LIMIT,
            ),
            error_code: None,
            error_message: None,
        }
    }

    fn mark_connected(&mut self) {
        if self.last_connected_at_ms.is_some() {
            self.reconnect_count = self.reconnect_count.saturating_add(1);
        }
        self.connection_state = "connected".to_owned();
        self.last_connected_at_ms = Some(live_capture_now_ms());
        self.error_code = None;
        self.error_message = None;
    }

    fn mark_recovering(&mut self, code: &str, message: impl Into<String>) {
        self.connection_state = "recovering".to_owned();
        self.round_trip_latency_ms = None;
        self.error_code = Some(code.to_owned());
        self.error_message = Some(sanitize_live_relay_error(message.into()));
    }

    fn mark_frame(&mut self, epoch: u64, frame_id: u64) {
        self.epoch = epoch;
        self.last_frame_id = frame_id;
        self.received_frames = self.received_frames.saturating_add(1);
        self.last_frame_at_ms = Some(live_capture_now_ms());
    }

    fn mark_round_trip(&mut self, elapsed: Duration) {
        self.round_trip_latency_ms = Some(elapsed.as_millis().min(u64::MAX as u128) as u64);
    }

    fn mark_closed(&mut self) {
        self.connection_state = "closed".to_owned();
        self.controller_owned = false;
        self.remote_control_active = false;
        self.controller_device_id = None;
        self.round_trip_latency_ms = None;
        self.observation_state = "closed".to_owned();
    }
}

struct LiveRelaySession {
    relay_id: String,
    live_session_id: String,
    role: LiveRelayRole,
    base_url: String,
    surface_instance_id: String,
    attachment_id: String,
    authorization: crate::device_session::DeviceSessionAuthorization,
    capture: Option<Arc<LiveCaptureSession>>,
    state: Arc<Mutex<LiveRelayRuntimeState>>,
    frames: Arc<Mutex<LiveRelayFrameBuffer>>,
    stop: Arc<AtomicBool>,
    reconnect: Arc<AtomicBool>,
    join: Mutex<Option<std::thread::JoinHandle<()>>>,
    control_join: Mutex<Option<std::thread::JoinHandle<()>>>,
    observation_join: Mutex<Option<std::thread::JoinHandle<()>>>,
    control_sequence: Mutex<u64>,
    input_sequence: Mutex<u64>,
}

impl LiveRelaySession {
    fn snapshot(&self) -> Result<LiveRelaySnapshot, String> {
        let state = self
            .state
            .lock()
            .map_err(|_| "live relay state poisoned".to_owned())?
            .clone();
        let overwritten_frames = self
            .frames
            .lock()
            .map_err(|_| "live relay frame buffer poisoned".to_owned())?
            .overwritten_frames;
        let last_input_sequence = *self
            .input_sequence
            .lock()
            .map_err(|_| "live relay input sequence poisoned".to_owned())?;
        let network_scope = match crate::loom_connector::classify_loom_base_url(&self.base_url) {
            Ok(crate::loom_connector::LoomBaseUrlKind::LoopbackHttp) => "loopback_http",
            Ok(crate::loom_connector::LoomBaseUrlKind::LoopbackHttps) => "loopback_https",
            Ok(crate::loom_connector::LoomBaseUrlKind::RemoteHttps) => "private_https",
            Err(_) => "unavailable",
        };
        let latency_state = match (self.role, state.round_trip_latency_ms) {
            (LiveRelayRole::Source, _) => "unavailable",
            (LiveRelayRole::Viewer, None) => "measuring",
            (LiveRelayRole::Viewer, Some(0..=120)) => "low",
            (LiveRelayRole::Viewer, Some(121..=300)) => "elevated",
            (LiveRelayRole::Viewer, Some(_)) => "high",
        };
        Ok(LiveRelaySnapshot {
            relay_id: self.relay_id.clone(),
            live_session_id: self.live_session_id.clone(),
            role: self.role.as_str().to_owned(),
            capture_session_id: self.capture.as_ref().and_then(|capture| {
                capture
                    .state
                    .lock()
                    .ok()
                    .map(|state| state.session_id.clone())
            }),
            connection_state: state.connection_state,
            epoch: state.epoch,
            last_frame_id: state.last_frame_id,
            received_frames: state.received_frames,
            reconnect_count: state.reconnect_count,
            overwritten_frames,
            controller_owned: state.controller_owned,
            remote_control_active: state.remote_control_active,
            last_input_sequence,
            last_connected_at_ms: state.last_connected_at_ms,
            last_frame_at_ms: state.last_frame_at_ms,
            media_transport: "websocket_binary".to_owned(),
            network_scope: network_scope.to_owned(),
            round_trip_latency_ms: state.round_trip_latency_ms,
            latency_state: latency_state.to_owned(),
            observation_capabilities: state.observation_capabilities,
            observation_state: state.observation_state,
            observation_reason: state.observation_reason,
            observations: state.observations.into_values().collect(),
            triggers: state.trigger_registrations,
            trigger_audits: state.trigger_audits.into_iter().collect(),
            error_code: state.error_code,
            error_message: state.error_message,
        })
    }

    fn stop_and_join(&self) -> Result<(), String> {
        self.stop.store(true, Ordering::SeqCst);
        let mut errors = Vec::new();
        let observation_join = match self.observation_join.lock() {
            Ok(mut guard) => guard.take(),
            Err(_) => {
                errors.push("live observation worker lock poisoned".to_owned());
                None
            }
        };
        if observation_join.is_some_and(|join| join.join().is_err()) {
            errors.push("live observation worker panicked during shutdown".to_owned());
        }
        let control_join = match self.control_join.lock() {
            Ok(mut guard) => guard.take(),
            Err(_) => {
                errors.push("live relay control worker lock poisoned".to_owned());
                None
            }
        };
        if control_join.is_some_and(|join| join.join().is_err()) {
            errors.push("live relay control worker panicked during shutdown".to_owned());
        }
        let join = match self.join.lock() {
            Ok(mut guard) => guard.take(),
            Err(_) => {
                errors.push("live relay worker lock poisoned".to_owned());
                None
            }
        };
        if join.is_some_and(|join| join.join().is_err()) {
            errors.push("live relay worker panicked during shutdown".to_owned());
        }
        if let Ok(mut frames) = self.frames.lock() {
            frames.clear();
        }
        if let Ok(mut state) = self.state.lock() {
            state.mark_closed();
        }
        if self.role == LiveRelayRole::Source {
            if let Err(error) = set_live_relay_source_interaction(self, false) {
                errors.push(error);
            }
        }
        errors.into_iter().next().map_or(Ok(()), Err)
    }
}

#[derive(Clone, Default)]
struct SharedLiveRelaySessions(Arc<Mutex<HashMap<String, Arc<LiveRelaySession>>>>);

impl SharedLiveRelaySessions {
    fn new() -> Self {
        Self::default()
    }

    fn get(&self, relay_id: &str) -> Result<Arc<LiveRelaySession>, String> {
        self.0
            .lock()
            .map_err(|_| "live relay session map poisoned".to_owned())?
            .get(relay_id)
            .cloned()
            .ok_or_else(|| "live relay session not found".to_owned())
    }

    fn insert(&self, session: Arc<LiveRelaySession>) -> Result<(), String> {
        let mut sessions = self
            .0
            .lock()
            .map_err(|_| "live relay session map poisoned".to_owned())?;
        if sessions.len() >= LIVE_RELAY_MAX_SESSIONS {
            return Err("live relay session limit reached".to_owned());
        }
        if sessions.contains_key(&session.relay_id) {
            return Err("live relay session id collision".to_owned());
        }
        sessions.insert(session.relay_id.clone(), session);
        Ok(())
    }

    fn remove(&self, relay_id: &str) -> Result<Arc<LiveRelaySession>, String> {
        self.0
            .lock()
            .map_err(|_| "live relay session map poisoned".to_owned())?
            .remove(relay_id)
            .ok_or_else(|| "live relay session not found".to_owned())
    }

    fn shutdown_all(&self) {
        let sessions = self
            .0
            .lock()
            .map(|mut sessions| sessions.drain().map(|(_, value)| value).collect::<Vec<_>>())
            .unwrap_or_default();
        for session in sessions {
            let _ = session.stop_and_join();
            let _ = close_live_session_blocking(&session);
        }
    }
}

fn next_live_relay_id(role: LiveRelayRole) -> String {
    format!("live-relay-{}-{}", role.as_str(), uuid::Uuid::new_v4())
}

fn validate_live_relay_identifier(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 160
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
        })
    {
        return Err(format!("{label} is not a valid loom.live.v1 identifier"));
    }
    Ok(())
}

fn sanitize_live_relay_error(message: String) -> String {
    let mut value: String = message.chars().take(512).collect();
    if message.chars().nth(512).is_some() {
        value.push('…');
    }
    value
}
