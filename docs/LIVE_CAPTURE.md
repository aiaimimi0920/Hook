# Live capture

## User flow and scope

Use `Ctrl+2` or the tray to select a live region. A region contained in a valid
program window stays anchored to that window's local pixels when the window
moves. Other selections use screen-region capture. Each admitted Live sticker
has independent placement, frames and input; closing one leaves siblings active.

Browser windows follow this same native path without an extension. Scrolling or
switching tabs changes the captured pixels. Keeping an earlier document visible
after scrolling or changing tabs was withdrawn from the product requirements on
2026-09-09. The old Browser Live extension, document-binding, import and shortcut
experiments are retired. Their historical successes and failures do not establish
support for pinned webpage content. The generic Loom capability bridge remains.

Deleting experimental source does not uninstall historical candidates, browser
registrations or already installed packages on a user's machine. Use a newly
built candidate to exercise current behavior.

## Failure notices

Failures with an existing bound Unit use that Unit's top-right notice stack.
An unbound failure, or a failure whose asynchronous owner was deleted, uses the
last remaining ordinary sticker. An explicitly bound Art node keeps its notice;
an unrelated Art node is not a fallback. Without a suitable host no failure popup
is created, and existing diagnostic reporting remains available.

`src/services/unitFailureNotice.ts` resolves ownership when the notice is
delivered through `uiActions.showEnhancementNotice`. The standard host owns
dismissal, timeout and its bounded queue. Native unknown-error text is sanitized.
`liveCaptureAdmissionFeedback.ts` uses this path rather than a global alert.
Capture status failures use `liveCaptureStatusFeedback.ts`; the controller keeps
the message tied to the affected Unit rather than introducing a global Live panel.

## Runtime boundaries and verification

- [Resource admission](LIVE_RESOURCE_ADMISSION.md): RAM, GPU, CPU, pressure and refusal.
- [Shared source capture](LIVE_SHARED_SOURCE_CAPTURE.md): WGC pool ownership and independent crops.
- [Shared work budget](LIVE_SHARED_SOURCE_WORK_BUDGET.md): aggregate capture and CPU fallback limits.
- [GPU presentation](LIVE_GPU_PRESENTATION.md): native texture route and compatibility fallback.
- [Protocol](LIVE_SCREENSHOT_PROTOCOL.md): native/Loom transport and authorization.
- [Features](FEATURES.md): shortcuts and manual regression matrix.

Frontend `liveProtocol.ts` contains trigger configuration types only. Native
Hook and Loom own wire validation, framing and ordering. Frontend regressions
exercise the current relay, extension contracts, capture feedback and notices;
the phase 7/8 runners retain those current tests.

Use the capture/input probes listed in the root README for native acceptance.
Typechecks, deterministic tests and headless probes do not prove arbitrary-app
input compatibility, desktop interaction or a guaranteed frame rate. Keep the
documented same-user/integrity, platform and rendering limitations when reporting
results. No new native acceptance result is implied by documentation cleanup.
