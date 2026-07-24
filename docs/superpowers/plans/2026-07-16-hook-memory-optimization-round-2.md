# Hook Memory Optimization Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep eager global hook installation unchanged while reducing Hook memory growth by keeping file-backed images as file paths instead of rehydrating them into base64 during session restore and file-path delivery flows.

**Architecture:** Preserve the existing startup-time global hook baseline in Rust. Shift image handling so persisted session stickers and `file_path` art deliveries keep raw local file paths in state, then normalize those paths only at display-time in the frontend via a dedicated helper. Cover the highest-risk display and canvas entry points with small contract tests so regressions are caught without another memory-heavy code path sneaking back in.

**Tech Stack:** Tauri 2, Rust, SolidJS, TypeScript, Vitest, Cargo

---

### Task 1: Lock the regression contract before more code changes

**Files:**
- Modify: `<hook-repo-root>/__tests__/integration/HookMemoryBaselineContract.test.ts`
- Modify: `<hook-repo-root>/__tests__/services/imageSource.test.ts`
- Test: `<hook-repo-root>/node_modules/.bin/vitest.cmd`

- [ ] **Step 1: Extend the failing contract tests**

Add assertions that:

```ts
expect(rustSource).not.toContain('sticker.src = format!("data:image/png;base64,{}", b64);');
expect(appSource).not.toContain("previewSrc = await api.readImageFromPath(filePath);");
expect(unitParamsPanelSource).toContain("normalizeImageSourceForDisplay");
```

and keep the existing eager global hook assertions:

```ts
expect(rustSource).toContain("install_capture_mouse_hook_thread(window.clone());");
expect(rustSource).toContain("install_overlay_keyboard_hook_thread(window.clone());");
```

- [ ] **Step 2: Run the focused frontend tests to verify current red/green state**

Run:

```powershell
node_modules\.bin\vitest.cmd run __tests__/integration/HookMemoryBaselineContract.test.ts __tests__/services/imageSource.test.ts
```

Expected:
- existing tests stay green or reveal exactly which contract is still missing
- no unrelated suite failures

---

### Task 2: Keep session-restored file-backed stickers in path form on the Rust side

**Files:**
- Modify: `<hook-repo-root>/src-tauri/src/lib.rs`
- Test: `<hook-repo-root>/src-tauri/src/lib.rs`

- [ ] **Step 1: Keep the Rust-side restore helper focused on validation, not re-encoding**

The restored sticker helper should follow this shape:

```rust
fn restore_loaded_session_stickers(stickers: &mut [StickerData]) {
    for sticker in stickers {
        if sticker.src.starts_with("data:image") {
            continue;
        }

        let path = std::path::Path::new(&sticker.src);
        if !path.exists() {
            println!(
                "Warning: Image file not found for sticker {}: {}",
                sticker.id, sticker.src
            );
        }
    }
}
```

- [ ] **Step 2: Ensure `load_session` calls the helper instead of converting file paths to base64**

The restore path should look like:

```rust
restore_loaded_session_stickers(&mut session_data.stickers);
```

and must not contain:

```rust
let bytes = fs::read(path).map_err(|e| e.to_string())?;
let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
sticker.src = format!("data:image/png;base64,{}", b64);
```

- [ ] **Step 3: Run the focused Rust test**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml restore_loaded_session_stickers_keeps_file_backed_srcs_in_path_form
```

Expected:
- PASS
- the test proves a file-backed sticker source remains a path after restore

---

### Task 3: Normalize local file-backed image sources only at frontend display-time

**Files:**
- Create: `<hook-repo-root>/src/services/imageSource.ts`
- Modify: `<hook-repo-root>/src/app.tsx`
- Modify: `<hook-repo-root>/src/services/stickerCanvas.ts`
- Modify: `<hook-repo-root>/src/components/UnitView.tsx`
- Modify: `<hook-repo-root>/src/components/UnitParamsPanel.tsx`
- Modify: `<hook-repo-root>/src/components/StickerSnapshotListPanel.tsx`

- [ ] **Step 1: Keep the image source normalizer small and display-only**

The helper should:

```ts
import { convertFileSrc } from "@tauri-apps/api/core";

export const isLikelyLocalFilePath = (src: string | null | undefined) => { /* windows path detection */ };

export const normalizeImageSourceForDisplay = (
  src: string | null | undefined,
  fileSrcConverter: (path: string) => string = convertFileSrc,
) => { /* data/blob/http/asset passthrough, file path -> convertFileSrc */ };
```

- [ ] **Step 2: Use the normalizer in the `file_path` art delivery branch**

The `file_path` branch in `src/app.tsx` should be:

```ts
case "file_path":
    filePath = delivery.delivery.path;
    if (filePath) {
        previewSrc = normalizeImageSourceForDisplay(filePath);
    }
    break;
```

and not:

```ts
previewSrc = await api.readImageFromPath(filePath);
```

- [ ] **Step 3: Normalize display/canvas consumers that may now see raw file paths**

Update the high-value consumers:

```ts
// stickerCanvas.ts
const resolvedSrc = normalizeImageSourceForDisplay(src);
image.src = resolvedSrc;

// UnitView.tsx
normalizeImageSourceForDisplay(liveUnit().data.previewSrc || liveUnit().data.src || "")

// UnitParamsPanel.tsx
return normalizeImageSourceForDisplay(props.unit.data.previewSrc || props.unit.data.src || "") || "";

// StickerSnapshotListPanel.tsx
src={normalizeImageSourceForDisplay(entry.snapshot.previewSrc || entry.snapshot.src)}
```

- [ ] **Step 4: Re-run the focused frontend tests**

Run:

```powershell
node_modules\.bin\vitest.cmd run __tests__/integration/HookMemoryBaselineContract.test.ts __tests__/services/imageSource.test.ts
```

Expected:
- PASS
- the contract proves file-backed display paths are normalized instead of eagerly decoded into base64

---

### Task 4: Verify type safety and Rust compile health before reporting completion

**Files:**
- Verify only

- [ ] **Step 1: Run TypeScript type checking**

Run:

```powershell
npm run typecheck
```

Expected:
- PASS

- [ ] **Step 2: Run Rust compile verification**

Run:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected:
- PASS

- [ ] **Step 3: Record the real behavioral outcome for the user**

Report:

```text
1. eager global hook install preserved
2. file-backed stickers stay as paths during session restore
3. frontend display paths are normalized only when rendered
4. tests and compile checks run clean
```
