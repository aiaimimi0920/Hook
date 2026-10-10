mod live_relay_source_timing_tests {
    use super::*;

    #[test]
    fn durations_and_outcomes_merge_without_history() {
        let mut first = LiveStageTiming::default();
        first.record(Duration::from_micros(4), LiveTimingOutcome::Succeeded);
        first.record(Duration::from_micros(9), LiveTimingOutcome::Failed);
        let mut next = LiveStageTiming::default();
        next.record(Duration::from_micros(2), LiveTimingOutcome::Empty);
        first.merge(&next);
        assert_eq!(
            (first.attempts, first.succeeded, first.failed, first.empty),
            (3, 1, 1, 1)
        );
        assert_eq!((first.total_micros, first.max_micros), (15, 9));
    }

    #[test]
    fn totals_saturate_without_wrapping_or_panicking() {
        let mut timing = LiveStageTiming {
            attempts: u64::MAX,
            total_micros: u64::MAX,
            ..Default::default()
        };
        timing.record(Duration::MAX, LiveTimingOutcome::Succeeded);
        timing.merge(&timing.clone());
        assert_eq!(timing.attempts, u64::MAX);
        assert_eq!(timing.total_micros, u64::MAX);
        assert_eq!(timing.max_micros, u64::MAX);
    }

    #[test]
    fn iteration_keeps_work_results_and_flushes_early_error() {
        let state = Mutex::new(LiveRelayRuntimeState::starting(1, Vec::new(), None));
        let work = || -> Result<(), &'static str> {
            let mut timing = LiveRelaySourceIteration::new(&state);
            assert!(state.try_lock().is_ok());
            assert_eq!(timing.latest(|| None::<u8>), None);
            assert_eq!(
                timing.latest(|| {
                    assert!(state.try_lock().is_ok());
                    Some(7)
                }),
                Some(7)
            );
            timing.result(LiveRelayTimingStage::Adaptation, || Err("original-error"))?;
            Ok(())
        };
        assert_eq!(work(), Err("original-error"));
        let guard = state.lock().unwrap();
        let timing = guard.source_timing.as_ref().unwrap();
        assert_eq!(
            (timing.latest_frame.attempts, timing.latest_frame.empty),
            (2, 1)
        );
        assert_eq!(timing.adaptation.failed, 1);
        assert_eq!(timing.socket_send.attempts, 0);
    }

    #[test]
    fn successful_and_failed_socket_work_are_separate_from_acknowledgement() {
        let state = Mutex::new(LiveRelayRuntimeState::starting(1, Vec::new(), None));
        for result in [Ok(12), Err("send-failed")] {
            let mut timing = LiveRelaySourceIteration::new(&state);
            assert_eq!(
                timing.result(LiveRelayTimingStage::SocketSend, || result),
                result
            );
            assert_eq!(
                timing.result(LiveRelayTimingStage::SocketService, || Ok::<_, ()>(3)),
                Ok(3)
            );
        }
        let guard = state.lock().unwrap();
        let timing = guard.source_timing.as_ref().unwrap();
        assert_eq!(
            (timing.socket_send.succeeded, timing.socket_send.failed),
            (1, 1)
        );
        assert_eq!(timing.socket_service.succeeded, 2);
        assert_eq!(guard.received_frames, 0);
        let json = serde_json::to_value(timing).unwrap();
        assert_eq!(json.as_object().unwrap().len(), 4);
        assert_eq!(json["socketSend"]["failed"], 1);
        assert_eq!(json["socketSend"].as_object().unwrap().len(), 6);
    }
}
