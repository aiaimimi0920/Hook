mod live_capture_timing_tests {
    use super::*;

    #[test]
    fn admission_cumulative_snapshot_is_replaced_not_added_again() {
        let state = state();
        for granted in [2, 3] {
            let mut timing = LiveCaptureIteration::new(&state);
            timing.admission(crate::live_gpu::work_budget::CpuAdmissionSnapshot {
                granted,
                policy_denied: 1,
                lock_unavailable: 0,
            });
        }
        let snapshot = state.lock().unwrap().snapshot(0).capture_timing.unwrap();
        assert_eq!(snapshot.cpu_admission.unwrap().granted, 3);
    }

    fn state() -> Mutex<LiveCaptureSessionState> {
        Mutex::new(LiveCaptureSessionState::starting(
            &LiveCaptureWorkerConfig {
                session_id: "timing-fixture".to_owned(),
                window_id: None,
                expected_process_id: None,
                source_title: None,
                x: 0,
                y: 0,
                width: 64,
                height: 32,
                window_region: None,
                target_fps: 30,
                display_metrics: CaptureWindowMetrics {
                    physical_origin_x: 0.0,
                    physical_origin_y: 0.0,
                    scale_factor: 1.0,
                    logical_width: 64.0,
                    logical_height: 32.0,
                },
                source_window: None,
            },
        ))
    }

    #[test]
    fn handoff_distinguishes_empty_failure_and_success_without_holding_state() {
        let state = state();
        assert!(state.lock().unwrap().snapshot(0).capture_timing.is_none());
        {
            let mut timing = LiveCaptureIteration::new(&state);
            assert_eq!(timing.handoff(|_| Ok::<_, &str>(None::<u8>)), Ok(None));
            assert_eq!(
                timing.handoff(|_| Err::<Option<u8>, _>("handoff-error")),
                Err("handoff-error")
            );
            assert_eq!(
                timing.handoff(|_| {
                    assert!(state.try_lock().is_ok());
                    Ok::<_, &str>(Some(9))
                }),
                Ok(Some(9))
            );
        }
        let snapshot = state.lock().unwrap().snapshot(0);
        let timing = snapshot.capture_timing.unwrap();
        assert_eq!(
            (
                timing.handoff.attempts,
                timing.handoff.succeeded,
                timing.handoff.failed,
                timing.handoff.empty
            ),
            (3, 1, 1, 1)
        );
        assert_eq!(timing.jpeg_encode.attempts, 0);
    }

    #[test]
    fn early_encode_failure_preserves_error_and_never_invents_stored_frame() {
        let state = state();
        let work = || -> Result<(), &'static str> {
            let mut timing = LiveCaptureIteration::new(&state);
            timing.handoff(|_| Ok::<_, &str>(Some(1)))?;
            timing.result(LiveCaptureTimingStage::JpegEncode, || Err("encode-error"))?;
            timing.result(LiveCaptureTimingStage::FrameStore, || Ok(()))
        };
        assert_eq!(work(), Err("encode-error"));
        let snapshot = state.lock().unwrap().snapshot(0);
        let timing = snapshot.capture_timing.unwrap();
        assert_eq!(timing.jpeg_encode.failed, 1);
        assert_eq!(timing.frame_store.attempts, 0);
        assert_eq!(snapshot.frame_id, 0);
    }

    #[test]
    fn returned_payload_keeps_its_owner_and_counters_survive_recovery() {
        struct Payload(Arc<AtomicBool>);
        impl Drop for Payload {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let state = state();
        let dropped = Arc::new(AtomicBool::new(false));
        let payload = {
            let mut timing = LiveCaptureIteration::new(&state);
            let value = timing
                .handoff(|_| Ok::<_, ()>(Some(Payload(Arc::clone(&dropped)))))
                .unwrap()
                .unwrap();
            assert!(timing
                .result(LiveCaptureTimingStage::JpegEncode, || Ok::<_, ()>(()))
                .is_ok());
            assert_eq!(
                timing.result(LiveCaptureTimingStage::FrameStore, || Err::<(), _>(
                    "store-error"
                )),
                Err("store-error")
            );
            value
        };
        assert!(!dropped.load(Ordering::SeqCst));
        drop(payload);
        assert!(dropped.load(Ordering::SeqCst));
        let mut guard = state.lock().unwrap();
        guard.mark_recovering(2, "fixture", "fixture");
        let snapshot = guard.snapshot(0);
        let value = serde_json::to_value(snapshot.capture_timing.unwrap()).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 5);
        assert_eq!(value["frameStore"]["failed"], 1);
        assert_eq!(value["jpegEncode"]["succeeded"], 1);
        assert_eq!(value["handoff"].as_object().unwrap().len(), 6);
    }

    #[test]
    fn readback_failure_merges_on_early_return_without_inventing_later_work() {
        let state = state();
        let work = || -> Result<(), &'static str> {
            let mut timing = LiveCaptureIteration::new(&state);
            timing.handoff(|readback| {
                readback.staging_copy(|| Err::<(), _>("copy-error"))?;
                readback.map_rgb(|| Ok::<_, &str>(Some(1)))
            })?;
            Ok(())
        };
        assert_eq!(work(), Err("copy-error"));
        let timing = state.lock().unwrap().snapshot(0).capture_timing.unwrap();
        assert_eq!(timing.handoff.failed, 1);
        assert_eq!(timing.readback.staging_copy.failed, 1);
        assert_eq!(timing.readback.map_rgb.attempts, 0);
        assert_eq!(timing.jpeg_encode.attempts, 0);
    }

    #[test]
    fn readback_substages_preserve_values_and_accumulate_without_state_lock() {
        let state = state();
        for fail in [false, true] {
            let mut timing = LiveCaptureIteration::new(&state);
            let result = timing.handoff(|readback| {
                let value = readback.staging_copy(|| {
                    assert!(state.try_lock().is_ok());
                    Ok::<_, &str>(7)
                })?;
                readback.map_rgb(|| {
                    assert!(state.try_lock().is_ok());
                    if fail { Err("map-error") } else { Ok(Some(value)) }
                })
            });
            assert_eq!(result, if fail { Err("map-error") } else { Ok(Some(7)) });
        }
        let timing = state.lock().unwrap().snapshot(0).capture_timing.unwrap();
        assert_eq!(timing.readback.staging_copy.succeeded, 2);
        assert_eq!(timing.readback.map_rgb.succeeded, 1);
        assert_eq!(timing.readback.map_rgb.failed, 1);
        assert_eq!(timing.readback.map_rgb.empty, 0);
        let json = serde_json::to_value(timing.readback).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 2);
        assert_eq!(json["stagingCopy"].as_object().unwrap().len(), 6);
    }
}
