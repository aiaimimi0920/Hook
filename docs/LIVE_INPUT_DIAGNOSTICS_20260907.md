# Live optimization checkpoint: owned input diagnostics

## Scope and outcome

The active optimization work is not release-complete. Product lifecycle and
shared-source scheduling fixes are in the separate V0.2.27 candidate described
in `LIVE_SHARED_SOURCE_WORK_BUDGET.md`; this checkpoint only changes the native
acceptance harness. No new product binary was built for the harness changes.
Loom was not modified. Existing dirty changes and release candidates were kept.

## Resource evidence already established

- Last Live compositor removal joins its worker; recreation is regression-tested.
- Sequential WinRT restart crash has an isolated regression and a process-lifetime
  MTA keepalive. That keepalive does not retain capture pools or GPU textures.
- Six native video crops shared one capture pool. At completion, demands,
  reservations and pools were zero, and no CPU permit was held.
- Native six-crop tests are not a six-WebView whole-application performance test.
  They do not establish smooth playback or absence of every resource leak.

## Current packaged input gate

`artifacts/live-runner-owned-20260907-r1/summary.json` records another failed
V0.2.27 GPU-preview Ctrl+2 probe: selection appears, but the Live Unit does not.
The 20-second locator timeout is retained as failure, not converted to success.
Successful SendInput insertion alone does not prove final mouse-up delivery.
Manual-user reproduction remains unconfirmed; do not infer a product regression
or a GPU leak from this automated failure alone.

Earlier debugger attachment changed timing, so the r3 debugger run is not an
acceptance result. It was explicitly ended using the owned Hook PID and verified
start time. A subsequent fresh process audit found zero matching processes for
that run and for the new owned-runner probe, including their browser profiles.

## Harness hardening

`scripts/tests/Invoke-LiveUnitNativeProbe.ps1` now records Hook and runner PID,
start time and Hook executable path in `owned-processes.json`. Node is an owned
process with separate stdout/stderr logs and a bounded action deadline (default
300 seconds, configurable 30-600). Finally cleanup includes the runner. An error
cleaning one process no longer skips the other owned processes or environment
restoration. Only owned process objects are stopped; no broad process-name kill.

The real 30-second-deadline probe launched correctly, wrote its ownership file
and failure summary, propagated exit code 1, and cleaned its owned processes.
It failed through the normal test-error path before the action deadline. The
forced-deadline branch and simulated cleanup-exception branch were not exercised.
PowerShell parser and strict effective-line gates are the additional checks.

## Next optimization boundary

Full-source GPU memory admission currently charges `source_pixels * 8` per Unit,
even where WGC acquisition is shared. This is conservative over-accounting, not
evidence of extra actual pools. Do not simply discount the second Unit: deleting
the first must not remove the only accounting for the surviving shared pool.

A safe follow-up needs shared-owner accounting with atomic admission and rollback,
while retaining per-ROI mailbox, preview and staging charges. Protect private
captures, HWND/PID/dimensions identity, failed subscription, last-owner teardown,
resize overlap and measured-growth correction with focused tests before relaxing
admission. Browser scroll/tab content anchoring and whole-app frame latency remain
separate unfinished acceptance requirements.

## Follow-up: graceful exit and frontend boundary

Three native probe scripts omitted the required marker argument to
`request_native_acceptance_exit`. Their caught IPC errors prevented graceful exit,
leaving the outer wrapper to clean up. They now send valid fixed ASCII markers.
The packaged `live-graceful-exit-20260907-r1` run logged both
`native_acceptance_exit_requested :: marker=live-unit-probe-cleanup` and
`hook_process_exit_cleanup :: reason=tauri_exit_requested`. The capture acceptance
still failed; cleanup success is not interaction success.

An explicit `-FrontendReleaseDiagnostic` option now isolates frontend creation
from the native release-edge failure. It emits the documented internal mouse-up
event only when requested, and records `nativeSelectionAcceptance=false`.
Default native acceptance never enables it or falls back to it. No production
input handler, authorization or screenshot logic was changed.

`artifacts/live-frontend-release-20260907-r1/summary.json` records real Unit
creation at 150% DPI, GPU presentation and native corner drag/settle after this
diagnostic event. Source-button clicking subsequently timed out: the overall
probe remains failed. Its first step used the earlier generic Ctrl+2 label; the
explicit false nativeSelectionAcceptance field is authoritative. Future diagnostic
runs use the distinct `frontend-release-create-unit-dpi-position` step label.

This establishes a route to separate frontend multi-Unit workload measurement
from native selection acceptance. It does not repair selection or establish
successful input forwarding. JS syntax, PowerShell parsing and strict line checks
passed after the harness changes; further whole-app benchmarking remains needed.

## V0.2.29 fresh native follow-up

The default native GPU Unit probe passed twice in independent owned instances:
`artifacts/live-v29-native-input-20260907-r1/summary.json` and `r2/summary.json`
(the latter is `artifacts/live-v29-native-input-20260907-r2/summary.json`). Both
record nativeSelectionAcceptance=true and use no synthetic frontend release.
Real Ctrl+2 selection, DPI placement, corner drag/settle, button forwarding,
source movement, slider drag, Tab and Ctrl+E passed. Shift+1 only checks dispatch
with Loom disabled. Earlier failures remain valid historical evidence; the
mouse-hook failure cause has not been established by these successful runs.
