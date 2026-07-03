# Hook Technical Architecture

## 1. Overview

Hook is a Windows-first desktop capture and sticker-editing application built on **Tauri v2**. It combines:

- an overlay-style screenshot experience,
- a canvas-style node/sticker workspace,
- local desktop integrations such as clipboard, global shortcuts, native dialogs, and local capability bridges.

The codebase is split between a SolidJS frontend under `src/` and a Rust/Tauri backend under `src-tauri/`.

## 2. Runtime Model

Hook runs as a single desktop application and can present the main window in three modes:

- **overlay**: transparent always-on-top surface for capture and pinning
- **canvas**: focused editing workspace
- **tray**: background-resident state with tray re-entry

Startup defaults are injected by the launcher (`start-hook.bat` -> `start-hook.vbs`) and interpreted again in Rust via the boot-profile helpers in `src-tauri/src/lib.rs`.

## 3. Frontend Architecture (`src/`)

### 3.1 Main composition

- **`app.tsx`**: top-level controller for desktop event wiring, session restore, shortcut handling, capture-mode orchestration, and unit/sticker interactions
- **`store/graphStore.ts`**: graph data, units, links, groups, persistence-facing mutations
- **`store/uiStore.ts`**: UI-only state, sticker tool settings, selection, long-capture UI state, local persistence helpers

### 3.2 Service layer

- **`services/api.ts`**: typed boundary for all frontend-to-Tauri commands and browser-preview fallbacks
- **`services/syncService.ts`**: workflow/session synchronization and backend rect updates
- **`services/client.ts`**: ArtLoom-style handshake / dispatch / delivery bridge used by the desktop workflow path
- **`services/shaderCache.ts`**: shader prefetch and browser/desktop fallback handling
- **`services/sticker*.ts`**: focused sticker-editing domain logic, including geometry, export, rasterization, annotations, effects, history, and context-menu behavior

### 3.3 UI structure

Major UI is intentionally split into focused components rather than a single visual monolith:

- canvas/link rendering
- unit rendering and parameter panels
- sticker annotation layer
- top-strip property and tool controls
- context menus, history panels, group bars, and selection overlays

The current visual baseline is the Hook terminal-style yellow/green theme, not the older rounded lavender/glass variant.

## 4. Backend Architecture (`src-tauri/src/`)

### 4.1 Command surface

`src-tauri/src/lib.rs` is the Tauri entry surface. It:

- registers desktop commands,
- owns boot/runtime state,
- manages shortcut registration,
- coordinates capture-mode transitions,
- initializes tray, single-instance guard, and long-capture session state.

### 4.2 Key backend modules

- **`capture.rs` / `screenshot.rs`**: region capture and low-level screenshot handling
- **`long_capture.rs`**: long screenshot analysis, overlap detection, frame stitching
- **`mock_artloom.rs`**: workflow-oriented backend integration surface and ArtLoom-style command handling
- **`cli_engine.rs`**: CLI-oriented execution helper
- **`loom_connector.rs`**: local Loom capability invocation
- **`talk_connector.rs`**: local Talk voice capture invocation
- **`tea_client.rs`**: local Tea ticket creation bridge
- **`voice/`**: voice session, audio, insertion, hotkey, and provider logic
- **`single_instance.rs`**: mutex-based single-instance protection
- **`mouse_monitor.rs`**: overlay hit-testing / click-through coordination
- **`process_utils.rs`**: child-process handling helpers

### 4.3 Platform bias

The current implementation is Windows-focused. That bias is visible in:

- Win32 dialog placement
- shared-memory image reads
- global shortcut handling
- clipboard/file-list integration
- desktop capture stack

## 5. Data Boundaries

### 5.1 Core graph model

The core editable model is:

- **units**
- **links**
- **sticker groups**
- **recycle bin / reference library**

### 5.2 Persisted local state

Hook persists several categories of local state:

- session graph data
- history data
- sticker tool settings
- runtime logs
- clipboard cache files

Most user-writable data is stored under the local app-data area, with temporary clipboard artifacts allowed under app-local or temp cache paths declared in `tauri.conf.json`.

## 6. Build and Release Flow

### 6.1 Frontend build

Frontend output is produced by:

- `npm run build`
- `scripts/build-static.cmd`
- `scripts/clean-tauri-dist.mjs`

The final static frontend payload is emitted to:

- `.output/public`

### 6.2 Desktop build

The local desktop exe flow is:

1. `scripts/build-local-hook-exe.ps1`
2. `npm run tauri build -- --no-bundle`
3. copy `src-tauri/target/release/hook.exe`
4. write final artifact to `..\release\Hook\hook.exe`

This repository now targets the **minimal exe output only**.

## 7. Current Maintenance Notes

- Root docs (`README.md`, `PROJECT_OVERVIEW.md`, `TECHNICAL_ARCHITECTURE.md`) describe the current repo shape.
- `docs/superpowers/plans` and `docs/migration` are historical records, not the primary source for current operator workflow.
- The current architecture intentionally prefers smaller service files for sticker editing and local capability surfaces, while `app.tsx` and `src-tauri/src/lib.rs` still remain the heaviest integration points.
