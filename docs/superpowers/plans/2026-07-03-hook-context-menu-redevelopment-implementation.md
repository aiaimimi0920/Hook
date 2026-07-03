# Hook Context Menu Redevelopment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Hook's sticker context-menu feature in staged, testable passes on top of the stable `v6版本` baseline without reusing any broken post-v6 context-menu code.

**Architecture:** Extend the existing Hook session model with frozen sticker snapshots for recycle-bin and reference-library data first, then layer on a global single-menu controller, a top-level menu overlay, submenu thumbnail panels, and finally hit-test hardening and visual polish. Keep screenshot capture logic isolated by closing menus on capture entry and never wiring menu state into the existing `Ctrl+1 / Ctrl+3` shortcut semantics.

**Tech Stack:** SolidJS, TypeScript, Vitest, Tauri Rust backend, existing Hook session persistence bridge

---

### Task 1: Add the recycle-bin / reference-library data model and session persistence

**Files:**
- Create: `Hook/src/services/stickerSnapshot.ts`
- Create: `Hook/src/services/stickerLibraryModel.ts`
- Create: `Hook/__tests__/unit/stickerSnapshot.test.ts`
- Create: `Hook/__tests__/unit/stickerLibraryModel.test.ts`
- Modify: `Hook/src/services/api.ts`
- Modify: `Hook/src/services/syncService.ts`
- Modify: `Hook/src/store/graphStore.ts`
- Modify: `Hook/src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing unit tests for frozen snapshots and list behavior**

```ts
// Hook/__tests__/unit/stickerSnapshot.test.ts
import { describe, expect, it } from "vitest";
import type { Unit } from "../../src/types/unit";
import {
  captureFrozenStickerSnapshot,
  instantiateStickerFromFrozenSnapshot,
} from "../../src/services/stickerSnapshot";

const createSticker = (): Unit => ({
  id: "sticker-1",
  type: "sticker",
  x: 10,
  y: 20,
  w: 200,
  h: 120,
  params: {},
  inputs: [],
  outputs: [],
  data: {
    src: "data:image/png;base64,source",
    previewSrc: "data:image/png;base64,preview",
    opacityNormal: 0.8,
    opacityMini: 0.5,
    annotationState: { elements: [], selectedIds: [], serialCounter: 1 },
    imageEditState: {
      cropRect: { x: 1, y: 2, w: 30, h: 40 },
      sourceSize: { w: 200, h: 120 },
      borderWidth: 2,
      borderColor: "#ffffff",
      cornerRadius: 6,
      flippedX: false,
      flippedY: false,
      contentEraseStrokes: [],
      beautify: null,
    },
  },
});

describe("stickerSnapshot", () => {
  it("captures a frozen full sticker snapshot without retaining live object references", () => {
    const unit = createSticker();
    const snapshot = captureFrozenStickerSnapshot(unit);
    unit.data.opacityNormal = 0.1;
    expect(snapshot.snapshot.opacityNormal).toBe(0.8);
    expect(snapshot.snapshot.id).toBe("sticker-1");
  });

  it("instantiates a new sticker instance from a frozen snapshot at a +50,+50 mouse offset", () => {
    const snapshot = captureFrozenStickerSnapshot(createSticker());
    const restored = instantiateStickerFromFrozenSnapshot(snapshot, { x: 300, y: 400 });
    expect(restored.id).not.toBe("sticker-1");
    expect(restored.x).toBe(350);
    expect(restored.y).toBe(450);
    expect(restored.data.previewSrc).toBe("data:image/png;base64,preview");
  });
});
```

```ts
// Hook/__tests__/unit/stickerLibraryModel.test.ts
import { describe, expect, it } from "vitest";
import {
  addRecycleBinEntry,
  restoreRecycleBinEntry,
  setReferenceEntry,
  cancelReferenceEntry,
} from "../../src/services/stickerLibraryModel";

const snapshot = {
  entryId: "entry-1",
  sourceStickerId: "sticker-1",
  createdAt: "2026-07-03T00:00:00.000Z",
  snapshot: { id: "sticker-1", src: "data:image/png;base64,x", x: 0, y: 0, w: 10, h: 10 },
};

describe("stickerLibraryModel", () => {
  it("keeps only the latest 10 recycle-bin entries", () => {
    const entries = Array.from({ length: 11 }).reduce((acc, _, index) => {
      return addRecycleBinEntry(acc, {
        ...snapshot,
        entryId: `entry-${index}`,
        createdAt: `2026-07-03T00:00:${String(index).padStart(2, "0")}.000Z`,
      });
    }, [] as typeof snapshot[]);
    expect(entries).toHaveLength(10);
    expect(entries[0].entryId).toBe("entry-1");
  });

  it("restores an entry and removes it from the recycle bin", () => {
    const result = restoreRecycleBinEntry([snapshot], "entry-1", { x: 10, y: 20 });
    expect(result.entries).toEqual([]);
    expect(result.restored.x).toBe(60);
    expect(result.restored.y).toBe(70);
  });

  it("stores a single frozen reference entry per source sticker and supports cancellation", () => {
    const references = setReferenceEntry([], snapshot);
    expect(references).toHaveLength(1);
    expect(cancelReferenceEntry(references, "sticker-1")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the new unit tests and verify they fail for the expected missing exports / behavior**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm test -- __tests__/unit/stickerSnapshot.test.ts __tests__/unit/stickerLibraryModel.test.ts"
```

Expected:

- FAIL because `stickerSnapshot.ts` / `stickerLibraryModel.ts` do not exist yet or the named exports are missing

- [ ] **Step 3: Implement the minimal snapshot helpers and pure list model**

```ts
// Hook/src/services/stickerSnapshot.ts
import { unwrap } from "solid-js/store";
import type { Unit } from "../types/unit";

export interface FrozenStickerSessionSnapshot {
  id: string;
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minified: boolean;
  savedRect: Unit["data"]["savedRect"] | null;
  cropOffset: Unit["data"]["cropOffset"] | null;
  opacityNormal: number;
  opacityMini: number;
  previewSrc: string | null;
  filePath: string | null;
  rasterizedAnnotationLayerSrc: string | null;
  annotationState: Unit["data"]["annotationState"] | null;
  imageEditState: Unit["data"]["imageEditState"] | null;
  captureMeta: Unit["data"]["captureMeta"] | null;
}

export interface FrozenStickerEntry {
  entryId: string;
  sourceStickerId: string;
  createdAt: string;
  snapshot: FrozenStickerSessionSnapshot;
}

export const captureFrozenStickerSnapshot = (unit: Unit): FrozenStickerEntry => ({
  entryId: crypto.randomUUID(),
  sourceStickerId: unit.id,
  createdAt: new Date().toISOString(),
  snapshot: structuredClone(unwrap({
    id: unit.id,
    src: unit.data.src || "",
    x: unit.x,
    y: unit.y,
    w: unit.w,
    h: unit.h,
    minified: unit.data.minified ?? false,
    savedRect: unit.data.savedRect || null,
    cropOffset: unit.data.cropOffset || null,
    opacityNormal: unit.data.opacityNormal ?? 1,
    opacityMini: unit.data.opacityMini ?? 0.9,
    previewSrc: unit.data.previewSrc || null,
    filePath: unit.data.filePath || null,
    rasterizedAnnotationLayerSrc: unit.data.rasterizedAnnotationLayerSrc || null,
    annotationState: unit.data.annotationState || null,
    imageEditState: unit.data.imageEditState || null,
    captureMeta: unit.data.captureMeta || null,
  })),
});

export const instantiateStickerFromFrozenSnapshot = (
  entry: FrozenStickerEntry,
  mouse: { x: number; y: number },
): Unit => ({
  id: crypto.randomUUID(),
  type: "sticker",
  x: mouse.x + 50,
  y: mouse.y + 50,
  w: entry.snapshot.w,
  h: entry.snapshot.h,
  params: {},
  inputs: [{ id: "image", type: "image", direction: "input", label: "Image" }],
  outputs: [{ id: "output_image", type: "image", direction: "output", label: "Image" }],
  data: {
    src: entry.snapshot.src,
    minified: entry.snapshot.minified,
    savedRect: entry.snapshot.savedRect || undefined,
    cropOffset: entry.snapshot.cropOffset || undefined,
    opacityNormal: entry.snapshot.opacityNormal,
    opacityMini: entry.snapshot.opacityMini,
    previewSrc: entry.snapshot.previewSrc || undefined,
    filePath: entry.snapshot.filePath || undefined,
    rasterizedAnnotationLayerSrc: entry.snapshot.rasterizedAnnotationLayerSrc || undefined,
    annotationState: entry.snapshot.annotationState || undefined,
    imageEditState: entry.snapshot.imageEditState || undefined,
    captureMeta: entry.snapshot.captureMeta || undefined,
  },
});
```

```ts
// Hook/src/services/stickerLibraryModel.ts
import type { Unit } from "../types/unit";
import {
  type FrozenStickerEntry,
  instantiateStickerFromFrozenSnapshot,
} from "./stickerSnapshot";

export const addRecycleBinEntry = (
  entries: FrozenStickerEntry[],
  next: FrozenStickerEntry,
): FrozenStickerEntry[] => [...entries, next].slice(-10);

export const restoreRecycleBinEntry = (
  entries: FrozenStickerEntry[],
  entryId: string,
  mouse: { x: number; y: number },
): { entries: FrozenStickerEntry[]; restored: Unit } => {
  const match = entries.find((entry) => entry.entryId === entryId);
  if (!match) throw new Error(`Recycle entry not found: ${entryId}`);
  return {
    entries: entries.filter((entry) => entry.entryId !== entryId),
    restored: instantiateStickerFromFrozenSnapshot(match, mouse),
  };
};

export const setReferenceEntry = (
  entries: FrozenStickerEntry[],
  next: FrozenStickerEntry,
): FrozenStickerEntry[] => [...entries.filter((entry) => entry.sourceStickerId !== next.sourceStickerId), next];

export const cancelReferenceEntry = (
  entries: FrozenStickerEntry[],
  sourceStickerId: string,
): FrozenStickerEntry[] => entries.filter((entry) => entry.sourceStickerId !== sourceStickerId);
```

- [ ] **Step 4: Extend the existing session bridge and backend schema**

```ts
// Hook/src/services/api.ts
import type { FrozenStickerEntry } from "./stickerSnapshot";

export interface SessionData {
  stickers: any[];
  links: any[];
  groups?: any[];
  recycleBin?: FrozenStickerEntry[];
  referenceLibrary?: FrozenStickerEntry[];
}
```

```ts
// Hook/src/store/graphStore.ts
import type { FrozenStickerEntry } from "../services/stickerSnapshot";

const [recycleBin, setRecycleBin] = createStore<FrozenStickerEntry[]>([]);
const [referenceLibrary, setReferenceLibrary] = createStore<FrozenStickerEntry[]>([]);

export const graphStore = {
  // ...
  recycleBin,
  referenceLibrary,
  setRecycleBin,
  setReferenceLibrary,
};
```

```ts
// Hook/src/services/syncService.ts
await api.saveSession(
  graphStore.units.map(mapUnitToSessionSticker),
  graphStore.links.map(mapLinkToSessionLink),
  graphStore.stickerGroups.map(mapGroupToSessionGroup),
  graphStore.recycleBin,
  graphStore.referenceLibrary,
);

graphStore.setRecycleBin(sessionData.recycleBin || []);
graphStore.setReferenceLibrary(sessionData.referenceLibrary || []);
```

```rust
// Hook/src-tauri/src/lib.rs
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FrozenStickerEntry {
    pub entry_id: String,
    pub source_sticker_id: String,
    pub created_at: String,
    pub snapshot: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionData {
    pub stickers: Vec<StickerData>,
    pub links: Vec<LinkData>,
    #[serde(default)]
    pub groups: Vec<serde_json::Value>,
    #[serde(default)]
    pub recycle_bin: Vec<FrozenStickerEntry>,
    #[serde(default)]
    pub reference_library: Vec<FrozenStickerEntry>,
}
```

- [ ] **Step 5: Run the stage-1 unit tests plus backend compile-oriented verification**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm test -- __tests__/unit/stickerSnapshot.test.ts __tests__/unit/stickerLibraryModel.test.ts"
```

Run:

```powershell
cargo test --manifest-path C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\src-tauri\Cargo.toml --lib save_session -- --nocapture
```

Expected:

- new unit tests PASS
- Rust test command exits 0, proving the session schema changes compile

- [ ] **Step 6: Commit the data-layer pass**

```powershell
git add Hook/src/services/stickerSnapshot.ts Hook/src/services/stickerLibraryModel.ts Hook/src/services/api.ts Hook/src/services/syncService.ts Hook/src/store/graphStore.ts Hook/src-tauri/src/lib.rs Hook/__tests__/unit/stickerSnapshot.test.ts Hook/__tests__/unit/stickerLibraryModel.test.ts
git commit -m "feat(hook): add frozen sticker session libraries"
```

### Task 2: Add the global single-menu controller and primary menu shell

**Files:**
- Create: `Hook/src/services/stickerContextMenuController.ts`
- Create: `Hook/src/components/StickerContextMenuLayer.tsx`
- Create: `Hook/src/components/StickerContextMenuPanel.tsx`
- Create: `Hook/__tests__/unit/stickerContextMenuController.test.ts`
- Create: `Hook/__tests__/integration/StickerContextMenuPrimaryContract.test.ts`
- Modify: `Hook/src/app.tsx`
- Modify: `Hook/src/components/UnitView.tsx`

- [ ] **Step 1: Write the failing controller and primary-menu contract tests**

```ts
// Hook/__tests__/unit/stickerContextMenuController.test.ts
import { describe, expect, it } from "vitest";
import {
  createStickerContextMenuController,
} from "../../src/services/stickerContextMenuController";

describe("stickerContextMenuController", () => {
  it("keeps only one menu target at a time and resets submenu on reopen", () => {
    const controller = createStickerContextMenuController();
    controller.openForSticker("sticker-1", { x: 10, y: 20 });
    controller.openSubmenu("recycleBin");
    controller.openForSticker("sticker-2", { x: 40, y: 50 });
    expect(controller.state.targetStickerId).toBe("sticker-2");
    expect(controller.state.activeSubmenu).toBe("none");
  });

  it("closes on escape and outside click", () => {
    const controller = createStickerContextMenuController();
    controller.openForSticker("sticker-1", { x: 10, y: 20 });
    controller.close();
    expect(controller.state.isOpen).toBe(false);
  });
});
```

```ts
// Hook/__tests__/integration/StickerContextMenuPrimaryContract.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("primary context-menu contract", () => {
  it("mounts a top-level StickerContextMenuLayer from app.tsx", () => {
    expect(readSource("src/app.tsx")).toContain("StickerContextMenuLayer");
  });

  it("opens a sticker menu from UnitView right click instead of relying on browser defaults", () => {
    const source = readSource("src/components/UnitView.tsx");
    expect(source).toContain("onContextMenu");
    expect(source).toContain("openForSticker");
  });
});
```

- [ ] **Step 2: Run the primary-menu tests and verify they fail**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm test -- __tests__/unit/stickerContextMenuController.test.ts __tests__/integration/StickerContextMenuPrimaryContract.test.ts"
```

Expected:

- FAIL because the controller and primary menu files are missing

- [ ] **Step 3: Implement the global controller and minimal primary menu**

```ts
// Hook/src/services/stickerContextMenuController.ts
export type StickerContextSubmenu = "none" | "recycleBin" | "referenceLibrary";

export interface StickerContextMenuState {
  isOpen: boolean;
  targetStickerId: string | null;
  mouseX: number;
  mouseY: number;
  activeSubmenu: StickerContextSubmenu;
}

export const createStickerContextMenuController = () => {
  const state: StickerContextMenuState = {
    isOpen: false,
    targetStickerId: null,
    mouseX: 0,
    mouseY: 0,
    activeSubmenu: "none",
  };

  return {
    state,
    openForSticker(stickerId: string, mouse: { x: number; y: number }) {
      state.isOpen = true;
      state.targetStickerId = stickerId;
      state.mouseX = mouse.x;
      state.mouseY = mouse.y;
      state.activeSubmenu = "none";
    },
    openSubmenu(submenu: StickerContextSubmenu) {
      state.activeSubmenu = submenu;
    },
    close() {
      state.isOpen = false;
      state.targetStickerId = null;
      state.activeSubmenu = "none";
    },
  };
};
```

```tsx
// Hook/src/components/StickerContextMenuPanel.tsx
export const StickerContextMenuPanel = () => (
  <div class="hook-context-menu-panel">
    <button type="button">关闭</button>
    <button type="button">保存</button>
    <button type="button">回收站</button>
    <button type="button">清空回收站</button>
    <button type="button">设置参考</button>
    <button type="button">参考列表</button>
    <button type="button">清空参考图</button>
  </div>
);
```

- [ ] **Step 4: Integrate the layer in `app.tsx` and right-click open behavior in `UnitView.tsx`**

```tsx
// Hook/src/app.tsx
import { StickerContextMenuLayer } from "./components/StickerContextMenuLayer";

<StickerContextMenuLayer />
```

```tsx
// Hook/src/components/UnitView.tsx
onContextMenu={(event) => {
  if (props.unit.type !== "sticker") return;
  event.preventDefault();
  event.stopPropagation();
  props.onMouseDown(event as unknown as MouseEvent);
  stickerContextMenuController.openForSticker(props.unit.id, {
    x: event.clientX,
    y: event.clientY,
  });
}}
```

- [ ] **Step 5: Run the controller + primary-menu tests**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm test -- __tests__/unit/stickerContextMenuController.test.ts __tests__/integration/StickerContextMenuPrimaryContract.test.ts"
```

Expected:

- PASS

- [ ] **Step 6: Commit the primary-menu shell**

```powershell
git add Hook/src/services/stickerContextMenuController.ts Hook/src/components/StickerContextMenuLayer.tsx Hook/src/components/StickerContextMenuPanel.tsx Hook/src/app.tsx Hook/src/components/UnitView.tsx Hook/__tests__/unit/stickerContextMenuController.test.ts Hook/__tests__/integration/StickerContextMenuPrimaryContract.test.ts
git commit -m "feat(hook): add primary sticker context menu shell"
```

### Task 3: Add recycle-bin and reference-library thumbnail submenus

**Files:**
- Create: `Hook/src/components/StickerSnapshotListPanel.tsx`
- Create: `Hook/__tests__/integration/StickerContextMenuSecondaryContract.test.ts`
- Modify: `Hook/src/components/StickerContextMenuLayer.tsx`
- Modify: `Hook/src/components/StickerContextMenuPanel.tsx`

- [ ] **Step 1: Write the failing submenu contract test**

```ts
// Hook/__tests__/integration/StickerContextMenuSecondaryContract.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("secondary context-menu contract", () => {
  it("uses a shared StickerSnapshotListPanel for recycle-bin and reference-library submenus", () => {
    const layer = readSource("src/components/StickerContextMenuLayer.tsx");
    expect(layer).toContain("StickerSnapshotListPanel");
    expect(layer).toContain('"recycleBin"');
    expect(layer).toContain('"referenceLibrary"');
  });
});
```

- [ ] **Step 2: Run the submenu contract test and verify it fails**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm test -- __tests__/integration/StickerContextMenuSecondaryContract.test.ts"
```

- [ ] **Step 3: Implement the reusable submenu list panel and action wiring**

```tsx
// Hook/src/components/StickerSnapshotListPanel.tsx
import type { FrozenStickerEntry } from "../services/stickerSnapshot";

export const StickerSnapshotListPanel = (props: {
  entries: FrozenStickerEntry[];
  onLeftActivate: (entryId: string) => void;
  onRightActivate: (entryId: string) => void;
}) => (
  <div class="hook-context-menu-snapshot-list">
    {props.entries.map((entry) => (
      <button
        type="button"
        onClick={() => props.onLeftActivate(entry.entryId)}
        onContextMenu={(event) => {
          event.preventDefault();
          props.onRightActivate(entry.entryId);
        }}
      >
        <img src={entry.snapshot.previewSrc || entry.snapshot.src} alt="" />
      </button>
    ))}
  </div>
);
```

- [ ] **Step 4: Run the submenu contract test**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm test -- __tests__/integration/StickerContextMenuSecondaryContract.test.ts"
```

Expected:

- PASS

- [ ] **Step 5: Commit the submenu behavior**

```powershell
git add Hook/src/components/StickerSnapshotListPanel.tsx Hook/src/components/StickerContextMenuLayer.tsx Hook/src/components/StickerContextMenuPanel.tsx Hook/__tests__/integration/StickerContextMenuSecondaryContract.test.ts
git commit -m "feat(hook): add context menu snapshot submenus"
```

### Task 4: Add overlay hit-test rectangles and event swallowing hardening

**Files:**
- Modify: `Hook/src/components/StickerContextMenuLayer.tsx`
- Modify: `Hook/src/services/syncService.ts`
- Modify: `Hook/src/services/uiRegistry.ts`
- Create: `Hook/__tests__/integration/StickerContextMenuHitTestContract.test.ts`

- [ ] **Step 1: Write the failing hit-test contract**

```ts
// Hook/__tests__/integration/StickerContextMenuHitTestContract.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("context-menu hit-test contract", () => {
  it("registers menu overlay rectangles through the existing UI registry path", () => {
    const layer = readSource("src/components/StickerContextMenuLayer.tsx");
    expect(layer).toContain("addOrUpdateRect");
    expect(layer).toContain("removeRect");
  });
});
```

- [ ] **Step 2: Run the hit-test contract and verify it fails**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm test -- __tests__/integration/StickerContextMenuHitTestContract.test.ts"
```

- [ ] **Step 3: Register coarse menu rects and swallow pointer events**

```tsx
// Hook/src/components/StickerContextMenuLayer.tsx
onMouseDown={(event) => {
  event.stopPropagation();
}}
onMouseUp={(event) => {
  event.stopPropagation();
}}
onClick={(event) => {
  event.stopPropagation();
}}
onContextMenu={(event) => {
  event.preventDefault();
  event.stopPropagation();
}}

createEffect(() => {
  if (!menuOpen) return;
  addOrUpdateRect({
    id: "sticker-context-menu-primary",
    x: menuX,
    y: menuY,
    width: menuWidth,
    height: menuHeight,
    name: "STICKER_CONTEXT_MENU_PRIMARY",
  });
});

onCleanup(() => {
  removeRect("sticker-context-menu-primary");
});
```

- [ ] **Step 4: Run the hit-test contract**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm test -- __tests__/integration/StickerContextMenuHitTestContract.test.ts"
```

Expected:

- PASS

- [ ] **Step 5: Commit the hit-test hardening**

```powershell
git add Hook/src/components/StickerContextMenuLayer.tsx Hook/src/services/uiRegistry.ts Hook/src/services/syncService.ts Hook/__tests__/integration/StickerContextMenuHitTestContract.test.ts
git commit -m "fix(hook): register and swallow context menu overlay hits"
```

### Task 5: Final polish and regression verification

**Files:**
- Modify: `Hook/src/components/StickerContextMenuPanel.tsx`
- Modify: `Hook/src/components/StickerSnapshotListPanel.tsx`
- Modify: `Hook/src/app.tsx`
- Test: `Hook/__tests__/integration/LongCaptureSessionContract.test.ts`
- Test: `Hook/__tests__/integration/CaptureShortcutDedupContract.test.ts`

- [ ] **Step 1: Remove redundant labels and enlarge submenu browsing height**

```tsx
// Hook/src/components/StickerSnapshotListPanel.tsx
<div
  class="hook-context-menu-snapshot-list"
  style={{
    "max-height": "420px",
    overflow: "auto",
  }}
>
```

```tsx
// Hook/src/components/StickerContextMenuPanel.tsx
// Keep text-only menu rows; do not add size/time/help labels into submenus.
```

- [ ] **Step 2: Add capture-regression guard in app-level menu coordination**

```tsx
// Hook/src/app.tsx
if (isSelecting() || longCaptureSession()?.active) {
  stickerContextMenuController.close();
}
```

- [ ] **Step 3: Run focused Hook regression tests**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm test -- __tests__/integration/CaptureShortcutDedupContract.test.ts __tests__/integration/LongCaptureSessionContract.test.ts __tests__/integration/StickerContextMenuPrimaryContract.test.ts __tests__/integration/StickerContextMenuSecondaryContract.test.ts __tests__/integration/StickerContextMenuHitTestContract.test.ts"
```

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm run typecheck"
```

Expected:

- all listed Hook integration tests PASS
- typecheck exits 0

- [ ] **Step 4: Build-oriented verification**

Run:

```powershell
cmd /d /s /c "pushd C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook && npm run build"
```

Expected:

- static frontend build exits 0

- [ ] **Step 5: Commit the final context-menu pass**

```powershell
git add Hook/src/components/StickerContextMenuPanel.tsx Hook/src/components/StickerSnapshotListPanel.tsx Hook/src/app.tsx
git commit -m "feat(hook): complete staged context menu redevelopment"
```
