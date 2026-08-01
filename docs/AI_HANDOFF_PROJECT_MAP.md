# Hook AI / Developer Handoff Project Map

This document is for the next developer or AI agent who needs to work in the
Hook repository quickly without re-discovering the codebase from scratch.

It is intentionally more operational than `PROJECT_OVERVIEW.md` and more
module-oriented than `TECHNICAL_ARCHITECTURE.md`.

## 1. What Hook is

Hook is a **Windows-first desktop capture and sticker workspace** built on:

- **Tauri 2** for the desktop host/runtime
- **WebView2** for the Windows frontend rendering surface
- **SolidJS + TypeScript + Vite** for the UI
- **Rust** for native capture, overlay control, global input hooks, file drag,
  clipboard, tray, and local capability bridges

The current codebase should be read as a combination of:

1. a transparent screenshot / overlay tool,
2. a desktop sticker editor and annotation workspace,
3. a local workflow surface with optional Talk / Loom / Tea bridges.

## 2. Read-this-first order

For orientation, the fastest useful reading order is:

1. `README.md`
2. `PROJECT_OVERVIEW.md`
3. `TECHNICAL_ARCHITECTURE.md`
4. `UIACCESS_DISTRIBUTION.md`
5. this file

If you only need current implementation hotspots, jump directly to:

- `src/app.tsx`
- `src/store/uiStore.ts`
- `src/store/graphStore.ts`
- `src/components/UnitView.tsx`
- `src/components/StickerAnnotationLayer.tsx`
- `src-tauri/src/lib.rs`
- `src-tauri/src/screenshot.rs`
- `src-tauri/src/long_capture.rs`

## 3. Top-level repository map

```text
Hook/
├── src/                  Frontend app, UI, state, services, hooks
├── src-tauri/            Rust/Tauri backend, native capture, bridge logic
├── scripts/              Local build, packaging, UIAccess helper scripts
├── __tests__/            Frontend-side contract tests
├── .github/workflows/    CI build and tag-release workflows
├── docs/                 Current policy docs + archived plans/specs
├── PROJECT_OVERVIEW.md   Repo-level summary
├── TECHNICAL_ARCHITECTURE.md
└── UIACCESS_DISTRIBUTION.md
```

## 4. Frontend module map (`src/`)

The frontend is a SolidJS application rendered inside Tauri/WebView2.

### 4.1 Entry points

- **`src/main.tsx`**
  - frontend bootstrap
  - mounts the application

- **`src/app.tsx`**
  - highest-value frontend integration file
  - wires desktop events, capture mode transitions, session restore, shortcut
    handling, overlay events, long capture UI state, and top-level unit/sticker
    interactions
  - if a bug spans multiple frontend subsystems, this file is often part of the
    path

### 4.2 State stores

- **`src/store/graphStore.ts`**
  - source of truth for graph-like workspace data
  - units, links, groups, recycle bin, reference library, persistence-facing
    mutations

- **`src/store/uiStore.ts`**
  - UI-only and interaction-only state
  - selection, tool settings, editing mode, active sticker state, capture mode,
    long capture runtime state, menus/panels visibility, and many imperative UI
    actions

Practical rule:

- if data should serialize into the session/workspace, look in `graphStore`
- if data is transient interaction state, look in `uiStore`

### 4.3 Hooks

- **`src/hooks/useSelection.ts`**
  - screenshot selection flow
  - region capture flow
  - auto long-capture frontend session orchestration
  - one of the most important capture-side frontend files

- **`src/hooks/useShortcuts.ts`**
  - frontend shortcut behavior
  - desktop vs browser-preview interaction differences

- **`src/hooks/useClipboard.ts`**
  - copy/paste logic for stickers and related artifacts

- **`src/hooks/useDraggable.ts`**
  - drag behavior for units/stickers

- **`src/hooks/useFileDrop.ts`**
  - drag/drop file intake

- **`src/hooks/useLinking.ts`**
  - node link interaction logic

- **`src/hooks/useNodeParameters.ts`**
  - parameter editing helpers for graph nodes

- **`src/hooks/useUnitActions.ts`**
  - higher-level unit action behavior and convenience wrappers

### 4.4 UI component clusters

#### Canvas / graph shell

- **`CanvasUnits.tsx`**
  - renders units on the workspace

- **`CanvasLinks.tsx`**
  - renders links between units

- **`CanvasSelection.tsx`**
  - visual screenshot selection rectangle and long-capture HUD bits

#### Unit / sticker rendering

- **`UnitView.tsx`**
  - critical file
  - renders individual units/stickers
  - handles drag, selection, native drag-export integration, and some desktop
    interaction boundaries

- **`UnitPorts.tsx`**
  - graph input/output port visuals

- **`UnitActionsMenu.tsx`**
  - Shift+1-like action menu surface

- **`UnitAddNodeMenu.tsx`**
  - add-node menu

- **`UnitParamsPanel.tsx`**
  - parameter panel shell

#### Sticker editing shell

- **`StickerAnnotationLayer.tsx`**
  - critical file
  - editing surface for annotations, brush/shape/text/select behavior, pointer
    handling, color-pick flow, and annotation selection logic

- **`StickerTopStrip.tsx`**
  - editing toolbar shell above the sticker

- **`StickerTopStripPropertyBar.tsx`**
  - tool property editing UI
  - this is where many "editable inputs/dropdowns do not work" regressions tend
    to surface

- **`stickerAnnotationModel.ts`**
  - frontend annotation model helpers

- **`stickerToolbarModel.ts`**
  - toolbar-related view-model logic

#### Context / history / organization panels

- **`StickerContextMenuLayer.tsx`**
  - routes context-menu state to the rendered layer

- **`StickerContextMenuPanel.tsx`**
  - context-menu UI

- **`HistoryPanel.tsx`**
  - screenshot history and related recovery interactions

- **`StickerSnapshotListPanel.tsx`**
  - snapshot list / library-like panel

- **`StickerGroupBar.tsx`**
  - sticker grouping UI

- **`StickerEffectOverlay.tsx`**
  - effect layer visuals

#### Utilities / visual support

- **`ColorPicker.tsx`**
  - color picker and screen-pick related UI

- **`ShaderPreview.tsx` / `ShaderRenderer.ts`**
  - shader preview path and rendering helpers

### 4.5 Frontend service layer

The `src/services/` folder is large but not random. It breaks down into a few
clear clusters.

#### A. Desktop boundary / runtime bridge

- **`api.ts`**
  - most important service boundary
  - typed frontend-to-Tauri command layer
  - browser-preview fallback behavior
  - if you need to know "what Rust commands exist from the frontend view", start
    here

- **`bootProfile.ts`**
  - startup mode and initial runtime profile parsing

- **`client.ts`**
  - local ArtLoom-style websocket bridge behavior

- **`protocol.ts`**
  - request/response protocol helpers

- **`workflowPayload.ts`**
  - workflow payload shaping

- **`syncService.ts`**
  - synchronization between frontend state and backend/runtime expectations

#### B. Capture / selection

- **`captureState.ts`**
  - capture mode types
  - selection/long-capture state helpers
  - overlap-analysis and scheduling config helpers

- **`graphImageResolution.ts`**
  - image sizing/resolution helpers for workspace usage

#### C. Sticker domain cluster

All `sticker*.ts` files belong to the sticker editing domain. They are split on
purpose to keep editing logic from collapsing into a single giant file.

Key files:

- **`stickerEditing.ts`**
  - editing domain types and higher-level behavior

- **`stickerGeometry.ts`**
  - geometry helpers

- **`stickerEditTransforms.ts`**
  - transform behavior (move/resize/rotate/scale-related helpers)

- **`stickerEditPropagation.ts`**
  - editing state propagation logic

- **`stickerAnnotationMutations.ts`**
  - low-level annotation mutation helpers

- **`stickerEffects.ts`**
  - sticker visual effects state/helpers

- **`stickerRasterize.ts` / `stickerRasterizeActions.ts`**
  - rasterization and actions around turning edit state into baked bitmap state

- **`stickerExport.ts`**
  - export-oriented helpers

- **`stickerHistory.ts`**
  - sticker edit snapshot/history capture

- **`stickerSnapshot.ts`**
  - frozen snapshot extraction/recovery helpers

- **`stickerLibraryModel.ts`**
  - recycle bin / reference list oriented modeling helpers

- **`stickerContextMenuController.ts`**
  - context menu behavior

- **`stickerDoubleClick.ts`**
  - double-click behavior such as compact/expand-like transitions

- **`stickerTopStripLayout.ts`**
  - top strip positioning/layout helpers

- **`stickerCanvas.ts`**
  - sticker/canvas interaction helpers

- **`stickerBitmapLayers.ts`**
  - bitmap layer helpers

- **`stickerBeautify.ts`**
  - visual cleanup/beautification helpers

#### D. Art / node / graph support

- **`artNodeFactory.ts`**
  - graph node creation helpers

- **`artPorts.ts`**
  - node port definitions/helpers

- **`artParamGrouping.ts`**
  - parameter grouping layout logic

- **`artLoomStartup.ts`**
  - startup logic for ArtLoom-related integration paths

- **`nodeExecutionConfig.ts`**
  - node execution/runtime config shaping

- **`uiRegistry.ts`**
  - UI registration / mapping helpers

#### E. General support / infra

- **`logger.ts`**
  - frontend logging helpers

- **`errorDiagnostics.ts`**
  - global error capture for frontend crash diagnostics

- **`fontCatalog.ts`**
  - font list handling

- **`toolSettings.ts`**
  - tool settings helpers

- **`historyModel.ts`**
  - history model shaping

- **`imageSource.ts`**
  - image source normalization

- **`liveEraseQueue.ts`**
  - queue helper for erase-related live editing paths

- **`syncedImagePayload.ts`**
  - image payload sync helpers

## 5. Backend module map (`src-tauri/`)

The backend is the native half of Hook. It owns screenshoting, overlay window
control, input hooks, native drag, session persistence, and capability bridges.

### 5.1 Core entry files

- **`src-tauri/src/main.rs`**
  - process entry
  - CLI/smoke helper entry cases

- **`src-tauri/src/lib.rs`**
  - highest-value backend integration file
  - registers Tauri commands
  - configures WebView2 runtime flags
  - manages overlay runtime state
  - installs global shortcut / mouse hook / keyboard hook threads
  - coordinates capture mode entry, long capture sessions, native drag flow,
    tray behavior, and capability surfaces

If a bug crosses desktop runtime boundaries, `lib.rs` is usually involved.

### 5.2 Native capture pipeline

- **`capture.rs`**
  - command surface for standard region capture

- **`screenshot.rs`**
  - most important low-level screenshot backend
  - Windows Graphics Capture / Direct3D fast path
  - GDI fallback path
  - video-safe capture behavior and resource-management tuning

- **`capture_coords.rs`**
  - coordinate normalization between logical/physical/global spaces

- **`long_capture.rs`**
  - long screenshot analysis and stitching helpers
  - overlap detection, pair analysis, frame merge logic

### 5.3 Runtime / desktop management

- **`single_instance.rs`**
  - single-instance enforcement

- **`mouse_monitor.rs`**
  - overlay hit-testing / mouse-related desktop coordination helpers

- **`process_utils.rs`**
  - process spawning / helper process utilities

### 5.4 Capability / workflow bridge modules

- **`mock_artloom.rs`**
  - local workflow-style backend surface and action dispatch behavior

- **`loom_config.rs`**
  - Loom config helpers

- **`loom_connector.rs`**
  - Loom bridge

- **`talk_connector.rs`**
  - Talk bridge and voice capture trigger surface

- **`tea_client.rs`**
  - Tea ticket bridge

- CLI-backed package Arts are forwarded by `mock_artloom.rs` to Loom over AHRP; Hook has no Art-specific local command executor.

### 5.5 Voice subsystem (`src-tauri/src/voice/`)

- **`core.rs`**
  - shared voice core types / behavior

- **`audio.rs`**
  - audio capture and wav artifact generation

- **`session.rs`**
  - voice session lifecycle

- **`insert.rs`**
  - insertion / clipboard / text application helpers

- **`hotkey.rs`**
  - voice-related hotkey support

- **`client.rs`**
  - voice-side client boundary

- **`mod.rs`**
  - module glue

### 5.6 Local vendored/native crates

Under `src-tauri/crates/`:

- **`scap-direct3d/`**
  - local capture backend support crate used by screenshoting paths

- **`scap-targets/`**
  - display/target abstraction helpers for capture

- **`drag/`**
  - native drag support crate used for Windows drag-export behavior

## 6. Build, packaging, and release modules

### 6.1 Local scripts (`scripts/`)

- **`build-local-hook-exe.ps1`**
  - primary local exe build script

- **`build-static.cmd`**
  - frontend static build wrapper

- **`dev-tauri.cmd`**
  - desktop dev entry

- **`run-tauri.cmd`**
  - tauri command wrapper

- **`serve-static.cmd` / `serve-static.mjs`**
  - static preview helpers

- **`package-release-zip.ps1`**
  - minimal release zip packaging

- **`install-hook-uiaccess.ps1`**
  - installation helper for the UIAccess lane

- **`setup-hook-uiaccess-local-test.ps1`**
  - local UIAccess test preparation

- **`package-uiaccess-installer-zip.ps1`**
  - UIAccess installer package helper

- **`capture-homepage-assets.ps1`**
  - homepage screenshot/GIF asset generation support

### 6.2 CI workflows

- **`.github/workflows/build-hook-exe.yml`**
  - main CI build path for portable exe artifact generation

- **`.github/workflows/release-hook-tag.yml`**
  - tag-driven GitHub Release packaging and asset publishing

### 6.3 Tests

- **`__tests__/releasePackaging.contract.test.ts`**
  - frontend-side release packaging contract coverage

- **`src-tauri/tests/*.rs`**
  - Rust-side contracts and smoke-oriented tests for specific bridges/subsystems

## 7. Current module hotspots

These are the files most likely to matter during real debugging or future
feature work:

- `src/app.tsx`
- `src/store/uiStore.ts`
- `src/store/graphStore.ts`
- `src/hooks/useSelection.ts`
- `src/components/UnitView.tsx`
- `src/components/StickerAnnotationLayer.tsx`
- `src/components/StickerTopStrip.tsx`
- `src/components/StickerTopStripPropertyBar.tsx`
- `src/services/api.ts`
- `src/services/captureState.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/screenshot.rs`
- `src-tauri/src/long_capture.rs`

Practical rule:

- frontend integration hotspot -> `app.tsx`
- native runtime hotspot -> `lib.rs`
- screenshot/video/black-screen hotspot -> `screenshot.rs`
- long screenshot hotspot -> `useSelection.ts` + `long_capture.rs` + long-capture commands in `lib.rs`
- editing/tools/annotation hotspot -> `StickerAnnotationLayer.tsx` + `StickerTopStrip*.tsx`

## 8. Current-vs-archival doc rule

This repository has both current docs and archived docs.

Current docs worth trusting first:

- `README.md`
- `PROJECT_OVERVIEW.md`
- `TECHNICAL_ARCHITECTURE.md`
- `UIACCESS_DISTRIBUTION.md`
- `docs/README.md`
- this file

Mostly archival / historical:

- `docs/migration/`
- `docs/superpowers/plans/`
- `docs/superpowers/specs/`

Use archived docs for background and rationale, not as the first source of
truth when current code disagrees.

## 9. Suggested onboarding path for the next AI

If the next agent only has a few minutes, the most efficient path is:

1. Read `README.md`
2. Read `PROJECT_OVERVIEW.md`
3. Read `TECHNICAL_ARCHITECTURE.md`
4. Read this file
5. Inspect `src/app.tsx`
6. Inspect `src/services/api.ts`
7. Inspect `src/store/uiStore.ts` and `src/store/graphStore.ts`
8. Inspect `src-tauri/src/lib.rs`
9. Inspect `src-tauri/src/screenshot.rs`

That sequence usually gives enough context to start real debugging or feature
work without re-surveying the whole repository.
