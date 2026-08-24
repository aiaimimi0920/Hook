//! Bounded in-memory cache for short-lived Loom device-session tokens.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use super::{DeviceSessionAuthorization, SurfaceRequestCredential};

const DEVICE_SESSION_RENEWAL_MARGIN_MILLIS: u64 = 30_000;
const MAX_CACHED_DEVICE_SESSIONS: usize = 64;

static DEVICE_SESSION_CACHE: OnceLock<Mutex<HashMap<String, CachedDeviceSession>>> =
    OnceLock::new();

#[derive(Clone)]
struct CachedDeviceSession {
    device_id: String,
    token: String,
    expires_at_ms: u64,
}

fn cache() -> &'static Mutex<HashMap<String, CachedDeviceSession>> {
    DEVICE_SESSION_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(super) fn get(
    cache_key: &str,
    now_ms: u64,
) -> Result<Option<DeviceSessionAuthorization>, String> {
    let mut sessions = cache()
        .lock()
        .map_err(|_| "Hook device session cache is unavailable".to_owned())?;
    prune_expired(&mut sessions, now_ms);
    Ok(sessions
        .get(cache_key)
        .filter(|session| {
            session.expires_at_ms > now_ms.saturating_add(DEVICE_SESSION_RENEWAL_MARGIN_MILLIS)
        })
        .map(|session| DeviceSessionAuthorization {
            device_id: session.device_id.clone(),
            credential: SurfaceRequestCredential::Device(session.token.clone()),
        }))
}

pub(super) fn insert(
    cache_key: String,
    device_id: String,
    token: String,
    expires_at_ms: u64,
    now_ms: u64,
) -> Result<(), String> {
    let mut sessions = cache()
        .lock()
        .map_err(|_| "Hook device session cache is unavailable".to_owned())?;
    insert_bounded(
        &mut sessions,
        cache_key,
        CachedDeviceSession {
            device_id,
            token,
            expires_at_ms,
        },
        now_ms,
    );
    Ok(())
}

pub(super) fn invalidate(base_url: &str) {
    let prefix = format!("{}\n", base_url.trim_end_matches('/'));
    if let Ok(mut sessions) = cache().lock() {
        sessions.retain(|key, _| !key.starts_with(&prefix));
    }
}

fn insert_bounded(
    sessions: &mut HashMap<String, CachedDeviceSession>,
    cache_key: String,
    session: CachedDeviceSession,
    now_ms: u64,
) {
    prune_expired(sessions, now_ms);
    if !sessions.contains_key(&cache_key) && sessions.len() >= MAX_CACHED_DEVICE_SESSIONS {
        if let Some(oldest_key) = sessions
            .iter()
            .min_by_key(|(_, cached)| cached.expires_at_ms)
            .map(|(key, _)| key.clone())
        {
            sessions.remove(&oldest_key);
        }
    }
    sessions.insert(cache_key, session);
}

fn prune_expired(sessions: &mut HashMap<String, CachedDeviceSession>, now_ms: u64) {
    sessions.retain(|_, session| session.expires_at_ms > now_ms);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(expires_at_ms: u64) -> CachedDeviceSession {
        CachedDeviceSession {
            device_id: "device".to_owned(),
            token: "token".to_owned(),
            expires_at_ms,
        }
    }

    #[test]
    fn insertion_prunes_expired_entries_and_bounds_capacity() {
        let mut sessions = HashMap::new();
        sessions.insert("expired".to_owned(), session(9));
        for index in 0..=MAX_CACHED_DEVICE_SESSIONS {
            insert_bounded(
                &mut sessions,
                format!("key-{index}"),
                session(100 + index as u64),
                10,
            );
        }
        assert_eq!(sessions.len(), MAX_CACHED_DEVICE_SESSIONS);
        assert!(!sessions.contains_key("expired"));
        assert!(!sessions.contains_key("key-0"));
        assert!(sessions.contains_key(&format!("key-{MAX_CACHED_DEVICE_SESSIONS}")));
    }
}
