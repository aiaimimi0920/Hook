# Shared Live window capture

## Incremental scope

This slice removes duplicate WGC sessions for multiple Live crops of the same
window. Browser document/tab binding remains a separate, verified Loom capability
package integration; it is not implemented by sharing a window capture.

`get_live_resource_status.sharedWindowCapturePools` exposes the actual window
pool count separately from conservative per-Unit `activeSources` reservations.

The V0.2.21 packaged single-Unit gate passed on 2026-09-07: Ctrl+2 placement at
150% DPI, corner drag/release, source button and slider input, source movement,
Tab, Ctrl+E snapshot/edit and GPU suspension. Shift+1 dispatch was exercised with
Loom disabled; actual connected Art creation was not established by that run.

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
- Resource admission deliberately retains conservative per-Unit full-source
  reservations for this slice. Sharing must first be proven before reducing those
  reservations or increasing aggregate throughput budgets.

Acceptance requires: one live WGC owner for six same-window crops, distinct valid
ROI output, unchanged GPU/fallback delivery, independent visibility and stop,
static late-join delivery, zero source owners after teardown, focused unit tests,
compile/formatter/line gates, and a freshly built packaged Unit probe.

This does not promise an arbitrary-app FPS gain, solve browser scrolling/tab
identity, share independent source windows, or change the existing source-window
input/hide ownership model. Joining a new crop may briefly interrupt source frame
arrival while its single shared pool refreshes; existing Unit pixels are retained.

## Verification recorded on 2026-09-07

- Three owned-window native tests passed, including static late join without a
  repaint, distinct lossless crop colors, sibling stop, resize epoch, source close
  and zero pools/reservations at teardown.
- The six-source video probe passed with both the previous video fixture and the
  new independently qualified fixture. All six same-window subscribers used one
  active WGC pool. GPU, fallback, visibility and survivor updates were preserved.
- Native multi-video acceptance now compares actual central pixels in two GPU
  snapshots per crop, rather than treating advancing frame counters as motion.
- `live-video-fixture.ts` validates all 480 decoded fixture frames and nine sample
  regions per frame before the native probe starts. The generated moving gradient
  had at least 41 quantized colors in those regions, above the unchanged native
  threshold of 12. Black/solid-color and integer-floor quantization unit tests pass.
  This removes the fixture's dependency on a moving testsrc2 detail intersecting
  one sampling region; it does not retroactively prove the cause of an unsaved
  historical failed frame or erase its failure record.

The source pool count is an ownership fact, not total driver memory or a monitor
FPS measurement. Final candidate GUI and package evidence belongs in its release
`VALIDATION.md`; source tests alone do not establish that the installed app changed.
