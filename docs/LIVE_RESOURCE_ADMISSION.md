# Live runtime resource admission

## Delivered boundary

Local WGC capture no longer has a fixed four-source product limit. A source must
reserve capacity before spawning its worker. The existing map and GPU-slot bounds
remain as a final **16-source safety ceiling**, not a promise that every machine
can run 16 sources or that admitted sources retain their requested FPS.

`live_resources/policy.rs` owns admission and hysteresis; `metrics.rs` owns cached
Windows counters; `mod.rs` owns the process-wide reservation lifetime. The capture
preflight creates an item to inspect source geometry but no WGC pool. Every later
pool build/rebuild revalidates its actual source/crop cost before allocation.
Failed spawn and worker teardown release the reservation; stopping one source
does not close another. Resizing beyond capacity fails explicitly rather than
allocating an unbudgeted larger pool.

## Inputs and conservative policy

- Sample at most once per second during source work/admission/status queries.
  No polling process, service, or additional sampler thread is created.
- RAM: physical total/available memory and Hook-process private bytes. Keep at
  least 10% of physical RAM or 512 MiB available, whichever is greater. Estimated
  Live memory is additionally bounded by one eighth of physical RAM or 2 GiB.
- GPU: use the capture device's DXGI adapter local-segment **process budget and
  current usage**, not the GPU's advertised VRAM or whole-machine utilization.
  Estimated Live GPU bytes must fit one third of the process budget, capped at
  1 GiB; missing DXGI counters use a conservative 256 MiB estimate. Keep 15% of
  the reported process budget free when admitting new allocations.
  Existing reusable preview payloads survive budget shrink; only new/growing
  payloads require new presentation headroom, avoiding permanent fallback churn.
- Estimate two full-source BGRA pools, crop/mailbox/presentation/staging
  allowances, decoded/encoded copies and fixed bookkeeping. A small crop of a
  large window is not charged as if only the crop were captured.
- Reserve concurrent starts immediately, before their allocations appear in OS
  counters. Compare later samples with a pending cohort to raise memory/GPU cost
  factors and marginal process-CPU estimates. Start/stop mixtures invalidate
  attribution but keep pending allocations charged until fresh samples catch up.
- CPU: consider sampled system utilization plus estimated new-source CPU cost
  (at least two percentage points). Refuse an estimated total above 85%.
- RAM/GPU pressure or CPU at least 85% latches protection: start at a 2x capture
  interval and increase once per fresh sample up to 8x, never beyond one second;
  reject additional sources. Each five consecutive fresh samples below 65% CPU
  with no RAM/GPU pressure halve the interval multiplier, rounding up. Recovery
  from 8x follows 8 -> 4 -> 2 -> 1 over 15 quiet samples rather than 35. Missing
  CPU telemetry does not prove recovery. Existing stickers are not deleted.

These constants are conservative policy values protected by synthetic weak/strong
machine and lifecycle tests, not calibrated performance guarantees. The existing
120-frame/s and 124,416,000-source-pixel/s aggregate scheduling targets and single
CPU fallback permit remain. Larger machine memory is not evidence of proportionally
higher GPU throughput, so this version does not increase those rates automatically.

## Diagnostics and visible refusal

`get_live_resource_status` returns only aggregate counters: active reservations,
hard ceiling, reserved RAM/GPU estimates, current sampled counters, growth factors
and pressure state. `activeSources` counts admitted Unit reservations;
`sharedWindowCapturePools` separately counts actual shared window WGC pools.
It does not return page titles, URLs, images or input data.
There is deliberately no universal "remaining sticker count": the next full 4K
source and the next small crop have different costs.

Resource refusals use bounded fixed codes. After capture input has been cleaned
up, Hook explains a refusal on the most recent Live Unit's notice stack, or in a
dialog when no Live Unit exists. It does not silently swallow a resource refusal.

## Limitations

- Same-window regions now share WGC pools; see `LIVE_SHARED_SOURCE_CAPTURE.md`.
  Reservations intentionally still charge full-source costs per Unit. They remain
  conservative during join/resize/recovery and are not measured resident memory.
- Incremental growth is a conservative heuristic, not causal profiling. Hook
  private-memory/process-CPU counters exclude WebView child processes; system
  CPU/RAM reflect competing applications. Other work can cause overestimation.
- GPU counters are one adapter's local-segment process view. They do not measure
  GPU engine utilization, all adapters or guaranteed resident memory. The byte
  model is an estimate, not a driver-memory/OOM proof.
- `GetSystemTimes` covers the caller's processor group on systems with more than
  64 processors. That hardware class has not been validated.
- Workload changes after admission (video starts, effects enable, other software
  consumes resources) can still lower performance. Pressure mitigation is bounded
  throttling and refusal, not transparent eviction or an arbitrary-app FPS promise.
- Browser tab/DOM binding is not installed by this change. The isolated
  `scripts/tests/live-browser-binding-probe.ts` evaluates CDP target screenshots,
  offscreen document-region refresh and an ordinary DOM button only. It does not
  advertise an available adapter, bypass Loom package trust, or change Ctrl+2's
  window-pixel binding. Browser permission, adapter packaging, actual Live Unit
  transport/input and arbitrary-page/video acceptance remain separate work.

## Verification

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib live_resources
npx vitest run __tests__/unit/liveCaptureAdmissionFeedback.test.ts
$env:HOOK_BROWSER_VIDEO_MULTI = "1"
$env:HOOK_BROWSER_VIDEO_COUNT = "6"
node --experimental-strip-types scripts/tests/live-browser-video-probe.ts artifacts/six-live-owned-probe
node --experimental-strip-types scripts/tests/live-browser-binding-probe.ts artifacts/browser-binding-owned-probe
```

The video probe creates only an owned browser/profile and source/output windows;
it verifies six changing production workers, native texture delivery, fallback,
visibility restoration, sibling stop and zero remaining reservations. It does not
establish six real graph Units or monitor FPS. The packaged real-Unit probe remains
required for placement, drag, editing, shortcuts and interaction.

API references: [DXGI memory info](https://learn.microsoft.com/en-us/windows/win32/api/dxgi1_4/ns-dxgi1_4-dxgi_query_video_memory_info),
[GetSystemTimes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getsystemtimes),
[CDP region screenshots](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-captureScreenshot).
