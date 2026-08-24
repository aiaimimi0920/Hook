// Abstracts native and standard-channel mouse event receivers for runtime and tests.

#[cfg(target_os = "windows")]
trait CaptureMouseEventReceiver {
    fn recv(&self) -> Result<CaptureMouseHookEvent, mpsc::RecvError>;
    fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> Result<CaptureMouseHookEvent, mpsc::RecvTimeoutError>;
    fn try_recv(&self) -> Result<CaptureMouseHookEvent, mpsc::TryRecvError>;
}

#[cfg(target_os = "windows")]
impl CaptureMouseEventReceiver for mpsc::Receiver<CaptureMouseHookEvent> {
    fn recv(&self) -> Result<CaptureMouseHookEvent, mpsc::RecvError> {
        mpsc::Receiver::recv(self)
    }

    fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> Result<CaptureMouseHookEvent, mpsc::RecvTimeoutError> {
        mpsc::Receiver::recv_timeout(self, timeout)
    }

    fn try_recv(&self) -> Result<CaptureMouseHookEvent, mpsc::TryRecvError> {
        mpsc::Receiver::try_recv(self)
    }
}

#[cfg(target_os = "windows")]
impl CaptureMouseEventReceiver for CaptureMouseEventQueue {
    fn recv(&self) -> Result<CaptureMouseHookEvent, mpsc::RecvError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        loop {
            if let Some(event) = Self::pop_front_locked(&mut state) {
                return Ok(event);
            }
            state = self
                .event_available
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    fn recv_timeout(
        &self,
        timeout: Duration,
    ) -> Result<CaptureMouseHookEvent, mpsc::RecvTimeoutError> {
        let deadline = Instant::now() + timeout;
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        loop {
            if let Some(event) = Self::pop_front_locked(&mut state) {
                return Ok(event);
            }

            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(mpsc::RecvTimeoutError::Timeout);
            }
            let (next_state, wait_result) = self
                .event_available
                .wait_timeout(state, remaining)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state = next_state;
            if wait_result.timed_out() && state.events.is_empty() {
                return Err(mpsc::RecvTimeoutError::Timeout);
            }
        }
    }

    fn try_recv(&self) -> Result<CaptureMouseHookEvent, mpsc::TryRecvError> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Self::pop_front_locked(&mut state).ok_or(mpsc::TryRecvError::Empty)
    }
}
