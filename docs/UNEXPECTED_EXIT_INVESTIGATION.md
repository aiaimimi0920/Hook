# Hook unexpected-exit investigation (2026-09-25)

Status: the captured 2026-10-02 overnight exit was caused by the old triple-Escape
emergency shortcut, not an observed crash. Its input origin is unknown. The earlier
unattributed exits below remain unresolved; this finding does not explain all
historical disappearances.

## Emergency behavior

At the time of the historical observations below, three Escape presses triggered
emergency exit. The current behavior replaces that trigger with three Esc+Delete
chords, using the same state machine in both native input trackers and the
independent watchdog. Both keys must be released between chords; adjacent chords
must be less than 400 ms apart. Ctrl+Alt+Shift+F12 remains available. Historical
triple-Escape log markers below retain their original meaning; they do not prove
human input and must not be relabelled as the new chord.

## Observations

Source: the local runtime log at
C:/Users/vmjcv/AppData/Local/Hook/logs/hook-runtime.log and Windows event logs.
Times below use America/Los_Angeles (UTC-07:00).

- 2026-10-02 23:43:35 (PID 39300): Escape inputs at 23:43:34.470,
  23:43:34.664 and 23:43:34.830 were followed by
  `emergency_triple_escape_exit :: source=rdev` and cleanup reason
  `triple_escape`. The independent process observer and watchdog both recorded
  exit status `0x00000000`. This establishes an emergency exit, not human input;
  the old log did not record injected-input flags. The replacement chord above
  prevents Escape-only sequences from taking this path.
- 2026-09-21 03:02:44: v0.2.31 recorded a Tao 0.35.3
  `cannot move state from Destroyed` panic after `tauri_exit`.
  Windows System event 1074 preceded it by approximately 8.5 seconds.
- 2026-09-23 04:16:38 and 2026-09-24 16:37:13: `tauri_exit` occurred shortly
  after System event 1074; these align with system shutdown/restart.
- 2026-09-25 16:36:09 (PID 48384) and 16:57:31 (PID 13788):
  v0.2.31.2 recorded `tauri_exit_requested`, without a panic or triple-Escape
  marker. The old code does not record a tray-quit source, and the generic Tauri
  event does not identify the original requester. These remain unattributed.
- No matching Application Error / Windows Error Reporting / .NET Runtime event
  was found in the preceding seven days. This does not rule out a crash.
- Available WER crash reports concern older debug test executables; they do not
  establish the cause of the recent desktop exits.

## Diagnostic correction

- Record tray quit, window-close label/policy, Tauri exit request code, final
  event, and returned exit code with PID. Exit records use synchronous,
  best-effort writes instead of the bounded, lossy background log queue.
- Record the original panic before native cleanup can re-enter window code.
- The independent watchdog queries and records the parent's decimal and
  hexadecimal exit status even when the parent cannot log its own termination.
- That diagnostic correction introduced no automatic restart, global exception
  swallowing, data reset, or change to emergency shortcuts. The later chord
  change is described separately above.

`scripts/tests/Test-WatchdogExitDiagnostics.ps1` exercises a real watchdog
against disposable parent processes returning 0, 23, and 0xC0000005. The last
case deliberately returns a status; it does not reproduce an access violation.
It injects no keyboard input and cannot serve as proof of the user's crash cause.


## Verified diagnostic candidate

- Candidate: `release/Hook/v0.2.31.6/hook.exe` relative to Neuro root.
  Actual workspace path: `Neuro/release/Hook/v0.2.31.6/hook.exe`.
- SHA-256: `f572847e5d146fe01de99e9366b6b58b712cbf73c75d4d167b625c55cbc76a01`.
  Internal dirty-worktree candidate; no public release or installed-version replacement.
- Rust watchdog tests: 3 passed. Exit/logging/watchdog contracts: 10 passed.
- Rust formatter, effective-line ratchet (1264 files), and `git diff --check` passed.
  All touched Rust files remain below 500 physical lines (therefore also below 500 effective lines).
- Real watchdog parent-status tests passed for 0, 23 and simulated 0xC0000005.
  See `artifacts/exit-diagnostics-20260925/result.json`.
- Native candidate acceptance passed: launch, single instance, 60-second soak,
  responsive native IPC, clean exit, restart and second clean exit. No forced cleanup
  or residual candidate processes. Loom integration was disabled for this focused gate.
  See `artifacts/exit-diagnostics-native-20260925/summary.json`.
- Both native exits recorded request code 0, returned code 0 and the watchdog's
  independent code 0. These checks validate diagnosis infrastructure, not a crash fix.

## Next evidence needed

Use the diagnostic candidate and correlate the next unexpected disappearance
with `process_exit_event`, `emergency_watchdog_parent_exited`, panic records,
and Windows events. An approximate incident time and whether the two recent
16:36/16:57 exits were intentional can narrow the existing evidence.
