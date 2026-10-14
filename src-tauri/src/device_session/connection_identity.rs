//! Connection selection reuses the protected key, never the default target's device ID.
use super::{identity, session_attempt, DeviceSessionAuthorization, SurfaceRequestCredential};

pub(crate) struct ConnectionIdentity(identity::DeviceIdentityDocument);

impl ConnectionIdentity {
    #[cfg(test)]
    pub(crate) fn load_at(root: &std::path::Path) -> Result<Self, String> {
        Ok(Self(identity::load_or_create_device_identity_at(root)?))
    }
    pub(crate) fn load(app: &tauri::AppHandle, device_id: Option<String>) -> Result<Self, String> {
        let mut identity = identity::load_or_create_device_identity(app)?;
        identity.device_id = device_id;
        Ok(Self(identity))
    }
    pub(crate) fn public_key(&self) -> &str {
        &self.0.public_key
    }
    pub(crate) fn bind(&mut self, device_id: String) {
        self.0.device_id = Some(device_id);
    }
    pub(crate) async fn session(
        &self,
        origin: &str,
    ) -> Result<(DeviceSessionAuthorization, u64), String> {
        let session = session_attempt::create_existing_device_session_once(origin, &self.0).await?;
        Ok((
            DeviceSessionAuthorization {
                device_id: session.device_id,
                credential: SurfaceRequestCredential::Device(session.token),
            },
            session.expires_at_ms,
        ))
    }
}
