// Owns Loom action routing from Tauri commands to Art and Surface operations.
const MAX_CONCURRENT_LOOM_ART_WORKERS: usize = 2;
const MAX_CONCURRENT_LOOM_CONTROL_WORKERS: usize = 8;
static ACTIVE_LOOM_ART_WORKERS: AtomicUsize = AtomicUsize::new(0);
static ACTIVE_LOOM_CONTROL_WORKERS: AtomicUsize = AtomicUsize::new(0);

fn try_reserve_loom_worker_slot(counter: &AtomicUsize, limit: usize) -> bool {
    let mut active = counter.load(Ordering::Acquire);
    loop {
        if active >= limit {
            return false;
        }
        match counter.compare_exchange_weak(
            active,
            active + 1,
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => return true,
            Err(current) => active = current,
        }
    }
}

struct LoomWorkerPermit {
    counter: &'static AtomicUsize,
}

impl Drop for LoomWorkerPermit {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::AcqRel);
    }
}

fn spawn_bounded_loom_worker(
    counter: &'static AtomicUsize,
    limit: usize,
    label: &'static str,
    task: impl FnOnce() + Send + 'static,
) -> Result<(), String> {
    if !try_reserve_loom_worker_slot(counter, limit) {
        return Err(format!("Loom {label} worker limit reached; retry later"));
    }
    let permit = LoomWorkerPermit { counter };
    thread::Builder::new()
        .name(format!("otter-loom-{label}"))
        .spawn(move || {
            let _permit = permit;
            task();
        })
        .map(|_| ())
        .map_err(|error| format!("start Loom {label} worker: {error}"))
}

fn validate_loom_action_payload(action: &LoomOtterAction) -> Result<(), String> {
    match action {
        LoomOtterAction::ExecuteArt {
            node_id,
            request_id,
            art_id,
            inputs,
            parameters,
            disabled_parameters,
            ..
        } => {
            validate_protocol_field(node_id, "node id")?;
            validate_protocol_field(request_id, "request id")?;
            validate_protocol_field(art_id, "Art id")?;
            validate_otter_art_input_sources(inputs)?;
            for name in inputs.keys() {
                validate_protocol_field(name, "input port id")?;
            }
            validate_json_payload_size(parameters, "Art parameters", MAX_LOOM_JSON_RESPONSE_BYTES)?;
            if disabled_parameters.len() > 512 {
                return Err("Art disabled-parameter count exceeds the Otter budget".to_owned());
            }
            for parameter in disabled_parameters {
                validate_protocol_field(parameter, "disabled parameter id")?;
            }
        }
        LoomOtterAction::CancelArt {
            node_id,
            request_id,
            ..
        } => {
            validate_protocol_field(node_id, "node id")?;
            validate_protocol_field(request_id, "request id")?;
        }
        LoomOtterAction::UpdateWorkflowNode {
            request_id,
            workflow_id,
            node_id,
            parameter_id,
            value,
        } => {
            validate_protocol_field(request_id, "request id")?;
            validate_protocol_field(workflow_id, "workflow id")?;
            validate_protocol_field(node_id, "node id")?;
            validate_protocol_field(parameter_id, "parameter id")?;
            validate_json_payload_size(value, "workflow value", MAX_LOOM_JSON_RESPONSE_BYTES)?;
        }
        LoomOtterAction::SyncWorkflow {
            workflow_id,
            snapshot,
        } => {
            validate_protocol_field(workflow_id, "workflow id")?;
            validate_json_payload_size(snapshot, "workflow snapshot", MAX_LOOM_JSON_RESPONSE_BYTES)?;
        }
        LoomOtterAction::SurfaceEvent { event }
        | LoomOtterAction::SurfaceLifecycle { event } => {
            validate_json_payload_size(event, "Surface event", MAX_LOOM_JSON_RESPONSE_BYTES)?;
        }
        LoomOtterAction::SurfaceConfirmation { decision } => {
            validate_json_payload_size(decision, "Surface decision", MAX_LOOM_JSON_RESPONSE_BYTES)?;
        }
        LoomOtterAction::SurfaceCancel { request } => {
            validate_json_payload_size(request, "Surface cancellation", MAX_LOOM_JSON_RESPONSE_BYTES)?;
        }
        LoomOtterAction::SurfaceResource { lease } => {
            validate_json_payload_size(lease, "Surface resource lease", 64 * 1024)?;
        }
        LoomOtterAction::SurfaceAttach {
            art_id,
            hook_node_id,
            capabilities,
            ..
        } => {
            validate_protocol_field(art_id, "Art id")?;
            validate_protocol_field(hook_node_id, "Otter node id")?;
            validate_json_payload_size(
                capabilities,
                "Surface capabilities",
                MAX_LOOM_JSON_RESPONSE_BYTES,
            )?;
        }
        LoomOtterAction::SurfaceRemount {
            instance_id,
            attachment_id,
            hook_node_id,
        } => {
            validate_surface_identifier(instance_id, "instance id")?;
            validate_surface_identifier(attachment_id, "attachment id")?;
            validate_surface_identifier(hook_node_id, "Otter node id")?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn loom_otter_dispatch_action(
    app: AppHandle,
    state: tauri::State<'_, LoomOtter>,
    action: LoomOtterAction,
) -> Result<(), String> {
    validate_loom_action_payload(&action)?;
    // Log action type without full data
    match &action {
        LoomOtterAction::ExecuteArt {
            node_id,
            request_id,
            art_id,
            inputs,
            ..
        } => {
            crate::append_runtime_log_line(&format!(
                "loom_otter_dispatch_execute_art :: node_id={} request_id={} art_id={} input_keys={}",
                diagnostic_field(node_id),
                diagnostic_field(request_id),
                diagnostic_field(art_id),
                {
                    let mut keys = inputs.keys().map(|key| diagnostic_field(key)).collect::<Vec<_>>();
                    keys.sort();
                    if keys.is_empty() { "none".to_string() } else { keys.join(",") }
                }
            ));
        }
        LoomOtterAction::CancelArt {
            node_id,
            request_id,
            generation,
        } => {
            crate::append_runtime_log_line(&format!(
                "loom_otter_dispatch_cancel_art :: node_id={} request_id={} generation={generation}",
                diagnostic_field(node_id),
                diagnostic_field(request_id)
            ));
        }
        LoomOtterAction::UpdateWorkflowNode {
            workflow_id,
            node_id,
            parameter_id,
            ..
        } => {
            crate::append_runtime_log_line(&format!(
                "loom_otter_dispatch_workflow_node_update :: workflow_id={} node_id={} parameter_id={}",
                diagnostic_field(workflow_id), diagnostic_field(node_id), diagnostic_field(parameter_id)
            ));
        }
        LoomOtterAction::SyncWorkflow { workflow_id, .. } => {
            console_line!("Otter workflow action: SyncWorkflow id={}", diagnostic_field(workflow_id));
        }
        LoomOtterAction::SurfaceEvent { event } => {
            crate::append_runtime_log_line(&format!(
                "loom_otter_dispatch_surface_event :: instance_id={} attachment_id={} event_id={} node_id={} action={}",
                json_diagnostic_field(event, "/instanceId"),
                json_diagnostic_field(event, "/attachmentId"),
                json_diagnostic_field(event, "/eventId"),
                json_diagnostic_field(event, "/nodeId"),
                json_diagnostic_field(event, "/action")
            ));
        }
        LoomOtterAction::SurfaceLifecycle { event } => {
            crate::append_runtime_log_line(&format!(
                "loom_otter_dispatch_surface_lifecycle :: instance_id={} attachment_id={} state={} revision={}",
                json_diagnostic_field(event, "/instanceId"),
                json_diagnostic_field(event, "/attachmentId"),
                json_diagnostic_field(event, "/state"),
                event
                    .get("revision")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or_default(),
            ));
        }
        LoomOtterAction::SurfaceConfirmation { decision } => {
            crate::append_runtime_log_line(&format!(
                "loom_otter_dispatch_surface_confirmation :: confirmation_id={} instance_id={} approved={}",
                json_diagnostic_field(decision, "/confirmationId"),
                json_diagnostic_field(decision, "/instanceId"),
                decision
                    .get("approved")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false),
            ));
        }
        LoomOtterAction::SurfaceCancel { request } => {
            crate::append_runtime_log_line(&format!(
                "loom_otter_dispatch_surface_cancel :: request_id={} instance_id={}",
                json_diagnostic_field(request, "/requestId"),
                json_diagnostic_field(request, "/instanceId"),
            ));
        }
        LoomOtterAction::SurfaceResource { lease } => {
            crate::append_runtime_log_line(&format!(
                "loom_otter_dispatch_surface_resource :: resource_id={}",
                json_diagnostic_field(lease, "/resource/resourceId")
            ));
        }
        LoomOtterAction::SurfaceAttach {
            art_id,
            hook_node_id,
            device_id,
            ..
        } => {
            crate::append_runtime_log_line(&format!(
                "loom_otter_dispatch_surface_attach :: art_id={} hook_node_id={} device_id={}",
                diagnostic_field(art_id),
                diagnostic_field(hook_node_id),
                diagnostic_field(device_id.as_deref().unwrap_or("device-000-local"))
            ));
        }
        LoomOtterAction::SurfaceRemount {
            instance_id,
            attachment_id,
            hook_node_id,
        } => {
            crate::append_runtime_log_line(&format!(
                "loom_otter_dispatch_surface_remount :: instance_id={} attachment_id={} hook_node_id={}",
                diagnostic_field(instance_id),
                diagnostic_field(attachment_id),
                diagnostic_field(hook_node_id)
            ));
        }
    }

    match action {
        LoomOtterAction::ExecuteArt {
            node_id,
            request_id,
            art_id,
            inputs,
            parameters,
            disabled_parameters,
            generation,
        } => {
            let app_handle = app.clone();
            let prefer_shared_memory_input = state
                .state
                .lock()
                .map(|state| prefer_shared_memory_art_input(&state.negotiated_transport))
                .unwrap_or(false);
            spawn_bounded_loom_worker(
                &ACTIVE_LOOM_ART_WORKERS,
                MAX_CONCURRENT_LOOM_ART_WORKERS,
                "art",
                move || {
                forward_otter_art_execute(
                    &app_handle,
                    &node_id,
                    &art_id,
                    &request_id,
                    generation,
                    &inputs,
                    &parameters,
                    &disabled_parameters,
                    prefer_shared_memory_input,
                );
                },
            )?;
        }
        LoomOtterAction::CancelArt {
            node_id,
            request_id,
            generation,
        } => {
            spawn_bounded_loom_worker(
                &ACTIVE_LOOM_CONTROL_WORKERS,
                MAX_CONCURRENT_LOOM_CONTROL_WORKERS,
                "cancel",
                move || forward_otter_art_cancel(&node_id, &request_id, generation),
            )?;
        }
        LoomOtterAction::UpdateWorkflowNode {
            request_id,
            workflow_id,
            node_id,
            parameter_id,
            value,
        } => {
            let app_handle = app.clone();
            spawn_bounded_loom_worker(
                &ACTIVE_LOOM_CONTROL_WORKERS,
                MAX_CONCURRENT_LOOM_CONTROL_WORKERS,
                "update",
                move || {
                    send_otter_control_request(
                        &app_handle,
                        serde_json::json!({
                            "method": "loom.hook.workflow.node.update",
                            "params": {
                                "requestId": request_id,
                                "workflowId": workflow_id,
                                "nodeId": node_id,
                                "parameterId": parameter_id,
                                "value": value
                            }
                        }),
                        Duration::from_secs(5),
                        "hook/sync_error",
                    );
                },
            )?;
        }
        LoomOtterAction::SyncWorkflow {
            workflow_id,
            snapshot,
        } => {
            console_line!("Syncing Workflow Snapshot: {}", workflow_id);
            let app_handle = app.clone();
            spawn_bounded_loom_worker(
                &ACTIVE_LOOM_CONTROL_WORKERS,
                MAX_CONCURRENT_LOOM_CONTROL_WORKERS,
                "sync",
                move || {
                    send_otter_control_request(
                        &app_handle,
                        serde_json::json!({
                            "method": "loom.hook.workflow.sync",
                            "params": {
                                "requestId": format!("workflow-sync:{}", Uuid::new_v4()),
                                "workflowId": workflow_id,
                                "snapshot": snapshot
                            }
                        }),
                        Duration::from_secs(5),
                        "hook/sync_error",
                    );
                },
            )?;
        }
        LoomOtterAction::SurfaceEvent { event } => {
            send_surface_event_to_loom(&app, event)
                .await
                .map_err(|error| sanitize_untrusted_message(&error, "Surface event failed"))?;
        }
        LoomOtterAction::SurfaceLifecycle { event } => {
            send_surface_lifecycle_to_loom(&app, event)
                .await
                .map_err(|error| sanitize_untrusted_message(&error, "Surface lifecycle failed"))?;
        }
        LoomOtterAction::SurfaceConfirmation { decision } => {
            send_surface_confirmation_to_loom(&app, decision)
                .await
                .map_err(|error| sanitize_untrusted_message(&error, "Surface confirmation failed"))?;
        }
        LoomOtterAction::SurfaceCancel { request } => {
            send_surface_cancel_to_loom(&app, request)
                .await
                .map_err(|error| sanitize_untrusted_message(&error, "Surface cancellation failed"))?;
        }
        LoomOtterAction::SurfaceResource { lease } => {
            fetch_surface_resource_from_loom(&app, &lease)
                .await
                .map_err(|error| sanitize_untrusted_message(&error, "Surface resource failed"))?;
        }
        LoomOtterAction::SurfaceAttach {
            art_id,
            hook_node_id,
            device_id: _,
            capabilities,
        } => match attach_surface_via_loom(&app, &art_id, &hook_node_id, capabilities).await {
            Ok(()) => crate::append_runtime_log_line(&format!(
                "loom_otter_surface_attach_ready :: art_id={} hook_node_id={}",
                art_id, hook_node_id
            )),
            Err(error) => {
                let error = sanitize_untrusted_message(&error, "Surface attach failed");
                crate::append_runtime_log_line(&format!(
                    "loom_otter_surface_attach_failed :: art_id={} hook_node_id={} error={}",
                    art_id, hook_node_id, error
                ));
                return Err(error);
            }
        },
        LoomOtterAction::SurfaceRemount {
            instance_id,
            attachment_id,
            hook_node_id,
        } => {
            remount_surface_via_loom(&app, &instance_id, &attachment_id, &hook_node_id)
                .await
                .map_err(|error| sanitize_untrusted_message(&error, "Surface remount failed"))?;
        }
    }

    Ok(())
}
