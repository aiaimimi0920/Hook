// Honest discovery contract for optional live adapters, visual providers, and input backends.
const LIVE_EXTENSION_PROTOCOL_VERSION: &str = "hook.live.extensions.v1";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LiveExtensionKind {
    ApplicationAdapter,
    VisualObservation,
    Interaction,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LiveExtensionAvailability {
    Available,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LiveExtensionOwner {
    LoomCapabilityPlugin,
    HookWindowsBackend,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LiveExtensionTrustBoundary {
    LoomVerifiedCapabilityPackage,
    HookNativeBackend,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveExtensionCapability {
    id: String,
    kind: LiveExtensionKind,
    availability: LiveExtensionAvailability,
    execution_owner: LiveExtensionOwner,
    trust_boundary: LiveExtensionTrustBoundary,
    #[serde(skip_serializing_if = "Option::is_none")]
    observation_source: Option<LiveRelayObservationSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    maximum_confidence: Option<LiveRelayObservationConfidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveExtensionCapabilityReport {
    protocol_version: String,
    capabilities: Vec<LiveExtensionCapability>,
}

fn unavailable_live_extension(
    id: &str,
    kind: LiveExtensionKind,
    owner: LiveExtensionOwner,
    trust_boundary: LiveExtensionTrustBoundary,
    observation_source: Option<LiveRelayObservationSource>,
    maximum_confidence: Option<LiveRelayObservationConfidence>,
    reason: &str,
) -> LiveExtensionCapability {
    LiveExtensionCapability {
        id: id.to_owned(),
        kind,
        availability: LiveExtensionAvailability::Unavailable,
        execution_owner: owner,
        trust_boundary,
        observation_source,
        maximum_confidence,
        reason: Some(reason.to_owned()),
    }
}

fn live_extension_capability_report() -> LiveExtensionCapabilityReport {
    let adapter = |id| {
        unavailable_live_extension(
            id,
            LiveExtensionKind::ApplicationAdapter,
            LiveExtensionOwner::LoomCapabilityPlugin,
            LiveExtensionTrustBoundary::LoomVerifiedCapabilityPackage,
            Some(LiveRelayObservationSource::AppAdapter),
            Some(LiveRelayObservationConfidence::Exact),
            "adapter_package_not_installed",
        )
    };
    let interaction = |id| {
        unavailable_live_extension(
            id,
            LiveExtensionKind::Interaction,
            LiveExtensionOwner::HookWindowsBackend,
            LiveExtensionTrustBoundary::HookNativeBackend,
            None,
            None,
            "backend_not_implemented",
        )
    };
    let capabilities = vec![
        adapter("browser_accessibility"),
        adapter("electron_accessibility"),
        adapter("special_rendering"),
        unavailable_live_extension(
            "vision_observation",
            LiveExtensionKind::VisualObservation,
            LiveExtensionOwner::LoomCapabilityPlugin,
            LiveExtensionTrustBoundary::LoomVerifiedCapabilityPackage,
            Some(LiveRelayObservationSource::Vision),
            Some(LiveRelayObservationConfidence::High),
            "vision_provider_not_installed",
        ),
        interaction("touch_input"),
        interaction("pen_input"),
        interaction("ime_input"),
        interaction("clipboard_input"),
        interaction("file_drop_input"),
    ];
    debug_assert!(capabilities
        .iter()
        .all(|capability| capability.availability != LiveExtensionAvailability::Available));
    LiveExtensionCapabilityReport {
        protocol_version: LIVE_EXTENSION_PROTOCOL_VERSION.to_owned(),
        capabilities,
    }
}

#[tauri::command]
fn get_live_extension_capabilities() -> LiveExtensionCapabilityReport {
    live_extension_capability_report()
}

#[cfg(test)]
mod live_extension_capability_tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn unavailable_extensions_are_bounded_and_never_advertised_as_runtime_support() {
        let report = live_extension_capability_report();
        assert_eq!(report.protocol_version, LIVE_EXTENSION_PROTOCOL_VERSION);
        assert_eq!(report.capabilities.len(), 9);
        let ids = report
            .capabilities
            .iter()
            .map(|capability| capability.id.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(ids.len(), report.capabilities.len());
        assert!(report.capabilities.iter().all(|capability| {
            capability.availability == LiveExtensionAvailability::Unavailable
                && capability
                    .reason
                    .as_deref()
                    .is_some_and(|reason| !reason.is_empty())
        }));
    }

    #[test]
    fn adapters_stay_behind_loom_trust_and_visual_confidence_is_not_exact() {
        let report = live_extension_capability_report();
        for capability in &report.capabilities {
            match capability.kind {
                LiveExtensionKind::ApplicationAdapter | LiveExtensionKind::VisualObservation => {
                    assert_eq!(
                        capability.execution_owner,
                        LiveExtensionOwner::LoomCapabilityPlugin
                    );
                    assert_eq!(
                        capability.trust_boundary,
                        LiveExtensionTrustBoundary::LoomVerifiedCapabilityPackage
                    );
                }
                LiveExtensionKind::Interaction => {
                    assert_eq!(
                        capability.execution_owner,
                        LiveExtensionOwner::HookWindowsBackend
                    );
                    assert_eq!(
                        capability.trust_boundary,
                        LiveExtensionTrustBoundary::HookNativeBackend
                    );
                }
            }
            if capability.observation_source == Some(LiveRelayObservationSource::Vision) {
                assert_ne!(
                    capability.maximum_confidence,
                    Some(LiveRelayObservationConfidence::Exact)
                );
            }
        }
    }
}
