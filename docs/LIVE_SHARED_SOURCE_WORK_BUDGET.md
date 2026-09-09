# Shared-source Live work accounting

## Problem and scope

Window crops already share a WGC source keyed by normalized HWND, process ID,
and complete source dimensions. Work scheduling nevertheless charged the full
window pixel rate once per Unit. Six small crops from one 1080p source therefore
looked like six independent full-window acquisitions and were unnecessarily
throttled. This change corrects scheduling, not the number of GPU copies.

## Implemented policy

- Reuse the actual shared-source key, including dimensions, for acquisition
  accounting. Private display captures remain independent even when IDs match
  a shared key's text.
- A shared acquisition uses the fastest subscriber's requested rate, counting
  hidden subscribers at one frame per second. Count the complete source pixels
  once at that rate.
- Charge every output ROI separately at that subscriber's rate. Six large crops
  are still expensive even though their acquisition is shared.
- Apply the existing acquisition ceilings (120 source frames/s, 124,416,000
  source pixels/s) and a separate 124,416,000 output pixels/s ceiling. The chosen
  rate obeys the most restrictive ceiling, plus existing dynamic pressure.
- CPU readback/JPEG permits are unchanged: they remain serialized, fair between
  consumers, and pixel/time bounded. Sharing a source never merges their permits.
- Source groups are derived from current demands; no extra global source registry
  or reference counts can survive the last consumer. Rebinding during resize
  replaces the old identity. GPU/source shutdown remains unchanged.

This does not loosen memory admission. Full-source memory reservations are still
conservative per Unit and need a separate ownership-aware review before reducing
them. It also does not eliminate per-ROI copying, prove lower whole-machine load,
or guarantee video refresh rates on a pressured machine.

## Verification

`live_gpu::work_budget` focused tests: 7 passed. Added coverage establishes:

- Six 100x100 outputs from one 1920x1080 source request 60 source frames/s,
  124,416,000 source pixels/s, and 3,600,000 output pixels/s, with a 1/60-second
  base interval before external pressure. This is a deterministic budget result,
  not a measured video frame rate.
- Six full-source outputs still receive a 100 ms interval because their output
  work is not deduplicated.
- Mixed rates, hidden/removed subscribers, independent CPU permits, source
  rebinding, private/shared identity separation, and last-owner cleanup.

Evidence: `artifacts/live-shared-budget-unit.log`. Follow-up checks completed:

- `live-shared-budget-native.log`: all 3 real native GPU/shared-source tests passed,
  including last-source cleanup and compositor recreation.
- `live-shared-budget-lib.log`: 389 passed, 16 ignored.
- `live-shared-budget-format.log`: formatter check passed.
- `live-shared-budget-lines.log`: strict line check passed, 1095 files.
- Hook and Loom `git diff --check` passed, neither has staged files; Loom was
  not modified. Existing dirty changes were preserved.

This source optimization is not included in the previously built V0.2.26 package.
New packaging and product-level performance acceptance remain required.

## V0.2.27 follow-up evidence

The optimization is now packaged in the separate local candidate
`release/Hook/live-shared-budget-20260907-r1/V0.2.27/portable/hook.exe`.
The build, ZIP packaging, no-GUI self-check, 389 Rust library tests, formatter,
and strict effective-line checks passed. This is not a clean-tag formal release.

The owned Chrome hardware-decoded video test with six Live crops passed:
`artifacts/live-shared-budget-six-20260907-r1/native-summary.json` and
`browser.json`. All six central video regions changed; they used one shared WGC
pool. The GPU measurement phase granted zero CPU readback/encoding permits.
Source work was counted at 60 requested frames/s and 69,572,520 pixels/s, while
the six outputs were correctly charged 200,108,160 pixels/s. Their base budget
interval was 26.806327 ms, not six times the full-window acquisition cost.

Observed GPU submitted counters were 134, 158, 167, 141, 98, and 117; these include
warmup and are not independently timed display-FPS or end-to-end latency metrics.
The browser decoded 2459 additional frames and dropped 39 over the whole probe;
its decoder was `D3D11VideoDecoder`. This is not a paired before/after benchmark
and does not establish perfectly smooth six-Live playback. The native capture
test process's sampled CPU fraction was about 0.00735 and GPU usage 75,161,600
bytes; those exclude the rest of Hook/WebView2 and are not whole-machine totals.

Final cleanup had zero budget demands, zero resource reservations, zero shared
pools, and no CPU permit held. A post-run audit found no Hook/test executable or
Chrome/Edge/WebView2 process using Hook's artifact profiles.

The packaged Ctrl+2 GUI gate still fails before Live creation. The pointer probe
now checks the number of events inserted by
[SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)
rather than treating a cursor position as proof of successful injection. All
insertions succeeded, but no native selection-up log appeared. V0.2.27 records
mouse-hook callbacks taking at least 100 ms through the existing async log queue;
no such outlier was recorded in this failed run. Neither injection failure nor a
slow callback is therefore established as the cause. Logs already use async
`try_send`; a synchronous logging rewrite would not address the observed code.

The browser harness also preserves native exit/log evidence if final video
telemetry fails after the browser closes, instead of masking the native error.
This error branch was syntax-checked; the six-crop run exercised its success path.

Remaining: diagnose native release-edge delivery, measure timed per-Unit frame
cadence/latency under comparable load, review shared-source memory reservation
ownership before relaxing it, and complete browser-content anchoring acceptance.

## Remaining release boundary

The earlier V0.2.26 Ctrl+2 GUI probe stopped after selection down without a native
selection-up log. Extending `.unit-live-input` timeout would not fix that boundary.
The pointer injector reports cursor position, not delivery of the release edge.
That native input issue must be investigated separately before claiming a fully
accepted release; the current budget change does not conceal or bypass it.
