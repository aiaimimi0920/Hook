# Hook Technical Architecture

This document describes the current implementation. Historical plans and
migration notes are intentionally not part of the active documentation set; Git
history and the `文本优化前版本` tag preserve them when historical investigation
is necessary.

## 1. Product and runtime model

Hook is a Windows-first Tauri 2 desktop application with a SolidJS/WebView2
frontend and a Rust native backend. The same main window is used in three
operational modes:

- **overlay** — transparent desktop surface used for capture and pinned stickers;
- **canvas** — focused editing and workflow workspace;
- **tray** — the main window is hidden while the process remains resident.

Startup configuration flows through:

```text
start-hook.bat
  -> launch-config.cmd
  -> start-hook.vbs
  -> Rust boot-profile parsing
```

The tray currently exposes capture, long capture, open-image, and quit actions.
The app-settings command and dialog remain implemented, but their tray entry is
temporarily hidden.

## 2. Repository layout

```text
Hook/
├── src/                        SolidJS frontend
│   ├── app.tsx                 desktop event and application orchestration
│   ├── components/             canvas, sticker, annotation, and panel UI
│   ├── hooks/                  reusable interaction controllers
│   ├── services/               domain logic and desktop boundaries
│   ├── store/                  persistent graph and transient UI state
│   └── types/                  shared frontend models
├── src-tauri/
│   ├── src/                    Rust/Tauri runtime and native integrations
│   ├── crates/                 locally maintained capture/drag dependencies
│   └── tauri.conf.json
├── scripts/                    build, packaging, smoke, and release helpers
├── __tests__/                  frontend unit/runtime/contract/performance tests
├── .github/workflows/          CI, release, performance, and signing workflows
└── docs/                       current feature, HDR, release, and policy docs
```

## 3. Frontend architecture

### 3.1 Integration entry

`src/app.tsx` owns cross-subsystem orchestration rather than domain algorithms.
Its responsibilities include:

- registering Tauri event listeners;
- restoring the persisted session;
- entering and leaving capture modes;
- routing native overlay mouse events;
- coordinating global shortcut results;
- connecting canvas, sticker, history, settings, Loom, Talk, and Tea surfaces.

New pure domain logic should not be added directly to `app.tsx` when it can live
in a focused service or hook.

### 3.2 State ownership

- `src/store/graphStore.ts` owns persistent workspace data: units, links, groups,
  recycle bin, reference library, parameters, and persistence-facing mutations.
- `src/store/uiStore.ts` owns transient interaction state: selection, active edit
  target, panels, tool modes, capture UI, drag previews, and temporary notices.

Persistent edits should pass through `graphStore.actions`. Transient high-rate
interaction state should not be written into the persisted graph on every input
sample.

### 3.3 Interaction hooks

- `useSelection.ts` — region/window/long-capture frontend lifecycle;
- `useDraggable.ts` — sticker/unit drag sessions, compositor transforms, snapping,
  link previews, GPU warming, and final position commits;
- `useClipboard.ts` — internal units, system images, file payloads, and cascading
  paste behavior;
- `useShortcuts.ts` — context-sensitive frontend shortcut dispatch;
- `useUnitActions.ts` — minify/restore and higher-level unit actions;
- `useFileDrop.ts`, `useLinking.ts`, `useNodeParameters.ts` — focused intake,
  graph-link, and parameter behavior.

### 3.4 Rendering components

- `CanvasUnits.tsx`, `CanvasLinks.tsx`, `CanvasSelection.tsx` render the workspace;
- `UnitView.tsx` renders each sticker or Art node and owns its DOM interaction
  boundary;
- `StickerAnnotationLayer.tsx` owns editable annotation rendering and geometry-
  aware hit testing;
- `StickerTopStrip.tsx` and `StickerTopStripPropertyBar.tsx` own sticker editing
  tools and properties;
- `UnitParamsPanel.tsx` and `components/params/` render Art parameters;
- `ShaderPreview.tsx` and `ShaderRenderer.ts` provide the GPU shader preview path;
- context menu, history, group, snapshot, settings, and color-picker components
  remain separate UI surfaces.

### 3.5 Domain services

The service directory is intentionally split by responsibility:

- **desktop boundary** — `api.ts`, `bootProfile.ts`, `client.ts`, `protocol.ts`;
- **session/workflow** — `syncService.ts`, `sessionStickerMapping.ts`,
  `sessionStickerPayload.ts`, `workflowInstantiation.ts`, `workflowPayload.ts`;
- **Art** — `artCapabilities.ts`, `artCapabilityNormalization.ts`,
  `artCandidateCache.ts`, `artDelivery*.ts`, `artNodeFactory.ts`, `artPorts.ts`;
- **sticker editing** — `stickerEditing.ts`, `stickerGeometry.ts`,
  `stickerAnnotationMutations.ts`, `stickerEditTransforms.ts`,
  `stickerEditPropagation.ts`, `stickerEffects.ts`, `stickerHistory.ts`,
  `stickerSnapshot.ts`, `stickerRasterize*.ts`, and `stickerExport.ts`;
- **performance/lifetime** — `shaderCache.ts`, `stickerGpuWarmPool.ts`,
  `syncImageCache.ts`, `imageSearchCandidateCache.ts`,
  `imageSearchPrefetchGeneration.ts`, `dragFollowerRegistry.ts`,
  `dragTargetIndex.ts`, and `liveEraseQueue.ts`;
- **general support** — `fileNaming.ts`, `appSettings.ts`, `historyModel.ts`,
  `imageSource.ts`, `fontCatalog.ts`, `logger.ts`, and `errorDiagnostics.ts`.

Two image-resolution paths intentionally coexist. Canvas display resolution and
capability-aware workflow resolution have different ordering and fallback rules;
they must not be unified as a cosmetic refactor without behavior tests.

## 4. Native backend architecture

### 4.1 Entry and command surface

- `src-tauri/src/main.rs` handles process-only CLI modes such as `--version`,
  `--self-check`, smoke helpers, and the emergency watchdog child process.
- `src-tauri/src/lib.rs` registers Tauri commands, initializes the runtime,
  installs global input handling, owns overlay/tray transitions, and connects the
  frontend to native services.

`lib.rs` is the main native integration point. New self-contained algorithms
should prefer a dedicated module, but input-hook and window-lifecycle changes
must be made conservatively because event ordering is load-bearing.

### 4.2 Capture modules

- `capture.rs` — region capture command surface and response metadata;
- `screenshot.rs` — Windows Graphics Capture, HDR/scRGB conversion, SDR/GDI
  fallback, and display selection;
- `capture_coords.rs` — physical/global/logical coordinate normalization;
- `capture_windows.rs` — visible window enumeration and target filtering;
- `long_capture.rs` — overlap analysis and incremental stitching.

Ordinary region capture can return a file-backed PNG plus metadata. HDR output
uses 16-bit BT.2020/PQ when appropriate; SDR output uses 8-bit sRGB. Long capture
remains SDR by design.

### 4.3 Desktop lifecycle and input

- `single_instance.rs` prevents two normal Hook instances from running;
- `mouse_monitor.rs` supports overlay hit testing and click-through decisions;
- `emergency_watchdog.rs` is an independent process that can terminate the main
  process on Double Escape or `Ctrl+Alt+Shift+F12` and restores cursor/input state;
- `app_settings.rs` and `file_naming.rs` own validated settings and atomic visible
  filename allocation.

The overlay input path uses a bounded native event queue. Replaceable move samples
may be coalesced, but button/key edges must remain ordered. During an active
sticker drag, the Windows overlay stream is authoritative; the parallel trusted
WebView stream is ignored to prevent two cursor clocks from alternating the DOM
transform.

### 4.4 Local capability bridges

- `mock_artloom.rs` maps the local Art/workflow surface;
- `loom_config.rs` and `loom_connector.rs` discover and invoke Loom capabilities;
- `talk_connector.rs` invokes the local Talk voice capability;
- `tea_client.rs` submits tickets to the local Tea service and redacts sensitive
  error content;
- `voice/` contains audio capture, session, provider, hotkey, clipboard insertion,
  and client logic.

CLI-backed package Arts are forwarded to Loom through AHRP. Hook does not maintain
per-Art command executors in the frontend or Rust host.

## 5. Capture and window targeting

Capture starts from `Ctrl+1` or the tray. The native target enumerator excludes
desktop/taskbar/hidden/tool windows and returns visible client/window bounds. The
frontend may highlight a hovered target; final capture revalidates the selected
window instead of trusting an old hover rectangle.

Coordinate conversion always distinguishes:

- virtual-desktop physical coordinates;
- monitor-local logical coordinates;
- WebView client coordinates;
- display scale factor and negative monitor origins.

Do not mix these spaces implicitly. High-DPI and secondary-monitor behavior must
be covered whenever capture or overlay input coordinates change.

## 6. Sticker rendering and performance

### 6.1 Whole-sticker drag

At drag start, Hook collects registered follower elements and prepares their GPU
transform layer. During ordinary dragging:

- the freshest native pointer sample writes `translate3d` directly;
- RAF updates snapping, link previews, metrics, and committed positions;
- the persisted graph position is written once at release;
- blur, visibility loss, pointer cancel, restart, and watchdog paths clear the
  transient transform and GPU-warm state.

### 6.2 Minified stickers

Window geometry and `minified` metadata are published in one graph-store write.
When a current baked composite exists, the minified view displays one bitmap.
The live image and annotation nodes remain mounted but `display:none`, so restore
does not reconstruct a large SVG tree. Cache writes are reactive, token-checked,
and invalidated when a unit/workspace is removed or replaced.

### 6.3 Annotation interaction

Freehand, line, arrow, rotated shape, mosaic, and blur annotations use geometry-
aware hit tests after a bounds prefilter. Moving an annotation uses an imperative
SVG transform preview and commits the actual annotation coordinates/history once
on release.

## 7. Persistence and files

Hook persists:

- session units, links, groups, recycle bin, and reference library;
- screenshot/color history;
- sticker tool settings;
- global application settings;
- content-addressed session image assets;
- runtime logs and bounded clipboard/cache artifacts.

User-visible filenames are rendered from the shared file-naming model and are
sanitized for Windows while preserving normal Unicode. Collision allocation is
atomic (`name.png`, `name_2.png`, ...). Internal content-addressed assets, capture
transport files, logs, and caches do not use the visible naming templates.

The public bundle identity is `com.yamiyu.hook`. If its data directory is empty,
the runtime checks legacy data roots for `io.github.aiaimimi0920.hook` and
`com.vmjcv.hook` so an identifier migration does not discard local state.

## 8. Build, test, and release

### 8.1 Frontend output

`npm run build` calls `scripts/build-static.cmd` and produces `.output/public`.
`scripts/clean-tauri-dist.mjs` removes stale frontend files before Tauri consumes
the directory.

### 8.2 Portable executable

`scripts/build-local-hook-exe.ps1` performs version validation, runs
`tauri build --no-bundle`, and copies `src-tauri/target/release/hook.exe` to the
requested output directory. `scripts/package-release-zip.ps1` creates the public
portable archive with license and third-party notice files.

### 8.3 CI lanes

- `build-hook-exe.yml` — main/manual verification and portable artifact build;
- `runtime-performance.yml` — runtime/performance-oriented gate;
- `release-hook-tag.yml` — `Vx.x.x` provenance validation, portable zip release,
  and unsigned UIAccess signing-candidate metadata;
- `signpath-signing.yml` — manual reviewed signing flow for the future installer
  phase.

The current user-facing release package is portable. The repository retains the
installer/UIAccess path, but it must fail closed until SignPath and the protected
approval environment are provisioned.

## 9. Maintenance invariants

1. Treat current code, configuration, scripts, workflows, and tests as the source
   of truth; update docs in the same change when behavior changes.
2. Preserve native input edge ordering. Do not trade reliable Down/Up/Escape
   delivery for move-event throughput.
3. Keep persistent graph data separate from transient UI/drag/edit previews.
4. Avoid per-move graph writes, full document queries, synchronous full-frame GPU
   readbacks, and unbounded caches/queues.
5. Session loading is tolerant: unknown fields may be reported, but readable
   sessions should not be rejected solely for schema drift.
6. Never publish an unsigned UIAccess candidate as a signed installer.
7. Keep project and bundled-source licenses in every release archive.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the change workflow and
[`docs/README.md`](docs/README.md) for the maintained documentation index.
