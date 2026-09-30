// Dedicated MTA UIA owner. Event handlers only invalidate a bounded, re-resolved scan.
#[cfg(target_os = "windows")]
#[derive(Clone)]
struct UiaObservationSample {
    observation_id: String,
    locator: LiveRelayElementLocator,
    value: Result<serde_json::Value, String>,
    fingerprint: Option<String>,
}

#[cfg(target_os = "windows")]
struct UiaObservationScan {
    capabilities: Vec<String>,
    samples: Vec<UiaObservationSample>,
}

#[cfg(target_os = "windows")]
struct UiaObservationTrack {
    sequence: u64,
    state: LiveRelayObservationState,
    fingerprint: Option<String>,
    observed_at_ms: u64,
    stable_since_ms: Option<u64>,
    locator: LiveRelayElementLocator,
    reason: Option<String>,
}

#[cfg(target_os = "windows")]
struct LiveUiaStructureInvalidator(Arc<AtomicBool>);

#[cfg(target_os = "windows")]
impl uiautomation::events::CustomStructureChangedEventHandler for LiveUiaStructureInvalidator {
    fn handle(
        &self,
        _sender: &uiautomation::UIElement,
        _change: uiautomation::types::StructureChangeType,
        _runtime_id: Option<&[i32]>,
    ) -> uiautomation::Result<()> {
        self.0.store(true, Ordering::Release);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
struct LiveUiaContext {
    automation: Option<UIAutomation>,
}

#[cfg(target_os = "windows")]
impl LiveUiaContext {
    fn new() -> Result<Self, String> {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

        if unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_err() {
            return Err("uia_initialization_failed".to_owned());
        }
        match UIAutomation::new_direct() {
            Ok(automation) => Ok(Self {
                automation: Some(automation),
            }),
            Err(_) => {
                unsafe { windows::Win32::System::Com::CoUninitialize() };
                Err("uia_initialization_failed".to_owned())
            }
        }
    }

    fn automation(&self) -> &UIAutomation {
        self.automation
            .as_ref()
            .expect("live UIA context owns automation until drop")
    }
}

#[cfg(target_os = "windows")]
impl Drop for LiveUiaContext {
    fn drop(&mut self) {
        self.automation.take();
        unsafe { windows::Win32::System::Com::CoUninitialize() };
    }
}

fn probe_live_observation_capabilities(
    capture: &LiveCaptureSession,
) -> LiveObservationCapabilityProbe {
    #[cfg(target_os = "windows")]
    {
        let Ok((hwnd, process_id)) = live_observation_window_identity(capture) else {
            return LiveObservationCapabilityProbe::unsupported("uia_requires_window_source");
        };
        match with_live_uia(|automation| scan_live_uia(automation, hwnd, process_id)) {
            Ok(scan) => LiveObservationCapabilityProbe {
                capabilities: scan.capabilities,
                semantic_control_count: scan.samples.len(),
                unavailable_reason: None,
            },
            Err(reason) => LiveObservationCapabilityProbe::unsupported(&reason),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = capture;
        LiveObservationCapabilityProbe::unsupported("uia_requires_windows")
    }
}

fn spawn_live_observation_worker(
    relay: Arc<LiveRelaySession>,
) -> Result<std::thread::JoinHandle<()>, String> {
    #[cfg(target_os = "windows")]
    {
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let worker_relay = Arc::clone(&relay);
        let join = std::thread::Builder::new()
            .name("hook-live-uia-observer".to_owned())
            .spawn(move || run_live_observation_worker(worker_relay, ready_tx))
            .map_err(|error| format!("spawn live UIA observation worker: {error}"))?;
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(join),
            Ok(Err(error)) => {
                let _ = join.join();
                Err(error)
            }
            Err(_) => {
                relay.stop.store(true, Ordering::SeqCst);
                let _ = join.join();
                Err("live UIA observation worker did not initialize".to_owned())
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = relay;
        Err("live UIA observation requires Windows 11".to_owned())
    }
}

#[cfg(target_os = "windows")]
fn run_live_observation_worker(
    relay: Arc<LiveRelaySession>,
    ready: mpsc::SyncSender<Result<(), String>>,
) {
    let result = match live_observation_window_identity(
        relay
            .capture
            .as_deref()
            .expect("source observation relay owns capture"),
    ) {
        Ok((hwnd, process_id)) => match LiveUiaContext::new() {
            Ok(context) => {
                let failure = ready.clone();
                let result =
                    run_live_uia_event_loop(&relay, context.automation(), hwnd, process_id, ready);
                if let Err(error) = &result {
                    let _ = failure.try_send(Err(error.clone()));
                }
                result
            }
            Err(_) => {
                let error = "uia_initialization_failed".to_owned();
                let _ = ready.send(Err(error.clone()));
                Err(error)
            }
        },
        Err(_) => {
            let error = "uia_source_window_unavailable".to_owned();
            let _ = ready.send(Err(error.clone()));
            Err(error)
        }
    };
    if let Err(error) = &result {
        mark_live_observation_failure(&relay, error);
    }
    append_runtime_log_line(&format!(
        "live_observation_worker_stopped :: relay={} result_ok={}",
        relay.relay_id,
        result.is_ok()
    ));
}

#[cfg(target_os = "windows")]
fn run_live_uia_event_loop(
    relay: &LiveRelaySession,
    automation: &UIAutomation,
    hwnd: isize,
    process_id: u32,
    ready: mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    use uiautomation::events::UIStructureChangeEventHandler;
    use uiautomation::types::{Handle, TreeScope};

    let root = automation
        .element_from_handle(Handle::from(hwnd))
        .map_err(|_| "uia_root_unavailable".to_owned())?;
    let publish_client = live_relay_observation_client(relay)?;
    let dirty = Arc::new(AtomicBool::new(true));
    let structure_handler: UIStructureChangeEventHandler =
        LiveUiaStructureInvalidator(Arc::clone(&dirty)).into();
    automation
        .add_structure_changed_event_handler(&root, TreeScope::Subtree, None, &structure_handler)
        .map_err(|_| "uia_event_subscription_failed".to_owned())?;
    // Property callbacks expose provider-owned VARIANTs. Periodic re-resolution reads them safely.
    let _ = ready.send(Ok(()));

    let mut tracks = std::collections::BTreeMap::new();
    let mut next_periodic = Instant::now();
    let loop_result = loop {
        if relay.stop.load(Ordering::SeqCst) {
            break Ok(());
        }
        if dirty.swap(false, Ordering::AcqRel) || Instant::now() >= next_periodic {
            std::thread::sleep(Duration::from_millis(120));
            let scan_result = match scan_live_uia(automation, hwnd, process_id) {
                Ok(scan) => apply_live_uia_scan(relay, &publish_client, &mut tracks, scan),
                Err(_) => mark_live_uia_scan_error(relay, &publish_client, &mut tracks),
            };
            if scan_result.is_err() {
                mark_live_observation_failure(relay, "observation_publish_recovering");
                dirty.store(true, Ordering::Release);
                next_periodic = Instant::now() + Duration::from_millis(250);
            } else {
                next_periodic = Instant::now() + Duration::from_secs(1);
            }
        }
        std::thread::sleep(Duration::from_millis(40));
    };
    let structure_removed = automation
        .remove_structure_changed_event_handler(&root, &structure_handler)
        .is_ok();
    if loop_result.is_ok() && !structure_removed {
        Err("uia_event_cleanup_failed".to_owned())
    } else {
        loop_result
    }
}

#[cfg(target_os = "windows")]
fn live_observation_window_identity(capture: &LiveCaptureSession) -> Result<(isize, u32), String> {
    let source = capture
        .source_window
        .as_ref()
        .ok_or_else(|| "uia_requires_window_source".to_owned())?
        .lock()
        .map_err(|_| "uia_source_window_unavailable".to_owned())?;
    let hwnd = source.validate_identity()?;
    Ok((hwnd.0 as isize, source.process_id))
}

#[cfg(target_os = "windows")]
fn with_live_uia<T>(
    operation: impl FnOnce(&UIAutomation) -> Result<T, String>,
) -> Result<T, String> {
    let context = LiveUiaContext::new()?;
    operation(context.automation())
}

#[cfg(target_os = "windows")]
fn scan_live_uia(
    automation: &UIAutomation,
    hwnd: isize,
    process_id: u32,
) -> Result<UiaObservationScan, String> {
    use uiautomation::types::Handle;

    let root = automation
        .element_from_handle(Handle::from(hwnd))
        .map_err(|_| "uia_root_unavailable".to_owned())?;
    let root_rect = root
        .get_bounding_rectangle()
        .map_err(|_| "uia_root_bounds_unavailable".to_owned())?;
    let walker = automation
        .get_control_view_walker()
        .map_err(|_| "uia_tree_unavailable".to_owned())?;
    let mut pending = vec![(root, Vec::<String>::new())];
    let mut samples = std::collections::BTreeMap::new();
    let mut capabilities = std::collections::BTreeSet::from(["uia_tree".to_owned()]);
    let mut visited = 0usize;
    while let Some((element, ancestors)) = pending.pop() {
        if visited >= LIVE_OBSERVATION_LIMIT {
            break;
        }
        visited += 1;
        let label = live_uia_ancestor_label(&element);
        let mut child_ancestors = ancestors.clone();
        if let Some(label) = label {
            child_ancestors.push(label);
            if child_ancestors.len() > 16 {
                child_ancestors.remove(0);
            }
        }
        if let Some(children) = walker.get_children(&element) {
            pending.extend(
                children
                    .into_iter()
                    .rev()
                    .map(|child| (child, child_ancestors.clone())),
            );
        }
        if element.get_process_id().ok() != Some(process_id) {
            continue;
        }
        if let Some(sample) =
            sample_live_uia_element(&element, ancestors, root_rect, &mut capabilities)
        {
            use std::collections::btree_map::Entry;

            match samples.entry(sample.observation_id.clone()) {
                Entry::Vacant(entry) => {
                    entry.insert(sample);
                }
                Entry::Occupied(mut entry) => {
                    let ambiguous = entry.get_mut();
                    ambiguous.value = Err("uia_locator_ambiguous".to_owned());
                    ambiguous.fingerprint = None;
                }
            }
        }
    }
    Ok(UiaObservationScan {
        capabilities: capabilities.into_iter().collect(),
        samples: samples.into_values().collect(),
    })
}
