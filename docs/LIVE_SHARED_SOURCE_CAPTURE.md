# Shared Live window capture

## Scope

Multiple Live crops of the same window share one WGC source. Browser windows use
the same native capture path; document/tab pinning experiments are retired. See
[Live capture](LIVE_CAPTURE.md) for the current product boundary.

`get_live_resource_status.sharedWindowCapturePools` exposes the actual window
pool count separately from conservative per-Unit `activeSources` reservations.

## Ownership and stop condition

- A source key is HWND + expected process ID + capture dimensions. Region/Unit
  identity is deliberately not part of the key. Display capture stays private.
- One dedicated thread owns a source's WGC session and its WinRT lifetime. The
  capturer itself never moves between subscriber threads.
- Each subscriber retains its own ROI, frame mailbox, capture budget, visibility,
  encoded frame sequence, input lifecycle and native presentation slot.
- Crop directly from the shared full-source texture into the subscriber's owned
  texture before the callback returns. No CPU readback or JPEG occurs in fan-out.
- Subscriber removal excludes it from callback delivery before its GPU slot is
  removed. Only the last subscription stops and joins the source owner.
- A new subscription requests one source-pool refresh so a static source supplies
  an initial frame. Refresh stops the old pool before starting its replacement;
  a generation check rejects late callbacks. There is no retained full-window GPU
  cache or continuous full-window copy added solely for late subscribers.
- Source dimensions remain part of the key: existing per-Unit resize validation,
  identity checks, resource admission and epoch transitions stay authoritative.
- Resource admission retains conservative per-Unit full-source reservations.
  Reducing them requires a separate ownership-aware review.

## Shared work accounting

`src-tauri/src/live_gpu/work_budget.rs` accounts acquisition and output separately:

- Group acquisition by the actual source key, including dimensions. Private
  display captures never alias a shared key, even when their text IDs match.
- Charge full-source pixels once at the fastest subscriber's requested rate.
  Hidden subscribers request one frame per second.
- Charge each output ROI at its own rate. Six large crops still incur six copies.
- Scale cadence against all three ceilings: 120 source frames/s, 124,416,000
  source pixels/s, and 124,416,000 output pixels/s. Apply dynamic resource pressure
  after that calculation.
- CPU readback/JPEG work uses one fair, leased permit, with ceilings of 30 frames/s
  and 24,000,000 pixels/s. Hold it through encoding; cooldown also accounts for
  the measured processing time. Hidden subscribers cannot take a permit.
- Derive groups from live demands. Resize changes the source identity; dropping
  the last demand leaves no additional accounting registry behind.

Six 100x100 crops from one 1920x1080 source requesting 60 FPS therefore account
for 124,416,000 acquisition pixels/s and 3,600,000 output pixels/s. Six full-size
crops account for their output independently and receive a 100 ms base interval.
These are scheduler calculations, not measured display FPS or latency.

## Verification

Acceptance requires: one live WGC owner for six same-window crops, distinct valid
ROI output, unchanged GPU/fallback delivery, independent visibility and stop,
static late-join delivery, zero source owners after teardown, focused unit tests,
compile/formatter/line gates, and a freshly built packaged Unit probe.

This does not promise an arbitrary-app FPS gain, solve browser scrolling/tab
identity, share independent source windows, or change the existing source-window
input/hide ownership model. Joining a new crop may briefly interrupt source frame
arrival while its single shared pool refreshes; existing Unit pixels are retained.

Focused `live_gpu::work_budget` tests cover shared/private identities, independent
ROI costs, mixed rates, hidden/removed subscribers, CPU permits and rebinding.
Owned-window native tests cover static late join, distinct lossless crop colors,
sibling stop, resize, source close and zero pools/reservations at teardown.
Multi-video probes compare actual central pixels in GPU snapshots; advancing
counters alone do not prove visible motion. See [video diagnostics](LIVE_VIDEO_CAPTURE_DIAGNOSTICS.md)
for controlled fixtures and capture/presentation evidence boundaries.

Historical candidate timings, test counts and GUI release-edge investigations
are available at `cleanup-base-20260928:docs/LIVE_SHARED_SOURCE_WORK_BUDGET.md`.
They do not establish acceptance or an unresolved failure in a later package.
Timed per-Unit cadence and latency require a comparable-load runtime measurement;
shared-source memory reservations remain conservative until separately reviewed.

The source pool count is an ownership fact, not total driver memory or a monitor
FPS measurement. Final candidate GUI and package evidence belongs in its release
`VALIDATION.md`; source tests alone do not establish that the installed app changed.
