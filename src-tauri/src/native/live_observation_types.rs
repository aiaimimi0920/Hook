// Protocol-compatible semantic observation types kept independent from UIA internals.
const LIVE_OBSERVATION_LIMIT: usize = 256;
const LIVE_OBSERVATION_VALUE_LIMIT: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LiveRelayObservationState {
    Unknown,
    Detected,
    Observing,
    Stable,
    Triggered,
    Stale,
    Error,
}

impl LiveRelayObservationState {
    fn can_carry_value(self) -> bool {
        !matches!(self, Self::Unknown | Self::Stale | Self::Error)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LiveRelayObservationSource {
    UiAutomation,
    AppAdapter,
    Vision,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LiveRelayObservationConfidence {
    Exact,
    High,
    Medium,
    Low,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayElementLocator {
    #[serde(skip_serializing_if = "Option::is_none")]
    automation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    control_type: String,
    ancestor_path: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    runtime_id: Option<Vec<i32>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayObservation {
    observation_id: String,
    sequence: u64,
    state: LiveRelayObservationState,
    source: LiveRelayObservationSource,
    confidence: LiveRelayObservationConfidence,
    observed_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    stable_since_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    locator: Option<LiveRelayElementLocator>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl LiveRelayObservation {
    fn validate(&self) -> Result<(), String> {
        validate_live_relay_identifier(&self.observation_id, "observation id")?;
        if self.sequence == 0 || self.observed_at_ms == 0 {
            return Err("live observation sequence and timestamp must be positive".to_owned());
        }
        if !self.state.can_carry_value() && self.value.is_some() {
            return Err("untrusted live observation state cannot carry a value".to_owned());
        }
        if self.source == LiveRelayObservationSource::Unknown
            && self.confidence != LiveRelayObservationConfidence::Low
        {
            return Err("unknown live observation sources must have low confidence".to_owned());
        }
        if self.source == LiveRelayObservationSource::Vision
            && self.confidence == LiveRelayObservationConfidence::Exact
        {
            return Err("visual live observations cannot claim exact confidence".to_owned());
        }
        if self.source == LiveRelayObservationSource::UiAutomation && self.locator.is_none() {
            return Err("UI Automation observations require an element locator".to_owned());
        }
        if let Some(locator) = &self.locator {
            validate_live_observation_locator(locator)?;
        }
        if self
            .reason
            .as_ref()
            .is_some_and(|reason| reason.is_empty() || reason.chars().count() > 512)
        {
            return Err("live observation reason is invalid".to_owned());
        }
        if self.value.as_ref().is_some_and(|value| {
            serde_json::to_vec(value)
                .map(|bytes| bytes.len() > LIVE_OBSERVATION_VALUE_LIMIT)
                .unwrap_or(true)
        }) {
            return Err("live observation value exceeds the size limit".to_owned());
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
struct LiveObservationCapabilityProbe {
    capabilities: Vec<String>,
    semantic_control_count: usize,
    unavailable_reason: Option<String>,
}

impl LiveObservationCapabilityProbe {
    fn unsupported(reason: &str) -> Self {
        Self {
            capabilities: Vec::new(),
            semantic_control_count: 0,
            unavailable_reason: Some(reason.to_owned()),
        }
    }
}

fn validate_live_observation_locator(locator: &LiveRelayElementLocator) -> Result<(), String> {
    if locator.control_type.is_empty()
        || locator.control_type.chars().count() > 160
        || locator
            .automation_id
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.chars().count() > 512)
        || locator
            .name
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.chars().count() > 512)
        || locator.ancestor_path.len() > 64
        || locator
            .ancestor_path
            .iter()
            .any(|value| value.is_empty() || value.chars().count() > 512)
        || locator
            .runtime_id
            .as_ref()
            .is_some_and(|value| value.len() > 64)
    {
        return Err("live observation locator is invalid".to_owned());
    }
    Ok(())
}

fn parse_live_observation_capabilities(
    snapshot: &serde_json::Value,
) -> Result<Vec<String>, String> {
    let values = snapshot
        .pointer("/session/observationCapabilities")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Loom live session has no observation capability report".to_owned())?;
    let mut capabilities = Vec::with_capacity(values.len());
    for value in values {
        let capability = value
            .as_str()
            .filter(|value| {
                matches!(
                    *value,
                    "uia_tree"
                        | "invoke"
                        | "range_value"
                        | "value"
                        | "toggle"
                        | "scroll"
                        | "adapter"
                        | "vision"
                )
            })
            .ok_or_else(|| {
                "Loom live session advertised an unknown observation capability".to_owned()
            })?;
        if capabilities.iter().any(|current| current == capability) {
            return Err("Loom live session repeated an observation capability".to_owned());
        }
        capabilities.push(capability.to_owned());
    }
    Ok(capabilities)
}

fn bounded_live_observation_text(value: String, max_chars: usize) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.chars().take(max_chars).collect())
    }
}

#[cfg(test)]
mod live_observation_type_tests {
    use super::*;

    #[test]
    fn stale_and_error_observations_cannot_claim_values() {
        let mut observation = LiveRelayObservation {
            observation_id: "uia:test".to_owned(),
            sequence: 1,
            state: LiveRelayObservationState::Stale,
            source: LiveRelayObservationSource::UiAutomation,
            confidence: LiveRelayObservationConfidence::Exact,
            observed_at_ms: 1,
            stable_since_ms: None,
            locator: Some(LiveRelayElementLocator {
                automation_id: Some("target".to_owned()),
                name: None,
                control_type: "ProgressBar".to_owned(),
                ancestor_path: Vec::new(),
                runtime_id: None,
            }),
            value: Some(serde_json::json!({ "value": 100 })),
            reason: Some("element_not_found".to_owned()),
        };
        assert!(observation.validate().is_err());
        observation.value = None;
        assert!(observation.validate().is_ok());
        observation.state = LiveRelayObservationState::Error;
        assert!(observation.validate().is_ok());
    }

    #[test]
    fn visual_observations_cannot_claim_exact_confidence() {
        let mut observation = LiveRelayObservation {
            observation_id: "vision:test".to_owned(),
            sequence: 1,
            state: LiveRelayObservationState::Stable,
            source: LiveRelayObservationSource::Vision,
            confidence: LiveRelayObservationConfidence::Exact,
            observed_at_ms: 1,
            stable_since_ms: Some(1),
            locator: None,
            value: Some(serde_json::json!({ "value": 100 })),
            reason: None,
        };
        assert!(observation.validate().is_err());
        observation.confidence = LiveRelayObservationConfidence::High;
        assert!(observation.validate().is_ok());
    }
}
