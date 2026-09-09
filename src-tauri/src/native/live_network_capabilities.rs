// Non-secret transport and privacy posture exposed to the live collaboration UI.
const LIVE_NETWORK_PROTOCOL_VERSION: &str = "hook.live.network.v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LiveNetworkScope {
    LoopbackHttp,
    LoopbackHttps,
    PrivateHttps,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LiveNetworkAvailability {
    Available,
    Unavailable,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveNetworkTransportCapability {
    id: String,
    availability: LiveNetworkAvailability,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveNetworkPrivacyPosture {
    cloud_frame_persistence: bool,
    cloud_ocr_persistence: bool,
    telemetry_enabled: bool,
    credentials_exposed: bool,
    policy: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveNetworkCapabilityReport {
    protocol_version: String,
    configured_scope: LiveNetworkScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_url_origin: Option<String>,
    remote_surface_enabled: bool,
    lan_independent: bool,
    non_loopback_tls_required: bool,
    non_loopback_device_auth_required: bool,
    latency_telemetry: String,
    input_policy: String,
    transports: Vec<LiveNetworkTransportCapability>,
    privacy: LiveNetworkPrivacyPosture,
}

fn unavailable_network_transport(id: &str, reason: &str) -> LiveNetworkTransportCapability {
    LiveNetworkTransportCapability {
        id: id.to_owned(),
        availability: LiveNetworkAvailability::Unavailable,
        reason: Some(reason.to_owned()),
    }
}

fn live_network_capability_report(base_url: Option<&str>) -> LiveNetworkCapabilityReport {
    let (configured_scope, base_url_origin, websocket) = match base_url.and_then(|value| {
        crate::loom_connector::classify_loom_base_url(value)
            .ok()
            .map(|kind| (value, kind))
    }) {
        Some((value, crate::loom_connector::LoomBaseUrlKind::LoopbackHttp)) => (
            LiveNetworkScope::LoopbackHttp,
            Some(value.to_owned()),
            LiveNetworkTransportCapability {
                id: "websocket_binary".to_owned(),
                availability: LiveNetworkAvailability::Available,
                reason: None,
            },
        ),
        Some((value, crate::loom_connector::LoomBaseUrlKind::LoopbackHttps)) => (
            LiveNetworkScope::LoopbackHttps,
            Some(value.to_owned()),
            LiveNetworkTransportCapability {
                id: "websocket_binary".to_owned(),
                availability: LiveNetworkAvailability::Available,
                reason: None,
            },
        ),
        Some((value, crate::loom_connector::LoomBaseUrlKind::RemoteHttps))
            if cfg!(feature = "remote-surface") =>
        {
            (
                LiveNetworkScope::PrivateHttps,
                Some(value.to_owned()),
                LiveNetworkTransportCapability {
                    id: "websocket_binary".to_owned(),
                    availability: LiveNetworkAvailability::Available,
                    reason: None,
                },
            )
        }
        _ => (
            LiveNetworkScope::Unavailable,
            None,
            unavailable_network_transport("websocket_binary", "loom_manifest_unavailable"),
        ),
    };
    LiveNetworkCapabilityReport {
        protocol_version: LIVE_NETWORK_PROTOCOL_VERSION.to_owned(),
        configured_scope,
        base_url_origin,
        remote_surface_enabled: cfg!(feature = "remote-surface"),
        lan_independent: true,
        non_loopback_tls_required: true,
        non_loopback_device_auth_required: true,
        latency_telemetry: "viewer_websocket_ping_round_trip".to_owned(),
        input_policy: "rtt_adaptive_pointer_coalescing".to_owned(),
        transports: vec![
            websocket,
            unavailable_network_transport("cloud_relay", "relay_provider_not_configured"),
            unavailable_network_transport("webrtc_turn", "nat_traversal_not_configured"),
        ],
        privacy: LiveNetworkPrivacyPosture {
            cloud_frame_persistence: false,
            cloud_ocr_persistence: false,
            telemetry_enabled: false,
            credentials_exposed: false,
            policy: "local_first_no_cloud_storage".to_owned(),
        },
    }
}

#[tauri::command]
fn get_live_network_capabilities() -> LiveNetworkCapabilityReport {
    let base_url = crate::loom_connector::read_default_loom_manifest()
        .ok()
        .map(|manifest| manifest.transport.base_url);
    live_network_capability_report(base_url.as_deref())
}

#[cfg(test)]
mod live_network_capability_tests {
    use super::*;

    #[test]
    fn local_and_private_https_scopes_keep_cloud_transports_honest() {
        let local = live_network_capability_report(Some("http://127.0.0.1:8765"));
        assert_eq!(local.configured_scope, LiveNetworkScope::LoopbackHttp);
        assert!(local.lan_independent);
        assert_eq!(
            local.transports[0].availability,
            LiveNetworkAvailability::Available
        );
        assert!(local.transports[1..].iter().all(|transport| {
            transport.availability == LiveNetworkAvailability::Unavailable
                && transport
                    .reason
                    .as_deref()
                    .is_some_and(|reason| !reason.is_empty())
        }));

        let remote = live_network_capability_report(Some("https://loom.example.test"));
        let expected_scope = if cfg!(feature = "remote-surface") {
            LiveNetworkScope::PrivateHttps
        } else {
            LiveNetworkScope::Unavailable
        };
        assert_eq!(remote.configured_scope, expected_scope);
        assert!(remote.non_loopback_tls_required);
        assert!(remote.non_loopback_device_auth_required);
    }

    #[test]
    fn privacy_posture_never_claims_cloud_storage_or_telemetry() {
        let report = live_network_capability_report(None);
        assert_eq!(report.configured_scope, LiveNetworkScope::Unavailable);
        assert!(!report.privacy.cloud_frame_persistence);
        assert!(!report.privacy.cloud_ocr_persistence);
        assert!(!report.privacy.telemetry_enabled);
        assert!(!report.privacy.credentials_exposed);
    }
}
