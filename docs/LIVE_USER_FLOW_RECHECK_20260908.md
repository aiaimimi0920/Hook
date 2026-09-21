# Live user-flow recheck: incomplete, not a release acceptance

## Status

The user's requirements are still NOT implemented in the ordinary Ctrl+2 flow:

- A page region must remain attached to its original document position after scrolling.
- The region must continue updating from the original page after switching tabs.

The earlier extension/palette acceptance exercised a different entry path. It
must not be presented as acceptance of Ctrl+2. No production fix or new release
was produced by this diagnostic step.

## Why the two browser requirements fail

`src/services/appLiveCaptureBackend.ts` selects document capture only when the
request includes an authorized browser selection/grant. Ordinary Ctrl+2 supplies
a native window and window-relative rectangle instead. Window capture observes
the currently rendered viewport: scrolling changes its content and switching
tabs changes the document visible in that window. Fixing coordinate arithmetic
cannot turn that source into a document-bound capture.

The installed browser provider already supports an explicitly authorized
document-region flow, but the personal browser profile and ordinary capture
entry are not connected to that flow. Passing a test through an owned Edge
profile, browser action, and command-palette import does not close this gap.

An ordinary Hook shortcut is not a browser activeTab authorization gesture.
The integration must preserve explicit browser authorization rather than
fabricating a grant or treating HWND coordinates as document coordinates.

## Fresh performance evidence

All measurements below are short, sequential runs under changing machine load.
They are diagnostic samples, not an isolated regression benchmark.

| Probe | Previous candidate | Current r3 candidate |
| --- | ---: | ---: |
| GPU submissions / second, one region | 20.12 | 19.33 |
| Frontend animation-frame gap p95 | 16.7 ms | 16.7 ms |
| Resource cadence multiplier at final sample | 4 | 6 |
| Hook process CPU fraction at final sample | 0.00253 | 0.00243 |
| CPU fallback decoded frames / second | 13.16 | 11.24 |
| CPU fallback presentation gap p95 | 133 ms | 195 ms |

Evidence files under `artifacts/`:

- `live-gpu-old-one-20260908/summary.json`
- `live-gpu-r3-one-20260908/summary.json`
- `live-perf-old-20260908/summary.json`
- `live-perf-r3-20260908/summary.json`

GPU submissions are NOT measured monitor presentation FPS. The frontend probe
uses the product renderer and native backend but explicitly reports
`nativeSelectionAcceptance: false`. The video-cadence wrapper forces CPU
fallback; its results do not describe the default GPU path.

Windows GPU preview is enabled by default unless `HOOK_LIVE_GPU_PREVIEW=0`.
The current GPU probe reported system CPU fraction 1.0 and pressure multiplier
6. An independent Windows performance-counter sample reported 94 percent CPU.
The previous-candidate run also entered pressure throttling. This is concrete
evidence that machine-wide pressure is reducing capture cadence in these runs;
it is not evidence that the latest binary alone caused the user's regression.

`src-tauri/src/live_resources/policy.rs` increases the cadence multiplier on
fresh CPU samples at or above 85 percent, or low memory/GPU budget. Recovery
requires five low-CPU samples per step. Consequently, reduced cadence can
persist after a short CPU spike. Removing this protection without a controlled
comparison risks reintroducing the user's earlier whole-machine stalls.

CPU fallback also deliberately serializes readback/encoding and applies a
cooldown in `src-tauri/src/live_gpu/work_budget.rs`. Its low measured FPS must
not be fixed by blindly removing the resource safeguards.

Both one-region GPU probes returned zero active sources, zero shared capture
pools, and zero reserved memory/GPU bytes after stop. The owned Hook processes
exited. This verifies those cleanup counters for these runs only; it does not
prove absence of every driver or multi-region lifetime leak.

## Remaining implementation and acceptance gates

1. Integrate an explicit browser-authorized capture entry into the actual user
   workflow, including extension onboarding in the user's browser profile.
   Native and document capture must not silently substitute for one another.
2. Transfer the authorized selection into a real Live unit without the current
   prepare/action/import detour. Preserve document identity, selection lease,
   cancellation, and last-consumer cleanup. Do not mint a user gesture in a
   background callback.
3. Verify the actual installed user-facing flow against source scrolling and
   foreground tab changes, with visibly changing original-region content.
   Verify multiple regions share the source. Browser input remains a separate
   uncompleted capability; the current document provider is read-only.
4. Repeat paired one/multiple-region performance measurements on a quiet
   machine, recording pressure state and actual presentation latency. Preserve
   bounded GPU/CPU work and confirm recovery after a controlled load spike.
5. Build a new candidate only after production changes, and re-run these user
   acceptance gates. Existing extension-only tests cannot certify completion.

No unrelated processes were terminated or browser permissions weakened during
this diagnostic step. Existing dirty Hook and Loom worktrees were preserved.
