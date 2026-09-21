# Real frontend workload baseline

The new `scripts/tests/live-frontend-workload-probe.ts` uses explicitly synthetic
selection events in an owned native acceptance instance to create actual frontend
Live Units. It is not a native shortcut, pointer or source-input acceptance test.
`nativeSelectionAcceptance` is always false. Production code is unchanged.

The PowerShell wrapper accepts `-GpuPreview -FrontendBenchmarkCount 1|2|4|6`,
separately from other probe modes. Each run owns its fixture, isolated app data,
WebView profile, Hook process and runner. It records actual Unit session IDs,
checks their source HWND, waits for GPU-mirror presentation, and samples a timed
five-second frontend workload. The fixture animates through its existing video
mode; it is not a hardware-decoded browser video benchmark.

Requested total crop area stays constant across counts by partitioning one
rectangle into tiles. DPI rounding can affect actual ROI edges. Reports retain
submitted-counter deltas, elapsed time, raw requestAnimationFrame intervals and
native resource samples. Counter updates are observed through the frontend's
existing poll cadence, so deltas are not exact display-FPS or latency measurements.

## Observed result

`artifacts/live-frontend-one-20260907-r1/summary.json` passed on packaged V0.2.28:

- One real frontend Unit; one shared window capture pool.
- Requested crop area 265,524 physical pixels.
- 5,015 ms sample; submitted counter increased by 200.
- RAF p95 and maximum about 16.8 ms.

This is a baseline from one run, not proof of a speedup or absence of whole-machine
lag. V0.2.28 predates the progressive pressure controller source changes.

## Initial multi-Unit attempts (retained failed evidence)

Six-Unit attempts were rejected when the second Unit bound to a different source.
The r4 report (`artifacts/live-frontend-six-20260907-r4/summary.json`) records
fresh window hit-test candidates: the first selection sees the fixture first;
the second sees another window ahead of it. Refreshing client coordinates did
not change this fact. Waiting for fresh target enumeration also did not fix it.
Do not report these attempts as a six-source performance regression or benchmark.

The harness now rejects that source ordering before emitting selection edges,
and still verifies the resulting native source identity after creation. It never
hides, minimizes or kills competing user windows. A reliable fixture-creation
boundary is still needed for 2/4/6-Unit measurement under this environment.

All tracked sessions are stopped; stop failures fail the probe. The harness
additionally waits for zero active reservations and shared pools before requesting
graceful acceptance exit. It records cleanup errors rather than hiding them.
The outer wrapper retains bounded process cleanup if the frontend is unavailable.

Final TypeScript test typecheck, strict effective-line checks and Hook/Loom diff
checks passed. A fresh process/profile audit found no remaining frontend probe
instances. The final preflight refusal is typechecked but not a successful
six-Unit run; the earlier failed results are retained without relabeling.

## Follow-up: valid source selection and packaged GPU regression

Horizontal strips now start at the same unobstructed left edge, preserving source
hit-test checks without changing user windows. This created all six correct-source
Units and exposed a real DPI/aspect-ratio GPU eligibility defect on V0.2.28.
After fixing contained-image geometry, packaged V0.2.29 passed 1/2/4/6 actual
frontend Unit runs at equal requested total crop area. Full measurements and
limitations are in `LIVE_CONTAINED_GPU_PREVIEW_20260907.md`. Earlier failed runs
remain failures; the successful follow-up uses separate artifact directories.
