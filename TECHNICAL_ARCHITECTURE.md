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

The tray currently exposes capture, live capture, long capture, open-image, and quit actions.
Live capture uses the native backend directly for every application, including
browsers. It binds window-local pixels, not webpage elements. The browser
extension shortcut relay, document provider, and import lifecycle were removed;
the generic Loom extension bridge remains independent of Live capture.
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
- `src/services/enhancementNoticeQueue.ts` owns notice identity and bounded FIFO
  transformations; `UnitVisualOverlays.tsx` renders each unit's notices in a
  right-aligned, dismissible stack so messages never leak across sticker/Art
  boundaries.

Persistent edits should pass through `graphStore.actions`. Transient high-rate
interaction state should not be written into the persisted graph on every input
sample.

### 3.3 Interaction hooks

- `useSelection.ts` — region/window/long/live-capture frontend lifecycle;
- `liveCaptureController.ts` and `liveCaptureStore.ts` — transient local live
  presentation, binary-frame polling, object-URL ownership, and view geometry;
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
- `screenshot/dwm_shared_surface.rs` — protected-window capture fallback. It
  checks `GetWindowDisplayAffinity`, resolves the undocumented
  `DwmGetDxSharedSurface` export dynamically so unsupported Windows builds fail
  closed, opens the returned D3D11 shared texture, copies it to a CPU-readable
  staging texture, validates dimensions/format/size, crops with display metrics
  and DWM extended-frame bounds, and returns RGB pixels. This path is bounded
  to a 512 MiB mapped surface and never falls back to a desktop crop when a
  protected window cannot provide a valid surface.
- `screenshot/protected_region.rs` — mixed region composition. It captures the
  desktop SDR background at the requested dimensions, then overlays the generic
  protected surface intersection at its physical offset. Windows above the
  protected target in `EnumWindows` z-order are converted to clipped occlusion
  rectangles, so their desktop pixels remain on top. A missing protected surface
  is an explicit error rather than a silent desktop-only result.
- `screenshot/wgc_session.rs` — shared D3D11 device, HWND-backed WGC capture,
  crop geometry, and bounded failure accounting;
- `screenshot/wgc_transient.rs` — short-lived SDR/HDR WGC sessions with bounded
  frame waits and unusable-frame rejection;
- `screenshot/wgc_persistent.rs` — opt-in thread-affine persistent WGC session,
  cached-frame validation, timeout fallback, and CPU crop ownership.
- `screenshot/live_capture.rs` — product live-session delivery owner, fresh-frame
  callback slot, JPEG presentation encoding, resize recovery, and source identity;
- `native/live_capture_types.rs` and `native/live_capture_commands.rs` — bounded
  session/frame ownership and Tauri lifecycle/raw-binary IPC commands;
- `native/live_source_window.rs`, `native/live_source_input.rs`, and
  `native/live_source_recovery.rs` — reversible source-window state, ordered
  same-user, no-upward-integrity window-message input, target identity checks, and a content-free
  atomic watchdog journal;
- `native/live_source_security.rs` checks the active desktop, session, owned token
  user SID, and UIPI direction. `services/liveCaptureFeedback.ts` exposes bounded,
  fixed-text Unit notices and code-only diagnostics when input is unavailable;
- `capture_coords.rs` — physical/global/logical coordinate normalization;
- `capture_windows.rs` — visible window enumeration, target filtering, and
  top-to-bottom z-order ranks used by protected-region composition;
- `long_capture.rs` — overlap analysis and incremental stitching.

Ordinary region capture can return a file-backed PNG plus metadata. HDR output
uses 16-bit BT.2020/PQ when appropriate; SDR output uses 8-bit sRGB. Long capture
remains SDR by design.

Single-device live capture is a separate session path rather than a loop added to
`capture_region`. Each session owns one delivery worker, one replaceable callback slot,
and at most three encoded frames. `read_live_capture_frame` returns raw IPC bytes;
the Solid controller owns and revokes short-lived object URLs. JPEG is only the
local WebView presentation transport and is not the `loom.live.v1` network media
codec. Capture/control state never enters `loom.surface.v1` as frame payloads.
The local maximum request is 60 FPS, reduced by `live_gpu/work_budget.rs` using
full-source pixel demand and total requested cadence. Unit demand updates every
250 ms; the shared source owner folds the minimum within its 100 ms control loop.
`screenshot/live_capture_producer.rs` attaches window Units through
`live_shared_source.rs` to one thread-affine owner in `live_shared_source_worker.rs`,
keyed by HWND/process/dimensions. The WGC pool has two buffers. Independent display
capture stays private. A new subscriber refreshes the pool for static initial
pixels, with old callbacks excluded by the source generation and subscriber lock.
Owned ROI copies happen before the source callback returns, without CPU readback.
`live_resources` owns process-wide source reservations before worker/pool creation,
cached OS CPU/RAM/DXGI sampling, upward allocation-growth estimates and hysteresis.
Source geometry is rechecked against its reservation before every pool rebuild.
The hard ceiling is 16; actual admission depends on estimated marginal cost and
runtime headroom. Pressure slows source cadence without deleting graph Units.
See `docs/LIVE_RESOURCE_ADMISSION.md` for telemetry and estimation boundaries.
A capacity-one callback notification wakes the worker;
there is no full-frame sleep after encoding. `live_frame_wic.rs` uses the built-in
Windows JPEG codec with scoped COM ownership, full dimensions, quality 0.82 and
4:4:4 chroma. A one-time diagnostic identifies software-codec fallback. Capture
timestamps precede CPU conversion; encode timestamps indicate completed encoding.
`liveCapturePresentation.ts` pre-decodes JPEGs before URL publication and keeps
one in-flight poll/read/decode chain, subtracting its cost from the frame interval.
Late decoded frames are revoked on stop, and slow consumers still skip old frames.
The automatic route B renderer in `src-tauri/src/live_gpu/` copies a bounded owned
BGRA8 texture before CPU conversion, then submits it on one compositor thread to
per-Unit DXGI swapchains. No WGC frame-pool texture crosses the callback lifetime.
`liveGpuPreview.ts` supplies physical DOM bounds and a renewable visibility lease;
Unit state and input ownership remain unchanged. `live_gpu/snapshot.rs` owns
bounded one-shot staging readback and PNG encoding on blocking workers;
`liveGpuSnapshot.ts` validates binary delivery and `liveCaptureUnit.ts` commits
explicit copy/save/drag snapshots with timestamp ordering and lifecycle guards.
`live_frame_handoff.rs` owns a latest GPU mailbox, a reusable spare and the arrival
clock. Callbacks never Map or encode; contended native submissions retain one
owned texture and transfer it later without overwriting a newer native frame.
Startup/fault/unsupported-layout fallback acquires one process-wide CPU permit
before staging/Map and holds it through JPEG. The permit imposes pixel/rate and
measured wall-time cooldown budgets. Hidden/offscreen consumers retain source
health at 1 FPS without JPEG production. `liveGpuPreviewScheduler.ts` supplies one
layout lease clock and a lazy shared geometry sample; CPU compatibility and GPU
fault modes continue publishing visibility demand.
Retained textures restore a static source even without another WGC update.
`liveCaptureHandoff.ts` coalesces transient PNG handoffs and waits for decode/paint
before normal native disable. Capture timestamps order handoffs and in-flight JPEGs;
PNG wins an equal-timestamp tie. These transitions do not commit streaming graph data.
Set `HOOK_LIVE_GPU_PREVIEW=0` to force compatibility. The Windows backend does not
use DWM thumbnails. See `docs/LIVE_GPU_PRESENTATION.md` for composition and acceptance boundaries.
When a live drag is fully contained by one enumerated program window, the frontend
stores the rectangle relative to that window. Rust converts it once to a physical
WGC surface crop; source movement does not alter that crop. The same local region
is translated through the window's current bounds for ordered input, so capture
and interaction remain aligned after the program moves. Session status keeps
logical WebView dimensions for its entire lifetime; physical WGC dimensions live
only in frame descriptors and never resize the local view implicitly.

Logical hide is capability-scoped to a live HWND session. The source remains a
near-transparent, non-activating compositor window so WGC continues receiving
fresh frames; original placement, extended style, topmost state, and layered
attributes are restored exactly. Cached child input targets are accepted only
while their HWND remains in the selected source subtree and the target process
passes the same-session/equal-integrity preflight; this supports legitimate
cross-thread and helper-process controls without relaxing UIPI. If a deepest
child becomes invalid, input falls back to the nearest valid ancestor instead of
disabling the whole session. `SendMessageTimeoutW` provides bounded delivery.
This does not emulate hardware input, secure desktop, or native minimization.

Static rectangular region drags intentionally use the visible display composition
to preserve every window that overlaps the selection. Live drags are program-first:
a rectangle fully contained by one valid top-level window uses that HWND plus a
fixed window-local crop; a rectangle spanning windows or desktop remains a screen
region. Full-window double click and protected-window static composition keep their
existing paths.

The live protected-window probes are local-only ignored Rust tests. They accept
any visible protected HWND through `HOOK_PROTECTED_WINDOW_HWND`; production code
does not match a process name or title. A Telegram installation is only a useful
local fixture. For example:

```powershell
$handle = (Get-Process Telegram).MainWindowHandle
$env:HOOK_PROTECTED_WINDOW_HWND = ('{0:x}' -f $handle)
cargo test --manifest-path src-tauri/Cargo.toml `
  screenshot::dwm_shared_surface::tests::captures_live_protected_window_from_dwm_shared_surface `
  --lib -- --ignored --nocapture
```

GitHub's ordinary `cargo test` invocation never enables `--ignored`, so hosted
runners do not require Telegram. Geometry, z-order masking, and fractional-DPI
rounding remain covered by deterministic tests that run without external apps.

### 4.3 Desktop lifecycle and input

- `single_instance.rs` prevents two normal Hook instances from running;
- `mouse_monitor.rs` supports overlay hit testing and click-through decisions;
- `emergency_watchdog.rs` is an independent process that can terminate the main
  process after three Escape presses within 400 ms or `Ctrl+Alt+Shift+F12`, and restores cursor/input state;
- `app_settings.rs` and `file_naming.rs` own validated settings and atomic visible
  filename allocation.

The overlay input path uses a bounded native event queue. Replaceable move samples
may be coalesced, but button/key edges must remain ordered. During an active
sticker drag, the Windows overlay stream is authoritative; the parallel trusted
WebView stream is ignored to prevent two cursor clocks from alternating the DOM
transform.

### 4.4 Local capability bridges

- `loom_hook.rs` maps the local Art/workflow surface;
- `loom_config.rs` and `loom_connector.rs` discover and invoke Loom capabilities;
- `talk_connector.rs` invokes the local Talk voice capability;
- `tea_client.rs` submits tickets to the local Tea service and redacts sensitive
  error content;
- `voice/` contains audio capture, session, provider, hotkey, clipboard insertion,
  and client logic.

Package Arts are forwarded to Loom through `loom.hook.v1`. Hook does not maintain
per-Art command executors in the frontend or Rust host.

Loom OCR blocks may carry additive `rawText` correction evidence,
`lineGeometry`, and CTC-timestep-aligned `characterSpans`/`wordSpans`. Hook
accepts only the named geometry sources, bounds list sizes and coordinates,
requires span text to match the displayed non-translated row, and retains valid
span extents as recognition evidence without replacing the detector row used for
whole-line typography. CTC timesteps are not pixel-level glyph segmentation, so
using their union as the presentation box can invent gaps or shrink a row.
Estimated baselines are accepted only at a safe angle and only when the rotated
text remains inside the screenshot frame. Missing, mismatched, or malformed
geometry follows the axis-aligned line box path, preserving mixed-version
Hook/Loom operation.

## 5. Capture and window targeting

Static capture starts from `Ctrl+1` or the tray; live capture starts from `Ctrl+2`
or its dedicated tray entry. The native target enumerator excludes
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

The public bundle identity and canonical automatic data root are
`com.yamiyu.hook`. Tests and isolated launches can override the data root with
`HOOK_APPDATA_DIR`; the runtime does not scan or migrate obsolete identities.

Phase 71 enforces the same canonical-only rule across the active Art boundary:
current schemas, package layouts, and app-data identities are accepted;
obsolete aliases and migration paths are not production inputs.

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
8. Do not add compatibility aliases or persisted-data/package-layout migration
   paths to the production Art boundary.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the change workflow and
[`docs/README.md`](docs/README.md) for the maintained documentation index.
