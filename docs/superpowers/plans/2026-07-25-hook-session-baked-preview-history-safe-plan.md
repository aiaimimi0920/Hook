# Hook Session Baked Preview + History-Safe Asset Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hook persist viewer-ready baked sticker previews for Loom/session consumers while keeping Hook editing state vector-native and making saved preview/source assets history-safe instead of overwrite-prone.

**Architecture:** Reuse Hook's existing sticker bake pipeline for live sync and extend the session-save path so `saveSession(...)` receives baked `previewSrc` for stickers whose visible result depends on Hook-only edit state. On the Rust side, stop saving session images as fixed `<sticker-id>.png` / `<sticker-id>_preview.png`; instead persist data-URL assets using deterministic content-addressed filenames so unchanged visuals reuse files and old historical references are not silently overwritten.

**Tech Stack:** SolidJS/TypeScript, Vitest, Tauri, Rust

---

### Task 1: Extract and test session-sticker baking logic on the frontend

**Files:**
- Create: `<hook-repo-root>\src\services\sessionStickerPayload.ts`
- Create: `<hook-repo-root>\__tests__\unit\sessionStickerPayload.test.ts`
- Modify: `<hook-repo-root>\src\services\syncService.ts`

- [ ] **Step 1: Write the failing test**

Add a new unit test file that proves:

1. plain stickers keep their existing normalized `previewSrc`
2. stickers with Hook-only edit state get a baked `previewSrc`
3. repeated saves with unchanged signatures reuse cached baked output
4. bake failure falls back to the base session sticker shape

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- __tests__/unit/sessionStickerPayload.test.ts
```

Expected: FAIL because `sessionStickerPayload.ts` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/sessionStickerPayload.ts` with:

- `mapUnitToSessionSticker(unit)`
- `buildSessionStickersForSave(units, options)`

The helper should:

- reuse `normalizePreviewSrc`
- reuse `requiresBakedStickerSyncImage`
- reuse `buildSyncedImageSignature`
- accept the existing baked-preview cache from `syncService`
- inject baked `previewSrc` only into the temporary session payload, never into `graphStore`

- [ ] **Step 4: Wire syncService to use the helper**

Replace the direct:

```ts
graphStore.units.map(mapUnitToSessionSticker)
```

with an awaited:

```ts
const sessionStickers = await buildSessionStickersForSave(...)
```

and pass `sessionStickers` into `api.saveSession(...)`.

- [ ] **Step 5: Run test to verify it passes**

Run:

```powershell
npm test -- __tests__/unit/sessionStickerPayload.test.ts
```

Expected: PASS

---

### Task 2: Make Rust session image persistence content-addressed and history-safe

**Files:**
- Modify: `<hook-repo-root>\src-tauri\src\lib.rs`

- [ ] **Step 1: Write the failing Rust tests**

Add Rust unit tests covering:

1. the same data URL persisted twice for the same sticker/slot resolves to the same file path
2. changed content resolves to a different file path
3. existing files are reused instead of rewritten blindly

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml session_asset
```

Expected: FAIL because the helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Inside `src-tauri/src/lib.rs`, add a focused helper for session asset persistence, for example:

- parse a `data:image/...` payload
- decode the bytes
- compute a deterministic content fingerprint
- generate a filename like `<sticker-id>_<slot>_<fingerprint>.png`
- if the file already exists, reuse it
- otherwise write it once

Apply it to at least:

- `src`
- `previewSrc`

in `save_session(...)`.

- [ ] **Step 4: Run Rust test to verify it passes**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml session_asset
```

Expected: PASS

---

### Task 3: Run targeted regression verification for live sync + session persistence

**Files:**
- Verify only

- [ ] **Step 1: Run targeted frontend tests**

Run:

```powershell
npm test -- __tests__/unit/sessionStickerPayload.test.ts __tests__/unit/syncedImagePayload.test.ts __tests__/integration/DesktopLiveSyncContract.test.ts __tests__/integration/WorkflowPayloadSlimmingContract.test.ts
```

Expected: PASS

- [ ] **Step 2: Run compile/type validation**

Run:

```powershell
npm run typecheck
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: PASS

- [ ] **Step 3: Run build validation**

Run:

```powershell
npm run build
```

Expected: PASS

---

### Task 4: Build a new Hook release for manual Loom/session verification

**Files:**
- Output: `<hook-release-root>\hook.exe`
- Output: timestamped exe/zip under `<hook-release-root>`

- [ ] **Step 1: Build the release exe**

Run:

```powershell
Set-Location <hook-repo-root>
.\build-hook-release.bat <hook-release-root> --force
```

- [ ] **Step 2: Create a timestamped copy and zip**

Reuse the existing local packaging path so testing can compare this build against earlier ones.

- [ ] **Step 3: Manual verification checklist**

Verify:

1. a sticker with vector annotations still remains editable inside Hook
2. after sync/save, `session.json` uses a baked `previewSrc` path for that sticker
3. re-saving unchanged content reuses the same persisted preview asset path
4. changing the annotation causes a new persisted preview asset path
5. Loom/history consumers now see the baked result without needing Hook's vector renderer
