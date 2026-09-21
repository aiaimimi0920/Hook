# Live failure notice routing

Later diagnosis of the Edge dispatch stall and stronger full-shell frame evidence
are in `LIVE_BROWSER_WORKER_IDENTITY_20260908.md`. The historical failed runs below
are retained; they must not be mistaken for the latest worker-selection behavior.

## User-facing contract

- A failure with an existing bound Unit uses that Unit's standard top-right notice.
- An unbound failure, or one whose asynchronous owner was deleted, uses the last
  remaining ordinary sticker in the current graph array.
- An unrelated Art node is not used as the unbound fallback. An explicitly bound
  Art node retains its own notice.
- With no suitable host, no failure popup is created. Existing caller diagnostics
  are not replaced with a global dialog.

## Root causes corrected

`liveCaptureAdmissionFeedback.ts` explicitly used `window.alert` because failed
creation had no new Unit. This conflicts with the native click-through/input
overlay. It now uses `unitFailureNotice.ts`, which resolves ownership at delivery
time and calls the existing `uiActions.showEnhancementNotice` API.

`ExtensionCommandPalette.tsx` also reopened its screen-centered dialog after a
command failure. It now captures the invoking Unit before the asynchronous
command and routes failure through the same notice API without reopening. The
last remaining frontend `alert`, cyclic-link rejection, now uses its target Unit.

No replacement popup component, color system, timer queue or click-through layer
was introduced. The existing Unit notice host retains top-right anchoring, click
and keyboard dismissal, five-second timeout and bounded eight-notice queue.
Native unknown-error contents remain sanitized rather than exposing page data.

## Fresh verification

- Five focused test files passed: 17 tests.
- Includes actual Solid component rendering of unbound capture failure at the
  last sticker's coordinates, standard right/top classes, pointer events enabled,
  click dismissal, no notice in the older sticker and no call to `window.alert`.
- Unit tests cover bound Art, deleted owner, no sticker, safe error text and
  explicit capture owner. Existing notice rendering/cleanup tests also passed.
- Application TypeScript, test TypeScript and changed-source ESLint passed.
- Strict effective-line gate passed after adding the rendering regression test.

## Actual candidate runtime evidence

The r2 candidate built successfully. Its seven manifest entries matched sizes and
hashes. Executable SHA-256:
`c0a6a2f5018d88450c2b762afbcf6bc9c0aef22f8075e11aa5d184e93e42c5f6`.

After confirming no user Hook instance remained, the normal native acceptance
passed: real Tauri/WebView2 launch and IPC, global single-instance behavior,
60-second soak, owned shutdown and restart. Evidence:
`artifacts/failure-notice-native-20260908/summary.json`.

A subsequent owned full-shell probe connected that executable to the actual
running Loom daemon, imported a fixture through the real file-drop handler, and
ran the command-palette browser import without a pending selection. The failure
appeared inside the original sticker and was dismissed through its standard
button; the command dialog stayed closed.

The same full-shell run then prepared the actual daemon capability, selected an
owned page through the installed Edge extension, imported it into the real Hook
canvas, switched browser tabs and scrolled the hidden source to y=1400. Both Hook
screenshots visibly show the original green region with different clock text.
Evidence: `artifacts/browser-live-shell-20260908-r1/summary.json`,
`hook-live-initial.png`, `hook-live-offscreen.png` in that directory.

This is stronger than the earlier framed test client: no source-module harness
or mocked authorization bridge substituted for Hook/Loom. It still uses an owned
Edge profile and command-palette entry, not ordinary Ctrl+2 browser acquisition.

The visual review also exposed an automatic control-error notice on successful
read-only browser capture. The provider correctly declared `unavailable`; the
controller's generic else branch treated that declared limitation as a failure.
The r3 source skips that automatic notice for browser documents. An explicit
click on a read-only browser region still explains that interaction is unsupported
and does not incorrectly instruct users to recapture. A focused regression covers
the successful read-only start. This does not implement browser input support.

## Scope honesty

This correction addresses failure feedback, not completion of browser document
capture. Ordinary Ctrl+2 still produces native capture metadata; an Edge action
grant and the actual Hook import flow must be integrated and verified separately.
An installed capability or a successful test-profile screenshot is not proof of
the ordinary user path. Do not advertise the full Live task as complete from
this notice fix.

Candidate build destination:
`../release/Hook/browser-live-candidate-20260908-r3/V0.2.29`.
This is a dirty-source candidate under the repository release policy, not a
clean tagged formal release. Existing release directories are preserved.

## Latest r3 delivery and remaining failure

The r3 candidate includes both notification routing and the read-only-start
correction. All seven manifest file hashes/sizes matched. Executable SHA-256:
`956466c547dae45d8e0c38b2c91e7de8d4aeba438ec7c65104823ab9e6c58286`.
Application/test/script typechecks and changed-source/script ESLint passed.
The expanded focused set passed (six files, including the read-only regression).

Two subsequent full-shell runs (artifacts `browser-live-shell-20260908-r2` and
`-r3`) reached the Edge action dispatch phase but exceeded the overall timeout.
Reaching that phase means the actual candidate's failure notice had already
appeared on its sticker, been dismissed, and the preparation command completed.
It does NOT mean browser capture passed. The last phase was `edge_selection`;
the following dispatch used CDP `Extensions.triggerAction`. The probe now bounds
that dispatch and its browser shutdown, and records phases to distinguish a
stalled test/browser command from Hook capture processing. No production browser
grant checks were weakened to make the test pass.

Owned Hook and matching Edge test processes were absent after timeout cleanup.
The earlier successful full-shell images remain valid evidence of that one run,
not proof of repeatable product readiness. Ordinary Ctrl+2 browser acquisition,
normal-profile extension onboarding and browser content interaction remain open.

The bounded r4 replay confirmed the boundary explicitly:
`Owned Edge action dispatch timed out`, before the picker wait began. Evidence:
`artifacts/browser-live-shell-20260908-r4/phase.json` and `runner.stderr.log`.
This last replay failed; it is not listed as a successful full-shell acceptance.
The final strict line checker and scoped diff check passed. No source changes
were made to Loom in this notice-fix step, and no user work was staged or reverted.
