#[test]
#[ignore = "requires the isolated Godot fixture and its owned process ID"]
fn real_godot_source_button_responds_to_window_input() {
    let output = std::path::PathBuf::from(std::env::var("HOOK_LIVE_GODOT_OUTPUT").unwrap());
    let owned_pid: u32 = std::env::var("HOOK_LIVE_GODOT_PID").unwrap().parse().unwrap();
    let read_json = |name: &str| -> serde_json::Value {
        let bytes = std::fs::read(output.join(name)).unwrap();
        assert!(bytes.len() < 65_536);
        serde_json::from_slice(&bytes).unwrap()
    };
    let ready = read_json("ready.json");
    assert_eq!(ready["pid"].as_u64(), Some(u64::from(owned_pid)));
    let mut source = LiveSourceWindowLifecycle::new_with_region(
        ready["windowId"].as_str().unwrap(), None,
    ).unwrap();
    assert_eq!(source.process_id, owned_pid, "never send input to an unowned window");
    let mut peer = LiveSourceWindowLifecycle::new_with_region(
        ready["windowId"].as_str().unwrap(), None,
    ).unwrap();
    assert!(Arc::ptr_eq(&source.visibility, &peer.visibility));
    peer.set_interaction_enabled(true).unwrap();
    source.set_logically_hidden(true, "multi_region_test").unwrap();
    assert_eq!(peer.source_window_state(), "logically_hidden");
    peer.set_logically_hidden(true, "second_region").unwrap();
    assert_eq!(peer.logical_hide_reason().as_deref(), Some("multi_region_test"));
    source.restore().unwrap();
    source.restore().unwrap();
    assert_eq!(peer.visibility.lock().unwrap().sessions, 1);
    assert_eq!(peer.source_window_state(), "logically_hidden");
    assert!(peer.interaction_enabled);
    let before = read_json("state.json")["clicks"].as_u64().unwrap();
    for (sequence, kind) in [(1, "mouse_move"), (2, "mouse_button_down"), (3, "mouse_button_up")] {
        peer.send_input(&LiveCaptureInputRequest {
            sequence, kind: kind.to_owned(),
            normalized_x: ready["normalizedX"].as_f64(),
            normalized_y: ready["normalizedY"].as_f64(),
            button: Some("left".to_owned()),
            wheel_delta: None, wheel_axis: None, click_count: None, virtual_key: None,
        }).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(120));
    }
    peer.set_interaction_enabled(false).unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let state = read_json("state.json");
        if state["clicks"].as_u64() == Some(before + 1) {
            println!("Godot native source effect: clicks={before}->{} downs={} ups={}",
                before + 1, state["downs"], state["ups"]);
            break;
        }
        assert!(std::time::Instant::now() < deadline, "Godot did not activate its button: {state}");
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    peer.restore().unwrap();
    assert_eq!(peer.source_window_state(), "visible");
    assert!(peer.visibility.lock().unwrap().snapshot.is_none());
    println!("Same-window visibility: shared snapshot, idempotent close-one, surviving input, last-owner restore passed");
}
