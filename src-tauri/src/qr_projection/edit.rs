//! Fixed, paired-device document API. No caller-selected path or foreign credentials.
use super::{protocol, Deserialize, Value};
use serde::Serialize;
use std::collections::BTreeMap;

pub(super) const MAX_BYTES: usize = 256 * 1024;
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Change {
    object_id: String,
    value: Option<Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Request {
    Initialize {
        projection_id: String,
        session_id: String,
        expected_digest: String,
        objects: BTreeMap<String, Value>,
    },
    Attach {
        projection_id: String,
        session_id: String,
    },
    Read {
        projection_id: String,
    },
    Mode {
        projection_id: String,
        session_id: String,
        op_id: String,
        base_mode_revision: u64,
        mode: Mode,
    },
    Apply {
        projection_id: String,
        session_id: String,
        op_id: String,
        base_revision: u64,
        mode_revision: u64,
        changes: Vec<Change>,
    },
    Checkpoint {
        projection_id: String,
        session_id: String,
        expected_revision: u64,
    },
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Mode {
    OneWay,
    TwoWay,
}

fn revision(value: &Value) -> bool {
    value
        .as_u64()
        .is_some_and(|n| (1..=protocol::MAX_REVISION).contains(&n))
}
fn session(value: &Value) -> bool {
    value.as_str().is_some_and(|id| {
        id.strip_prefix("edit:").is_some_and(|id| {
            id.len() == 32
                && id
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    })
}
fn digest(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn object(id: &str, value: &Value) -> bool {
    protocol::identifier(id)
        && value["id"] == id
        && value.is_object()
        && serde_json::to_vec(value).is_ok_and(|bytes| bytes.len() <= 16 * 1024)
}
impl Request {
    pub(super) fn prepare(self) -> Result<Value, String> {
        let value = serde_json::to_value(self).map_err(|_| "projection_invalid_request")?;
        if serde_json::to_vec(&value)
            .map_err(|_| "projection_invalid_request")?
            .len()
            > MAX_BYTES
        {
            return Err("projection_request_budget".into());
        }
        if !value["projectionId"]
            .as_str()
            .is_some_and(protocol::projection_id)
            || (value["operation"] != "read" && !session(&value["sessionId"]))
        {
            return Err("projection_invalid_request".into());
        }
        let valid = match value["operation"].as_str() {
            Some("initialize") => {
                digest(&value["expectedDigest"])
                    && value["objects"].as_object().is_some_and(|items| {
                        items.len() <= 256 && items.iter().all(|(id, v)| object(id, v))
                    })
            }
            Some("mode") => {
                value["opId"].as_str().is_some_and(protocol::identifier)
                    && revision(&value["baseModeRevision"])
            }
            Some("apply") => {
                value["opId"].as_str().is_some_and(protocol::identifier)
                    && revision(&value["baseRevision"])
                    && revision(&value["modeRevision"])
                    && value["changes"].as_array().is_some_and(|items| {
                        (1..=32).contains(&items.len())
                            && items.iter().all(|item| {
                                item["objectId"].as_str().is_some_and(|id| {
                                    protocol::identifier(id)
                                        && (item["value"].is_null() || object(id, &item["value"]))
                                })
                            })
                    })
            }
            Some("checkpoint") => revision(&value["expectedRevision"]),
            Some("read" | "attach") => true,
            _ => false,
        };
        if !valid {
            return Err("projection_invalid_request".into());
        }
        Ok(value)
    }
}

pub(super) fn validate_response(value: Value, expected_session: &Value) -> Result<Value, String> {
    let valid = value["schema"] == "neuro.projection-edit.v1"
        && session(&value["sessionId"])
        && (expected_session.is_null() || expected_session == &value["sessionId"])
        && revision(&value["revision"])
        && revision(&value["modeRevision"])
        && revision(&value["checkpointRevision"])
        && value["modeRevision"].as_u64() <= value["revision"].as_u64()
        && value["checkpointRevision"].as_u64() <= value["modeRevision"].as_u64()
        && matches!(value["mode"].as_str(), Some("one_way" | "two_way"))
        && digest(&value["basis"]["digest"])
        && value["basis"]["width"]
            .as_u64()
            .is_some_and(|n| (1..=8192).contains(&n))
        && value["basis"]["height"]
            .as_u64()
            .is_some_and(|n| (1..=8192).contains(&n))
        && value["basis"]["width"].as_u64().unwrap_or(8193)
            * value["basis"]["height"].as_u64().unwrap_or(8193)
            <= 16_777_216
        && value["receiptCount"].as_u64().is_some_and(|n| n <= 256)
        && value["objects"].as_object().is_some_and(|items| {
            items.len() <= 256
                && items.iter().all(|(id, item)| {
                    protocol::identifier(id)
                        && revision(&item["revision"])
                        && item["revision"].as_u64() <= value["revision"].as_u64()
                        && (item["value"].is_null() || object(id, &item["value"]))
                })
        })
        && serde_json::to_vec(&value).is_ok_and(|bytes| bytes.len() <= MAX_BYTES);
    if !valid {
        return Err("projection_invalid_response".into());
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn projection_edit_boundary_checks_sessions_budgets_and_correlations() {
        let id = format!("projection:{}", "a".repeat(32));
        let sid = format!("edit:{}", "b".repeat(32));
        let request = json!({"operation":"initialize","projectionId":id,"sessionId":sid,"expectedDigest":"c".repeat(64),"objects":{}});
        assert!(serde_json::from_value::<Request>(request.clone())
            .unwrap()
            .prepare()
            .is_ok());
        let mut invalid = request;
        invalid["url"] = json!("https://untrusted.invalid");
        assert!(serde_json::from_value::<Request>(invalid).is_err());
        let value = json!({"schema":"neuro.projection-edit.v1","sessionId":sid,"revision":1,"modeRevision":1,
            "checkpointRevision":1,"receiptCount":0,"mode":"one_way","basis":{"digest":"c".repeat(64),"width":2,"height":2},"objects":{}});
        assert!(validate_response(value.clone(), &json!(sid)).is_ok());
        assert!(
            validate_response(value.clone(), &json!(format!("edit:{}", "d".repeat(32)))).is_err()
        );
        let mut invalid = value.clone();
        invalid["modeRevision"] = json!(2);
        assert!(validate_response(invalid, &Value::Null).is_err());
        let mut invalid = value;
        invalid["objects"]["object"] = json!({"revision":1,"value":{"id":"other","type":"rect"}});
        assert!(validate_response(invalid, &Value::Null).is_err());
    }
}
