//! Restart intent is distinct from history and protected by connection generation.
use super::{
    history::{self, Target},
    resume, Runtime,
};
use std::path::PathBuf;

fn root() -> PathBuf {
    let root = std::env::temp_dir().join(format!("otter-loom-resume-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}
fn target(id: &str) -> Target {
    Target {
        origin: format!("https://{id}.test"),
        loom_id: format!("loom-{id}"),
        name: "测试 Loom".into(),
        device_id: format!("device-{id}"),
    }
}

#[test]
fn missing_intent_does_not_resume_arbitrary_history() {
    let root = root();
    history::remember(&root, target("old")).unwrap();
    assert!(resume::load(&root).unwrap().is_none());
}

#[test]
fn successful_connection_survives_exit_and_last_target_wins() {
    let root = root();
    let mut state = Runtime::default();
    state.generation = 1;
    resume::remember_connected(&state, 1, &root, target("first")).unwrap();
    state.generation = 2;
    resume::remember_connected(&state, 2, &root, target("last")).unwrap();
    // Shutdown clears runtime ownership, not the persistent intent.
    state.exiting = true;
    state.generation += 1;
    state.view = super::View::default();
    assert_eq!(resume::load(&root).unwrap().unwrap().loom_id, "loom-last");
    assert!(resume::remember_connected(&state, 2, &root, target("late")).is_err());
    assert_eq!(resume::load(&root).unwrap().unwrap().loom_id, "loom-last");
    let text = std::fs::read_to_string(root.join("loom-resume.json")).unwrap();
    for secret in ["password", "receipt", "token", "privateKey"] {
        assert!(!text.contains(secret));
    }
}

#[test]
fn manual_disconnect_clears_intent_but_keeps_history_and_rejects_late_success() {
    let root = root();
    let mut state = Runtime::default();
    state.generation = 1;
    resume::remember_connected(&state, 1, &root, target("first")).unwrap();
    resume::prepare_replace(&state, None, Some(&root)).unwrap();
    state.generation += 1;
    assert!(resume::load(&root).unwrap().is_none());
    assert_eq!(history::load(&root).unwrap().len(), 1);
    assert!(resume::remember_connected(&state, 1, &root, target("late")).is_err());
    assert!(resume::load(&root).unwrap().is_none());
}

#[test]
fn startup_cannot_override_manual_action_and_does_not_forget_offline_target() {
    let root = root();
    resume::save(&root, Some(target("saved"))).unwrap();
    let mut state = Runtime::default();
    resume::prepare_replace(&state, Some(0), None).unwrap();
    assert_eq!(resume::load(&root).unwrap().unwrap().loom_id, "loom-saved");
    state.generation = 1;
    assert!(resume::prepare_replace(&state, Some(0), None).is_err());
    state.exiting = true;
    assert!(resume::prepare_replace(&state, None, None).is_err());
}

#[test]
fn invalid_unbounded_or_unsafe_records_fail_closed() {
    let root = root();
    let path = root.join("loom-resume.json");
    for bytes in [
        vec![b'x'; 4097],
        b"not json".to_vec(),
        br#"{"version":2,"target":null}"#.to_vec(),
    ] {
        std::fs::write(&path, bytes).unwrap();
        assert!(resume::load(&root).is_err());
    }
    let mut unsafe_target = target("unsafe");
    unsafe_target.origin = "http://remote.test".into();
    assert!(resume::save(&root, Some(unsafe_target)).is_err());
    resume::save(&root, None).unwrap();
    assert!(resume::load(&root).unwrap().is_none());
}

#[test]
fn failed_durable_disconnect_is_not_reported_as_success() {
    let root = root();
    let invalid_root = root.join("not-a-directory");
    std::fs::write(&invalid_root, b"file").unwrap();
    assert!(resume::prepare_replace(&Runtime::default(), None, Some(&invalid_root)).is_err());
}
