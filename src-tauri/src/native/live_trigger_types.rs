// Typed Hook mirror for Loom-owned live trigger registration and audit state.
const LIVE_RELAY_TRIGGER_LIMIT: usize = 64;
const LIVE_RELAY_TRIGGER_AUDIT_LIMIT: usize = 256;
const LIVE_RELAY_TRIGGER_OPERAND_LIMIT: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LiveRelayConditionOperator {
    Equals,
    NotEquals,
    GreaterThan,
    GreaterOrEqual,
    LessThan,
    LessOrEqual,
    Contains,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayTriggerCondition {
    condition_id: String,
    revision: u64,
    observation_id: String,
    operator: LiveRelayConditionOperator,
    operand: serde_json::Value,
    stable_for_ms: u32,
    rising_edge: bool,
    rearm: bool,
    minimum_confidence: LiveRelayObservationConfidence,
}

impl LiveRelayTriggerCondition {
    fn validate(&self) -> Result<(), String> {
        validate_live_relay_identifier(&self.condition_id, "trigger condition id")?;
        validate_live_relay_identifier(&self.observation_id, "trigger observation id")?;
        if self.revision == 0 || self.stable_for_ms > 86_400_000 {
            return Err("live trigger revision or stable duration is invalid".to_owned());
        }
        let encoded = serde_json::to_vec(&self.operand)
            .map_err(|_| "live trigger operand is not serializable".to_owned())?;
        if encoded.len() > LIVE_RELAY_TRIGGER_OPERAND_LIMIT
            || !live_trigger_operand_shape_is_bounded(&self.operand)
        {
            return Err("live trigger operand exceeds its size or shape limit".to_owned());
        }
        let expected = live_trigger_expected_operand(&self.operand)?;
        if matches!(
            self.operator,
            LiveRelayConditionOperator::GreaterThan
                | LiveRelayConditionOperator::GreaterOrEqual
                | LiveRelayConditionOperator::LessThan
                | LiveRelayConditionOperator::LessOrEqual
        ) && expected.as_f64().is_none()
        {
            return Err("numeric live trigger operators require a number".to_owned());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayTriggerTarget {
    surface_instance_id: String,
    surface_attachment_id: String,
    surface_node_id: String,
    surface_event: String,
    surface_action: String,
}

impl LiveRelayTriggerTarget {
    fn validate(&self) -> Result<(), String> {
        for (value, field) in [
            (&self.surface_instance_id, "trigger Surface instance id"),
            (&self.surface_attachment_id, "trigger Surface attachment id"),
            (&self.surface_node_id, "trigger Surface node id"),
            (&self.surface_event, "trigger Surface event"),
            (&self.surface_action, "trigger Surface action"),
        ] {
            validate_live_relay_identifier(value, field)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayTriggerConfigureRequest {
    relay_id: String,
    binding_id: String,
    enabled: bool,
    target: LiveRelayTriggerTarget,
    condition: LiveRelayTriggerCondition,
}

impl LiveRelayTriggerConfigureRequest {
    fn validate(&self) -> Result<(), String> {
        validate_live_relay_identifier(&self.relay_id, "relay id")?;
        validate_live_relay_identifier(&self.binding_id, "trigger binding id")?;
        self.target.validate()?;
        self.condition.validate()
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayTriggerBinding {
    binding_id: String,
    observation_id: String,
    condition_revision: u64,
    authorized_by: String,
    enabled: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayTriggerRegistration {
    binding: LiveRelayTriggerBinding,
    condition: LiveRelayTriggerCondition,
    target: LiveRelayTriggerTarget,
    armed: bool,
    last_match: bool,
    pending_offline_match: bool,
}

impl LiveRelayTriggerRegistration {
    fn validate(&self) -> Result<(), String> {
        validate_live_relay_identifier(&self.binding.binding_id, "trigger binding id")?;
        validate_live_relay_identifier(&self.binding.observation_id, "trigger observation id")?;
        validate_live_relay_identifier(&self.binding.authorized_by, "trigger authorizer")?;
        if self.binding.condition_revision == 0
            || self.binding.condition_revision != self.condition.revision
            || self.binding.observation_id != self.condition.observation_id
        {
            return Err("live trigger binding and condition do not agree".to_owned());
        }
        self.condition.validate()?;
        self.target.validate()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum LiveRelayTriggerOutcome {
    Fired,
    Skipped,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LiveRelayTriggerAudit {
    trigger_id: String,
    binding_id: String,
    condition_revision: u64,
    observation_id: String,
    observation_sequence: u64,
    source_device_id: String,
    observation_source: LiveRelayObservationSource,
    idempotency_key: String,
    outcome: LiveRelayTriggerOutcome,
    evaluated_at_ms: u64,
    authorized_by: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    action_request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl LiveRelayTriggerAudit {
    fn validate(&self) -> Result<(), String> {
        for (value, field) in [
            (&self.trigger_id, "trigger id"),
            (&self.binding_id, "trigger binding id"),
            (&self.observation_id, "trigger observation id"),
            (&self.source_device_id, "trigger source device id"),
            (&self.idempotency_key, "trigger idempotency key"),
            (&self.authorized_by, "trigger authorizer"),
        ] {
            validate_live_relay_identifier(value, field)?;
        }
        if self.condition_revision == 0
            || self.observation_sequence == 0
            || self.evaluated_at_ms == 0
        {
            return Err("live trigger audit counters must be positive".to_owned());
        }
        if let Some(request_id) = &self.action_request_id {
            validate_live_relay_identifier(request_id, "trigger action request id")?;
        }
        if self
            .reason
            .as_ref()
            .is_some_and(|reason| reason.len() > 512)
        {
            return Err("live trigger audit reason is too long".to_owned());
        }
        Ok(())
    }
}

fn parse_live_trigger_snapshot(
    snapshot: &serde_json::Value,
) -> Result<
    (
        Vec<LiveRelayTriggerRegistration>,
        std::collections::VecDeque<LiveRelayTriggerAudit>,
    ),
    String,
> {
    let registrations: Vec<LiveRelayTriggerRegistration> = serde_json::from_value(
        snapshot
            .get("triggers")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([])),
    )
    .map_err(|error| format!("parse Loom live triggers: {error}"))?;
    if registrations.len() > LIVE_RELAY_TRIGGER_LIMIT {
        return Err("Loom live trigger binding limit exceeded".to_owned());
    }
    for registration in &registrations {
        registration.validate()?;
    }

    let audits: Vec<LiveRelayTriggerAudit> = serde_json::from_value(
        snapshot
            .get("triggerAudits")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([])),
    )
    .map_err(|error| format!("parse Loom live trigger audits: {error}"))?;
    if audits.len() > LIVE_RELAY_TRIGGER_AUDIT_LIMIT {
        return Err("Loom live trigger audit limit exceeded".to_owned());
    }
    for audit in &audits {
        audit.validate()?;
    }
    Ok((registrations, audits.into()))
}

fn apply_live_relay_trigger_event(
    relay: &LiveRelaySession,
    payload: &serde_json::Value,
) -> Result<(), String> {
    if relay.role != LiveRelayRole::Viewer {
        return Ok(());
    }
    let audit: LiveRelayTriggerAudit = serde_json::from_value(payload.clone())
        .map_err(|error| format!("parse Loom live trigger audit: {error}"))?;
    audit.validate()?;
    let mut state = relay
        .state
        .lock()
        .map_err(|_| "live relay state poisoned".to_owned())?;
    upsert_live_trigger_audit(&mut state.trigger_audits, audit);
    Ok(())
}

fn upsert_live_trigger_audit(
    audits: &mut std::collections::VecDeque<LiveRelayTriggerAudit>,
    audit: LiveRelayTriggerAudit,
) {
    if let Some(existing) = audits
        .iter_mut()
        .find(|existing| existing.idempotency_key == audit.idempotency_key)
    {
        if !live_trigger_audit_is_reservation(existing) && live_trigger_audit_is_reservation(&audit)
        {
            return;
        }
        if *existing != audit {
            *existing = audit;
        }
    } else {
        audits.push_back(audit);
    }
    while audits.len() > LIVE_RELAY_TRIGGER_AUDIT_LIMIT {
        audits.pop_front();
    }
}

fn live_trigger_audit_is_reservation(audit: &LiveRelayTriggerAudit) -> bool {
    audit.action_request_id.is_none()
        && audit.reason.as_deref() == Some("surface_action_dispatch_reserved")
}

fn live_trigger_expected_operand(
    operand: &serde_json::Value,
) -> Result<&serde_json::Value, String> {
    let Some(object) = operand.as_object() else {
        return Ok(operand);
    };
    if !object.contains_key("path") && !object.contains_key("value") {
        return Ok(operand);
    }
    if object.len() != 2 {
        return Err("live trigger selector must contain only path and value".to_owned());
    }
    let path = object
        .get("path")
        .and_then(serde_json::Value::as_str)
        .filter(|path| path.starts_with('/') && path.len() <= 256 && *path != "/")
        .ok_or_else(|| "live trigger selector path is invalid".to_owned())?;
    let _ = path;
    object
        .get("value")
        .ok_or_else(|| "live trigger selector value is missing".to_owned())
}

fn live_trigger_operand_shape_is_bounded(root: &serde_json::Value) -> bool {
    let mut pending = vec![(root, 1usize)];
    let mut nodes = 0usize;
    while let Some((value, depth)) = pending.pop() {
        nodes = nodes.saturating_add(1);
        if depth > 16 || nodes > 512 {
            return false;
        }
        match value {
            serde_json::Value::Array(values) => {
                pending.extend(values.iter().map(|value| (value, depth + 1)));
            }
            serde_json::Value::Object(values) => {
                pending.extend(values.values().map(|value| (value, depth + 1)));
            }
            _ => {}
        }
    }
    true
}

#[cfg(test)]
mod live_trigger_type_tests {
    use super::*;

    fn trigger_audit(idempotency_key: &str, reason: &str) -> LiveRelayTriggerAudit {
        LiveRelayTriggerAudit {
            trigger_id: "trigger:progress".to_owned(),
            binding_id: "binding:progress".to_owned(),
            condition_revision: 1,
            observation_id: "uia:progress".to_owned(),
            observation_sequence: 101,
            source_device_id: "device:source".to_owned(),
            observation_source: LiveRelayObservationSource::UiAutomation,
            idempotency_key: idempotency_key.to_owned(),
            outcome: LiveRelayTriggerOutcome::Fired,
            evaluated_at_ms: 1,
            authorized_by: "device:viewer".to_owned(),
            action_request_id: None,
            reason: Some(reason.to_owned()),
        }
    }

    #[test]
    fn trigger_condition_rejects_wrong_numeric_type_and_deep_operands() {
        let mut condition = LiveRelayTriggerCondition {
            condition_id: "condition:progress".to_owned(),
            revision: 1,
            observation_id: "uia:progress".to_owned(),
            operator: LiveRelayConditionOperator::GreaterOrEqual,
            operand: serde_json::json!({ "path": "/rangeValue/value", "value": "100" }),
            stable_for_ms: 1_000,
            rising_edge: true,
            rearm: true,
            minimum_confidence: LiveRelayObservationConfidence::Exact,
        };
        assert!(condition.validate().is_err());
        condition.operator = LiveRelayConditionOperator::Equals;
        condition.operand = (0..17).fold(
            serde_json::json!(1),
            |value, _| serde_json::json!({ "nested": value }),
        );
        assert!(condition.validate().is_err());
    }

    #[test]
    fn trigger_audits_replace_reservations_by_idempotency_key_only() {
        let mut audits = std::collections::VecDeque::new();
        upsert_live_trigger_audit(
            &mut audits,
            trigger_audit("trigger:key-one", "surface_action_dispatch_reserved"),
        );
        let mut finalized = trigger_audit("trigger:key-one", "surface_action_accepted");
        finalized.action_request_id = Some("request:phase7".to_owned());
        upsert_live_trigger_audit(&mut audits, finalized.clone());
        assert_eq!(audits.len(), 1);
        assert_eq!(audits[0], finalized);

        upsert_live_trigger_audit(
            &mut audits,
            trigger_audit("trigger:key-one", "surface_action_dispatch_reserved"),
        );
        assert_eq!(
            audits[0], finalized,
            "a replayed reservation cannot regress final state"
        );

        upsert_live_trigger_audit(
            &mut audits,
            trigger_audit("trigger:key-two", "surface_action_dispatch_reserved"),
        );
        assert_eq!(audits.len(), 2);
    }
}
