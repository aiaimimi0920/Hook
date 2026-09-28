use super::{protocol, response, v2_protocol};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};

fn reply() -> Value {
    let image = image::RgbaImage::from_pixel(2, 2, image::Rgba([10, 20, 30, 255]));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
    let snapshot = protocol::ProjectionSnapshot {
        image_base64: STANDARD.encode(bytes.into_inner()),
        width: 2,
        height: 2,
    };
    let digest = protocol::validate_snapshot(&snapshot).unwrap();
    json!({
        "envelope": {
            "protocol": protocol::PROTOCOL, "projectionId": format!("projection:{}", "1".repeat(32)),
            "serverOrigin": "https://loom.example.test",
            "source": {"deviceId": "a", "sessionId": "session-a", "unitId": "source", "revision": 1},
            "content": {"kind": "sticker", "digest": digest}, "expiresAtMs": 300001,
            "nonce": "2".repeat(32), "signature": {"algorithm": "ed25519", "keyId": "a", "value": "A".repeat(86)},
        },
        "revision": 1, "digest": digest, "linked": true, "receiverDeviceId": "b", "receiverUnitId": "receiver", "snapshot": snapshot,
    })
}

#[test]
fn prepared_create_retains_signed_identity_and_checks_actor_origin_and_pixels() {
    let value = reply();
    let body = |value: &Value, actor: &str, origin: &str| {
        super::prepared_create::prepared_create_body(
            serde_json::from_value(value["envelope"].clone()).unwrap(),
            serde_json::from_value(value["snapshot"].clone()).unwrap(),
            Some("b".to_owned()),
            actor,
            origin,
        )
    };
    let first = body(&value, "a", "https://loom.example.test").unwrap();
    assert_eq!(first["envelope"], value["envelope"]);
    assert_eq!(
        first,
        body(&value, "a", "https://loom.example.test").unwrap()
    );
    assert!(body(&value, "other", "https://loom.example.test").is_err());
    assert!(body(&value, "a", "https://other.example.test").is_err());
    let mut mismatch = value.clone();
    mismatch["envelope"]["content"]["digest"] = json!("0".repeat(64));
    assert_eq!(
        body(&mismatch, "a", "https://loom.example.test").unwrap_err(),
        "projection_content_changed"
    );
}

#[test]
fn offline_routes_preserve_signed_envelope_and_require_bound_target() {
    use sha2::{Digest, Sha256};
    let envelope = reply()["envelope"].clone();
    let peer = format!("loom-{}", "a".repeat(64));
    let target = format!(
        "peer-target:{:x}",
        Sha256::digest(format!("{peer}\nremote"))
    );
    let route = json!({"peerId": peer, "remoteDeviceId": "remote"});
    let mut body = json!({"envelope": envelope, "targetDeviceId": target});
    assert_eq!(
        super::offline::prepare(
            "/v1/projections/create",
            &mut body,
            serde_json::from_value(route.clone()).unwrap()
        )
        .unwrap(),
        "/v1/offline-projections/create"
    );
    assert_eq!(body["envelope"], envelope);
    body["targetDeviceId"] = json!("local-device");
    assert!(super::offline::prepare(
        "/v1/projections/create",
        &mut body,
        serde_json::from_value(route.clone()).unwrap()
    )
    .is_err());
    assert!(super::offline::prepare(
        "/v1/projections/read",
        &mut body,
        serde_json::from_value(route).unwrap()
    )
    .is_err());
    assert!(super::offline::prepare(
        "/v1/projections/targets",
        &mut body,
        serde_json::from_value(json!({})).unwrap()
    )
    .is_err());
}

#[test]
fn foreign_response_requires_explicit_route_and_keeps_integrity_checks() {
    let mut value = reply();
    value["route"] = json!("offline_peer");
    let body = json!({"envelope": value["envelope"], "receiverUnitId": "receiver"});
    let context = response::ResponseContext::new(
        "/v1/projections/accept",
        "https://receiver.example.test",
        &body,
    );
    assert!(response::validate(value.clone(), &context).is_err());
    let context = context.offline(true);
    assert!(response::validate(value.clone(), &context).is_ok());
    for (field, wrong) in [
        ("route", json!("shared_loom")),
        ("receiverUnitId", json!("other")),
        ("digest", json!("0".repeat(64))),
    ] {
        let mut invalid = value.clone();
        invalid[field] = wrong;
        assert!(response::validate(invalid, &context).is_err());
    }
    value["envelope"]["source"]["deviceId"] = json!("forged");
    assert!(response::validate(value, &context).is_err());
}

#[test]
fn projection_delivery_metadata_is_bounded_and_origin_bound() {
    let valid = json!({"targets": [{"deviceId": "b", "name": "PC 3", "policy": "auto", "route": "shared_loom"}]});
    assert!(super::delivery::validate(
        valid.clone(),
        "/v1/projections/targets",
        "https://loom.example.test"
    )
    .is_ok());
    let mut invalid = valid.clone();
    invalid["targets"][0]["route"] = json!("official_relay");
    assert!(super::delivery::validate(
        invalid,
        "/v1/projections/targets",
        "https://loom.example.test"
    )
    .is_err());
    let huge = json!({"targets": vec![valid["targets"][0].clone(); 65]});
    assert!(super::delivery::validate(
        huge,
        "/v1/projections/targets",
        "https://loom.example.test"
    )
    .is_err());
    let mut entry = reply();
    entry["delivery"] = json!({"status": "accepted"});
    let inbox = json!({"invitations": [entry]});
    assert!(super::delivery::validate(
        inbox.clone(),
        "/v1/projections/inbox",
        "https://loom.example.test"
    )
    .is_ok());
    assert!(super::delivery::validate(
        inbox,
        "/v1/projections/inbox",
        "https://other.example.test"
    )
    .is_err());
    let value = reply();
    let body = json!({"envelope": value["envelope"], "targetDeviceId": "b"});
    let context = response::ResponseContext::new(
        "/v1/projections/create",
        "https://loom.example.test",
        &body,
    );
    assert!(response::validate(value, &context).is_err());
}

#[test]
fn projection_offline_target_cannot_be_misrepresented_as_sendable_or_local() {
    use sha2::{Digest, Sha256};
    let peer = format!("loom-{}", "a".repeat(64));
    let id = format!(
        "peer-target:{:x}",
        Sha256::digest(format!("{peer}\nremote-b"))
    );
    let target = json!({"deviceId": id, "name": "Remote", "policy": "auto", "route": "offline_peer",
        "peerId": peer, "remoteDeviceId": "remote-b", "peerName": "Loom B", "deliveryAvailable": false,
        "unavailableReason": "offline_peer_delivery_not_implemented"});
    let validate = |item| {
        super::delivery::validate(
            json!({"targets": [item]}),
            "/v1/projections/targets",
            "https://loom.example.test",
        )
    };
    assert!(validate(target.clone()).is_ok());
    for (field, value) in [
        ("deliveryAvailable", json!(true)),
        ("route", json!("shared_loom")),
        ("deviceId", json!("local-device")),
        ("remoteDeviceId", json!("other-device")),
    ] {
        let mut invalid = target.clone();
        invalid[field] = value;
        assert!(validate(invalid).is_err());
    }
}

#[test]
fn projection_reply_checks_signed_identity_target_and_png_digest() {
    let value = reply();
    let body =
        json!({"envelope": value["envelope"], "receiverUnitId": "receiver", "expectedRevision": 1});
    let context = response::ResponseContext::new(
        "/v1/projections/accept",
        "https://loom.example.test",
        &body,
    );
    assert!(response::validate(value.clone(), &context).is_ok());
    for (pointer, replacement) in [
        (
            "/envelope/serverOrigin",
            json!("https://other.example.test"),
        ),
        ("/receiverUnitId", json!("other-unit")),
        ("/revision", json!(0)),
        ("/digest", json!("a".repeat(64))),
        ("/snapshot", Value::Null),
        ("/snapshot/width", json!(3)),
    ] {
        let mut changed = value.clone();
        *changed.pointer_mut(pointer).unwrap() = replacement;
        assert!(response::validate(changed, &context).is_err(), "{pointer}");
    }
}

#[test]
fn projection_update_ack_matches_exact_revision_and_digest() {
    let mut value = reply();
    value["revision"] = json!(2);
    value["snapshot"] = Value::Null;
    let body = json!({"projectionId": value["envelope"]["projectionId"], "revision": 2, "digest": value["digest"]});
    let context = response::ResponseContext::new(
        "/v1/projections/update",
        "https://loom.example.test",
        &body,
    );
    assert!(response::validate(value.clone(), &context).is_ok());
    value["revision"] = json!(3);
    assert!(response::validate(value.clone(), &context).is_err());
    value["revision"] = json!(2);
    value["digest"] = json!("a".repeat(64));
    assert!(response::validate(value, &context).is_err());
}

#[test]
fn projection_native_origins_and_png_allocation_are_bounded() {
    assert_eq!(
        protocol::normalize_origin("https://loom.example.test/").unwrap(),
        "https://loom.example.test"
    );
    for origin in [
        "http://192.168.1.5",
        "https://user:pass@host",
        "https://host/path",
        "https://host?x=1",
        "file:///tmp/x",
    ] {
        assert!(protocol::normalize_origin(origin).is_err(), "{origin}");
    }
    let mut snapshot: protocol::ProjectionSnapshot =
        serde_json::from_value(reply()["snapshot"].clone()).unwrap();
    snapshot.width = 8193;
    assert!(protocol::validate_snapshot(&snapshot).is_err());
    snapshot.width = 8192;
    snapshot.height = 8192;
    assert!(protocol::validate_snapshot(&snapshot).is_err());
}

fn signed_v2_reply() -> Value {
    use ed25519_dalek::{Signer, SigningKey};
    let key = SigningKey::from_bytes(&[7; 32]);
    let device = "148946ee-b1af-4114-ae78-fae086f12068";
    let mut value = reply();
    let envelope = &mut value["envelope"];
    envelope["protocol"] = json!("neuro.qr-projection.v2");
    envelope["source"]["deviceId"] = json!(device);
    envelope["source"]["accountId"] = json!("account:test");
    envelope["source"]["publicKey"] = json!(STANDARD.encode(key.verifying_key().as_bytes()));
    envelope["signature"]["keyId"] = json!(device);
    let fields = [
        "/protocol",
        "/projectionId",
        "/serverOrigin",
        "/source/deviceId",
        "/source/accountId",
        "/source/publicKey",
        "/source/sessionId",
        "/source/unitId",
        "/source/revision",
        "/content/kind",
        "/content/digest",
        "/expiresAtMs",
        "/nonce",
        "/signature/algorithm",
        "/signature/keyId",
    ];
    let message = fields
        .map(|field| {
            let field = envelope.pointer(field).unwrap();
            field
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| field.to_string())
        })
        .join("\n");
    envelope["signature"]["value"] = json!(base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(key.sign(message.as_bytes()).to_bytes()));
    value
}

#[test]
fn projection_v2_checks_signed_account_identity_and_update_ack() {
    let mut value = signed_v2_reply();
    let body = json!({"kind":"inspect", "envelope":value["envelope"]});
    assert!(v2_protocol::validate_response(&value, &body).is_ok());
    for pointer in [
        "/envelope/source/accountId",
        "/envelope/serverOrigin",
        "/envelope/content/digest",
    ] {
        let mut forged = value.clone();
        *forged.pointer_mut(pointer).unwrap() = json!("untrusted");
        assert!(v2_protocol::validate_response(
            &forged,
            &json!({"kind":"inspect", "envelope":forged["envelope"]})
        )
        .is_err());
    }
    let update = json!({"kind":"update", "projectionId":value["envelope"]["projectionId"],
        "sourceSessionId":"session-a", "priorRevision":1, "revision":2, "snapshot":value["snapshot"]});
    value["revision"] = json!(2);
    value["snapshot"] = Value::Null;
    assert!(v2_protocol::validate_response(&value, &update).is_ok());
    for (pointer, replacement) in [("/revision", json!(3)), ("/digest", json!("a".repeat(64)))] {
        let mut changed = value.clone();
        *changed.pointer_mut(pointer).unwrap() = replacement;
        assert!(v2_protocol::validate_response(&changed, &update).is_err());
    }
    let mut other_epoch = update;
    other_epoch["sourceSessionId"] = json!("other-session");
    assert!(v2_protocol::validate_response(&value, &other_epoch).is_err());
}
