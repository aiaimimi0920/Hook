# Live pressure-recovery candidate, 2026-09-08

## Scope and unresolved main requirements

This is a narrow performance-policy change, not completion of browser Live.
Ordinary Ctrl+2 still captures window pixels. Pinning the original webpage
region across scrolling and tab switching remains unimplemented in that entry.
The existing authorized browser extension path is separate and read-only.
No ordinary-browser acceptance is claimed for this candidate.

## Change

Fresh runtime evidence in `LIVE_USER_FLOW_RECHECK_20260908.md` showed pressure
throttling, including a previous candidate still at a 4x interval when sampled
CPU had dropped below the recovery threshold. The existing recovery policy
needed 35 consecutive quiet samples to recover from its maximum 8x interval.

`src-tauri/src/live_resources/policy.rs` now halves the interval multiplier,
rounding up, after each five consecutive quiet samples: 8 -> 4 -> 2 -> 1.
This reduces maximum recovery to 15 quiet samples. A recovery step increases
the allowed rate by at most twofold; it does not instantly restore full load.

Unchanged protections:

- CPU/RAM/GPU pressure still slows capture and rejects new sources.
- Missing/intermediate CPU samples interrupt recovery; repeated sample IDs
  cannot accelerate it.
- Renewed pressure immediately escalates the multiplier again.
- CPU encoding remains serialized and bounded; GPU budgets, source sharing,
  lifetime ownership, and the 16-source safety ceiling are unchanged.

This does not improve FPS while the machine remains continuously overloaded.
It also does not establish the cause of every reported stutter.

## Verification

- Regression test failed before the production change: actual multiplier 7,
  expected 4 after the first recovery window.
- Rust focused tests: 12 passed, zero failed, including odd multipliers,
  duplicate samples, renewed memory pressure, admission and cleanup contracts.
- `cargo fmt --check`: passed.
- Strict effective-line checker: 1,128 files, none above 500 effective lines.
- Production policy changes add only comments, with no net effective-line
  growth. The existing cohesive policy test module gains one focused test.
- `git diff --check`: passed separately for Hook and Loom; preexisting line-
  ending warnings remain. Loom was not modified by this step.
- Official candidate build: passed.
- Direct headless smoke against the packaged executable and its SHA-256:
  passed (`artifacts/live-recovery-headless-20260908`).

The formal release verifier refused the dirty source provenance, as required.
That failure is preserved in `artifacts/live-recovery-verify-20260908.log`;
the clean-source gate was not bypassed or weakened.

The four-region GPU runtime probe did NOT pass. Creation of the second region
was refused with `live_resource_cooldown`; the UI wait subsequently timed out.
Its final sample reported system CPU 1.0 and cadence multiplier 8. Cleanup
returned zero active sources, shared pools, and reserved RAM/GPU bytes. No
owned Hook process remained after the probe. This confirms pressure protection
still operates, not that four-region performance or recovery is accepted.
Evidence: `artifacts/live-recovery-gpu-four-20260908/summary.json` and its
`logs/hook-runtime.log`.

## Candidate delivery

Built with the repository's `scripts/build-release.ps1` into:

`../release/Hook/live-recovery-candidate-20260908-r1/V0.2.29/portable/hook.exe`

This is a dirty-worktree test candidate, not a formal release or replacement of
the user's running installation. Existing releases and unrelated applications
were preserved. Do not use this artifact as proof that browser document binding
or the overall performance objective is complete.

## Next gates

1. Exercise pressure recovery and paired multi-region presentation on a quiet
   machine, then under a controlled transient load; do not remove safeguards to
   force an overloaded-machine probe green.
2. Implement the missing user-facing browser authorization/selection handoff.
   A Hook command cannot supply browser activeTab authorization on its own;
   preserve the explicit browser action and opaque document grant. Do not turn
   the existing readiness-only prepare command into a blocking capture call.
3. Accept scrolling/tab-switch behavior through the installed user entry, not
   only the existing extension/palette test route.
