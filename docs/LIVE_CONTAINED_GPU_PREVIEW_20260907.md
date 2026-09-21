# DPI-rounded thin Live crops incorrectly fell back to JPEG

## Reproduced boundary

The real frontend benchmark now creates six same-source Units by selecting
horizontal strips from an unobstructed left-edge anchor. Its source identity
checks pass for all six. No competing user window is moved or hidden.

On V0.2.28, `artifacts/live-frontend-geometry-20260907-r1/summary.json` records:

- Six image boxes of 436 x 44 CSS pixels at 150% DPI.
- Actual images of 655 x 66 or 655 x 67 pixels after capture rounding.
- `object-fit: contain`, centered positioning and identity transforms.
- Every Unit remains `jpeg` with GPU submitted count zero.

`liveGpuPreview.ts` rejected any absolute width/height ratio difference above
0.01. Even 655 x 66 differs from the box ratio by about 0.015; 655 x 67 differs
by about 0.133. These are valid contained images, not unsupported transforms.
The guard therefore disabled the intended GPU path for all six narrow crops,
forcing CPU readback/encoding rather than measuring shared GPU presentation.

This is direct evidence of unnecessary fallback, not proof it is the sole cause
of the user's whole-machine lag. Earlier six-native-crop tests could not detect
this frontend-only eligibility failure.

## Fix

`containedPreviewRect` computes the centered content rectangle from the image's
natural dimensions and its DOM box. GPU presentation uses those actual pixel
bounds, preserving aspect ratio and letterboxing rather than widening a tolerance
or stretching the source texture. The DOM Unit geometry is unchanged.

The path only accepts centered `object-fit: contain` with an identity image
transform. Existing visibility, editing, opacity, annotation, overlap, viewport
and native health guards remain. Noncentered positioning remains on the normal
image path. No additional frame copy, allocation queue or sampling thread is added.

## Validation before package runtime

- 36 tests across five GPU policy/runtime/registration/scheduler/cadence files
  passed (`artifacts/live-contain-runtime-tests-r2.log`).
- Regression inputs include both actual thin-crop sizes, centered letterboxing
  in both directions, invalid image dimensions and noncentered fallback.
- Production/test TypeScript checks, strict effective-line checks and Hook/Loom
  diff checks passed. Loom was not changed.
- A fresh V0.2.29 candidate was built for runtime validation; it also
  includes the previously tested progressive pressure controller. The earlier
  V0.2.28 binary is not modified and does not contain these fixes.

## Fresh V0.2.29 packaged runtime result

The new candidate completed the same real frontend workload with 1, 2, 4 and
6 Units. All four runs passed; each used exactly one shared source pool and
ended with zero active reservations and zero pools. Requested total crop area
was 258,984 physical pixels in every run. All Units entered GPU-mirror mode.

| Units | Sample ms | Per-Unit submitted deltas | RAF p95 ms |
| --- | --- | --- | --- |
| 1 | 5021 | 199 | 16.7 |
| 2 | 5019 | 202, 202 | 16.7 |
| 4 | 5023 | 189, 197, 173, 148 | 16.7 |
| 6 | 5023 | 208, 133, 193, 184, 147, 144 | 16.8 |

Evidence: `artifacts/live-v29-frontend-{1,2,4}-20260907-r1/summary.json`
and `artifacts/live-v29-frontend-six-20260907-r1/summary.json`.
The six-Unit RED case on V0.2.28 had all six GPU counters at zero, so this proves
the erroneous eligibility fallback is corrected in the actual candidate.

These are frontend-polled submission counters, not exact display FPS; RAF timing
measures frontend callbacks, not source-to-display latency. Six-Unit system CPU
was about 65% versus 25-32% in the other runs, so do not infer a controlled
whole-machine speedup. The animated fixture is not arbitrary browser video.

The candidate is in `release/Hook/live-contained-preview-20260907-r1/V0.2.29`.
Its digest-bound headless smoke passed and all eight checksum entries matched.
It retains dirty provenance and is not a formal release or an installed update.
Two fresh default native Unit probes on V0.2.29 also passed without synthetic
selection events, including source button/slider input and shared editing. See
the candidate's `VALIDATION.md`; this does not prove why earlier input runs failed.
