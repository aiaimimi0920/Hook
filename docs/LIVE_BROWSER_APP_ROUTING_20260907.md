# Browser Live routing in the application

## Implemented

The real App now constructs its existing Live controller with
`createAppLiveCaptureBackend(api)`. Ordinary selections retain the native path.
Selections carrying both `browserGrantId` and `browserAuthorization` use the
browser provider, whose installed-package trust and permission checks remain
unchanged. Missing/rejected browser credentials fail closed, without silently
falling back to screen capture. This prevents a failed document binding from
appearing successful while still changing with scrolling.

One browser backend is shared across application sessions, preserving its
aggregate retained-frame budget. Session ownership routes polling, frame reads,
input, controls and teardown to the backend that created the session. Closed
sessions cannot accidentally invoke the native backend. Bridge authorization
metadata is consumed locally rather than copied into the provider selection
payload; only the opaque region grant and capture geometry are forwarded.

## Fresh verification

- Three routing tests pass: native path, browser lifecycle/credential separation,
  and no fallback after missing/revoked grants.
- Six browser backend tests, two real Live Unit controller tests, and twelve
  native controller runtime tests passed (23 focused tests total).
- Live Unit tests additionally assert grant and originating target preservation
  through the real controller's request conversion.
- Production and test TypeScript checks passed. Focused production ESLint passed.
- Strict line checks passed for Hook (1110 files, no soft exceptions) and Loom
  (981 files, 12 existing soft exceptions). Both Git diff checks passed.
- Hook frontend build succeeded in 37.92 seconds; `.output/public/index.html`
  exists. Log: `artifacts/browser-live-app-routing-build.log`. The existing large
  bundle warning remains. No executable release was replaced or installed.

## Remaining product boundary

The Ctrl+2 selection caller still supplies ordinary window geometry; it does not
yet acquire the browser grant/authorization envelope. The extension-to-Hook grant
handoff, verified native-host installation and capability packaging remain open.
Thus the application now has a connected backend route, but the requested
scroll/tab-independent Ctrl+2 experience is not yet product-complete. Browser
capture latency and real integrated shutdown also require release acceptance.
