# Native GPU Live: separate presentation from status polling

## Proven redundant work

`liveCaptureController` previously scheduled `poll_live_capture_frame` using the
capture target FPS even while the native GPU mirror suppressed CPU/JPEG output.
At a 60 FPS target, six mirrors could therefore issue about 360 status/frame IPC
requests per second without using those requests to display the video.

This is independent of the shared WGC source pool. Sharing capture ownership does
not automatically remove per-Unit IPC, reactive status updates, crop copies or
swapchain presentation.

## Bounded change

- The capture controller registers a per-session polling lease.
- Only a successful native `configure_live_gpu_preview` response with an active
  layout, `presenting=true` and no error renews that lease.
- A healthy mirror uses a 250 ms status polling interval. GPU submission,
  source capture target FPS and native presentation are unchanged.
- The preview scheduler checks layout every 80 ms, but an unchanged acknowledged
  mirror renews native status every 160 ms. Geometry, visibility, and composition
  changes still configure immediately on the next check. Initial activation and
  failed requests retain the fast cadence. A 500 ms
  lease expiry prevents a lost preview component or stalled renewal from keeping
  the controller permanently in slow-poll mode.
- A disabled mirror, handoff, configure error, changed binding or cleanup clears
  its acknowledgement. A waiting status timer is replaced with an immediate poll.
- If a poll is already in flight, no second poll is started. Completion selects
  the fallback cadence; this optimization does not introduce a new timeout for an
  already stalled IPC/decode operation.
- Before native presentation is acknowledged, first-frame and JPEG polling retain
  the existing pacing. Static GPU-to-DOM handoff still uses the retained snapshot
  rather than waiting for a new source frame.
- Stop and dispose remove controller-owned registrations. Unregistered session
  updates are ignored. Native session IDs include process ID, time and a monotonic
  process-local sequence; they are not user-provided reusable browser identifiers.

The lease bridge is deliberately not a second frame transport or a capture budget.
It does not change source permissions, source identity, resource admission, queue
limits, texture ownership or browser access.

## Regression proof

Focused tests cover first-frame pacing, acknowledged slow polling, expiry,
immediate waiting-timer fallback, independent sessions, cleanup and no overlapping
poll when disabling during an in-flight request. The six-session controller test
renews the real lease interface every 80 ms and observes 24-30 poll calls over a
one-second fake-timer window, including interval-boundary calls.

These are scheduling/IPC-call-count tests, not a measured reduction of whole-PC
CPU usage or a video FPS benchmark. Release `VALIDATION.md` records actual build,
test and packaged runtime results separately.

## Stable-layout configuration optimization

The 80 ms layout clock previously sent the same configure IPC even when geometry
and visibility had not changed. Cache only acknowledged layouts; compare all five
layout fields and visibility before deferring the next request. A deferred check
does not renew either the native or frontend lease. The native lease is 350 ms,
so a 160 ms heartbeat leaves substantially more scheduling margin than a 250 ms
heartbeat rounded up to the next 80 ms tick.

In the same 960 ms fake-timer runtime test, configure calls fell from 13 to 7,
including initial activation. This halves steady-state configuration traffic;
it does not halve total GPU or CPU usage. Frame capture and presentation rates
are unchanged. Each check now reuses one image bounds measurement, and fully
offscreen images skip style and all-Unit occlusion work. A delayed handoff still
remeasures visibility before disabling its native cover.

Tests cover unchanged layouts, immediate movement, unacknowledged activation,
heartbeat errors, offscreen return, drag/edit, overlays, and late cleanup.

## Remaining performance work

Per-crop GPU copies, independent swapchains, compositor locking, CPU fallback and
idle native worker wakeups remain separate costs. This change removes one proved
source of redundant work; it does not establish that all multi-Live stutter has
been solved or that increasing the number of stickers is free.

Browser document binding has been withdrawn. Browser windows use ordinary native
window-pixel capture without an extension.
