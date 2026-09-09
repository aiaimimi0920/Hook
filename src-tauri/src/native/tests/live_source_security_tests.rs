#[test]
fn administrator_hook_can_control_an_ordinary_source() {
    assert!(live_input_integrity_allows(0x3000, 0x2000));
}

#[test]
fn ordinary_hook_cannot_control_an_administrator_source() {
    assert!(!live_input_integrity_allows(0x2000, 0x3000));
}

#[test]
fn equal_integrity_sources_remain_allowed() {
    assert!(live_input_integrity_allows(0x2000, 0x2000));
    assert!(live_input_integrity_allows(0x3000, 0x3000));
}

#[test]
fn different_user_and_missing_user_are_rejected_even_downward() {
    let controller = LiveInputProcessIdentity { integrity_level: 0x3000, user_sid: vec![1] };
    let source = LiveInputProcessIdentity { integrity_level: 0x2000, user_sid: vec![2] };
    assert!(!live_input_identity_allows(&controller, &source));
    let empty = LiveInputProcessIdentity { integrity_level: 0x2000, user_sid: vec![] };
    assert!(!live_input_identity_allows(&empty, &empty));
}

#[cfg(target_os = "windows")]
#[test]
fn reads_real_process_token_identity_and_preflights_own_process() {
    let identity = live_input_process_identity(std::process::id()).unwrap();
    assert!(!identity.user_sid.is_empty());
    assert!(live_input_identity_allows(&identity, &identity));
    live_source_input_preflight(std::process::id()).unwrap();
}

#[cfg(target_os = "windows")]
#[test]
#[ignore = "reads identities of the currently reported Hook and source PIDs; no input"]
fn reported_live_process_identities_follow_uipi_direction() {
    let controller_pid = std::env::var("HOOK_LIVE_PROBE_CONTROLLER_PID").unwrap().parse().unwrap();
    let source_pid = std::env::var("HOOK_LIVE_PROBE_SOURCE_PID").unwrap().parse().unwrap();
    let controller = live_input_process_identity(controller_pid).unwrap();
    let source = live_input_process_identity(source_pid).unwrap();
    println!("Live identity: controllerIL={} sourceIL={} sameUser={} oldEquality={} correctedAllowed={}",
        controller.integrity_level, source.integrity_level, controller.user_sid == source.user_sid,
        controller.integrity_level == source.integrity_level,
        live_input_identity_allows(&controller, &source));
    assert!(controller.integrity_level > source.integrity_level);
    assert!(live_input_identity_allows(&controller, &source));
    assert!(!live_input_identity_allows(&source, &controller));
}
