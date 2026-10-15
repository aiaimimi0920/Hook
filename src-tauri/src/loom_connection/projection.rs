//! Projection uses the selected connection's live device session, never its history.
use super::{owner, protocol, Runtime};
use crate::device_session::DeviceSessionAuthorization;

#[derive(Clone)]
pub(super) struct Session {
    origin: String,
    authorization: DeviceSessionAuthorization,
    expires_at: u64,
}

fn live(state: &Runtime, now: u64) -> Result<Option<&Session>, String> {
    if state.generation == 0 && !state.exiting {
        return Ok(None); // Preserve standalone local enrollment before explicit selection.
    }
    state
        .projection
        .as_ref()
        .filter(|session| {
            !state.exiting
                && state.view.phase == "connected"
                && state.view.expires_at > now
                && session.expires_at > now
        })
        .map(Some)
        .ok_or_else(|| "projection_loom_unavailable".into())
}

pub(crate) fn origin() -> Result<Option<String>, String> {
    let state = owner().lock().map_err(|_| "projection_loom_unavailable")?;
    Ok(live(&state, protocol::now())?.map(|session| session.origin.clone()))
}

pub(crate) fn authorization(origin: &str) -> Result<Option<DeviceSessionAuthorization>, String> {
    let state = owner().lock().map_err(|_| "projection_loom_unavailable")?;
    authorization_for(&state, origin, protocol::now())
}

fn authorization_for(
    state: &Runtime,
    origin: &str,
    now: u64,
) -> Result<Option<DeviceSessionAuthorization>, String> {
    let Some(session) = live(state, now)? else {
        return Ok(None);
    };
    // Never send one Loom's device token to a different origin or silently re-pair.
    if session.origin != origin && state.view.origin.as_deref() != Some(origin) {
        return Err("projection_context_changed".into());
    }
    Ok(Some(session.authorization.clone()))
}

#[cfg(feature = "remote-surface")]
pub(super) fn install(
    generation: u64,
    origin: String,
    authorization: DeviceSessionAuthorization,
    expires_at: u64,
) -> Result<(), String> {
    let mut state = owner().lock().map_err(|_| "projection_loom_unavailable")?;
    if state.generation != generation || state.exiting {
        return Err("projection_context_changed".into());
    }
    state.projection = Some(Session {
        origin,
        authorization,
        expires_at,
    });
    Ok(())
}

#[cfg(feature = "remote-surface")]
pub(super) async fn resolve_origin(
    app: &tauri::AppHandle,
    origin: &str,
    info: &protocol::LoomInfo,
    previous: Option<&str>,
) -> Result<String, String> {
    let local = reqwest::Url::parse(origin)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
        .is_some_and(|host| {
            host == "localhost"
                || host
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
        });
    if !local || !info.discoverable {
        return Ok(origin.into());
    }
    let endpoint = protocol::origin(
        info.endpoint
            .as_deref()
            .ok_or("projection_invalid_origin")?,
    )?;
    if previous == Some(endpoint.as_str()) {
        return Ok(endpoint);
    }
    // The certificate comes from the selected local Loom, NOT an untrusted UDP hint.
    let public = protocol::request(origin, "/v1/otter/identity", None, None).await?;
    if public["loomId"] != info.loom_id || public["endpoint"] != endpoint {
        return Err("projection_context_changed".into());
    }
    let certificate = public["certificate"]
        .as_str()
        .ok_or("projection_lan_certificate_missing")?;
    crate::loom_lan_trust::loom_connection_prepare_discovered(
        app.clone(),
        endpoint.clone(),
        info.loom_id.clone(),
        certificate.into(),
    )
    .await?;
    Ok(endpoint)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_session_requires_live_selected_connection() {
        let mut state = Runtime::default();
        assert!(live(&state, 10).unwrap().is_none());
        state.generation = 1;
        assert!(live(&state, 10).is_err());
        state.view.phase = "connected".into();
        state.view.expires_at = 30;
        state.projection = Some(Session {
            origin: "https://192.168.1.2:8766".into(),
            authorization: DeviceSessionAuthorization::device_for_test("device-test", "test-token"),
            expires_at: 20,
        });
        assert_eq!(
            live(&state, 10).unwrap().unwrap().origin,
            "https://192.168.1.2:8766"
        );
        assert_eq!(
            authorization_for(&state, "https://192.168.1.2:8766", 10)
                .unwrap()
                .unwrap()
                .device_id,
            "device-test"
        );
        assert!(authorization_for(&state, "https://192.168.1.3:8766", 10).is_err());
        state.view.origin = Some("http://127.0.0.1:8765".into());
        assert!(authorization_for(&state, "http://127.0.0.1:8765", 10)
            .unwrap()
            .is_some());
        state.view.expires_at = 10;
        assert!(live(&state, 10).is_err());
        state.view.expires_at = 30;
        assert!(live(&state, 20).is_err());
        state.view.phase = "disconnected".into();
        assert!(live(&state, 10).is_err());
        state.view.phase = "connected".into();
        state.exiting = true;
        assert!(live(&state, 10).is_err());
    }
}
