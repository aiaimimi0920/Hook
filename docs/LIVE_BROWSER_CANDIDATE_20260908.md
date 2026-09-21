# Browser Live candidate 2026-09-08

## Delivered candidate, not formal completion

Built from the current Hook checkout using `scripts/build-release.ps1`, version
V0.2.29, into `../release/Hook/browser-live-candidate-20260908-r1/V0.2.29`.
Previous releases and running user processes were not replaced.

Portable executable SHA-256:
`a97aad01960db30d92489fd32847b05cd16830e5713b6d192fe1e4f53bafafd2`.

All seven manifest file lengths/hashes matched. The executable's `--self-check`
reported status `ok`, version 0.2.29. Native candidate preflight passed and recorded
existing Hook processes. Full native acceptance was not started because those
user processes retain the global single-instance lock. User was asked to save
needed stickers and exit Hook normally; no force termination was used.

The manifest truthfully records dirty source. This is a candidate, not a tagged,
clean-source formal release; the formal verifier's clean-source gate was not
disabled or represented as passed.

## Fresh checks

- Hook application TypeScript check passed.
- Browser acceptance script strict TypeScript and ESLint passed, including the
  additional action-event diagnostic instrumentation.
- Six browser unit test files passed, 41 tests.
- Strict effective-line gate passed: 1121 files, none above 500 effective lines.
- Both independent repositories passed scoped `git diff --check`. Their dirty
  states were retained (127 Loom entries and 254 Hook entries at this checkpoint);
  no staging, commit or revert was performed.
- Loom CLI capability group passed four tests, release CLI build passed, targeted
  Rust format checks passed. Loom strict gate passed with its 12 existing
  exceptions. No claim of a full workspace Rust or clippy gate.
- Native startup regression passed with 339 ms measured startup (fixture setup
  excluded). This is not a video frame-latency measurement.

## Latest runtime concern

Registered Edge r15-r17 previously passed consecutively. Fresh r18 and r19 failed
waiting for the production picker; the action title remained its default and the
owned page recorded no resize events. r19 failed after parallel builds finished,
so compilation load alone is not an established cause. Logs and owned screenshots
are retained. The fixture now checks that the real production action listener is
registered before triggering and observes delivery without invoking that handler
or granting access itself. Fresh r20, r21 and r22 passed consecutively with this
instrumentation. Final cleanup found no owned r18-r22 Edge processes and no
discovery file. The actual Loom capability remained active with zero failures.
This does not establish the root cause of the earlier intermittent failure; do
not call it a confirmed production fix or silently discard the failed runs.

## Remaining acceptance

The locally signed development capability is active in the running Loom daemon.
This does not make the user's old running Hook executable the new candidate, nor
does loading the extension in an owned test profile install it in personal Edge.
Browser capture currently uses the selected-sticker command-palette prepare,
browser action selection, and command-palette import flow. Ctrl+2 remains native
capture. Browser capture is read-only; full desktop input, many-region/video
performance and virtualized-page behavior are not proven by the owned DOM tests.

Do not mark the entire Live task complete until the fresh picker regression and
the complete candidate Hook acquisition/display/cleanup path are verified.
