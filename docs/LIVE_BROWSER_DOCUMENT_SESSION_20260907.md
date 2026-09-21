# Browser document binding candidate: 2026-09-07

## Delivery state

This is an implemented and tested **candidate session layer**, not a shipped
browser adapter. Current Ctrl+2 still uses the existing window-region capture.
No browser extension, personal-profile debugger, or Loom provider was installed.
No EXE was rebuilt for this intermediate step: these files are not linked into
Hook core, and rebuilding it would not deliver browser anchoring. The previous
V0.2.29 candidate remains unchanged. The browser product task is incomplete.

The protocol requires an installed, authorized, digest-bound Loom capability
package. Repository inspection found no existing shipped browser provider to
reuse. The earlier reference to a verified browser package describes a required
integration boundary, not an already available backend.

## Implemented behavior

- `scripts/browser-candidate/documentBinding.ts` consumes one dedicated target
  transport, pins its main frame and loader identity, and copies bounded document
  coordinates. It does not focus a tab, scroll a page, or change device metrics.
- The caller can bind multiple regions to that one session. Only one capture is
  in flight; overlapping calls receive `BROWSER_CAPTURE_BUSY`, without a queue.
  This is a concurrency guard, **not** a fair scheduler or shared-frame cropper.
- Document identity is checked before and after screenshot acquisition. Main
  frame navigation/loading, target close, revocation, and command timeout end the
  binding. Replacement-document pixels must not be published as the old source.
- Unrelated iframe navigation does not invalidate the main-document binding.
- Close removes subscriptions and pending cancellation callbacks and requests
  transport detach once; it does not close the user's tab. There are no periodic
  timers, retained frame caches, GPU allocations, or processes owned by this
  module. Each request clears its deadline and cancellation subscription.
- Capture failure is terminal in this candidate. Rebinding requires an explicit
  new session; there is no silent retarget or automatic navigation recovery.

The transport is trusted candidate infrastructure, not an authorization boundary.
The future provider must own real connection cancellation, detach failures,
process shutdown, global rate limits, and grant revocation. The current close
method waits for transport detach; it cannot forcibly terminate a faulty remote
transport that never settles its detach promise.

## Fresh validation

- 12 focused Vitest tests passed: coordinate copy, navigation before/during
  capture, four close/navigation events, iframe exclusion, malformed events,
  concurrent rejection/revocation, timeout, and region limits.
- `tsc --noEmit -p tsconfig.test.json` passed, including candidate scripts.
- Repository strict effective-line checker passed, scanning 1,098 files with
  zero files over the 500-line threshold. Modified/new source physical line
  counts: session 141, unit test 95, browser probe 191; UTF-8 without BOM.
- No frontend formatter command is configured in package.json; existing local
  TypeScript formatting was preserved. No Rust source changed.
- Hook and Loom `git diff --check` passed. Both repositories retain substantial
  pre-existing dirty work; this step changes Hook only. No staging or commits.
- Final owned Chromium run:
  `artifacts/live-browser-document-session-20260907-r3/summary.json`.
  A and B occupied the same browser window. While B remained visible/focused,
  the A-bound image retained A's pixels and changed over time. After A scrolled
  to y=1400, its original region remained capturable and updated without moving
  the scroll position. Ordinary fixture-button interaction affected only A.
  Navigation and source close rejected further bound reads; browser and HTTP
  fixture server cleanup passed.
- Final sample capture durations: inactive tab 209.77 ms; offscreen region
  225.83 ms. Earlier r2 measured 158.86/151.70 ms. These few PNG screenshots are
  neither sustained FPS nor a video performance acceptance result.

The probe still sets device metrics on its **owned fixture target** for a stable
pixel assertion. That is not a permitted default for a user's browser. The next
runtime acceptance must include unmodified browser zoom/DPI, real selection
coordinate conversion, and multiple regions.

## Next product steps and stop conditions

1. Build the browser provider through Loom's capability-package trust boundary,
   with explicit target authorization and close/revoke semantics; do not add an
   unauthenticated localhost debugging endpoint to Hook.
2. Convert the user's selected viewport region to source document CSS coordinates
   with verified tab, document, zoom, and DPI identity. Reject ambiguity rather
   than treating HWND as tab identity.
3. Implement fair per-target scheduling and global resource admission. Evaluate
   one bounded source capture plus regional crops against individual captures;
   distant document regions must not force unbounded full-page screenshots.
4. Feed authorized browser frames into the existing Live Unit lifecycle, editing,
   snapshot, and failure feedback, without disguising a browser target as a
   native window ID. Lock interaction to the same document identity.
5. Run actual Ctrl+2 and multi-region tests, package both affected products into
   their release roots, and verify executable/provenance paths before claiming
   delivery. Normal DOM first; virtualized content, background video, DRM,
   cross-origin iframe interaction and real-gesture controls remain separate
   acceptance cases.
