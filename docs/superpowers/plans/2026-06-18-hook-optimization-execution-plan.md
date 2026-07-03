> **Archived note:** This file is kept for historical planning context and may not reflect the current Hook codebase. 当前实现请以仓库根目录 `README.md`、`PROJECT_OVERVIEW.md`、`TECHNICAL_ARCHITECTURE.md` 为准.

# Hook Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Hook optimization pass by preserving current screenshot and image-import behavior while reducing avoidable memory, payload, and release-path risk in the Hook subproject only.

**Architecture:** Keep Hook's existing SolidJS + Tauri structure and optimize inside the current boundaries instead of refactoring unrelated modules. Long capture remains a frontend-driven interaction, but frame ownership and stitching move to a Rust-backed session path first, with the pre-existing frontend stitching path retained as fallback. Image import remains permissive for current supported formats and continues to rely on the Rust `image` crate for real decoding and MIME detection.

**Tech Stack:** SolidJS, TypeScript, Tauri, Rust, Vitest, Cargo, PowerShell, `image`, `base64`.

---

## Constraints and non-goals

- Do **not** touch unrelated subprojects such as `Loom`, `Talk`, `Tea`, `Gateway`, or release pipelines outside Hook.
- Do **not** remove the Rust `image` dependency from `Hook/src-tauri/Cargo.toml`.
- Do **not** narrow current drag-in image support for `png`, `jpg`, `jpeg`, `webp`, and `bmp`.
- Do **not** remove legacy fallback behavior for long capture if the backend session flow fails to start.
- Do **not** fork release output away from `C:\Users\Public\nas_home\AI\GameEditor\Neuro\release\Hook\<VersionId>`.
- Optimize without trimming screenshot, clipboard, sticker, or session-sync features.

## Current code-reality notes

- Long capture backend session commands already exist in `Hook/src-tauri/src/lib.rs` and are already wired into `Hook/src/services/api.ts` plus `Hook/src/hooks/useSelection.ts`.
- Payload deduping already exists through `Hook/src/services/syncedImagePayload.ts`, currently used by `Hook/src/services/syncService.ts`.
- Image import format preservation already exists through `read_image_from_path` in `Hook/src-tauri/src/lib.rs` plus extension gating in `Hook/src/hooks/useFileDrop.ts`.
- `Hook/src-tauri/src/long_capture.rs`, `Hook/src/components/UnitView.tsx`, and `Hook/src/store/uiStore.ts` should only be touched if an implementation task proves they are the smallest correct place for a follow-up optimization. They are **not** mandatory edit targets just because they appeared in an older draft.

---

## Task 1: Lock the non-regression guardrails that the user explicitly cares about

**Files:**
- Create: `Hook/__tests__/integration/HookOptimizationGuardrailsContract.test.ts`
- Create: `Hook/__tests__/integration/ImageImportPreservationContract.test.ts`
- Create: `Hook/__tests__/integration/LongCaptureSessionContract.test.ts`
- Create: `Hook/__tests__/integration/WorkflowPayloadSlimmingContract.test.ts`
- Modify: `Hook/__tests__/integration/ReleaseLauncherContract.test.ts`
- Create: `Hook/__tests__/releasePackaging.contract.test.ts`

- [ ] **Step 1: Read the current Hook code paths before tightening contracts**

Confirm the real surfaces this task is protecting:

```powershell
Get-Content -Raw Hook\src\hooks\useFileDrop.ts
Get-Content -Raw Hook\src\services\api.ts
Get-Content -Raw Hook\src\hooks\useSelection.ts
Get-Content -Raw Hook\src\services\syncService.ts
Get-Content -Raw Hook\src\services\syncedImagePayload.ts
Get-Content -Raw Hook\src-tauri\src\lib.rs
```

Expected:
- The image import path still goes through `useFileDrop.ts -> api.readImageFromPath -> read_image_from_path`.
- Long capture session commands are visible in both TypeScript and Rust.
- Sync payload building flows through `buildSyncedImagePayload`.

- [ ] **Step 2: Keep the contract tests source-based and narrow**

Use source-shape contract tests that assert the preserved boundaries rather than implementation trivia. The guardrail tests should check:

```ts
expect(fileDropSource).toContain('endsWith(".png")');
expect(fileDropSource).toContain('endsWith(".jpg")');
expect(fileDropSource).toContain('endsWith(".jpeg")');
expect(fileDropSource).toContain('endsWith(".webp")');
expect(fileDropSource).toContain('endsWith(".bmp")');
expect(apiSource).toContain("readImageFromPath");
expect(rustSource).toContain("fn read_image_from_path");
expect(cargoToml).toContain('image = "0.25.9"');
expect(apiSource).toContain("startLongCaptureSession");
expect(selectionSource).toContain("finishAutoLongCaptureSession");
expect(syncServiceSource).toContain("buildSyncedImagePayload");
expect(packageSource).toContain('"Hook"');
```

Do **not** make these tests assert exact formatting or brittle inline string assembly that would fail on harmless refactors.

- [ ] **Step 3: Run only the new contract suites first**

Run:

```powershell
cd Hook
node_modules\.bin\vitest.cmd run __tests__\integration\HookOptimizationGuardrailsContract.test.ts __tests__\integration\ImageImportPreservationContract.test.ts __tests__\integration\LongCaptureSessionContract.test.ts __tests__\integration\WorkflowPayloadSlimmingContract.test.ts __tests__\integration\ReleaseLauncherContract.test.ts __tests__\releasePackaging.contract.test.ts --pool threads --maxWorkers 1 --no-file-parallelism
```

Expected:
- PASS.
- If a contract fails here, fix the contract itself if it is stale before changing production code.

- [ ] **Step 4: Commit the contract layer before deeper optimization**

```powershell
git add Hook/__tests__/integration/HookOptimizationGuardrailsContract.test.ts Hook/__tests__/integration/ImageImportPreservationContract.test.ts Hook/__tests__/integration/LongCaptureSessionContract.test.ts Hook/__tests__/integration/WorkflowPayloadSlimmingContract.test.ts Hook/__tests__/integration/ReleaseLauncherContract.test.ts Hook/__tests__/releasePackaging.contract.test.ts
git commit -m "test(hook): lock optimization guardrails"
```

---

## Task 2: Finalize backend-owned long capture without breaking the existing interaction

**Files:**
- Modify: `Hook/src-tauri/src/lib.rs`
- Modify: `Hook/src/services/api.ts`
- Modify: `Hook/src/hooks/useSelection.ts`
- Modify: `Hook/__tests__/integration/LongCaptureSessionContract.test.ts`
- Modify: `Hook/__tests__/integration/LongCaptureContract.test.ts`
- Modify: `Hook/__tests__/unit/captureState.test.ts`

- [ ] **Step 1: Verify the current backend session path and identify only real remaining gaps**

Read the active files:

```powershell
Get-Content -Raw Hook\src-tauri\src\lib.rs
Get-Content -Raw Hook\src\services\api.ts
Get-Content -Raw Hook\src\hooks\useSelection.ts
Get-Content -Raw Hook\__tests__\integration\LongCaptureContract.test.ts
Get-Content -Raw Hook\__tests__\unit\captureState.test.ts
```

Expected:
- `start_long_capture_session`, `sample_long_capture_session`, `finish_long_capture_session`, and `cancel_long_capture_session` are already present.
- `useSelection.ts` uses backend session first and local stitching as fallback.
- Any remaining work should be limited to correctness, edge-case cleanup, or tests.

- [ ] **Step 2: Keep the session API contract explicit**

The session surface should remain:

```ts
startLongCaptureSession: (rect) => safeInvoke("start_long_capture_session", { rect })
sampleLongCaptureSession: (sessionId) => safeInvoke("sample_long_capture_session", { sessionId })
finishLongCaptureSession: (sessionId) => safeInvoke("finish_long_capture_session", { sessionId })
cancelLongCaptureSession: (sessionId) => safeInvoke("cancel_long_capture_session", { sessionId })
```

And the frontend flow should keep these behaviors:

```ts
autoLongCaptureBackendSessionId = await api.startLongCaptureSession(rect);
const response = await api.sampleLongCaptureSession(autoLongCaptureBackendSessionId);
const stitched = await api.finishLongCaptureSession(backendSessionId);
await api.cancelLongCaptureSession(autoLongCaptureBackendSessionId);
```

Do **not** remove the fallback branch that captures frames in the frontend when backend session startup fails.

- [ ] **Step 3: Validate Rust-side long capture behavior directly**

Run:

```powershell
cargo test --manifest-path Hook\src-tauri\Cargo.toml long_capture --lib
cargo test --manifest-path Hook\src-tauri\Cargo.toml app_cli_tests --lib
```

Expected:
- PASS.
- No regression in Rust-side capture/image helper tests.

- [ ] **Step 4: Validate TypeScript long-capture behavior**

Run:

```powershell
cd Hook
node_modules\.bin\vitest.cmd run __tests__\integration\LongCaptureContract.test.ts __tests__\integration\LongCaptureSessionContract.test.ts __tests__\unit\captureState.test.ts --pool threads --maxWorkers 1 --no-file-parallelism
```

Expected:
- PASS.
- Ctrl+3 still maps to a long-capture flow and the contract still recognizes both axis-aware analysis and fallback stitching.

- [ ] **Step 5: Commit only if there were real code changes**

If files changed:

```powershell
git add Hook/src-tauri/src/lib.rs Hook/src/services/api.ts Hook/src/hooks/useSelection.ts Hook/__tests__/integration/LongCaptureSessionContract.test.ts Hook/__tests__/integration/LongCaptureContract.test.ts Hook/__tests__/unit/captureState.test.ts
git commit -m "feat(hook): finalize backend long capture session flow"
```

If no production change was needed, skip the commit and record that Task 2 was satisfied by existing implementation plus verification evidence.

---

## Task 3: Preserve image import breadth and make MIME detection stay evidence-based

**Files:**
- Modify: `Hook/src-tauri/src/lib.rs`
- Modify: `Hook/src/hooks/useFileDrop.ts`
- Modify: `Hook/src/services/api.ts`
- Modify: `Hook/__tests__/integration/ImageImportPreservationContract.test.ts`
- Create: `Hook/__tests__/unit/syncedImagePayload.test.ts`

- [ ] **Step 1: Confirm the real supported image boundary before changing anything**

Run:

```powershell
Get-Content -Raw Hook\src\hooks\useFileDrop.ts
Get-Content -Raw Hook\src-tauri\src\lib.rs
Get-Content -Raw Hook\src-tauri\Cargo.toml
```

Expected:
- `useFileDrop.ts` currently gates `png`, `jpg`, `jpeg`, `webp`, `bmp`.
- Rust reads bytes and infers MIME from bytes/path.
- `image = "0.25.9"` is still present.

- [ ] **Step 2: Preserve the current drag-in contract exactly unless Rust support is proven broader**

The allowed extension check should stay at least this broad:

```ts
if (
  !lower.endsWith(".png") &&
  !lower.endsWith(".jpg") &&
  !lower.endsWith(".jpeg") &&
  !lower.endsWith(".webp") &&
  !lower.endsWith(".bmp")
) {
  return;
}
```

If you want to add more formats later, first prove the Rust side and the real UX both support them. Do **not** pretend to support extra formats only because `image` might decode them.

- [ ] **Step 3: Keep MIME detection content-based on the Rust side**

The Rust path should continue to prefer real content/path detection before extension fallback:

```rust
if let Some(mime) = image::guess_format(bytes).ok().and_then(mime_from_image_format) {
    return mime;
}

if let Some(mime) = image::ImageFormat::from_path(path).ok().and_then(mime_from_image_format) {
    return mime;
}
```

This is the minimum acceptable direction because the user explicitly wants future non-PNG/JPEG image usage preserved.

- [ ] **Step 4: Validate the image-preservation suites**

Run:

```powershell
cargo test --manifest-path Hook\src-tauri\Cargo.toml app_cli_tests --lib
cd Hook
node_modules\.bin\vitest.cmd run __tests__\integration\ImageImportPreservationContract.test.ts __tests__\unit\syncedImagePayload.test.ts --pool threads --maxWorkers 1 --no-file-parallelism
```

Expected:
- PASS.
- No regression in image import boundaries or MIME inference contract.

- [ ] **Step 5: Commit only if code changed**

```powershell
git add Hook/src-tauri/src/lib.rs Hook/src/hooks/useFileDrop.ts Hook/src/services/api.ts Hook/__tests__/integration/ImageImportPreservationContract.test.ts Hook/__tests__/unit/syncedImagePayload.test.ts
git commit -m "fix(hook): preserve image import breadth"
```

---

## Task 4: Keep sync payload slimming, startup hardening, and release-path discipline

**Files:**
- Modify: `Hook/src/services/syncService.ts`
- Create: `Hook/src/services/syncedImagePayload.ts`
- Modify: `Hook/src-tauri/src/lib.rs`
- Modify: `Hook/build-hook-release.bat`
- Modify: `Hook/__tests__/integration/DesktopLiveSyncContract.test.ts`
- Modify: `Hook/__tests__/integration/ReleaseLauncherContract.test.ts`
- Modify: `Hook/__tests__/releasePackaging.contract.test.ts`

- [ ] **Step 1: Verify the dedupe helper is the single intended payload-shaping surface**

Read:

```powershell
Get-Content -Raw Hook\src\services\syncService.ts
Get-Content -Raw Hook\src\services\syncedImagePayload.ts
Get-Content -Raw Hook\__tests__\integration\DesktopLiveSyncContract.test.ts
```

Expected:
- `syncService.ts` imports `buildSyncedImagePayload` and `normalizePreviewSrc`.
- `syncedImagePayload.ts` is the single helper responsible for dropping redundant `previewSrc`.
- `DesktopLiveSyncContract.test.ts` checks the contract, not an outdated inline implementation string.

- [ ] **Step 2: Keep the slim-payload behavior scoped to duplicate data only**

The accepted behavior is:

```ts
export const normalizePreviewSrc = (unit) => {
    const previewSrc = unit.data.previewSrc;
    if (!previewSrc || previewSrc === unit.data.src) {
        return undefined;
    }
    return previewSrc;
};
```

And:

```ts
return {
    src: unit.data?.src,
    ...(previewSrc ? { previewSrc } : {}),
    rasterizedAnnotationLayerSrc: unit.data?.rasterizedAnnotationLayerSrc || null,
};
```

This is deduplication, not feature removal. Do **not** drop `src`, `previewSrc` when distinct, or `rasterizedAnnotationLayerSrc`.

- [ ] **Step 3: Keep the Rust startup hardening intact**

The backend should continue to fail soft around startup cleanup and lock paths:

```rust
append_runtime_log_line("update_pin_rects_lock_failed");
append_runtime_log_line("set_mouse_monitor_active_lock_failed");
append_runtime_log_line(&format!("clipboard_cache_cleanup_failed :: {}", error));
```

Do not replace these with panics, unwrap chains, or blocking cleanup behavior that could make startup more brittle.

- [ ] **Step 4: Run the full Hook validation sweep**

Run:

```powershell
cargo fmt --check --manifest-path Hook\src-tauri\Cargo.toml
cargo test --manifest-path Hook\src-tauri\Cargo.toml app_cli_tests --lib
cargo test --manifest-path Hook\src-tauri\Cargo.toml long_capture --lib
cd Hook
npm run typecheck
npm test
```

Expected:
- PASS.
- Full frontend suite passes without reintroducing redundant sync payload behavior.

- [ ] **Step 5: Re-verify canonical release output**

Run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File Hook\package-hook-release.ps1 -Tag hook-optimization-dryrun -DryRun
powershell.exe -NoProfile -ExecutionPolicy Bypass -File Hook\package-hook-release.ps1 -Tag hook-optimization-final -Force
```

Expected:
- `build-release-exes.ps1` emits a dry-run JSON plan for `C:\Users\Public\nas_home\AI\GameEditor\Neuro\release\Hook\hook-optimization-dryrun`.
- `C:\Users\Public\nas_home\AI\GameEditor\Neuro\release\Hook\hook-optimization-final` is generated in force mode.
- Final package contains `hook.exe`, `manifest.json`, `checksums.sha256`, and package zip output.

- [ ] **Step 6: Commit only if this task changed code or packaging tests**

```powershell
git add Hook/src/services/syncService.ts Hook/src/services/syncedImagePayload.ts Hook/src-tauri/src/lib.rs Hook/build-hook-release.bat Hook/__tests__/integration/DesktopLiveSyncContract.test.ts Hook/__tests__/integration/ReleaseLauncherContract.test.ts Hook/__tests__/releasePackaging.contract.test.ts
git commit -m "perf(hook): slim sync payloads and preserve release path"
```

---

## Task 5: Plan-completion audit against the user’s accepted optimization intent

**Files:**
- Modify: `Hook/docs/superpowers/plans/2026-06-18-hook-optimization-execution-plan.md`
- Review only: `Hook/src-tauri/src/lib.rs`
- Review only: `Hook/src/hooks/useSelection.ts`
- Review only: `Hook/src/services/api.ts`
- Review only: `Hook/src/services/syncService.ts`
- Review only: `Hook/src/services/syncedImagePayload.ts`
- Review only: `Hook/src/hooks/useFileDrop.ts`

- [ ] **Step 1: Audit the old draft assumptions against actual implementation**

Specifically verify and record:

```text
- Hook/src-tauri/src/long_capture.rs did not need modification if lib.rs-owned session state solved the problem.
- Hook/src/components/UnitView.tsx did not need modification if payload shaping was fully centralized in syncService.ts + syncedImagePayload.ts.
- Hook/src/store/uiStore.ts only needs changes if session-state UX requires it beyond what already exists.
- readImageFromPath unit coverage can be satisfied by integration + Rust tests when the true logic lives in Rust, not in a TypeScript helper.
```

If any of these statements are false in the live code, reopen the relevant task before declaring completion.

- [ ] **Step 2: Produce the final verification summary from commands already run**

Record the exact green checks:

```text
- cargo fmt --check --manifest-path Hook\src-tauri\Cargo.toml
- cargo test --manifest-path Hook\src-tauri\Cargo.toml app_cli_tests --lib
- cargo test --manifest-path Hook\src-tauri\Cargo.toml long_capture --lib
- cd Hook && npm run typecheck
- cd Hook && npm test
- powershell.exe -NoProfile -ExecutionPolicy Bypass -File Hook\package-hook-release.ps1 -Tag hook-optimization-final -Force
```

- [ ] **Step 3: Only then mark the Hook optimization plan complete**

Completion criteria:

```text
- Long capture keeps Ctrl+3 interaction and preserves fallback behavior.
- Image import support is preserved and the Rust image dependency remains.
- Payload slimming removes duplicate transfer only, not features.
- Release artifacts still land under release\Hook\<VersionId>.
- Hook-only scope was respected.
```

There is no code to write in this step; it is an evidence gate.

---

## Self-review checklist

- [ ] The plan reflects the current Hook codebase, not an earlier imagined file-touch list.
- [ ] The plan preserves the `image` module and current drag-in behavior.
- [ ] The plan explicitly keeps long-capture fallback behavior.
- [ ] The plan keeps release output rooted under `C:\Users\Public\nas_home\AI\GameEditor\Neuro\release\Hook`.
- [ ] Each task contains exact files and executable commands.
- [ ] No task optimizes by silently removing a user-visible capability.
