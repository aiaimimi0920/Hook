// Socket-owned decoder: reference pictures never enter the latest-image cache.
#[derive(Default)]
struct LiveRelayVideoViewer {
    decoder: Option<crate::live_video::Decoder>,
    chain: Option<(u64, u64, u32, u32)>,
    pending: VecDeque<LiveRelayFrameDescriptor>,
    fallback: bool,
    requested: bool,
}

impl LiveRelayVideoViewer {
    fn reset(&mut self) {
        self.decoder = None;
        self.chain = None;
        self.pending.clear();
    }

    fn receive(
        &mut self,
        relay: &LiveRelaySession,
        socket: &mut tungstenite::WebSocket<
            tungstenite::stream::MaybeTlsStream<std::net::TcpStream>,
        >,
        bytes: &[u8],
    ) -> Result<(), String> {
        let frame = decode_live_relay_binary_frame(&relay.relay_id, &relay.live_session_id, bytes)?;
        if frame.descriptor.codec != "h264" {
            self.reset();
            self.requested = false;
            return accept_live_relay_viewer_frame(relay, bytes);
        }
        let epoch = frame.descriptor.epoch;
        // Do not spend native codec work on revoked sessions or a previous authorization epoch.
        {
            let state = relay
                .state
                .lock()
                .map_err(|_| "live relay state poisoned")?;
            if relay.stop.load(Ordering::SeqCst) || state.connection_state == "closed" {
                return Err("live relay viewer is closed".to_owned());
            }
            if epoch < state.epoch {
                return Err("Loom delivered a stale live video epoch".to_owned());
            }
        }
        if self.fallback {
            return Ok(()); // In-flight video may arrive after sticky fallback.
        }
        let keyframe = bytes[5] & 1 != 0;
        if !self.continuous(&frame.descriptor) {
            self.reset();
            if !keyframe {
                if !self.requested {
                    Self::control(socket, "keyframe_request", epoch)?;
                    self.requested = true;
                }
                return Ok(());
            }
        }
        if keyframe {
            self.requested = false;
        }
        match self.decode(frame, keyframe, &relay.stop) {
            Ok(Some(frame)) => commit_live_relay_viewer_frame(relay, frame, true),
            Ok(None) => Ok(()),
            Err(_) => {
                self.reset();
                self.fallback = true;
                // Native failure/permit exhaustion never causes a reconnect/probe loop.
                if !relay.stop.load(Ordering::SeqCst) {
                    Self::control(socket, "video_fallback", epoch)?;
                }
                Ok(())
            }
        }
    }

    fn continuous(&self, frame: &LiveRelayFrameDescriptor) -> bool {
        self.chain.is_some_and(|(epoch, id, width, height)| {
            epoch == frame.epoch
                && id.checked_add(1) == Some(frame.frame_id)
                && width == frame.width
                && height == frame.height
        })
    }

    fn decode(
        &mut self,
        frame: LiveRelayFrame,
        keyframe: bool,
        stop: &AtomicBool,
    ) -> Result<Option<LiveRelayFrame>, String> {
        let descriptor = frame.descriptor;
        if self.decoder.is_none() {
            let format = crate::live_video::Format::new(descriptor.width, descriptor.height, 30)
                .map_err(|error| error.to_string())?;
            self.decoder =
                Some(crate::live_video::Decoder::new(format).map_err(|error| error.to_string())?);
        }
        let timestamp =
            i64::try_from(descriptor.frame_id).map_err(|_| "video timeline overflow")?;
        if self.pending.len() >= 4 {
            return Err("video descriptor budget exceeded".to_owned());
        }
        self.chain = Some((
            descriptor.epoch,
            descriptor.frame_id,
            descriptor.width,
            descriptor.height,
        ));
        self.pending.push_back(descriptor);
        let output = self
            .decoder
            .as_mut()
            .expect("decoder initialized")
            .decode(&frame.payload, timestamp, keyframe, stop)
            .map_err(|error| error.to_string())?;
        let Some(output) = output else {
            return Ok(None);
        };
        let mut descriptor = self
            .pending
            .pop_front()
            .ok_or("video output without descriptor")?;
        if i64::try_from(descriptor.frame_id).ok() != Some(output.timestamp) {
            return Err("video output descriptor mismatch".to_owned());
        }
        // This describes the IPC representation, not the compressed network byte count.
        descriptor.codec = "raw_bgra".to_owned();
        descriptor.byte_length = output.bgra.len();
        Ok(Some(LiveRelayFrame {
            descriptor,
            payload: output.bgra,
        }))
    }

    fn control(
        socket: &mut tungstenite::WebSocket<
            tungstenite::stream::MaybeTlsStream<std::net::TcpStream>,
        >,
        kind: &str,
        epoch: u64,
    ) -> Result<(), String> {
        let text = serde_json::json!({"type": kind, "epoch": epoch}).to_string();
        socket
            .send(tungstenite::Message::Text(text))
            .map_err(|_| "send live video recovery control failed".to_owned())
    }
}
