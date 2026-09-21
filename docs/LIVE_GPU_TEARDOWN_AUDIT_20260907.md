# Live shutdown and GPU resource audit - 2026-09-07

## Status

Feature development and multi-video stress work are paused at the user's request.
The compositor-retention defect and an independently reproduced WinRT restart
crash have been fixed in source. The follow-up native acceptance now passes all
three tests. A V0.2.26 candidate has been built separately; no replacement has
been installed, and the existing V0.2.25 executable does not contain these fixes.
This is not a claim that all desktop stuttering has been resolved.

## Findings

1. Closing the main window normally hides Hook in the tray. It does not mean the
   application has exited, and currently does not stop Live capture. See
   `src-tauri/src/native/app_runtime.rs`, close-request handling, and the default
   close-to-tray setting in `src-tauri/src/shortcut_config.rs`. Background capture
   can therefore continue after the user closes the visible window.
2. Before this fix, removing the last Live slot left the process-wide GPU
   compositor service, thread, and presenter alive. The compositor continued its
   16 ms receive-timeout loop with no Live slots. This is confirmed unnecessary
   retention, not proof of an unbounded GPU leak or the sole cause of severe lag.
3. Normal application exit already calls Live-session shutdown and GPU shutdown.
   Session shutdown signals the capture worker and joins it, then clears frames.
   Shared capture sources use weak registry entries and stop/join their source
   owner when the last subscription disappears. No strong ownership cycle was
   established in this audit.
4. Process termination and hiding a window must not be conflated. Windows releases
   process resources and closes handles when a process terminates, but child
   processes are not automatically terminated. See Microsoft's
   [process termination documentation](https://learn.microsoft.com/en-us/windows/win32/procthread/terminating-a-process).
   The emergency forced-exit paths were not changed to block on GPU cleanup.
5. A fresh process audit after the tests found zero `hook.exe`, zero
   `hook_lib-*.exe`, and zero Chrome/Edge/WebView2 processes whose command lines
   referenced this repository's `Hook/artifacts/` test profiles. The profile
   comparison normalized path separators. This does not establish zero total
   system GPU usage or exclude unrelated browser, driver, or broker activity.

## Implemented change

In `src-tauri/src/live_gpu/worker.rs`, removing the final slot now takes the
singleton service, disconnects its wake channel, and joins the compositor.
Joining happens outside both the service and slot mutexes so the compositor can
finish its own cleanup. Removing one of several Live slots preserves the service.
Explicit shutdown shares the same service-finalization helper. A later Live can
create a new service.

The regression in `src-tauri/src/live_gpu/native_tests.rs` verifies that a
surviving sibling keeps its compositor, the last removal leaves no service, and
three subsequent configure/remove cycles recreate and retire the service.
Those extra cycles verify service lifecycle, not new captured frames on every
cycle. The earlier portion of the same test uses real WGC frames, GPU textures,
two native swapchains, lossless snapshots, lease expiry, and static fallback.

This change does not remove all process-wide graphics caches used by ordinary
screenshots and does not change close-to-tray product behavior.

## Verification and failures retained

Evidence is under `Hook/artifacts/`:

| Evidence | Actual result |
| --- | --- |
| `live-gpu-teardown-red.log` | Before fix: last-Live service-release assertion failed. |
| `live-gpu-teardown-green.log` | After fix: real GPU regression passed, 1 test. |
| `live-gpu-teardown-reopen.log` | Final regression including 3 recreation cycles passed, 1 test. |
| `live-gpu-teardown-lib.log` | 386 passed, 0 failed, 16 ignored. |
| `live-gpu-teardown-format.log` | Cargo formatter check passed. |
| `live-gpu-teardown-lines.log` | Strict effective-line check passed, 1093 files. |
| `live-gpu-teardown-native.log` | Capture pipeline passed; process then crashed with `0xc0000005` as the next native test started. |
| `live-gpu-teardown-native-recheck.log` | Capture pipeline and GPU regression passed; shared-source test failed with `live_resource_cooldown`. |
| `live-gpu-teardown-shared.log` | Standalone shared-source test failed: static second crop did not arrive before health-rebuild timeout. |

The native crash is not diagnosed. Windows Application event 1000 recorded the
test executable as the faulting module, offset `0x18a49de`; this is not a stack
trace and does not identify a defective function. A teardown concurrency audit
found that `Capturer::stop` unregisters callbacks and closes the frame pool
without an explicit in-flight callback drain. This is a hypothesis to investigate,
not proof of a use-after-free: the callback holds cloned COM references, and the
underlying event-unregistration/close behavior must also be established. No
speculative callback-locking change was made that might introduce shutdown
deadlocks.

Effective lines after this change: `worker.rs` 486; `native_tests.rs` 430. The
worker remains below the repository's strict 500-line ceiling. Hook and Loom
both passed `git diff --check`; each has zero staged files. Both inherited dirty
worktrees were preserved. Loom was not modified. No unrelated processes were
killed, no release was overwritten, and no Git commit or publication was made.

## Decisions and release gate at the initial checkpoint

- The user has been asked whether close-to-tray should stop all Live captures,
  or whether closing should exit Hook entirely. No answer has been received at
  this checkpoint. The recommended option is to keep tray behavior while
  stopping Live capture and preserving static stickers. That requires coordinated
  frontend freezing and backend teardown; merely draining native sessions would
  leave frontend polling against missing sessions.
- Diagnose the native access violation and shared-source acceptance failures
  before claiming teardown acceptance or building a release candidate. Do not
  disable resource protections merely to make tests pass.
- After acceptance, build a new version under `Neuro/release/Hook`, retain prior
  versions, and verify the actual packaged executable. Existing V0.2.25 remains
  unchanged until then.

## Follow-up: isolated WinRT restart crash

The investigation now has a smaller reproducer that does not create a window,
capture session, frame pool, D3D device, texture, or compositor. Eight sequential
threads initialize WinRT, call `scap_direct3d::is_supported()`, then uninitialize
WinRT. Before the follow-up fix, iteration zero returned `Ok(true)` and the next
iteration crashed with `0xc0000005`. See `live-winrt-support-red.log`; an earlier
direct `GraphicsCaptureSession::IsSupported` probe behaved the same way in
`live-winrt-apartment-red.log`.

This establishes an independent runtime-lifetime defect; it does not require an
in-flight capture callback. The installed windows-core 0.60.1 `FactoryCache`
retains agile factory pointers in process-wide statics, whereas capture owners
uninitialize their individual MTA apartments on shutdown. Microsoft's explanation
of [factory caches surviving COM teardown](https://devblogs.microsoft.com/oldnewthing/20211105-00/?p=105878)
describes this failure mechanism and keeping MTA usage alive across short-lived
workers. The old Hook fault address also maps near `IsSupported` in the current
symbols, but the executable was rebuilt after that original crash, so that
address mapping is only a clue, not a valid matched-binary stack trace.

`scap-direct3d/src/runtime.rs` now retains exactly one process-lifetime MTA usage
cookie before capture construction or public feature probes touch cached WinRT
factories. It does not retain a capture session, frame pool, GPU device, texture,
or Live compositor. The cookie must not be decremented when a Live stops, because
the process-wide factory caches can be used by later captures. Windows reclaims
it when the process exits. This is bounded runtime ownership, distinct from
keeping every Live capture alive or leaving a periodic compositor loop running.

The isolated regression passed all eight restarts after the fix
(`live-winrt-support-green.log`). It was then made a non-ignored Windows
integration test and passed again (`live-winrt-support-default.log`). Its purpose
is to prove that support queries survive apartment restarts without errors or
crashes; either supported or unsupported is a valid capability result.

Follow-up verification:

- `live-winrt-scap-lib.log`: 11 capture-library unit tests passed.
- `live-winrt-native.log`: all 3 Hook native tests passed in one process. This
  includes real capture CPU suppression/static fallback, two GPU surfaces and
  compositor retirement/recreation, shared static late join and crop colors,
  source resize/close, and zero remaining shared pools/resource reservations.
- `live-winrt-hook-lib.log`: 386 passed, 0 failed, 16 ignored.
- `live-winrt-format.log` and `live-winrt-scap-format.log`: formatter checks passed.
- `live-winrt-lines.log`: strict line check passed, 1095 files.

The earlier failed runs remain recorded above. No callback-drain rewrite was
needed to make these tests pass. This does not prove every potential callback
race absent. Direct `windows::core::factory` calls in target lookup acquire fresh
interfaces instead of using the generated static `FactoryCache`; they are not
the same stale-cache boundary and were not given redundant lifetime hooks.
Normal worker exit marks the session closed before removing its GPU slot;
frontend GPU configuration holds that state mutex while checking eligibility.

## V0.2.26 candidate

The local build and ZIP packaging completed under
`Neuro/release/Hook/live-gpu-teardown-20260907-r1/V0.2.26/`.
The packaged executable's no-GUI self-check returned version `0.2.26` and status
`ok`; this check is not itself GPU or interaction acceptance. The single-Live
packaged GPU/Unit probe failed at its initial Ctrl+2 selection: `.unit-live-input`
did not become visible within 20 seconds. No downstream interaction/parity step
passed. The selection UI remained visible, so this run does not establish a
GPU display failure or a shutdown leak. Its specific input/selection failure
remains unresolved. No multi-video stress run was started.

Evidence: `artifacts/live-gpu-teardown-packaged-20260907-r1/summary.json`,
`failure.png`, and `artifacts/live-gpu-teardown-packaged.log`. After the wrapper
completed cleanup, a fresh process audit found zero Hook/test executables and
zero processes referring to this probe's dedicated profile directory. Do not
promote this candidate as fully accepted or replace the user's running version.

- Executable: `portable/hook.exe`, 7,984,128 bytes.
- Executable SHA-256:
  `d48427e90555827e0bcef0cb3f1498dd3894b532c78a4121aff7886354865054`.
- ZIP: `packages/hook-windows-x64-V0.2.26.zip`.
- ZIP SHA-256:
  `7d0af845c39d253088b7f6c9de8beb2b641122048e8fbd112b4f7f289c654c95`.
- Provenance records `gitDirty=true`, `uiAccess=false`, and build time
  `2026-09-07T12:06:36.8490183+08:00`. This is a local candidate, not a clean-tag
  formal publication. No automatic installation into Loom or replacement of
  the user's current Hook was performed.
