//! Experimental native presentation boundary. Unit state and source input stay in Hook.

use serde::{Deserialize, Serialize};

#[cfg(all(test, target_os = "windows"))]
pub(crate) mod browser_video_oracle;
#[cfg(all(test, target_os = "windows"))]
mod browser_video_tests;
#[cfg(target_os = "windows")]
mod frame;
#[cfg(all(test, target_os = "windows"))]
mod multi_live_tests;
#[cfg(all(test, target_os = "windows"))]
mod native_tests;
#[cfg(target_os = "windows")]
mod presenter;
#[cfg(target_os = "windows")]
mod snapshot;
pub(crate) mod work_budget;
#[cfg(target_os = "windows")]
mod worker;

#[cfg(target_os = "windows")]
pub(crate) use frame::GpuFrame;
#[cfg(target_os = "windows")]
pub(crate) use snapshot::Readback;

#[cfg(target_os = "windows")]
#[derive(Debug, PartialEq)]
pub(crate) enum SubmitOutcome {
    Queued,
    Busy,
    Fallback,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Layout {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    inset: f32,
}

impl Layout {
    fn validate(self) -> Result<Self, String> {
        if [self.x, self.y, self.width, self.height, self.inset]
            .iter()
            .any(|value| !value.is_finite())
            || self.x.abs() > 32_768.0
            || self.y.abs() > 32_768.0
            || !(1.0..=16_384.0).contains(&self.width)
            || !(1.0..=16_384.0).contains(&self.height)
            || self.inset < 0.0
            || self.inset * 2.0 >= self.width.min(self.height)
        {
            return Err("invalid GPU preview physical bounds".to_string());
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewStatus {
    available: bool,
    presenting: bool,
    submitted_frames: u64,
    replaced_frames: u64,
    cpu_readbacks_skipped: u64,
    error: Option<String>,
}

pub(crate) fn enabled() -> bool {
    cfg!(target_os = "windows")
        && preview_requested(std::env::var("HOOK_LIVE_GPU_PREVIEW").ok().as_deref())
}

fn preview_requested(value: Option<&str>) -> bool {
    value != Some("0")
}

#[tauri::command]
pub(crate) fn get_live_gpu_preview_capability() -> bool {
    enabled()
}

#[tauri::command]
pub(crate) async fn read_live_gpu_snapshot(
    window: tauri::WebviewWindow,
    sessions: tauri::State<'_, crate::SharedLiveCaptureSessions>,
    session_id: String,
) -> Result<tauri::ipc::Response, String> {
    crate::validate_live_capture_session_id(&session_id)?;
    let session = sessions.get(&session_id)?;
    if window.label() != "main"
        || matches!(
            session
                .state
                .lock()
                .map_err(|_| "live state poisoned")?
                .capture_state
                .as_str(),
            "closed" | "failed"
        )
    {
        return Err("GPU snapshot requires an active main-window Live Unit".to_string());
    }
    if !enabled() {
        return Ok(tauri::ipc::Response::new(Vec::new()));
    }
    #[cfg(target_os = "windows")]
    {
        // Acquire before scheduling: renderer requests cannot grow a blocking work queue.
        let permit = snapshot::Permit::acquire()?;
        let id = session_id.clone();
        let bytes = tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            worker::snapshot(&id)?
                .map(snapshot::Readback::encode)
                .transpose()
                .map(Option::unwrap_or_default)
        })
        .await
        .map_err(|error| error.to_string())??;
        if !std::sync::Arc::ptr_eq(&session, &sessions.get(&session_id)?)
            || matches!(
                session
                    .state
                    .lock()
                    .map_err(|_| "live state poisoned")?
                    .capture_state
                    .as_str(),
                "closed" | "failed"
            )
        {
            return Err("Live session ended during GPU snapshot".to_string());
        }
        Ok(tauri::ipc::Response::new(bytes))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = session;
        Ok(tauri::ipc::Response::new(Vec::new()))
    }
}

#[tauri::command]
pub(crate) fn configure_live_gpu_preview(
    window: tauri::WebviewWindow,
    sessions: tauri::State<'_, crate::SharedLiveCaptureSessions>,
    session_id: String,
    layout: Option<Layout>,
    visible: bool,
) -> Result<PreviewStatus, String> {
    crate::validate_live_capture_session_id(&session_id)?;
    let session = sessions.get(&session_id)?;
    let state = session.state.lock().map_err(|_| "live state poisoned")?;
    if window.label() != "main" || matches!(state.capture_state.as_str(), "closed" | "failed") {
        return Err("GPU preview requires an active main-window Live Unit".to_string());
    }
    let layout = layout.map(Layout::validate).transpose()?;
    work_budget::set_visible(&session_id, visible);
    if !enabled() {
        return Ok(PreviewStatus::default());
    }
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        worker::configure(hwnd.0 as usize, &session_id, layout)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = layout;
        Ok(PreviewStatus::default())
    }
}

#[cfg(target_os = "windows")]
pub(crate) use worker::{fallback, invalidate, remove, shutdown, submit, submit_pending};

#[cfg(not(target_os = "windows"))]
pub(crate) fn remove(_session_id: &str) {}
#[cfg(not(target_os = "windows"))]
pub(crate) fn shutdown() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_preview_is_automatic_with_an_explicit_compatibility_opt_out() {
        assert!(preview_requested(None));
        assert!(preview_requested(Some("1")));
        assert!(!preview_requested(Some("0")));
    }

    #[test]
    fn preview_bounds_reject_invalid_and_preserve_physical_coordinates() {
        let valid = Layout {
            x: -120.5,
            y: 23.25,
            width: 150.0,
            height: 75.0,
            inset: 3.0,
        };
        assert_eq!(valid.validate().unwrap(), valid);
        for width in [0.0, -1.0, f32::NAN, f32::INFINITY, 16_385.0] {
            assert!(Layout { width, ..valid }.validate().is_err());
        }
        assert!(Layout {
            x: f32::NEG_INFINITY,
            ..valid
        }
        .validate()
        .is_err());
    }
}
