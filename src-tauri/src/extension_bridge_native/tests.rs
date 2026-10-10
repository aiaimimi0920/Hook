use super::{
    matching,
    queue::{validate_message, TextQueue, MAX_BYTES},
    session::Session,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

#[test]
fn only_extension_protocol_methods_cross_native_boundary() {
    for method in [
        "loom.hook.handshake",
        "loom.extension.handshake",
        "loom.extension.command.authorize",
        "loom.extension.command.invoke",
    ] {
        assert!(
            validate_message(&serde_json::json!({"method": method, "params": {}}).to_string())
                .is_ok()
        );
    }
    for text in [
        "{}",
        "null",
        "{",
        r#"{"method":"loom.hook.workflow.instantiate","params":{}}"#,
        r#"{"method":"loom.extension.command.invoke","params":null}"#,
    ] {
        assert!(validate_message(text).is_err());
    }
}

#[test]
fn queues_bound_both_count_and_total_bytes_and_restore_capacity() {
    let mut queue = TextQueue::default();
    for _ in 0..128 {
        queue.push(String::new()).unwrap();
    }
    assert!(queue.push(String::new()).is_err());
    for _ in 0..128 {
        assert_eq!(queue.pop(), Some(String::new()));
    }
    queue.push("x".repeat(MAX_BYTES)).unwrap();
    assert!(queue.push("x".into()).is_err());
    assert_eq!(queue.pop().unwrap().len(), MAX_BYTES);
    queue.push("next".into()).unwrap();
}

#[test]
fn failed_connection_closes_without_exposing_private_errors() {
    let session = Session::start_with(|| Err("private token must not cross IPC".into())).unwrap();
    let slot = Some(session);
    let session = slot.as_ref().unwrap();
    assert!(matching(&slot, "previous-epoch").is_err());
    assert!(matching(&slot, &session.epoch).is_ok());
    let deadline = Instant::now() + Duration::from_secs(2);
    loop {
        let result = serde_json::to_value(session.poll().unwrap()).unwrap();
        assert!(!result.to_string().contains("private token"));
        if result["closed"] == true {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(session
        .send(r#"{"method":"loom.hook.handshake","params":{}}"#.into())
        .is_err());
}

#[test]
fn cancellation_joins_even_when_open_has_not_completed() {
    let finished = Arc::new(AtomicBool::new(false));
    let marker = finished.clone();
    let session = Session::start_with(move || {
        std::thread::sleep(Duration::from_millis(30));
        marker.store(true, Ordering::Release);
        Err("cancelled opening".into())
    })
    .unwrap();
    drop(session);
    assert!(finished.load(Ordering::Acquire));
}
