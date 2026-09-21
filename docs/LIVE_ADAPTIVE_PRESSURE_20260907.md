# Progressive Live pressure response

## Problem and scope

The existing admission policy slowed existing Live captures by a fixed factor
of two under pressure. Repeated high-load samples did not reduce their work any
further. This patch makes that safety response progressive; it does not claim
that reducing frame rate fixes every source of whole-machine lag.

## Control behavior

- Reuse the existing once-per-second OS samples and 85% high CPU / 65% quiet CPU
  thresholds. Low available memory or GPU allocation headroom also triggers it.
- Each new high-pressure sample adds one interval step, initially 2 and capped
  at 8. Re-reading the same sample never escalates it again, regardless of how
  many Live Units poll the policy.
- Five consecutive quiet samples reduce the multiplier by one. Intermediate or
  missing CPU observations reset that quiet streak. Admission remains in cooldown
  until recovery reaches multiplier 1.
- Existing capture/work budgets still apply. A nominal 60 Hz demand can therefore
  fall to 7.5 Hz at multiplier 8 before any other work-budget constraints. This is
  intentional degradation of Live refresh to protect desktop responsiveness.
- `get_live_resource_status` now includes `cadenceScale` for diagnostic evidence.
  No new polling thread, process, allocation queue or per-frame OS query is added.

Slower capture does not free already allocated GPU memory. This controller must
not be presented as memory-leak repair or used to loosen memory admission.
The maximum and recovery rates are bounded policy choices, not measured optimal
parameters. Real whole-app pressure/recovery validation remains required.

## Regression scope

Tests cover sustained escalation and the cap, duplicate-sample immunity across
16 consumers, gradual recovery, renewed pressure, interrupted/unknown recovery
and GPU pressure overriding quiet CPU. The earlier one-step hysteresis test is
retained. Strict effective-line checks passed after this edit batch.
Fresh compilation and the full Rust library run passed: 392 tests passed,
16 ignored, zero failures (`artifacts/live-adaptive-pressure-lib.log`). Cargo
formatter and Hook/Loom diff checks passed; Loom was not modified.

This source change is newer than the V0.2.28 candidate and is not included in it.
Do not infer packaged behavior from source-only tests.
It is included in the subsequent V0.2.29 candidate. The real 1/2/4/6 frontend
workload runs passed at cadenceScale 1; they do not exercise forced high-pressure
escalation/recovery, which remains covered by the focused policy regressions.

## Independent input diagnostic

`artifacts/live-v28-release-edge-20260907-r1` retained the original failed packaged
Ctrl+2 instance for a bounded 45-second diagnostic window. After the automatic
selection failed, the helper inserted a standalone mouse-up, then standalone
down/up, without coordinates or a combined move flag. Hook identity was verified
by PID and start time first. No corresponding native edge logs appeared.

This rules out only the narrow assumption that the original combined move/up
shape alone explains the missing release. It does not prove why the hook stopped
observing synthetic edges, or whether manual input has the same issue. The wrapper
completed with the original failure; no product input success is claimed.
A subsequent process/profile audit found zero owned diagnostic processes.
