// Connection-owned media demands; one wire sequence spans both video and image modes.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct LiveRelayVideoPolicy {
    #[serde(rename = "type")]
    kind: String,
    epoch: u64,
    h264_allowed: bool,
    keyframe_sequence: u64,
}

struct LiveRelayVideoSource {
    capture_id: String,
    epoch: u64,
    allowed: bool,
    sequence: u64,
    force_keyframe: bool,
    failed: bool,
    encoder: Option<crate::live_video::Encoder>,
    generation: Option<u64>,
    subscription: Option<crate::live_video::capture::Subscription>,
    encoded: Option<crate::live_gpu::work_budget::EncodedFrameConsumer>,
    capture_cursor: u64,
    last_capture_ms: u64,
    cached: Option<crate::live_video::capture::Captured>,
}

impl LiveRelayVideoSource {
    fn new(capture_id: String, epoch: u64) -> Self {
        Self {
            capture_id,
            epoch,
            allowed: false,
            sequence: 0,
            force_keyframe: true,
            failed: false,
            encoder: None,
            generation: None,
            subscription: None,
            encoded: None,
            capture_cursor: 0,
            last_capture_ms: 0,
            cached: None,
        }
    }

    fn policy(&mut self, text: &str) -> Result<(), &'static str> {
        if text.len() > 256 {
            return Err("video policy exceeds control budget");
        }
        let policy: LiveRelayVideoPolicy =
            serde_json::from_str(text).map_err(|_| "invalid video policy")?;
        if policy.kind != "video_policy"
            || policy.epoch != self.epoch
            || policy.epoch == 0
            || policy.keyframe_sequence < self.sequence
        {
            return Err("stale or invalid video policy");
        }
        self.force_keyframe |=
            (!self.allowed && policy.h264_allowed) || self.sequence != policy.keyframe_sequence;
        self.allowed = policy.h264_allowed;
        self.sequence = policy.keyframe_sequence;
        if !self.allowed {
            self.retire_video();
        }
        Ok(())
    }

    fn retire_video(&mut self) {
        self.encoder = None;
        self.subscription = None;
        self.generation = None;
        self.cached = None;
        self.force_keyframe = true;
    }

    fn next(
        &mut self,
        capture: &LiveCaptureSession,
        profile: LiveRelayMediaProfile,
        frame_id: u64,
        stop: &AtomicBool,
        timing: &mut LiveRelaySourceIteration<'_>,
    ) -> Result<Option<Vec<u8>>, String> {
        if profile == LiveRelayMediaProfile::H264 && self.allowed && !self.failed {
            match self.video(frame_id, stop, timing) {
                Ok(None) if self.encoder.is_none() => {}
                Ok(frame) => return Ok(frame),
                Err(_) => {
                    self.retire_video();
                    self.failed = true; // Probe once per connection, never once per frame.
                }
            }
        }
        if self.encoded.is_none() {
            self.encoded = Some(crate::live_gpu::work_budget::EncodedFrameConsumer::acquire(
                &self.capture_id,
            )?);
        }
        let frame = timing.latest(|| {
            capture
                .frames
                .lock()
                .ok()
                .and_then(|frames| frames.clone_latest_after(self.capture_cursor))
        });
        let Some(frame) = frame else { return Ok(None) };
        self.capture_cursor = frame.descriptor.frame_id;
        if frame.descriptor.capture_timestamp_ms < self.last_capture_ms {
            return Ok(None);
        }
        self.last_capture_ms = frame.descriptor.capture_timestamp_ms;
        let mut bytes = timing.result(LiveRelayTimingStage::Adaptation, || {
            encode_live_relay_capture_frame(&frame, profile, self.epoch)
        })?;
        // Capture IDs count JPEG work, not AU work; neither mode owns the wire counter.
        bytes[16..24].copy_from_slice(&frame_id.to_be_bytes());
        Ok(Some(bytes))
    }

    fn video(
        &mut self,
        frame_id: u64,
        stop: &AtomicBool,
        timing: &mut LiveRelaySourceIteration<'_>,
    ) -> Result<Option<Vec<u8>>, String> {
        if self.subscription.is_none() {
            self.subscription = Some(crate::live_video::capture::Subscription::acquire(
                &self.capture_id,
            )?);
        }
        let (generation, frame) = timing.result(LiveRelayTimingStage::LatestFrame, || {
            self.subscription
                .as_ref()
                .expect("subscribed")
                .take_current()
        })?;
        if self
            .cached
            .as_ref()
            .is_some_and(|frame| frame.generation != generation)
        {
            self.cached = None;
            self.encoder = None;
        }
        // Keep one independent texture to answer late-join IDR requests on a static window.
        let frame = frame.or_else(|| self.force_keyframe.then(|| self.cached.take()).flatten());
        let Some(frame) = frame else {
            return Ok(None);
        };
        self.encoded = None;
        let format = crate::live_video::Format::new(frame.width, frame.height, 30)
            .map_err(|error| error.to_string())?;
        if self.generation != Some(frame.generation)
            || self
                .encoder
                .as_ref()
                .is_none_or(|encoder| encoder.format() != format)
        {
            self.encoder = None;
            self.encoder = Some(
                crate::live_video::Encoder::new(frame.device.clone(), format)
                    .map_err(|error| error.to_string())?,
            );
            self.generation = Some(frame.generation);
            self.force_keyframe = true;
        }
        let packet = timing.result(LiveRelayTimingStage::Adaptation, || {
            self.encoder
                .as_mut()
                .expect("encoder initialized")
                .encode(&frame.texture, self.force_keyframe, stop)
                .map_err(|error| error.to_string())
        })?;
        if self
            .subscription
            .as_ref()
            .expect("subscribed")
            .generation()?
            != frame.generation
        {
            self.encoder = None;
            self.cached = None;
            self.force_keyframe = true;
            return Ok(None);
        }
        self.force_keyframe = false;
        let bytes = encode_live_relay_binary_frame(
            &LiveRelayBinaryMetadata {
                epoch: self.epoch,
                frame_id,
                capture_timestamp_ms: frame.captured_at_ms,
                encode_timestamp_ms: live_capture_now_ms(),
                width: frame.width,
                height: frame.height,
                dropped_frames: 0,
                keyframe: packet.keyframe,
                color_space: "srgb",
                codec: "h264",
            },
            &packet.bytes,
        )?;
        self.last_capture_ms = self.last_capture_ms.max(frame.captured_at_ms);
        self.cached = Some(frame);
        Ok(Some(bytes))
    }
}
