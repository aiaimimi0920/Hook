> **Archived note:** This file is kept for historical planning context and may not reflect the current Hook codebase. 当前实现请以仓库根目录 `README.md`、`PROJECT_OVERVIEW.md`、`TECHNICAL_ARCHITECTURE.md` 为准.

# Hook Sticker Top Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new sticker-level top strip shell that stays visible for selected stickers without replacing the existing sticker edit toolbar.

**Architecture:** Introduce an isolated `stickerTopStripLayout` service plus a dedicated `StickerTopStrip` portal component, then mount it from `UnitView` under the selected-sticker path while preserving the old `StickerEditToolbar`.

**Tech Stack:** SolidJS, TypeScript, Vitest, Tauri.

---

## Task 1: Lock the top-strip geometry contract with failing tests

**Files:**
- Create: `__tests__/unit/stickerTopStripLayout.test.ts`
- Create: `src/services/stickerTopStripLayout.ts`

- [ ] **Step 1: Write the failing unit tests for the new top-strip layout helper**

```ts
import { describe, expect, it } from "vitest";
import {
  STICKER_TOP_STRIP_HEIGHT,
  STICKER_TOP_STRIP_MIN_WIDTH,
  computeStickerTopStripFrame,
} from "../../src/services/stickerTopStripLayout";

describe("sticker top strip layout", () => {
  it("anchors above the sticker and left-aligns to the sticker by default", () => {
    const frame = computeStickerTopStripFrame({ x: 240, y: 220, w: 520, h: 180 }, 1440, 900);
    expect(frame.left).toBe(240);
    expect(frame.top).toBe(220 - STICKER_TOP_STRIP_HEIGHT);
    expect(frame.width).toBe(520);
    expect(frame.height).toBe(STICKER_TOP_STRIP_HEIGHT);
  });
});
```

- [ ] **Step 2: Run the new unit test and confirm it fails because the layout helper does not exist yet**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && node_modules\.bin\vitest.cmd run __tests__\unit\stickerTopStripLayout.test.ts --pool threads --maxWorkers 1 --no-file-parallelism"
```

Expected: FAIL with a module-resolution error for `src/services/stickerTopStripLayout.ts`.

- [ ] **Step 3: Implement the minimal layout helper**

```ts
export const STICKER_TOP_STRIP_MIN_WIDTH = 400;
export const STICKER_TOP_STRIP_HEIGHT = 80;

export const computeStickerTopStripFrame = (
  anchor: { x: number; y: number; w: number; h: number },
  viewportWidth: number,
  viewportHeight: number,
) => {
  // width clamp + above/below placement + best-fit viewport clamping
};
```

- [ ] **Step 4: Re-run the same unit test file**

Run the same command from Step 2.

Expected: PASS for the layout behaviors.

## Task 2: Lock the mounting contract before wiring the UI

**Files:**
- Create: `__tests__/integration/StickerTopStripContract.test.ts`
- Create: `src/components/StickerTopStrip.tsx`
- Modify: `src/components/UnitView.tsx`

- [ ] **Step 1: Write the failing contract test for the new strip component and selected-sticker mount path**

```ts
expect(topStripSource).toContain("export const StickerTopStrip");
expect(topStripSource).toContain("computeStickerTopStripFrame");
expect(unitViewSource).toContain("<StickerTopStrip");
expect(unitViewSource).toContain("props.unit.type === \"sticker\" && props.isSelected");
expect(unitViewSource).toContain("<StickerEditToolbar");
```

- [ ] **Step 2: Run the contract test and confirm it fails because the component is not mounted yet**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && node_modules\.bin\vitest.cmd run __tests__\integration\StickerTopStripContract.test.ts --pool threads --maxWorkers 1 --no-file-parallelism"
```

Expected: FAIL because `StickerTopStrip.tsx` and the `UnitView` mount path do not exist yet.

- [ ] **Step 3: Implement the minimal portal component and mount it**

```tsx
export const StickerTopStrip: Component<StickerTopStripProps> = (props) => (
  <Portal>
    <div class="fixed z-[1195] border border-white/20 bg-black/70" />
  </Portal>
);
```

Also mount it from `UnitView.tsx` under the selected-sticker overlay path while keeping `StickerEditToolbar` unchanged.

- [ ] **Step 4: Re-run the contract test**

Run the same command from Step 2.

Expected: PASS for the top-strip mount contract.

## Task 3: Verify the complete Hook slice and package a fresh release

**Files:**
- Modify: `src/components/StickerTopStrip.tsx`
- Modify: `src/components/UnitView.tsx`
- Modify: `package-hook-release.ps1` (only if packaging needs explicit version output changes; otherwise no code change)

- [ ] **Step 1: Run targeted tests for the new strip**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && node_modules\.bin\vitest.cmd run __tests__\unit\stickerTopStripLayout.test.ts __tests__\integration\StickerTopStripContract.test.ts --pool threads --maxWorkers 1 --no-file-parallelism"
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm run typecheck"
```

Expected: exit 0.

- [ ] **Step 3: Run the full Hook test suite**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm test"
```

Expected: all test files pass with zero failures.

- [ ] **Step 4: Run the production build**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm run build"
```

Expected: exit 0.

- [ ] **Step 5: Build and package the fresh release exe**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm run tauri -- build --no-bundle"
powershell -ExecutionPolicy Bypass -File C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\package-hook-release.ps1 -VersionId 20260629-sticker-top-strip
```

Expected: a new release folder under `C:\Users\Public\nas_home\AI\GameEditor\Neuro\release\Hook\20260629-sticker-top-strip` containing `hook.exe`.
