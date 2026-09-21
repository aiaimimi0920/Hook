# Combined browser-to-consumer acceptance - 2026-09-08

## What now passes

The owned Chromium probe now routes real selected-region pixels through:

1. Loom's extension debugger capture and native-request handler.
2. An explicitly test-owned transport adapter.
3. Loom `DocumentSessions` and the actual big-endian framed command runtime.
4. Hook `createBrowserLiveCaptureBackend`, including poll cursor progression,
   retained-frame storage and frame reads.

The final PNG assertions use bytes returned by Hook's backend, not a separate
direct browser-capture path. No trusted package snapshot or signature was forged.

## Actual result

Evidence: `artifacts/browser-live-consumer-20260908-r4/summary.json` reports passed.

- The user-like drag selected a 320 x 160 CSS-pixel region of source tab A.
- Device scale was 1.5; the PNG was 480 x 240 physical pixels.
- Test tab B was explicitly created in A's window using the extension tab API.
- After switching to B, A was hidden and B visible. The original green region's
  changing clock reached Hook as a new frame, rather than showing B's blue region.
- After scrolling A to 1400 pixels, A remained hidden, B remained visible, the
  original region's clock changed again and A's scroll position was not reset.
- Three increasing frame IDs were read through the same consumer/runtime document
  binding. Navigating A rejected capture with `BROWSER_DOCUMENT_CHANGED`; it did
  not silently bind the new document.
- Runtime session count after cleanup was zero. Owned browser and HTTP server closed.
- Offscreen PNG was visually inspected and showed the original green region/clock.
- Sample capture times were 267 ms inactive and 1147 ms offscreen. These are single
  samples, not video/FPS acceptance or a claim of consistently low latency.

## Failed attempts retained

R1/R2 failed visibility preconditions. The probe previously created another page
without constraining its browser window. R3 explicitly created a same-window tab
and passed both capture cases, then exposed Playwright's decorated exception text
being reduced to a generic runtime failure by the test adapter. R4 carries the
worker's explicit error code across that test boundary and passes navigation too.
Assertions were not relaxed; all prior artifacts remain available.

## Checks and remaining scope

Focused TypeScript checking (Bundler resolution, Node and Vite types), ESLint and
both repository diff checks passed. Hook strict size checking passed with 1115
files and no exceptions. This increment changes acceptance code, not installed
product payloads, so no new full application release was produced.

Still missing: actual Hook controller/UI rendering in this same real-browser run,
signed capability admission, registered native messaging and installed-product
acceptance. This is an isolated transport adapter, not a production authorization
or native-messaging substitute. Abrupt-termination recovery, bounded preparation
waiting, browser interaction and multi-region video performance remain open.

The requested product objective remains active. This result proves the selected
ordinary DOM region can survive scrolling/tab switching through the real runtime
and Hook backend; it does not claim the installed application already does so.
