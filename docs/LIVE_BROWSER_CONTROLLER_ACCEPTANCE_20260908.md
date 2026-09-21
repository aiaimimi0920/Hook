# Real controller and rendered-image acceptance - 2026-09-08

## Scope added

The combined probe now supports `--loom-controller`. It compiles the actual Hook
controller/store/presentation modules using the repository's Vite/Solid toolchain
and serves an owned test page. The transport is still explicitly test-owned; it
does not simulate installed package trust or native-host registration.

Actual path exercised:

`browser debugger -> Loom native handler -> test transport -> DocumentSessions ->
framed runtime -> Hook backend -> liveCaptureController -> real Image.decode ->
liveCaptureViews + graphStore -> reactive test image renderer`.

The test does not replace Image.decode, canvas decoding or the controller. It
asserts the controller creates a sticker Unit and commits a PNG snapshot. The
small test renderer observes the real live image URL; it is not the complete Hook
application shell or ordinary sticker component.

## Fresh passing run

`artifacts/browser-live-controller-20260908-r5/summary.json`: passed=true.

- Source selected by an actual drag: 320 x 160 CSS pixels, DPR 1.5.
- Tab B is created explicitly inside source tab A's window.
- With B visible and A hidden, A's original green region and changing clock reach
  the controller and rendered image; the source is not changed to B.
- A is scrolled to 1400 pixels while hidden. Its original region continues to
  update; B remains visible and the original scroll position is not reset.
- Controller reached rendered frame 9, with a real sticker Unit and stored snapshot.
- Navigating A leads to failed capture with `BROWSER_DOCUMENT_CHANGED`, after the
  controller's next poll. The last good frame may remain displayed, but the new
  document is not rebound.
- Stop leaves zero live views and zero retained runtime sessions, while keeping
  one ordinary sticker Unit with its final PNG snapshot.
- Owned browser and fixture server closed; the UI preview server is also awaited
  during teardown. The UI screenshots were generated from the rendered image;
  `offscreen-ui.png` was visually inspected and showed the original region/clock.

`elapsedMs` in controller mode measures reading an already decoded displayed
frame. The reported 46/10 ms samples are **not** browser capture latency or FPS.

## Test corrections and checks

- R1/R2 timed out during browser attachment while a Vite dev dependency scan ran.
  The harness now builds its single HTML entry before starting capture and serves
  static output. Build/cache directories are scoped to each new artifact directory;
  the user's running dev server/cache is not reused.
- R3 passed the controller capture path. R4 added cleanup assertions but caught a
  test race: reading immediately after navigation can return the last good frame.
  R5 explicitly waits, with a deadline, for the real controller's terminal failure
  and then verifies rejection and retained-snapshot cleanup.
- Focused strict TypeScript and ESLint passed. Hook strict size check: 1118 files,
  no exceptions. Both independent repository diff checks passed.

Run from Hook with a fresh artifact path:

```powershell
node --experimental-strip-types scripts/tests/live-browser-extension-probe.ts artifacts/browser-controller-next --loom-controller
```

## Not yet product completion

No installed browser, registry, trust store or production app was modified. The
newly compiled UI is an acceptance artifact, not a replacement Hook executable.
Signed installation, registered native messaging, the complete Hook shell and
normal Ctrl+2 acquisition still require integrated acceptance. Safe abrupt-exit
recovery, bounded preparation waiting and multi-region/video performance remain
open. The original user objective is not marked complete.
