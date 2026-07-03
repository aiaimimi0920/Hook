# Hook Real App Smoke Audit

## Scope

This audit records the final real-app smoke evidence for the migrated `Neuro/Hook`
after the contract migration audit in:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\docs\migration\hook-migration-completion-audit.md
```

The goal of this smoke was to verify that the migrated Hook can run with a real
ArtLoom/backend roundtrip, not only unit and contract tests.

## Smoke artifact

Artifact directory:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\smoke-artifacts\roundtrip-real-appdata-force-click-cjs-20260606-194616
```

Primary result file:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\smoke-artifacts\roundtrip-real-appdata-force-click-cjs-20260606-194616\core-roundtrip-wait-nodes-result.json
```

## Result summary

The final focused roundtrip passed:

```json
{
  "step": "core-reference-roundtrip",
  "workflowId": "wf-1770163847887",
  "expectedUnits": 4,
  "initialUnitCount": 0,
  "artLoomNodeCountBeforeInstantiate": 4,
  "unitCountAfterFirstInstantiate": 4,
  "unitCountAfterSecondInstantiate": 4,
  "hookConsole": {
    "errors": [],
    "warnings": [],
    "ignored": []
  },
  "loomConsole": {
    "errors": [],
    "warnings": [],
    "ignored": []
  },
  "status": "passed",
  "assertionSummary": "Hook units 0->4->4"
}
```

Interpretation:

- Hook initially had zero instantiated units.
- ArtLoom loaded the reference workflow with four nodes.
- First `引用到桌面` / instantiate action delivered four units into Hook.
- Second instantiate action remained idempotent and did not duplicate units.
- Hook browser console had no unignored errors or warnings.
- ArtLoom browser console had no unignored errors or warnings.

## Visual evidence

Final Hook preview screenshot:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\smoke-artifacts\roundtrip-real-appdata-force-click-cjs-20260606-194616\screenshots\core-arthook-preview-final.png
```

Final ArtLoom editor screenshot:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\smoke-artifacts\roundtrip-real-appdata-force-click-cjs-20260606-194616\screenshots\core-artloom-editor-final.png
```

The final Hook screenshot shows imported graph units and the safe voice panel
defaults:

- `Shortcut: Ctrl+Alt+Space`
- `Audio: Silent`
- `Provider: Mock`
- `Output: Dry Run / Fallback`
- `Mode: Dictate`

The final ArtLoom screenshot shows the workflow canvas and a success toast for
desktop reference.

## Real APPDATA safety

This smoke had to temporarily inject the workflow into the real Windows
ArtNexus workflow directory because the reference ArtLoom backend used the
Windows known-folder location rather than the child process `APPDATA` override.

Before/after restoration metadata:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\smoke-artifacts\roundtrip-real-appdata-force-click-cjs-20260606-194616\backup-meta.json
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\smoke-artifacts\roundtrip-real-appdata-force-click-cjs-20260606-194616\restore-meta.json
```

Restoration checks passed:

```text
yaml:
  existedBefore: false
  existsAfter: false
  matches: true

workflow_index.json:
  existedBefore: true
  existsAfter: true
  sha256Before: 4F53CDA18C2BAA0C0354BB5F9A3ECBE5ED12AB4D8E11BA873C2F11161202B945
  sha256After:  4F53CDA18C2BAA0C0354BB5F9A3ECBE5ED12AB4D8E11BA873C2F11161202B945
  matches: true
```

The temporary workflow YAML was removed after the smoke, and the existing
`workflow_index.json` hash matched its pre-smoke value.

## Runtime cleanup

The smoke restore metadata recorded no listeners on:

```text
1420
1422
19820
```

A later re-check also found no TCP entries for those ports and no remaining
`arthook` / `artloom` processes from this smoke.

## Stability expansion on 2026-06-07

Additional stability validation artifacts were written under:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603
```

### Fresh automated verification

Result file:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\automated-results.json
```

Fresh commands and exit codes:

```text
npm run typecheck                                EXIT=0
npm test                                         EXIT=0
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
                                                 EXIT=0
cargo test --manifest-path src-tauri\Cargo.toml  EXIT=0
npm run build                                    EXIT=0
```

The full Vitest run reported:

```text
Test Files 96 passed (96)
Tests 259 passed (259)
```

The Rust test run reported:

```text
src\lib.rs: 24 passed
src\main.rs: 0 passed
tests\voice_core_contract.rs: 2 passed
tests\voice_session_contract.rs: 4 passed
Doc-tests arthook_lib: 0 passed
```

### Standalone no-backend browser smoke

Result file:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\standalone-browser-smoke-result.json
```

The standalone browser smoke passed these assertions against
`http://127.0.0.1:1420/`:

```text
voiceDefaultsVisible: true
globalMenuOpened: true
globalMenuClosedByEscape: true
reloadCycles: 3
unexpected console errors/warnings: 0
pageErrors: 0
```

Reload cycle evidence:

```text
cycle 1: VOICE panel visible, Ctrl+Alt+Space visible
cycle 2: VOICE panel visible, Ctrl+Alt+Space visible
cycle 3: VOICE panel visible, Ctrl+Alt+Space visible
```

Screenshots:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\screenshots\standalone-initial.png
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\screenshots\standalone-global-menu-open.png
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\screenshots\standalone-after-reloads.png
```

### Repeated ArtLoom to Hook roundtrip smoke

Artifact directory:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\roundtrip-repeat-20260607-021817
```

The existing core roundtrip harness was run three times against the same
reference workflow and backend session:

```text
iteration 1: Hook units 0 -> 4 -> 4, Hook console clean, ArtLoom console clean
iteration 2: Hook units 0 -> 4 -> 4, Hook console clean, ArtLoom console clean
iteration 3: Hook units 0 -> 4 -> 4, Hook console clean, ArtLoom console clean
```

Result files:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\roundtrip-repeat-20260607-021817\roundtrip-iter-1.json
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\roundtrip-repeat-20260607-021817\roundtrip-iter-2.json
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\roundtrip-repeat-20260607-021817\roundtrip-iter-3.json
```

Each result reported:

```text
status: passed
initialUnitCount: 0
artLoomNodeCountBeforeInstantiate: 4
unitCountAfterFirstInstantiate: 4
unitCountAfterSecondInstantiate: 4
hookConsole.errors: []
hookConsole.warnings: []
loomConsole.errors: []
loomConsole.warnings: []
```

Screenshots for each iteration are under:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\roundtrip-repeat-20260607-021817\screenshots
```

### Cleanup result and harness caveat

After the expanded stability run:

```text
no listeners on 1420/1422/19820
no arthook/artloom processes
```

`workflow_index.json` and the temporary `wf-1770163847887.yaml` were restored
to the pre-run state:

```text
workflow_index.json:
  length: 2
  sha256: 4F53CDA18C2BAA0C0354BB5F9A3ECBE5ED12AB4D8E11BA873C2F11161202B945

wf-1770163847887.yaml:
  exists: false
```

However, the first version of the repeat-roundtrip harness recorded metadata
for `latest.yaml` but forgot to copy its backup bytes before running. During
the repeat smoke, old ArtLoom/Hook live sync changed:

```text
C:\Users\vmjcv\AppData\Roaming\ArtNexus\workflows\latest.yaml
```

Pre-run metadata:

```text
length: 3686
sha256: 7137975A38FB56304805ABFE0A03D30C6709A951810C2954DC81865A921B7F06
```

Post-run metadata:

```text
length: 3685
sha256: F51CF025153195FFF0056A8A1B870A3B69E51F847EA4E1ECD828005744B4BAB0
```

The exact pre-run `latest.yaml` bytes were not available for restoration. The
post-run file was preserved here for traceability:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\roundtrip-repeat-20260607-021817\latest-yaml-after-unrestorable.yaml
```

This is a smoke-harness cleanup defect, not a Hook roundtrip failure. Future
real-APPDATA smokes must copy all files they intend to restore before starting
ArtLoom/Hook.

### Guarded workflow-dir backup/restore roundtrip smoke

After the repeat-harness cleanup defect above, a guarded harness was added under:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\guarded-roundtrip-smoke.ps1
```

The harness backs up and restores the entire real workflow directory:

```text
C:\Users\vmjcv\AppData\Roaming\ArtNexus\workflows
```

The directory-level restore helper was self-tested against a temporary
directory, including changed, deleted, and added files. The passing self-test
log is:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\guarded-roundtrip-selftest-4.log
```

The final guarded two-iteration ArtLoom-to-Hook run is:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\guarded-roundtrip-20260607-031720
```

State file:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\guarded-roundtrip-20260607-031720\guarded-roundtrip-state.json
```

Guarded run summary:

```text
status: passed
iterations: 2
restoreCheck.diffCount: 0
restoreCheck.portListenerCount: 0
```

Both guarded iterations passed the same Hook-relevant assertions:

```text
iteration 1: Hook units 0 -> 4 -> 4, Hook console clean, ArtLoom console clean
iteration 2: Hook units 0 -> 4 -> 4, Hook console clean, ArtLoom console clean
```

Result files:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\guarded-roundtrip-20260607-031720\roundtrip-iter-1.json
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\guarded-roundtrip-20260607-031720\roundtrip-iter-2.json
```

The real workflow directory matched byte-for-byte after restore. The before and
after snapshots in `guarded-roundtrip-state.json` matched these file hashes:

```text
latest.json:
  length: 745
  sha256: 180DB8B25D3BE93389338C9D51072C4E53B8AAE578D316AD1332D9D95234D502

latest.yaml:
  length: 3685
  sha256: F51CF025153195FFF0056A8A1B870A3B69E51F847EA4E1ECD828005744B4BAB0

wf-1770163847887.json:
  length: 14872580
  sha256: 91E48FE07F060AA0E9987718C63A0151BA56F3C1464E5CF9A0A360C37F9F8FF2

workflow_index.json:
  length: 2
  sha256: 4F53CDA18C2BAA0C0354BB5F9A3ECBE5ED12AB4D8E11BA873C2F11161202B945
```

An independent post-run check also found no listeners on:

```text
1420
1422
19820
```

and no remaining `arthook` / `artloom` processes.

### Guarded Tauri desktop startup smoke

A first bounded Tauri desktop startup probe was able to launch
`src-tauri\target\debug\arthook.exe`, create WebView2 processes, write a runtime
log, and register the voice hotkey, but the initial smoke harness incorrectly
reported cleanup failure because it missed the Tauri `beforeDevCommand`
`serve-static.mjs` process on port `1420`.

That failing harness artifact was preserved here:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\tauri-desktop-20260607-032034
```

Important evidence from that first probe:

```text
arthook.exe observed:
  C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\src-tauri\target\debug\arthook.exe

runtime log:
  C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\tauri-desktop-20260607-032034\runtime-log\arthook-runtime.log

runtime log hits:
  register_voice_hotkey_success: true
  Ctrl+Alt+Space: true
  voice-settings-loaded: true
```

The cleanup gap was then fixed in the guarded Tauri harness:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\tauri-desktop-guarded-smoke.ps1
```

The fixed harness records a baseline port snapshot, waits for explicit desktop
startup evidence, stops the Tauri command process tree and new `serve-static`
listener, and verifies final cleanup.

Two independent guarded Tauri desktop startup runs passed:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\tauri-desktop-guarded-20260607-044613\tauri-desktop-guarded-state.json
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-20260607-020603\tauri-desktop-guarded-20260607-044810\tauri-desktop-guarded-state.json
```

Both guarded Tauri runs met all startup conditions:

```text
arthookStarted: true
webviewObserved: true
port1420Listening: true
staticHttp200: true
runtimeLogCreated: true
frontendMounted: true
voiceSettingsLoaded: true
voiceHotkeyRegistered: true
artLoomDisabledInStartupLog: true
```

Both guarded Tauri runs also completed cleanup:

```text
remainingListeners: 0
remainingArthook: 0
remainingCommandTree: 0
finalCleanup.listeners: 0
finalCleanup.arthook: 0
```

The known Tauri stdout/stderr messages during this no-backend startup smoke were
expected for the bounded scenario:

```text
Warning: Failed to register Ctrl+1: HotKey already registered
Warning: Failed to register Ctrl+2: HotKey already registered
[MockArtLoom] Connection failed to ws://127.0.0.1:19820. Retrying...
```

The Ctrl+1/Ctrl+2 messages indicate those hotkeys were already registered in the
host session, while `Ctrl+Alt+Space` voice hotkey registration succeeded in the
runtime log. The ArtLoom connection retries are expected because this Tauri
startup smoke intentionally ran with ArtLoom disabled/no backend listener on
`19820`.

### Final current-worktree automated recheck

Because the Hook working tree gained additional Tea-related source and tests
after the earlier automated run, a final automated recheck was run against the
current Hook working tree.

Artifact directory:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-final-20260607-105534
```

Summary file:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.runtime\stability-final-20260607-105534\final-automated-results.json
```

Fresh command results:

```text
npm run typecheck                                EXIT=0
npm test                                         EXIT=0
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
                                                 EXIT=0
cargo test --manifest-path src-tauri\Cargo.toml  EXIT=0
npm run build                                    EXIT=0
```

The current-worktree Vitest run reported:

```text
Test Files 98 passed (98)
Tests 270 passed (270)
```

The current-worktree Rust test run reported:

```text
src\lib.rs: 24 passed
src\main.rs: 0 passed
tests\tea_client_contract.rs: 1 passed
tests\tea_real_daemon_smoke.rs: 1 ignored
tests\voice_core_contract.rs: 2 passed
tests\voice_session_contract.rs: 4 passed
Doc-tests arthook_lib: 0 passed
```

The ignored `tea_real_daemon_smoke` test is intentionally marked `#[ignore]`
because it requires a live Tea daemon and is run through the dedicated real
daemon smoke script rather than the default `cargo test` command.

### Hook to Tea real-daemon smoke

The Hook-to-Tea integration was also validated through the dedicated real
daemon harness:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\scripts\smoke-hook-tea-real.ps1
```

This smoke builds `tea-daemon`, starts it on an isolated loopback port with a
temporary SQLite store, runs Hook's ignored Rust integration test
`tea_real_daemon_smoke`, then independently verifies the created ticket through
Tea's HTTP API:

```text
GET /v1/tickets/{id}
GET /v1/tickets/{id}/events
GET /v1/tickets/{id}/export/markdown
```

The latest preserved-artifact run passed after the cleanup-finalization
hardening:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke-hook-tea-real.ps1 -TimeoutSec 60 -KeepArtifacts
```

Artifact:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-real-20260607-104437-c22a9679\summary.json
```

Evidence:

```text
status: passed
run_id: 20260607-104437-c22a9679
artifact_root: C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-real-20260607-104437-c22a9679
base_url: http://127.0.0.1:53184
ticket_id: c810fbd3-07f0-4003-a0d5-114eefe3e4fc
labels: source:hook, policy:plan-only, context:untrusted
event_count: 1
daemon_pid: 31652
keep_artifacts: true
cleanup_phase: complete
cleanup_detail: complete
daemon_stopped: true
port_listener_count_after_stop: 0
store_created_before_cleanup: true
store_size_before_cleanup_bytes: 4096
store_file_count_before_cleanup: 3
store_total_size_before_cleanup_bytes: 168736
store_file_count_after_cleanup: 3
store_preserved: true
stdout_tail: tea-daemon listening on http://127.0.0.1:53184
```

The retained SQLite store and WAL sidecars were present after cleanup because
`-KeepArtifacts` was set:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-real-20260607-104437-c22a9679\tea-smoke.sqlite
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-real-20260607-104437-c22a9679\tea-smoke.sqlite-shm
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-real-20260607-104437-c22a9679\tea-smoke.sqlite-wal
```

The harness now uses a collision-resistant `run_id` in the artifact directory:

```text
hook-tea-real-YYYYMMDD-HHmmss-<8 hex chars>
```

This avoids same-second artifact collisions if multiple real smokes are
launched close together.

The latest default cleanup run passed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke-hook-tea-real.ps1 -TimeoutSec 60
```

Artifact:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-real-20260607-104603-bb6330b2\summary.json
```

Evidence:

```text
status: passed
run_id: 20260607-104603-bb6330b2
base_url: http://127.0.0.1:57297
ticket_id: d71ae75c-fdde-44e9-abc3-27be1ed99f97
labels: source:hook, policy:plan-only, context:untrusted
event_count: 1
keep_artifacts: false
cleanup_phase: complete
cleanup_detail: complete
daemon_stopped: true
port_listener_count_after_stop: 0
store_created_before_cleanup: true
store_size_before_cleanup_bytes: 4096
store_file_count_before_cleanup: 3
store_total_size_before_cleanup_bytes: 168736
store_file_count_after_cleanup: 0
store_preserved: false
```

Post-run checks confirmed the default cleanup path removed:

```text
tea-smoke.sqlite
tea-smoke.sqlite-shm
tea-smoke.sqlite-wal
```

and left no listener on port `57297` and no remaining `tea-daemon` process.

A follow-up default-cleanup run was launched from the `Hook` subdirectory to
verify the harness still does not depend on the caller's current working
directory after the `run_id` artifact naming change:

```powershell
cd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook
powershell -NoProfile -ExecutionPolicy Bypass -File ..\scripts\smoke-hook-tea-real.ps1 -TimeoutSec 60
```

Artifact:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-real-20260607-105425-ef99c177\summary.json
```

Evidence:

```text
status: passed
run_id: 20260607-105425-ef99c177
base_url: http://127.0.0.1:50358
cleanup_phase: complete
daemon_stopped: true
port_listener_count_after_stop: 0
store_file_count_before_cleanup: 3
store_total_size_before_cleanup_bytes: 168736
store_file_count_after_cleanup: 0
store_preserved: false
```

The harness failure path was also probed with the target port deliberately
occupied before launch. The smoke exited non-zero, wrote a failure summary, and
did not kill the external listener:

```text
artifact: C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-real-20260607-104727-63ed23c5\summary.json
status: failed
run_id: 20260607-104727-63ed23c5
base_url: http://127.0.0.1:54016
cleanup_phase: complete
cleanup_detail: complete
daemon_stopped: true
port_listener_count_after_stop: 1
listeners_after_stop[0].local_endpoint: 127.0.0.1:54016
store_created_before_cleanup: true
store_file_count_before_cleanup: 1
store_total_size_before_cleanup_bytes: 73728
store_file_count_after_cleanup: 0
store_preserved: false
listener_count_before: 1
listener_count_after: 1
stderr_tail: Error: 通常每个套接字地址(协议/网络地址/端口)只允许使用一次。 (os error 10048)
```

That failure-path probe exposed a PowerShell automatic-variable collision in
the listener parser (`$pid` shadows `$PID`). A later focused review also found
that the command helper accepted `WorkingDirectory` but did not enter it. The
parser variable was renamed to `$listenerPid`, `Invoke-Checked` now uses
`Push-Location $WorkingDirectory` / `Pop-Location`, and source contracts were
added for both regressions.

The cleanup-finalization hardening also fixed a later real-smoke hang in the
summary-writing path. The harness previously wrote `status: passed` before
cleanup finished; if finalization then hung, the preserved `summary.json` could
look successful while `finished_at`, daemon cleanup, and store evidence were
still unset. The script now keeps the success path at
`validated_pending_cleanup` until cleanup completes, records
`cleanup_phase`/`cleanup_detail` before each cleanup stage, and only writes
`status: passed` together with `cleanup_phase: complete`.

The hang root cause was narrowed with those phase markers to daemon log-tail
collection after a redirected `tea-daemon` child process had been stopped. The
fix avoids reading the redirected logs with `Get-Content -Tail`; `Get-LogTail`
now opens the files via `FileStream` with `FileShare.ReadWrite`, and the daemon
cleanup path uses a scalar PID plus `$daemon.Dispose()` so final log-tail
collection does not retain child-process redirection handles.

This smoke proves the Hook Rust Tea client can create and verify a real Tea
ticket through a running `tea-daemon` and isolated SQLite store. It does not
launch the full Tauri UI or click the desktop tray entry; those remain separate
UI/desktop interaction validation scopes.

### Hook UI to Tea real smoke

The Hook panel entry was also validated through the dedicated UI smoke harness:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\scripts\smoke-hook-tea-ui-real.ps1
```

This smoke builds `tea-daemon`, builds Hook's static frontend, starts an
isolated Tea daemon and Hook static preview, injects a Tauri-compatible
`__TAURI_INTERNALS__` invoke bridge into headless Chromium, clicks the
`Create Tea Ticket` button in the Voice panel, and then independently verifies
the created ticket through Tea's HTTP API:

```text
GET /v1/tickets/{id}
GET /v1/tickets/{id}/events
GET /v1/tickets/{id}/export/markdown
```

Fresh preserved-artifact run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke-hook-tea-ui-real.ps1 -KeepArtifacts
```

Artifact:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-ui-real-20260607-120321-3e10c059\summary.json
```

Evidence:

```text
status: passed
run_id: 20260607-120321-3e10c059
base_url: http://127.0.0.1:60090
hook_url: http://127.0.0.1:60095/
ticket_id: 0e09a8e7-d4b8-453c-b03a-09a1fddcfba8
frontend_ticket_visible: true
tea_api_verified: true
labels: source:hook, policy:plan-only, context:untrusted
event_count: 1
keep_artifacts: true
cleanup_phase: complete
daemon_stopped: true
hook_server_stopped: true
port_listener_count_after_stop: 0
hook_port_listener_count_after_stop: 0
store_file_count_before_cleanup: 3
store_total_size_before_cleanup_bytes: 168736
store_file_count_after_cleanup: 3
store_preserved: true
stdout_tail: tea-daemon listening on http://127.0.0.1:60090
hook_stdout_tail: [serve-static] Serving C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\.output\public on http://127.0.0.1:60095
```

The retained SQLite store and WAL sidecars were present after cleanup because
`-KeepArtifacts` was set. The process/port cleanup still completed: the summary
recorded both the Tea daemon and Hook static preview stopped, with zero
listeners left on both smoke ports.

This smoke proves the Hook frontend panel button can reach the Hook Tea command
bridge and create a real Tea ticket. It still does not claim full native tray
coverage or long-running desktop stability; those stay in the guarded Tauri
desktop startup smoke scope above.

The Hook UI smoke failure path was also probed with the Hook static-preview
port deliberately occupied before launch. The smoke exited non-zero, wrote a
failure summary, stopped the Tea daemon, and did not kill the external listener:

```text
artifact: C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-ui-real-20260607-120308-a4270cb7\summary.json
smoke_exit_code: 1
status: failed
error: Hook static preview exited early with code
daemon_stopped: true
hook_server_stopped: true
port_listener_count_after_stop: 0
hook_port_listener_count_after_stop: 1
cleanup_phase: complete
cleanup_detail: complete
```

After the UI smoke harness and frontend test anchors were added, a fresh Hook
frontend verification passed:

```text
npm run typecheck  EXIT=0
npm test           EXIT=0

Test Files 99 passed (99)
Tests 274 passed (274)
```

### Hook native Tauri/WebView to Tea real smoke

The native desktop Hook-to-Tea path is now covered by a dedicated real smoke
harness:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\scripts\smoke-hook-tea-tauri-ui-real.ps1
```

The source contract is:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\__tests__\integration\HookTeaTauriUiSmokeHarnessContract.test.ts
```

This smoke builds `tea-daemon`, builds Hook's static frontend, starts an
isolated Tea daemon, launches real Tauri `dev` with a temporary `--config`
that serves Hook on a random loopback port, exposes the WebView2 instance
through a random CDP port, connects Playwright to that real WebView with
`chromium.connectOverCDP`, and clicks the real panel button:

```text
[data-testid="tea-ticket-button"]
```

It then verifies:

```text
window.__TAURI_INTERNALS__ is present
[data-testid="tea-ticket-output"] contains the created ticket UUID
runtime log contains tea_ticket_created :: id={ticket_id}
GET /v1/tickets/{id}
GET /v1/tickets/{id}/events
GET /v1/tickets/{id}/export/markdown
```

Unlike `smoke-hook-tea-ui-real.ps1`, this native harness does not inject a
browser-preview bridge such as `page.addInitScript` or
`__hookTeaUiSmokeInvoke`. It exercises the real Tauri/WebView command path.

The harness isolates all runtime state under:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-tauri-ui-real-<run_id>
```

Important isolation and cleanup controls:

```text
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<debug_port> --remote-allow-origins=*
WEBVIEW2_USER_DATA_FOLDER=<artifact>\webview2-user-data
ARTHOOK_TEA_BASE_URL=http://127.0.0.1:<tea_port>
ARTHOOK_TEA_AUTH_TOKEN=<random token>
ARTHOOK_INITIAL_UI_MODE=canvas
ARTHOOK_ENABLE_ARTLOOM=0
```

The harness rejects selected ports that already have listeners before starting
Tea, Tauri, or the WebView. On the success path it keeps `status` at
`validated_pending_cleanup` until cleanup finishes, then writes
`status = passed` only after stopping the known Tauri command tree, the new Hook desktop
process, the WebView2 debug process, the Tea daemon, and the smoke listeners.
Recursive artifact cleanup is guarded with a separator-aware resolved-path
boundary so a sibling path such as `artifact-root2` cannot be treated as inside
`artifact-root`.

The latest preserved-artifact native run passed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke-hook-tea-tauri-ui-real.ps1 -TimeoutSec 120 -KeepArtifacts
```

Artifact:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-tauri-ui-real-20260607-210103-267968e3\summary.json
```

Evidence:

```text
status: passed
run_id: 20260607-210103-267968e3
base_url: http://127.0.0.1:57835
hook_url: http://127.0.0.1:57836/
cdp_url: http://127.0.0.1:57837
ticket_id: 48488c43-190d-4b9b-aed8-f5f9b7f501e8
native_tauri_runtime: true
frontend_ticket_visible: true
runtime_log_contains_ticket: true
tea_api_verified: true
daemon_stopped: true
tauri_command_tree_stopped: true
arthook_stopped: true
webview_debug_stopped: true
port_listener_count_after_stop: 0
hook_port_listener_count_after_stop: 0
debug_port_listener_count_after_stop: 0
store_file_count_after_cleanup: 3
store_preserved: true
webview2_user_data_removed: false
webview2_user_data_exists_after_cleanup: true
cleanup_phase: complete
cleanup_detail: complete
```

The latest default-cleanup native run also passed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke-hook-tea-tauri-ui-real.ps1 -TimeoutSec 120
```

Artifact:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-tauri-ui-real-20260607-213202-17f363fd\summary.json
```

Evidence:

```text
status: passed
run_id: 20260607-213202-17f363fd
base_url: http://127.0.0.1:56259
hook_url: http://127.0.0.1:56260/
cdp_url: http://127.0.0.1:56264
ticket_id: 96c30d25-4d74-4594-9848-1e0a272a94e7
native_tauri_runtime: true
frontend_ticket_visible: true
runtime_log_contains_ticket: true
tea_api_verified: true
daemon_stopped: true
tauri_command_tree_stopped: true
arthook_stopped: true
webview_debug_stopped: true
port_listener_count_after_stop: 0
hook_port_listener_count_after_stop: 0
debug_port_listener_count_after_stop: 0
store_file_count_before_cleanup: 3
store_file_count_after_cleanup: 0
store_preserved: false
webview2_user_data_removed: true
webview2_user_data_exists_after_cleanup: false
cleanup_phase: complete
cleanup_detail: complete
```

An earlier native default-cleanup run also passed before the WebView2
user-data hardening:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-tauri-ui-real-20260607-204028-57b522da\summary.json

status: passed
ticket_id: 9e3ce77b-e96b-4d76-b851-42c44c4c6fff
native_tauri_runtime: true
frontend_ticket_visible: true
runtime_log_contains_ticket: true
tea_api_verified: true
port_listener_count_after_stop: 0
hook_port_listener_count_after_stop: 0
debug_port_listener_count_after_stop: 0
store_file_count_after_cleanup: 0
cleanup_phase: complete
```

The native CDP readiness path had one preserved failure before the
`WEBVIEW2_USER_DATA_FOLDER` hardening:

```text
C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-tauri-ui-real-20260607-204316-aa277a86\summary.json

status: failed
error: WebView2 CDP endpoint did not become ready on port 59620 within 120 seconds
base_url: http://127.0.0.1:59614
hook_url: http://127.0.0.1:59618/
cdp_url: http://127.0.0.1:59620
preexisting_listener_count: 0
cleanup_phase: complete
cleanup_detail: complete
store_file_count_after_cleanup: 3
store_preserved: true
```

That failure was not a Hook frontend startup failure. The runtime log in the
same artifact showed the native app had mounted:

```text
app_setup :: startup_mode=silent initial_ui_mode=canvas auto_start_capture=false art_loom_enabled=false
frontend-mounted
boot-profile-loaded :: startupMode=silent initialUiMode=canvas autoStartCapture=false artLoomEnabled=false
rdev_ctrl1_triggered
```

The failure was therefore localized to the WebView2 remote debugging endpoint.
The hardening fix was to set a per-run `WEBVIEW2_USER_DATA_FOLDER` so WebView2
does not reuse a browser process/profile where new remote-debugging arguments
may be ignored. The next `-KeepArtifacts` run after that change was the passing
`20260607-210103-267968e3` run above.

The selected-port preflight was also verified with external listeners on each
selectable port. Each case exited non-zero before starting Tea/Tauri, wrote a
`blocked_preexisting_listener` summary, and left the external listener alive
until the test script explicitly stopped it:

```text
HookPort occupied:
  artifact: C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-tauri-ui-real-20260607-210940-dc885554\summary.json
  status: blocked_preexisting_listener
  preexisting_listener_count: 1
  cleanup_phase: not_started
  daemon_stopped: false
  tauri_command_tree_stopped: false

TeaPort occupied:
  artifact: C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-tauri-ui-real-20260607-211047-3afe72d3\summary.json
  status: blocked_preexisting_listener
  preexisting_listener_count: 1
  cleanup_phase: not_started
  daemon_stopped: false
  tauri_command_tree_stopped: false

DebugPort occupied:
  artifact: C:\Users\Public\nas_home\AI\GameEditor\Neuro\.tmp\tea-smoke\hook-tea-tauri-ui-real-20260607-211051-d31f634b\summary.json
  status: blocked_preexisting_listener
  preexisting_listener_count: 1
  cleanup_phase: not_started
  daemon_stopped: false
  tauri_command_tree_stopped: false
```

This native smoke proves the Hook desktop WebView button can create a real Tea
ticket through the actual Tauri command bridge, not only through the Rust client
or injected browser-preview bridge. It still does not claim installer/release
packaging correctness or long-duration tray/session behavior.

## Known non-Hook issues encountered during smoke

Several earlier smoke attempts failed before the final pass. These were
diagnosed as reference-smoke or reference-ArtLoom UI timing issues, not Hook
delivery failures:

- The old full smoke script initially selected a sticker node/parameter target
  whose click was intercepted by ArtLoom UI children.
- A patched click variant then hit an old full-smoke assertion expecting a
  sticker `X` input that was not present in the current reference UI state.
- A too-early core click saw `Empty workflow` because the ArtLoom button logic
  reads ReactFlow state, and the visual canvas had appeared before that state
  was ready.

The final smoke waited for the ArtLoom canvas to contain the expected four
ReactFlow nodes before clicking the desktop-reference action. That final run
passed the Hook-relevant assertions.

## Conclusion

For the migrated Hook target, the real-app smoke passed the core ArtLoom to Hook
roundtrip:

```text
Hook units: 0 -> 4 -> 4
Hook console: clean
ArtLoom console: clean
Real APPDATA restoration: clean
Smoke ports/process cleanup: clean
```

This supports the stronger conclusion that Hook is not only contract-test clean
but can also receive and de-duplicate a real reference workflow from ArtLoom in
the tested desktop/browser-preview integration path. The 2026-06-07 stability
expansion further verified a fresh build/test baseline, standalone no-backend
browser behavior, reload resilience, global menu open/close behavior, and three
consecutive real ArtLoom-to-Hook roundtrips. A guarded follow-up added two more
real ArtLoom-to-Hook roundtrips with byte-for-byte workflow-directory
restoration, plus two guarded Tauri desktop startup runs that verified the
desktop binary, WebView2 startup, static dev server, frontend mount, voice
settings load, voice hotkey registration, ArtLoom-disabled startup log, and
process/port cleanup.

This smoke does not claim long-duration production stability, installer/release
packaging correctness, or exhaustive OS-level capture/sticker/hotkey behavior.
Those remain separate product/release validation scopes.
