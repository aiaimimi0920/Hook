use super::*;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use windows::Win32::Foundation::HWND;

const SOURCE_TOKEN: &str = "phase4-source-session-token";
const VIEWER_A_TOKEN: &str = "phase4-viewer-a-session-token";
const VIEWER_B_TOKEN: &str = "phase4-viewer-b-session-token";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PhaseFourDaemonReady {
    base_url: String,
    surface_instance_id: String,
    source_attachment_id: String,
    viewer_a_attachment_id: String,
    viewer_b_attachment_id: String,
    source_device_id: String,
    viewer_a_device_id: String,
    viewer_b_device_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PhaseFourSessionReady {
    live_session_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PhaseFourEndpointReport {
    schema_version: u8,
    role: String,
    duration_ms: u128,
    frames: u64,
    distinct_frames: usize,
    first_frame_id: Option<u64>,
    last_frame_id: u64,
    reconnect_count: u64,
    reconnect_duration_ms: Option<u128>,
    strictly_increasing: bool,
    maximum_latency_ms: u64,
    p95_latency_ms: u64,
    controller_conflict_observed: bool,
    controller_transfer_observed: bool,
    input_events_sent: u64,
    input_delivered: bool,
    source_reclaim_observed: bool,
    interaction_released: bool,
    observation: PhaseSixObservationEvidence,
    event_reasons: Vec<String>,
    errors: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PhaseFiveFixtureState {
    clicks: u64,
    key_edges: u64,
    drag_edges: u64,
    track_value: i32,
}

#[test]
#[ignore = "started by Invoke-LiveScreenshotPhaseFourProbe.ps1"]
fn phase_four_live_relay_source_endpoint() {
    let ready = phase_four_daemon_ready();
    let session_ready_path = required_phase_four_path("HOOK_LIVE_PHASE4_SESSION_READY");
    let output = required_phase_four_path("HOOK_LIVE_PHASE4_OUTPUT");
    let stop = required_phase_four_path("HOOK_LIVE_PHASE4_STOP");
    let hwnd = phase_four_hwnd();
    let duration = phase_four_duration();
    let phase_five = phase_five_enabled();
    let phase_six = phase_six_enabled();
    let worker_config = phase_four_capture_config(hwnd, phase_five || phase_six);
    let source_window = worker_config.source_window.clone();
    let state = Arc::new(Mutex::new(LiveCaptureSessionState::starting(
        &worker_config,
    )));
    let frames = Arc::new(Mutex::new(LiveCaptureFrameBuffer::new()));
    let dropped = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let (stop_tx, stop_rx) = mpsc::sync_channel(1);
    let worker = crate::screenshot::spawn_live_capture_worker(
        worker_config,
        Arc::clone(&state),
        Arc::clone(&frames),
        Arc::clone(&dropped),
        stop_rx,
    )
    .expect("spawn Phase 4 WGC source");
    let capture = Arc::new(LiveCaptureSession {
        state: Arc::clone(&state),
        frames,
        dropped_frames: Arc::clone(&dropped),
        stop_tx: Mutex::new(Some(stop_tx)),
        join: Mutex::new(Some(worker)),
        source_window,
    });
    assert!(wait_for_capture_streaming(&state, Duration::from_secs(15)));

    let authorization = crate::device_session::DeviceSessionAuthorization::device_for_test(
        &ready.source_device_id,
        SOURCE_TOKEN,
    );
    let capture_status = snapshot_live_capture_state(&state, &dropped).expect("capture status");
    let observation_probe = if phase_six {
        probe_live_observation_capabilities(&capture)
    } else {
        LiveObservationCapabilityProbe::unsupported("phase6_disabled")
    };
    let live_session_id = format!("live:phase4:{}", uuid::Uuid::new_v4());
    let request = LiveRelayPublishRequest {
        capture_session_id: capture_status.session_id.clone(),
        surface_instance_id: ready.surface_instance_id.clone(),
        source_attachment_id: ready.source_attachment_id.clone(),
        source_hook_id: "hook-node:phase4-source".to_owned(),
        live_session_id: Some(live_session_id.clone()),
    };
    let body = build_live_session_create_body(
        &request,
        &capture_status,
        &authorization.device_id,
        &live_session_id,
        &observation_probe.capabilities,
    );
    let runtime = tokio::runtime::Runtime::new().expect("Phase 4 source runtime");
    let response = runtime
        .block_on(create_live_session_http(
            &ready.base_url,
            &authorization,
            &body,
        ))
        .expect("create Phase 4 live session");
    let epoch =
        validate_live_session_snapshot(&response, &live_session_id).expect("valid live session");
    let relay = phase_four_relay(
        LiveRelayRole::Source,
        &ready.base_url,
        &live_session_id,
        epoch,
        &ready.surface_instance_id,
        &ready.source_attachment_id,
        authorization,
        Some(Arc::clone(&capture)),
        observation_probe.capabilities.clone(),
        observation_probe.unavailable_reason.clone(),
    );
    let relay_worker = spawn_live_relay_source_worker(Arc::clone(&relay), Arc::clone(&capture))
        .expect("spawn Phase 4 source relay");
    *relay.join.lock().expect("source relay join") = Some(relay_worker);
    if phase_five {
        let control = spawn_live_relay_control_worker(Arc::clone(&relay))
            .expect("spawn Phase 5 source control worker");
        *relay.control_join.lock().expect("source control join") = Some(control);
    }
    if phase_six {
        let observation = spawn_live_observation_worker(Arc::clone(&relay))
            .expect("spawn Phase 6 source observation worker");
        *relay
            .observation_join
            .lock()
            .expect("source observation join") = Some(observation);
    }
    write_phase_four_json(
        &session_ready_path,
        &serde_json::json!({ "liveSessionId": live_session_id }),
    );

    let started = Instant::now();
    let mut phase_six_continuity = PhaseSixSourceContinuity::default();
    let mut phase_six_errors = Vec::new();
    while !stop.exists() && started.elapsed() < duration + Duration::from_secs(45) {
        if phase_five {
            phase_five_source_tick(
                &relay,
                &required_phase_four_path("HOOK_LIVE_PHASE4_COORDINATION"),
            );
        }
        if phase_six && phase_six_errors.is_empty() {
            if let Err(error) =
                phase_six_source_tick(&relay, started.elapsed(), &mut phase_six_continuity)
            {
                phase_six_errors.push(error);
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let snapshot = relay.snapshot().expect("source relay snapshot");
    let mut errors = phase_six_errors;
    if snapshot.received_frames < 3 {
        errors.push("source published fewer than three frames".to_owned());
    }
    let (fixture, source_reclaim_observed, interaction_released) =
        phase_five_source_outcome(&relay);
    let input_delivered = !phase_five
        || (fixture.clicks >= 1
            && fixture.key_edges >= 2
            && fixture.drag_edges >= 5
            && fixture.track_value != 40);
    if phase_five && !input_delivered {
        errors.push(format!(
            "Phase 5 fixture did not receive every input edge: {fixture:?}"
        ));
    }
    if phase_five && (!source_reclaim_observed || !interaction_released) {
        errors.push("Phase 5 source did not reclaim and release remote input".to_owned());
    }
    let input_events_sent = if phase_five
        && required_phase_four_path("HOOK_LIVE_PHASE4_COORDINATION")
            .join("phase5-input-sent")
            .exists()
    {
        10
    } else {
        0
    };
    let mut observation = phase_six_observation_evidence(phase_six, &snapshot);
    observation.logical_hide_correct = phase_six_continuity.logical_hide_correct;
    observation.hidden_update_observed = phase_six_continuity.hidden_update_observed;
    observation.hidden_observation_count = phase_six_continuity.hidden_observation_count;
    observation.hidden_error_count = phase_six_continuity.hidden_error_count;
    observation.hidden_unexpected_error_count = phase_six_continuity.hidden_unexpected_error_count;
    observation.hidden_errors = phase_six_continuity.hidden_errors;
    observation.locator_continuity = phase_six_continuity.locator_continuity;
    if phase_six && (!observation.logical_hide_correct || !observation.locator_continuity) {
        errors.push("Phase 6 observation continuity did not survive logical hide".to_owned());
    }
    let mut report = PhaseFourEndpointReport {
        schema_version: 1,
        role: "source".to_owned(),
        duration_ms: started.elapsed().as_millis(),
        frames: snapshot.received_frames,
        distinct_frames: 0,
        first_frame_id: None,
        last_frame_id: snapshot.last_frame_id,
        reconnect_count: snapshot.reconnect_count,
        reconnect_duration_ms: None,
        strictly_increasing: true,
        maximum_latency_ms: 0,
        p95_latency_ms: 0,
        controller_conflict_observed: false,
        controller_transfer_observed: false,
        input_events_sent,
        input_delivered,
        source_reclaim_observed,
        interaction_released,
        observation,
        event_reasons: Vec::new(),
        errors,
    };
    report.observation.worker_stopped_cleanly = relay.stop_and_join().is_ok();
    if phase_six && !report.observation.worker_stopped_cleanly {
        report
            .errors
            .push("Phase 6 observation worker did not stop cleanly".to_owned());
    }
    let _ = close_live_session_blocking(&relay);
    capture.stop_and_join().expect("stop Phase 4 WGC source");
    write_phase_four_json(&output, &report);
    assert!(report.errors.is_empty(), "{}", report.errors.join("; "));
}

#[test]
#[ignore = "started by Invoke-LiveScreenshotPhaseFourProbe.ps1"]
fn phase_four_live_relay_viewer_endpoint() {
    let ready = phase_four_daemon_ready();
    let viewer = std::env::var("HOOK_LIVE_PHASE4_VIEWER").expect("viewer role is required");
    let session_ready_path = required_phase_four_path("HOOK_LIVE_PHASE4_SESSION_READY");
    let output = required_phase_four_path("HOOK_LIVE_PHASE4_OUTPUT");
    let coordination = required_phase_four_path("HOOK_LIVE_PHASE4_COORDINATION");
    let duration = phase_four_duration();
    wait_for_path(&session_ready_path, Duration::from_secs(45));
    let session_ready: PhaseFourSessionReady = read_phase_four_json(&session_ready_path);
    let (device_id, token, attachment_id) = if viewer == "A" {
        (
            ready.viewer_a_device_id.as_str(),
            VIEWER_A_TOKEN,
            ready.viewer_a_attachment_id.as_str(),
        )
    } else {
        (
            ready.viewer_b_device_id.as_str(),
            VIEWER_B_TOKEN,
            ready.viewer_b_attachment_id.as_str(),
        )
    };
    let authorization =
        crate::device_session::DeviceSessionAuthorization::device_for_test(device_id, token);
    let runtime = tokio::runtime::Runtime::new().expect("Phase 4 viewer runtime");
    let discovery = runtime
        .block_on(discover_live_sessions_http(&ready.base_url, &authorization))
        .expect("discover Phase 4 live session");
    let preview = find_live_session_snapshot(&discovery, &session_ready.live_session_id)
        .expect("find Phase 4 live session");
    let epoch = validate_live_session_snapshot(preview, &session_ready.live_session_id)
        .expect("valid Phase 4 session");
    let join_request = LiveRelayJoinRequest {
        live_session_id: session_ready.live_session_id.clone(),
        surface_instance_id: ready.surface_instance_id.clone(),
        attachment_id: attachment_id.to_owned(),
    };
    let remote = runtime
        .block_on(attach_live_viewer_http(
            &ready.base_url,
            &authorization,
            &join_request,
            epoch,
        ))
        .expect("attach Phase 4 viewer");
    let epoch = validate_live_session_snapshot(&remote, &session_ready.live_session_id)
        .expect("valid attached Phase 4 session");
    let observation_capabilities =
        parse_live_observation_capabilities(&remote).expect("valid observation capabilities");
    let relay = phase_four_relay(
        LiveRelayRole::Viewer,
        &ready.base_url,
        &session_ready.live_session_id,
        epoch,
        &ready.surface_instance_id,
        attachment_id,
        authorization,
        None,
        observation_capabilities.clone(),
        observation_capabilities
            .is_empty()
            .then(|| "source_did_not_advertise_observation".to_owned()),
    );
    let relay_worker =
        spawn_live_relay_viewer_worker(Arc::clone(&relay)).expect("spawn Phase 4 viewer relay");
    *relay.join.lock().expect("viewer relay join") = Some(relay_worker);
    if phase_five_enabled() || phase_six_enabled() {
        let control = spawn_live_relay_control_worker(Arc::clone(&relay))
            .expect("spawn Phase 5 viewer control worker");
        *relay.control_join.lock().expect("viewer control join") = Some(control);
    }
    let report = exercise_phase_four_viewer(&viewer, &relay, &coordination, duration);
    relay.stop_and_join().expect("stop Phase 4 viewer relay");
    write_phase_four_json(&output, &report);
    assert!(report.errors.is_empty(), "{}", report.errors.join("; "));
}
