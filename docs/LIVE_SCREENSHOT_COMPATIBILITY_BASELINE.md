# Live Screenshot Compatibility and Runtime Baseline

Status: **G0, G2, and G3 Go for the narrow initial support declaration below.**
G2 covers the single-device Hook live owner; G3 adds logical hiding and local
transparent interaction. Remote transport/input, semantic observation, and the
wider Windows matrix remain gated by their later phases.

## Purpose and boundary

Phase 0 validates the Windows capture, UI Automation, input, and resource
assumptions needed before Hook and Loom add `loom.live.v1`. The probe is test-only:
it does not register a product command, start a live session, or change the
existing screenshot path. Phase 0 intentionally produces no release binary.

Run an interactive fixture from the Hook repository root:

```powershell
npm run probe:live-screenshot:phase0
# Or append: -- -FixtureKind Win32
# Or append: -- -FixtureKind Wpf
```

The command builds a temporary WinForms, WPF, or classic Win32 fixture below
`artifacts/live-screenshot-phase0/<run-id>`, captures it through Hook's opt-in
persistent WGC path, inspects only that fixture's UIA tree, performs one
same-integrity raw mouse click, then starts a persistent HWND capture before
moving the source to `-32000,-32000`. It records bounded process-tree samples,
restores the window, and removes the fixture process. Generated evidence is
intentionally excluded from Git.

## Measured environment

The first reproducible run was measured on 2026-09-04:

| Dimension | Observed value |
| --- | --- |
| OS | Windows 11 Home China, 10.0.26200 |
| Interactive session | Yes |
| Active displays | One, 2560 x 1440, 32 bpp |
| HDR | Disabled for the captured display |
| Physical GPU | NVIDIA GeForce RTX 2080 Ti |
| Additional display adapters | AskLink virtual display; MuMu virtual display |
| Fixtures | Same-integrity classic Win32, .NET WinForms, and WPF windows |

Virtual adapters were present but did not expose additional active `Screen`
entries. They are not counted as multi-monitor evidence.

## Locked initial support declaration

The historical same-integrity acceptance below is not a requirement to elevate
ordinary source applications. As of V0.2.11, the input permission policy allows
the same user's equal-or-lower-integrity source on the same active default
desktop/session, while rejecting upward input. The Godot source-input probe
(`scripts/tests/Invoke-LiveSourceGodotProbe.ps1`) additionally tests a real Button
effect in an isolated Godot window; that does not promote every editor control,
logical-hide mode, or rendering framework into the historical full matrix.

The first implementation target is deliberately limited to **Windows 11,
single active SDR display, same-integrity source, classic Win32 or WinForms,
using a near-transparent compositor-window logical-hide strategy**. Native minimization,
`SW_HIDE`, elevation boundaries, HDR, RDP, mixed DPI, and other framework rows
are unsupported until their own reproducible evidence passes.

This is the complete Phase 0 declaration: rows outside that narrow target are
explicitly excluded rather than inferred to work. G0 permits protocol work; it
does not waive the 600-second G2 resource gate or G3 product-runtime proof.

## Phase 2 G2 result

Run the product live-worker probe from the Hook repository root:

```powershell
npm run probe:live-screenshot:phase2
```

The accepted run is `artifacts/live-screenshot-phase2/20260904-201648`. On the
single active 2560 x 1440 SDR display, the animated WinForms source ran for 600
seconds and produced 2,950 consumed frames with 2,944 distinct SHA-256 digests.
The maximum observed gap between consumed frames was 543 ms. Resizing the source
advanced the WGC epoch from 1 to 2 and resumed fresh frames. Explicit session stop
joined the worker and cleared its queue; closing the source produced the exact
`source_closed` failure and also cleared buffered frames.

The resource sampler compared process-tree medians from 120-180 seconds with the
last 60 seconds. Handles changed from 724 to 734 (+10, locked limit +32); private
bytes changed from 76,599,296 to 80,472,064 (+3,872,768, locked limit +134,217,728).
The gate passed. The bounded frame path intentionally discarded 3,548 obsolete
callback/queue frames instead of blocking capture. This is backpressure evidence,
not a promise that this CPU JPEG presentation path delivers 12 rendered fps.

G2 also keeps deterministic contracts for negative origins, mixed-DPI display
selection, and fractional scaling. The accepted runtime machine had one active
display, so multi-monitor/mixed-DPI rows remain contract-tested but not promoted
to observed runtime support.

## Phase 3 G3 result

Run the declared-matrix probe from the Hook repository root:

```powershell
npm run probe:live-screenshot:phase3
```

The accepted run is `artifacts/live-screenshot-phase3/20260904-230733`. It sampled
both declared rows. Classic Win32 produced 16 hidden frames with 13 distinct
digests and 11 post-restore frames; WinForms produced 16/16 hidden frames and 11
post-restore frames. Both independently observed click and keyboard edges, changed
their native slider on wheel input, and observed either a native trackbar drag
effect (Win32) or the fixture's mouse down/move/up edge sequence (WinForms).

Both rows restored exact bounds, released tracked input on local reclaim, executed
the same journal-based restoration routine used by the watchdog, removed the
journal, joined the capture worker, and cleared buffered frames. Hook core and
extension shortcuts now ignore the focused live-control subtree; unit tests cover
that routing boundary. The recovery journal stores only HWND/process/thread,
placement, style, and layered attributes, is flushed then atomically replaced,
and contains no title, frame, text, or keyboard data.

G3 does not claim that WinForms window-message drag reproduces every custom
control's hardware-input semantics. It also does not claim native minimization:
the accepted strategy keeps the source in composition as a non-activating window
with alpha 1 and reports native-minimize support as false.

## Current measured result

The locked 2026-09-04 matrix used 12 visible samples and four logical-hide
samples per fixture at a nominal 100 ms sampling interval:

| Fixture / evidence directory | Visible frames / distinct | Physical crop | Call ms min / max / mean | Offscreen frames / distinct | Raw click |
| --- | --- | --- | --- | --- | --- |
| Win32 / `20260904-175943` | 12 / 10 | 686 x 470 | 104 / 565 / 163.67 | 4 / 3 | Pass |
| WinForms / `20260904-175955` | 12 / 11 | 686 x 470 | 78 / 700 / 162.92 | 4 / 3 | Pass |
| WPF / `20260904-180007` | 12 / 10 | 1029 x 705 at 150% DPI | 144 / 777 / 237.08 | 3 / 3 | Pass |

All visible runs retained the thread-local display WGC session. Win32 and
WinForms produced every requested persistent HWND sample after moving offscreen.
WPF produced changing offscreen frames but missed one bounded sample, so it is
not in the initial support declaration. The three bounded process samplers saw
private-byte peaks from 209,825,792 to 259,477,504 bytes, working-set peaks from
228,577,280 to 258,002,944 bytes, and handle peaks from 807 to 819. Each runner
then cleaned up its owned cargo and fixture process tree.

These timings include frame waiting and CPU readback/cropping. They are not
end-to-end presentation latency, encoded media latency, or a frame-rate promise.
The short run establishes a Spike baseline only; it does not satisfy the later
600-second G2 leak gate.

## UI Automation capability result

The fixtures exposed the following exact provider results:

| Provider | Progress bar | Button | Text box | Check box | Slider |
| --- | --- | --- | --- | --- | --- |
| Classic Win32 | numeric ID, `RangeValue` | numeric ID, `Invoke` | numeric ID, `Value` | numeric ID, `Invoke` + `Toggle` | numeric ID, `RangeValue` |
| WinForms | `buildProgress`, `RangeValue` + `Value` | `actionButton`, `Invoke` | `textValue`, `Value` | `toggleValue`, `Invoke` + `Toggle` | `rangeValue`, `Value` only |
| WPF | `buildProgress`, `RangeValue` | `actionButton`, `Invoke` | `textValue`, `Value` | `toggleValue`, `Toggle` | `rangeValue`, `RangeValue` |

The slider result demonstrates why capabilities must be reported per element and
pattern. Hook must not infer `RangeValue` merely from a `Slider` control type.

## Provisional support matrix

Only an explicit `observed-pass` row may be used as implementation evidence.
`Not tested` means unsupported for the initial declaration until a real run is
recorded; it does not mean the technology is impossible.

| Program/system class | Persistent changing frames | UIA | Raw input | Logical hide/minimize | Status |
| --- | --- | --- | --- | --- | --- |
| Classic Win32, Win11, same integrity, SDR | Yes | Per-control patterns recorded | Click/key/wheel/native trackbar drag passed | Near-transparent 16 frames/13 distinct; exact restore | Initial supported |
| WinForms, Win11, same integrity, SDR | Yes | Per-control patterns recorded | Click/key/wheel and mouse drag-edge sequence passed | Near-transparent 16/16 changing; exact restore | Initial supported with window-message caveat |
| WPF, Win11, same integrity, 150% DPI, SDR | Yes | Per-control patterns recorded | Mouse click passed | Offscreen 3/4, changing | Excluded pending continuity proof |
| WinUI/UWP | No reproducible safe fixture | Not declared | Not declared | Not declared | Initial unsupported |
| Electron/browser | Installed candidates only; no controlled oracle | Not declared | Not declared | Not declared | Initial unsupported |
| Qt/Flutter | No lightweight controlled fixture | Not declared | Not declared | Not declared | Initial unsupported |
| Custom Canvas/D3D/OpenGL/Vulkan | No controlled oracle; protected-content boundary unknown | Not declared | Not declared | Not declared | Initial unsupported |
| Elevated target from ordinary Hook | Not attempted by test harness | Not declared | Must fail closed | Not declared | Initial unsupported |
| RDP / other user session | No test environment | Not declared | Must fail closed | Not declared | Initial unsupported |
| Win10 | No test environment | Not declared | Not declared | Not declared | Initial unsupported |
| Multi-monitor/mixed DPI/negative origin | Deterministic coordinate contracts only | Not declared | Not declared | Not declared | Initial unsupported |
| HDR | Hardware probe explicitly reported disabled | Not applicable | Not applicable | Not declared | Initial unsupported |
| Sleep/wake/window recreation | No safe automated environment transition | Not declared | Not declared | Not declared | Initial unsupported |

## Fixture and evidence inventory

- `scripts/tests/fixtures/LiveScreenshotPhaseZeroFixture.cs` owns the animated,
  known-control WinForms oracle. The adjacent `...Win32Fixture.cs` and
  `...WpfFixture.cs` files own their framework-specific oracles.
- `scripts/tests/Invoke-LiveScreenshotPhaseZeroProbe.ps1` owns compilation,
  process isolation, environment capture, resource sampling, and cleanup.
- `src-tauri/src/screenshot/wgc_persistent/live_probe_tests.rs` owns the ignored
  Windows-only WGC/UIA/raw-input probe.
- Existing deterministic Rust tests continue to cover monitor identity,
  negative-origin selection, fractional-DPI rounding, HDR policy, suspicious
  black-frame rejection, and persistent-session thread ownership.
- `scripts/tests/Invoke-LiveScreenshotPhaseTwoProbe.ps1` and
  `screenshot/live_capture_tests.rs` own the G2 product-worker soak, resize,
  source-close, resource-growth, and cleanup evidence.
- `scripts/tests/Invoke-LiveScreenshotPhaseThreeProbe.ps1` and
  `screenshot/live_source_phase3_tests.rs` own the G3 declared-matrix hide,
  input, reclaim, recovery-journal, exact-restore, and cleanup evidence.
- `scripts/tests/Invoke-LiveScreenshotPhaseSixProbe.ps1` owns the G6 provider
  matrix. It runs UIA independently from the Phase 5 input loop, then runs a
  separate WinForms fallback pass with no semantic capability dependency.

## Phase 6 UI Automation candidate

The accepted G6 run is
`artifacts/live-screenshot-phase6/20260905-r20/summary.json`. It used real WGC
frames, Loom HTTP/WebSocket relay, three paired device sessions, and two viewer
processes for each declared provider. Every check in the G6 summary passed.

| Provider | Exact/anchored observations | Stable | Final stale/error | Capabilities |
| --- | ---: | ---: | ---: | --- |
| Classic Win32 | 12 / 12 | 11 | 0 | `uia_tree`, `invoke`, `range_value`, `toggle` |
| WinForms | 15 / 15 | 12 | 0 | `uia_tree`, `invoke`, `range_value`, `toggle`, `value` |

Both runs found `Window`, `ProgressBar`, `Button`, `Text`, `CheckBox`, and
`Slider`, delivered reliable observation state to both viewers, retained stable
element bindings after restore, and stopped the UIA owner thread cleanly. The
observer owns an MTA COM context on one dedicated thread, subscribes only to
structure changes, and re-resolves exact properties on a bounded one-second
periodic scan. Provider-owned property callback variants are not retained.

Stable observation IDs use `AutomationId`, control type, and stable ancestry;
when an AutomationId exists, a changing accessible Name is display data rather
than identity. Runtime IDs remain diagnostic data and are not used as the stable
cross-resolution key. Duplicate stable keys fail closed as
`uia_locator_ambiguous`.

Logical hide continued to produce updated business-control observations for both
providers. Applying the tool-window style may temporarily remove the native
title-bar minimize/maximize nodes; those two nodes were reported honestly as
`stale` with `element_not_found` and no value. The gate permits only that exact
TitleBar transition and rejected zero unexpected hidden-state errors. All 12/15
observations were exact and non-error again after restore.

Resource checks use the most frequently observed stable process topology rather
than mixing cargo startup/exit processes into handle growth. Win32 recorded 10
steady samples, -5 median handles, and 3,043,328 bytes median private growth;
WinForms recorded 11 steady samples, +1 median handle, and -1,921,024 bytes
median private growth. Per-process samples are retained in each provider's
`process-samples.json` for attribution.

The separate WinForms no-semantics fallback completed ten ordered input events,
source reclaim, and input release with no endpoint errors. This demonstrates
that missing UIA semantics do not disable transparent Phase 5 interaction. WPF
remains excluded pending logical-hide continuity proof and WinUI remains
unsupported; G6 does not broaden the Phase 0 declaration.

## Risks and required next evidence

1. The current persistent capture path is opt-in, full-display, CPU-readback based,
   and owned by one blocking thread. It is a reusable Spike, not the Phase 2 live
   session owner.
2. WGC capture-call timing is currently too slow and variable to infer an
   interactive frame-rate target. Phase 0 must measure raw frame callbacks and
   presentation latency separately before setting thresholds.
3. G3 covers the near-transparent compositor-window strategy and exact recovery;
   it does not claim native minimize, `SW_HIDE`, or broader application classes.
4. The test does not exercise DPI transitions, negative monitor origins, HDR,
   protected content, sleep/wake, RDP, or device loss.
5. UIA is measured for three providers. Per-control pattern absence must remain
   an explicit capability result; classic Win32 IDs are numeric rather than the
   fixture's symbolic labels.
6. Same-integrity mouse input passed. UIPI, elevated targets, lock screen, secure
   desktop, and cross-session input remain mandatory fail-closed tests.
7. Short process samples prove cleanup for this run, not absence of long-duration
   GPU, COM, handle, or memory growth.
8. G6 exercised Loom media transport, observation fanout, and the independent
   Phase 5 fallback on one host. A separate-machine LAN run is still required
   before claiming cross-machine UIA latency or reliability.

G0 is Go only for the narrow declaration above. Later phases must keep excluded
rows fail-closed, publish capability reasons, and add real evidence before
expanding support.
