# Browser extension transport acceptance: 2026-09-07

## Status: progress, not product delivery

Implemented a Chromium extension debugger transport and tested it with a real
Manifest V3 extension in an owned Chromium profile. The full objective remains
open: Ctrl+2, Loom package authorization, Live Unit presentation, and the release
build are not connected to this transport. Existing V0.2.29 release artifacts
were not replaced. No extension was installed into the user's normal browser.

The previous turn established document-session behavior through Playwright CDP.
This turn establishes that the same binding can run through the actual extension
API, without a product-side debugging port or a Playwright runtime dependency.
The test driver alone uses a temporary owned-browser debugging port.

## Implementation and ownership

- `scripts/browser-candidate/chromiumDebuggerBinding.ts` wraps the extension's
  debugger API, pins commands/events to one tab, ignores unrelated tabs and child
  sessions, and adapts it to the existing document binding candidate.
- Only a caller which has already obtained an explicit tab grant may open it.
  This function does not acquire permission and is not an authorization boundary.
- Duplicate owners of the same tab are rejected. Pending attachment remains
  reserved after cancellation, until its eventual success/failure can be cleaned
  up. Late successful attachment is detached rather than leaked.
- Browser cancellation, explicit AbortSignal cancellation, document invalidation,
  failed setup, and close remove listeners. The code does not close user tabs.
- An attach failure does not call detach: that could detach someone else's
  debugger. Browser-driven detach releases the local reservation.
- `browser-extension-fixture.ts` is test-only, exposes no webpage message handler,
  external endpoint, or native messaging host, and limits target lookup to the
  loopback fixture URL supplied by the owned test driver.

The API requires the extension's `debugger` permission and supports tab-directed
commands and events. Enterprise screenshot/host policy can reject attachment;
it must remain a visible failure, not a bypass attempt. See the official
[Chrome debugger API reference](https://developer.chrome.com/docs/extensions/reference/api/debugger).

## Fresh evidence

- Focused tests: 20 passed across browserDocumentBinding and
  chromiumDebuggerBinding, including 8 new transport tests.
- Test TypeScript compilation and strict effective-line check passed (1,102
  files, no files over 500 effective lines). All four new source files are
  UTF-8 without BOM and 29-135 physical lines. No frontend formatter command
  is configured; existing local formatting was preserved.
- Hook and Loom diff checks passed, with 224/115 dirty entries respectively and
  zero staged entries. This turn changed Hook only and preserved earlier edits.
  A fresh process audit found zero matching owned test-browser profile processes.
- Final real extension result:
  `artifacts/live-browser-extension-20260907-r6/summary.json` passed.
- Source DPR was **1.5** without overriding browser metrics. The 320x160 CSS
  region produced 480x240 image pixels; decoder checks verified original-page
  green pixels rather than the active tab's blue pixels.
- Inactive original content changed over time. After scrolling the source to
  y=1400, the original document region still changed, with scrollY unchanged and
  the other tab still visible. Navigation rejected further reads.
- Browser and HTTP fixture cleanup passed. No personal profile was touched.
- **Performance is not acceptable as a video promise:** the inactive sample took
  597.74 ms and the offscreen sample 2613.83 ms. These sparse samples do not
  isolate encoding, command, or background scheduling cost. Do not treat the
  direct-CDP prototype's faster numbers as extension performance evidence.

### Preserved failed attempts

- r1 incorrectly asserted CSS dimensions against device-pixel screenshot sizes.
- r2-r5 selected the browser's built-in extension worker (`thunk.js`) rather than
  the fixture worker. The final probe locates the known fixture worker URL and
  waits for initialization. Speculative debugger-resume logic was removed after
  the wrong-worker diagnosis.
- r6 uses `connectOverCDP` with `noDefaults` for the test driver so Playwright
  focus/DPI overrides cannot substitute for real tab visibility and scale.

## Integration conclusion and next work

Loom's existing persistent capability processes can support bounded command
polling. They do not supply a ready-made browser provider or an arbitrary frame
stream. Source inspection confirmed that package command dispatch validates
snapshot generation, active package ownership and gesture requirements.

Next: add per-command timing to identify the extension path's delay; define a
bounded, rate-controlled browser provider command contract; connect explicit
browser grants to Loom package lifecycle and revocation; then feed frames through
Hook's existing Unit editing/snapshot lifecycle. Multiple regions must share the
same target owner, with fair scheduling and pixel limits rather than independent
unbounded poll loops. Final acceptance still requires real Ctrl+2 selection,
scroll/tab preservation, multiple regions, close/exit cleanup, and release builds
in both affected project release roots.
