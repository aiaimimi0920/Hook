//! Bounded latest-frame selection for interactive previews, not frame-by-frame recording.
use windows::Graphics::Capture::{Direct3D11CaptureFrame, Direct3D11CaptureFramePool};
use windows::Win32::Foundation::S_OK;

pub(crate) const MAX_QUEUED_CAPTURE_FRAMES: i32 = 4;

pub(crate) fn pool_size(latest_only: bool, fps: Option<u32>) -> i32 {
    // Interactive capture discards backlog: allocating four full-window buffers
    // per crop increases residency without making a newer frame available.
    if latest_only {
        return 2;
    }
    fps.map(|fps| ((fps as f32 / 30.0 * 2.0).ceil() as i32).clamp(2, MAX_QUEUED_CAPTURE_FRAMES))
        .unwrap_or(2)
}

struct PendingFrame(Option<Direct3D11CaptureFrame>);
impl Drop for PendingFrame {
    fn drop(&mut self) {
        if let Some(frame) = self.0.take() {
            let _ = frame.Close();
        }
    }
}

pub(crate) fn next_frame(
    pool: &Direct3D11CaptureFramePool,
    latest_only: bool,
) -> windows::core::Result<Option<Direct3D11CaptureFrame>> {
    select_frame(latest_only, || pending_frame(pool.TryGetNextFrame()))
        .map(|frame| frame.and_then(|mut frame| frame.0.take()))
}

fn pending_frame(
    result: windows::core::Result<Direct3D11CaptureFrame>,
) -> windows::core::Result<Option<PendingFrame>> {
    match result {
        Ok(frame) => Ok(Some(PendingFrame(Some(frame)))),
        // windows-core 0.60 maps a successful null interface to Error::empty (S_OK).
        Err(error) if error.code() == S_OK => Ok(None),
        Err(error) => Err(error),
    }
}

fn select_frame<T, E>(
    latest_only: bool,
    mut next: impl FnMut() -> Result<Option<T>, E>,
) -> Result<Option<T>, E> {
    let mut selected = next()?;
    if latest_only && selected.is_some() {
        // A producer may refill the pool while we drain it. Never wait for it to empty.
        for _ in 1..MAX_QUEUED_CAPTURE_FRAMES {
            let Some(frame) = next()? else {
                break;
            };
            selected = Some(frame);
        }
    }
    Ok(selected)
}

#[cfg(test)]
mod tests {
    use super::select_frame;

    #[test]
    fn interactive_pool_is_two_buffers_without_changing_recording_defaults() {
        for fps in [None, Some(30), Some(60), Some(120)] {
            assert_eq!(super::pool_size(true, fps), 2);
        }
        assert_eq!(super::pool_size(false, Some(60)), 4);
        assert_eq!(super::pool_size(false, None), 2);
    }

    #[test]
    fn null_interface_is_empty_but_real_hresult_failures_propagate() {
        let null = unsafe { windows::core::Type::from_abi(std::ptr::null_mut()) };
        assert!(matches!(super::pending_frame(null), Ok(None)));
        let error = windows::core::Error::from_hresult(windows::Win32::Foundation::E_POINTER);
        assert!(super::pending_frame(Err(error)).is_err());
    }

    #[test]
    fn default_preserves_oldest_while_preview_drops_backlog() {
        for (latest, expected, remaining) in [(false, 1, 3), (true, 4, 0)] {
            let mut frames = [1, 2, 3, 4].into_iter();
            assert_eq!(
                select_frame(latest, || Ok::<_, ()>(frames.next())),
                Ok(Some(expected))
            );
            assert_eq!(frames.count(), remaining);
        }
    }

    #[test]
    fn continuous_producer_is_bounded_and_empty_notifications_are_allowed() {
        let mut calls = 0;
        assert_eq!(
            select_frame(true, || {
                calls += 1;
                Ok::<_, ()>(Some(calls))
            }),
            Ok(Some(4))
        );
        assert_eq!(calls, 4);
        assert_eq!(select_frame(true, || Ok::<Option<u8>, ()>(None)), Ok(None));
    }

    #[test]
    fn discarded_frames_and_error_paths_release_ownership() {
        use std::{cell::Cell, rc::Rc};
        struct Frame(Rc<Cell<usize>>);
        impl Drop for Frame {
            fn drop(&mut self) {
                self.0.set(self.0.get() + 1);
            }
        }
        let released = Rc::new(Cell::new(0));
        let mut calls = 0;
        let result = select_frame(true, || {
            calls += 1;
            if calls == 3 {
                Err("capture failed")
            } else {
                Ok(Some(Frame(released.clone())))
            }
        });
        assert!(matches!(result, Err("capture failed")));
        assert_eq!(released.get(), 2);
    }
}
