// The attach response can retain bindings for an old identity at the same Hook node.
fn mounted_attachment(device_id: &str, hook_node_id: &str) -> serde_json::Value {
    serde_json::json!({
        "descriptor": {"deviceId": device_id, "hookNodeId": hook_node_id},
        "lifecycleRevision": 7,
        "snapshot": {"revision": 11}
    })
}

#[test]
fn surface_attach_selects_the_current_device_binding_after_repair() {
    let attachments = serde_json::json!({
        "attachment:a-old": mounted_attachment("device:old", "node:one"),
        "attachment:z-current": mounted_attachment("device:new", "node:one")
    });
    let (id, attachment) = select_mounted_surface_attachment(
        attachments.as_object().unwrap(),
        "node:one",
        "device:new",
    )
    .unwrap();
    assert_eq!(id, "attachment:z-current");
    assert_eq!(attachment["descriptor"]["deviceId"], "device:new");
    assert_eq!(attachment["lifecycleRevision"], 7);
    assert_eq!(attachment["snapshot"]["revision"], 11);
}

#[test]
fn surface_attach_preserves_an_existing_same_device_binding() {
    let attachments = serde_json::json!({
        "attachment:one": mounted_attachment("device:one", "node:one")
    });
    let (id, _) = select_mounted_surface_attachment(
        attachments.as_object().unwrap(),
        "node:one",
        "device:one",
    )
    .unwrap();
    assert_eq!(id, "attachment:one");
}

#[test]
fn surface_attach_rejects_unowned_or_wrong_node_bindings() {
    for attachments in [
        serde_json::json!({"attachment:old": mounted_attachment("device:old", "node:one")}),
        serde_json::json!({"attachment:other": mounted_attachment("device:new", "node:other")}),
        serde_json::json!({"attachment:missing-owner": {"descriptor": {"hookNodeId": "node:one"}}}),
        serde_json::json!({}),
    ] {
        assert!(select_mounted_surface_attachment(
            attachments.as_object().unwrap(),
            "node:one",
            "device:new"
        )
        .is_err());
    }
}
