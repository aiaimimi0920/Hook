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

## Cross-device LiveRelay entry

The source Live Unit's parameter panel exposes **实时投射 → 发布到 Loom**. The receiver
uses a Surface-capable Art Unit on its paired default Loom: open the parameter panel,
refresh the session list, select a connected source and choose **加入观看**. A real,
non-disposed Surface attachment is required. This is not a QR image import or a tile wall.

`UnitLiveViewer.tsx` reads the mounted attachment from `surfaceStore`; the existing
`liveRelayController.join` and native command revalidate the session and device on Loom.
No permission is synthesized, and joining does not acquire controller ownership.
The global controller rejects concurrent joins for the same session and admits at most
four pending join requests. An obsolete Surface generation/attachment or a closed panel
causes a late join to stop only its newly created relay. Established viewers remain owned
by `LiveFeatures` and can be closed from the viewer window independently of the Art panel.

After Loom deletes a device, choose **重新配对** in the receiver panel. This explicit
request reuses the persisted Ed25519 key pair, submits registration without requesting
approval or a session token, and invalidates only that Loom origin's cached sessions.
If the device ID changes, the existing Surface reset/attach owner obtains new bindings;
the user must approve the device in Loom, then refresh, select and join again. Closed
viewers remain terminal with their old authorization and do not block a new relay for
the same live session. Connected/recovering viewers still prevent duplicate joining.
The pending operation is shared across panels; a disposed owner cannot publish its
late result, and this operation never requests controller ownership.

Late join begins at the exact acknowledged `viewer_joined` event rather than
replaying pre-join control history. The same attachment snapshot initializes each
UIA observation's latest sequence before workers start; subsequent updates must
still be contiguous. Invalid, duplicate or oversized observation snapshots fail
joining. If that anchor or subsequent events are missing,
joining fails instead of silently skipping required control events. A source stop
is confirmed through the authorized session snapshot; the viewer then closes and
clears its last pixels. A temporary transport failure alone keeps recovery available.

This entry has component/controller coverage; real two-device networking, input grants,
revocation and display/performance acceptance remain separate package-bound gates.

The viewer exposes a fixed, read-only `data-live-relay-diagnostic` slot with source,
epoch/frame, received counters and decoded-submitted stages. It retains no frame history
or pixels. See [receiver diagnostics](LIVE_RELAY_DIAGNOSTICS.md) for bounded collection
and actual executable/process SHA binding; these counters are not physical display FPS.

## Failure notices

WGC may stop emitting frames when a captured window is static. After a valid
encoded image, silence without callback errors preserves the capture owner,
latest image and epoch rather than restarting every five seconds. Initial-frame
timeouts and callback failures still recover; source closure, HWND identity and
geometry checks remain active while idle. This does not complete LiveRelay epoch
coordination after genuine device loss or resize recovery.

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
- [GPU presentation](LIVE_GPU_PRESENTATION.md): native texture route and compatibility fallback.
- [Video diagnostics](LIVE_VIDEO_CAPTURE_DIAGNOSTICS.md): controlled probes and capture/presentation evidence boundaries.
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

## Compatibility and validation

The historical controlled runtime baseline covers Windows 11, one active SDR
display, and same-integrity classic Win32/WinForms sources. Logical hiding keeps
the source in composition with alpha 1, preserving its original taskbar/Alt-Tab
eligibility. Activating the source restores its placement/style without closing
the capture or other regions sharing that source. Native minimize is intercepted
to keep rendering; this does not establish capture of genuinely minimized or
`SW_HIDE` windows. WinForms window-message drag may reproduce mouse edges without
every custom control's hardware-input semantics.

A transient input delivery timeout cancels held inputs without replaying the
ambiguous action. Identity and permission checks must pass again before the next
user action is accepted; other input failures still disable control. Owned HWND
regressions cover this recovery and shared visibility/style restoration, not
arbitrary browser-control compatibility.

Native minimization and transient coordinate conversion failures also cancel the
current input without permanently disabling control. Input mapping is deferred
while the source is iconic, since its minimized placement cannot map the captured
region. Passive hover failures during this transition are quiet; action failures
remain visible and are not replayed. The opt-in `live-browser-input-probe.mjs`
checks a cropped Chromium video control through native Hook input, with a DOM
playback/click oracle in visible, logically hidden and restored states, for both
normal and maximized windows. It uses an isolated browser, not the user's profile.

Closing a Live sticker (including Escape/delete) never requires a fresh GPU
snapshot. The recycle bin retains the latest cached frame when one exists; a
source that failed before its first frame can still be closed. Export/edit
actions continue to require their normal snapshot boundary.

Source foreground ownership alone does not reclaim a logically hidden window:
browsers can activate themselves while handling forwarded input. Shared source
visibility requires a fresh taskbar/switcher click or task-switch key token before
accepting a foreground transition or taskbar minimize toggle. Ordinary mouse
motion cannot authorize restoration, even between forwarded input and delayed
browser activation. Tokens expire and are invalidated by new physical overlay
input, not by delayed IPC input that predates the shell gesture. An iconic source
also has to match the foreground owner recorded at the shell gesture. The low-level
mouse hook only checks shell ownership on button-down, not
on the high-frequency move path; it never changes window styles or waits there.
The browser probe polls source visibility after input and checks alpha remains 1,
in addition to checking that the video control actually changes playback state.

Temporary capture rebuild failures (including a crop temporarily outside a resized
source) remain recovering rather than permanently exiting after three attempts.
The owner retries with a cancellable 400 ms to 2 s backoff, still checking source
identity and native minimization before rebuilding. Source closure/identity loss
remains terminal. The isolated browser probe holds an invalid crop for 8 seconds,
then verifies streaming with a newly captured frame and prompt stop during retry.
Successful capture/input clears only its own old error notices, not unrelated
notices on the sticker. Esc/delete remains independent of recovery/readback.

Current input policy permits the same user's equal-or-lower-integrity source on
the active default desktop/session and rejects upward, cross-user/session and
secure-desktop input. The isolated Godot Button probe is an additional narrow
input check, not acceptance of every editor control or logical-hide mode.

| Environment or source | Evidence boundary |
| --- | --- |
| Classic Win32 / WinForms, Win11, SDR | Controlled capture, logical hide, click/key/wheel, reclaim and restoration baseline. |
| WPF at 150% DPI | Changing frames and click were observed; logical-hide continuity remains outside the accepted baseline. |
| Browser / Electron | Native window pixels follow scrolling and tab changes; the controlled Win32/WinForms input matrix does not establish arbitrary browser-control or pinned-document support. |
| WinUI/UWP, Qt/Flutter, custom Canvas/D3D/OpenGL/Vulkan | Require independent controlled fixtures and input/continuity evidence. |
| Multi-monitor, mixed DPI, negative origins | Coordinate contracts exist; single-display results do not establish runtime compatibility. |
| HDR, Win10, RDP, sleep/wake, device loss, protected content | Require their own capture and recovery checks; screenshot HDR support alone does not establish Live support. |

Run the existing interactive probes from the Hook repository root:

```powershell
npm run probe:live-screenshot:phase0
npm run probe:live-screenshot:phase2
npm run probe:live-screenshot:phase3
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/Invoke-LiveScreenshotPhaseSixProbe.ps1
```

- Phase 0 uses owned Win32/WinForms/WPF fixtures to inspect changing WGC frames,
  per-control UIA patterns and same-integrity raw input. Its short samples cannot
  establish sustained FPS, latency or resource stability.
- Phase 2 exercises the product worker for 600 seconds, resize/epoch transitions,
  exact `source_closed` failure, stop/join and cleared frame queues. Its locked
  resource-growth limits are +32 handles and +134,217,728 private bytes, comparing
  the 120-180-second median with the final 60 seconds. Discarding obsolete frames
  is bounded backpressure; consumed frames are not rendered-frame measurements.
- Phase 3 checks logical hide, ordered input, exact restore, local reclaim and
  watchdog journal recovery. The journal contains window identity, placement and
  style attributes, without titles, pixels, text or keyboard data.
- Phase 6 checks UIA independently from the input loop and runs a no-semantics
  fallback. Missing UIA must not disable transparent interaction. The historical
  relay/fanout run was on one host; separate-machine UIA latency and reliability
  still need their own evidence.

UIA capabilities are per-element/provider facts: a Slider type alone does not
imply `RangeValue`. Stable locators use AutomationId, control type and ancestry;
Runtime IDs are diagnostic only, and duplicate locators fail closed. Logical
hiding may temporarily remove title-bar nodes; report them stale rather than
inventing a value. Observer threads, capture workers and input ownership must
all terminate or restore on teardown.

The original environment, detailed G0/G2/G3/G6 results and sample counts remain
recoverable with `git show cleanup-base-20260928:docs/LIVE_SCREENSHOT_COMPATIBILITY_BASELINE.md`.
Those dated results neither certify a later binary nor broaden the support
matrix. Store fresh candidate acceptance with that candidate's release evidence.
