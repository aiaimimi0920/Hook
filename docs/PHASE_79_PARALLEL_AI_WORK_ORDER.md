# Phase 79 Hook parallel AI work order

Date: 2026-08-23

Status: **H0, H1-A through H1-F, H2-A/B and H2-C1/C2 complete; remaining H2-C component families are in progress**

## 1. Assignment

You own the Hook half of the Phase 79 large-file modularization and hardening program.

Work only in the following placeholder roots (resolve them from the active checkout before running commands):

- source repository: `<hook-repo-root>`
- final release root: `<hook-release-root>` (the Hook directory under the shared Neuro release root)

Another AI is working in the independent Loom repository at the same time. Do not edit Loom source,
Loom documentation, `release\Loom`, the parent Neuro repository, or any sibling project. Do not add a
source-time dependency on Loom's checkout. Hook and Loom remain independent Git repositories.

This work order is operational guidance, not proof that the implementation is correct. When this document,
an older plan and the current code disagree, use this precedence:

1. current Hook implementation and runtime behavior;
2. current tests, schemas, manifests and CI/release scripts;
3. the repository-owned effective-line report;
4. this work order;
5. historical documentation.

Do not implement a finding merely because a document claims it exists. Locate the real boundary, reproduce or
characterize the behavior, and verify the proposed change against actual callers and tests.

### 1.1 Accepted objective for this round

This plan implements the user's effective-line policy literally:

- the design center is approximately 150 effective lines per focused module;
- up to 500 effective lines is acceptable when one cohesive owner genuinely needs it;
- 501-700 effective lines requires a current, machine-readable cohesion justification;
- every file above 700 effective lines must be split;
- every file above 1500 effective lines is an urgent hard-cap violation and must keep being split until every
  resulting handwritten file is at most 700 effective lines.

The work has two reviewable stages for each ownership boundary:

1. **behavior-preserving structural extraction** with the same proof before and after;
2. **post-split hardening** of each resulting file for security, vulnerabilities, resource and memory lifetime,
   performance, responsiveness and missing failure-path tests.

Do not mix speculative hardening into the initial move. The structural result must be green before intentional
behavior changes begin. Meaningful module and invariant comments are required, but comments are not metric
padding. Loom is read-only integration context for this round because another AI owns Loom concurrently.

## 2. Repository state that must be preserved

Hook is an independent Git repository:

- Git root: `<hook-repo-root>`
- branch: `main`
- HEAD: `6fca3eae224a6856c829900beb94917826392d07`
- tag at HEAD: `发布前的v2`
- branch relation at handoff creation: `main...origin/main [ahead 1]`
- product version at handoff creation: `0.1.7`

The worktree is intentionally dirty because Phase 79-A tooling has already been added locally. These are
inherited changes, not disposable generated work:

Tracked modifications:

- `.github/workflows/build-hook-exe.yml`
- `.github/workflows/release-hook-tag.yml`
- `__tests__/integration/HookBuildWorkflowCiContract.test.ts`
- `__tests__/integration/HookReleaseWorkflowContract.test.ts`
- `package.json`

Untracked Phase 79-A source/configuration:

- `scripts/effective-code-lines-baseline.json`
- `scripts/effective-code-lines-exceptions.json`
- `scripts/effective-code-lines-lexer.mjs`
- `scripts/effective-code-lines-policy.json`
- `scripts/effective-code-lines.mjs`
- `scripts/tests/effective-code-lines.test.mjs`

This work-order document is also an intentional new file:

- `docs/PHASE_79_PARALLEL_AI_WORK_ORDER.md`

Rules:

- Never reset, revert, overwrite or delete these inherited changes.
- Do not use `git reset --hard`, destructive checkout, clean, or bulk generated-directory deletion.
- Before every batch, capture a scoped `git status` and distinguish inherited files from your batch.
- If an inherited file changes unexpectedly while you work, stop and inspect rather than reverting it.
- Do not commit, tag, push, publish a GitHub release, or request signing unless the user explicitly asks.
- Do not commit `artifacts`, `target*`, `.output`, `dist`, `node_modules`, runtime state or release payloads.

Suggested first commands:

```powershell
Set-Location <hook-repo-root>
rtk git status --short --branch
rtk git rev-parse HEAD
rtk git tag --points-at HEAD
rtk npm run test:effective-lines
rtk npm run check:effective-lines
```

## 3. Effective-line policy

The repository-owned checker is authoritative:

- policy: `scripts/effective-code-lines-policy.json`
- baseline: `scripts/effective-code-lines-baseline.json`
- exception registry: `scripts/effective-code-lines-exceptions.json`
- generated report: `artifacts/effective-code-lines.json`
- baseline commit: `6fca3eae224a6856c829900beb94917826392d07`
- baseline tree: `e11235e2b9a7341c2d536f1f04dbeda9560b782b`

Line policy:

| Effective lines | Meaning | Required action |
| ---: | --- | --- |
| approximately 100-250, centered on 150 | preferred module size | Aim near 150 when it matches a natural ownership boundary. |
| 251-500 | acceptable | Keep only when the file has one clear responsibility. |
| 501-700 | soft-limit decision | Split, or record a current reviewed cohesion exception with exact evidence. |
| 701-1500 | mandatory split | No final exception. |
| above 1500 | hard-cap violation | No waiver; continue until every result is at most 700. |

Additional rules:

- Blank lines and comment-only lines do not count, but comments must not be used as metric padding.
- Handwritten production code, tests, PowerShell/CMD scripts, styles and locally maintained Rust forks count.
- Generated and immutable inputs are excluded only by the checked policy.
- Do not create arbitrary `part1`, `part2`, `helpers2` or equal-line-range files.
- A selected baseline file may not be declared complete while it or any result remains above 700.
- No newly created file may exceed 700.
- Prefer all new files at or below 500; explain every deliberate 501-700 result.
- The 150-line target is a design center, not an equal-size quota. Do not split a cohesive 220-line owner or create
  80-line forwarding fragments merely to make files numerically uniform.
- Preserve a facade or coordinator when callers depend on the old import/module path.

Fresh handoff evidence:

```text
Effective lines: 493 files; >1500=7, 701-1500=15, 501-700=20
ratchet violations: 0
501-700 exceptions: 0
```

The ratchet is green only because untouched oversized baseline files remain warnings. It does not mean the
queue is complete. Final closure requires strict mode, no file above 700, and a justified record for every
remaining 501-700 file.

## 4. Current complete queue

The numbers below come from the repository checker, not `wc`, IDE totals or a historical estimate.

### 4.1 Hard cap: above 1500 effective lines

| Effective | Physical | File | Primary responsibility |
| ---: | ---: | --- | --- |
| 11,882 | 13,089 | `src-tauri/src/lib.rs` | Native bootstrap, state, Tauri commands, input, overlay/window/tray, capture, persistence and integrations. |
| 5,611 | 6,143 | `src-tauri/src/long_capture.rs` | Target selection, scroll capture, overlap analysis, stitching, session state and output. |
| 3,442 | 3,672 | `src-tauri/src/loom_hook.rs` | Loom/Hook protocol, handshake, transport, state, actions and resources. |
| 2,538 | 2,732 | `src/components/StickerAnnotationLayer.tsx` | Annotation tools, editing state, hit testing, SVG rendering and pointer interaction. |
| 2,121 | 2,398 | `src/app.tsx` | Application, listener, session, capture, canvas, Loom/Talk/Tea orchestration. |
| 2,044 | 2,336 | `src-tauri/src/screenshot.rs` | Capture backend, display targeting, HDR/scRGB, conversion and fallback. |
| 1,518 | 1,671 | `src/components/UnitView.tsx` | Unit rendering, Art/sticker state, menus, ports and DOM interaction. |

### 4.2 Mandatory: 701-1500 effective lines

| Effective | Physical | File |
| ---: | ---: | --- |
| 1,191 | 1,326 | `src/services/api.ts` |
| 1,134 | 1,345 | `__tests__/unit/ShaderPreviewRuntime.test.tsx` |
| 1,128 | 1,256 | `src/services/stickerGeometry.ts` |
| 1,106 | 1,341 | `src-tauri/crates/scap-targets/src/platform/win.rs` |
| 1,065 | 1,187 | `src/hooks/useSelection.ts` |
| 1,046 | 1,181 | `scripts/smoke-hook-tea-tauri-ui-real.ps1` |
| 1,014 | 1,138 | `src/components/UnitParamsPanel.tsx` |
| 1,011 | 1,073 | `src/components/StickerTopStrip.tsx` |
| 968 | 1,190 | `src/app.css` |
| 925 | 971 | `__tests__/unit/graphImageResolution.test.ts` |
| 917 | 987 | `scripts/Invoke-HookNativeCandidateAcceptance.ps1` |
| 853 | 920 | `src/components/StickerTopStripPropertyBar.tsx` |
| 838 | 902 | `src/components/JavaScriptSurface.tsx` |
| 786 | 885 | `scripts/smoke-hook-tea-ui-real.ps1` |
| 761 | 824 | `src-tauri/tests/loom_connector_contract.rs` |

### 4.3 Soft-limit decisions: 501-700 effective lines

Each file below must either finish at 500 or fewer, or receive a specific current exception containing its
responsibility, reason another split is harmful, owner/reviewer, effective-line count, source hash and review
date. The exception registry is currently empty.

| Effective | Physical | File |
| ---: | ---: | --- |
| 690 | 795 | `src/services/stickerExport.ts` |
| 666 | 692 | `public/javascript-surface-bootstrap.js` |
| 647 | 711 | `src-tauri/src/device_session.rs` |
| 625 | 700 | `src/services/stickerEditing.ts` |
| 612 | 673 | `src-tauri/src/voice/audio.rs` |
| 610 | 702 | `src-tauri/crates/scap-direct3d/src/lib.rs` |
| 589 | 629 | `__tests__/unit/stickerEditTransforms.test.ts` |
| 583 | 638 | `src-tauri/tests/talk_connector_contract.rs` |
| 578 | 696 | `scripts/capture-homepage-assets.ps1` |
| 578 | 603 | `scripts/run-javascript-surface-browser-smoke.mjs` |
| 577 | 677 | `__tests__/unit/overlaySyntheticEvents.test.ts` |
| 573 | 660 | `src/components/ColorPicker.tsx` |
| 571 | 629 | `src-tauri/src/loom_connector.rs` |
| 568 | 624 | `src/components/ShaderPreview.tsx` |
| 565 | 636 | `__tests__/integration/api.browser.test.ts` |
| 564 | 609 | `src-tauri/src/file_naming.rs` |
| 540 | 625 | `src-tauri/src/voice/insert.rs` |
| 540 | 632 | `src/services/overlaySyntheticEvents.ts` |
| 518 | 599 | `src/services/syncService.ts` |
| 510 | 606 | `src/services/graphImageResolution.ts` |

Regenerate this queue at the start and end of every batch. If the live report differs, use the live report and
record why it changed.

## 5. Required execution method for every batch

### 5.1 Characterize before editing

For the selected target, record:

- public exports, Rust visibility and import paths;
- Tauri command names and argument casing;
- event names, payload shapes and listener ownership;
- serde/JSON/protocol fields and versions;
- CLI flags, environment variables and persisted file shapes;
- Windows and non-Windows `cfg` branches;
- initialization/shutdown order and resource owners;
- focused unit, integration, source-contract and runtime tests;
- hot paths and existing performance gates.

Run the focused boundary before moving code. If no test protects an important behavior, add a characterization
test first. Do not call compilation alone a baseline.

Several Hook integration tests read source text from exact paths and search for symbols. Examples include the
Remote Surface/general settings contracts reading `src/app.tsx` and `src-tauri/src/loom_hook.rs`, and sticker
contracts reading `UnitView.tsx` and `StickerAnnotationLayer.tsx`. When symbols move, either retain a meaningful
coordinator/export in the old file or update the source contract atomically. Do not weaken assertions solely to
make extraction easier; prefer runtime assertions when runtime behavior is practical to exercise.

### 5.2 Design the module graph

Before writing files, give every proposed module:

- one sentence of responsibility;
- its state/resource owner;
- allowed dependencies;
- forbidden reverse dependencies;
- public or private surface;
- focused tests.

Shared helpers move only when at least two real owners need them. Prefer narrow visibility. Do not expose private
implementation merely to bypass Rust module visibility or TypeScript import cycles.

### 5.3 Pure structural split first

Make the ownership extraction without intentional behavior change, then run the same focused proof used before
the extraction. Keep the old import/module path as a thin facade where it is a real compatibility boundary.

Intermediate extraction steps should remain compilable and testable. However, once a baseline file has changed,
the ratchet will reject it until it reaches the threshold. For a very large target such as `src-tauri/src/lib.rs`,
continue the same batch through all planned ownership extractions; do not commit or report an incomplete
above-700 intermediate state as finished.

### 5.4 Add meaningful comments

Every new source module should begin with a concise purpose comment where the language permits it. Add comments
for invariants that are not obvious from names and types:

- coordinate-space and DPI assumptions;
- input ordering/coalescing and pointer ownership;
- lock/state/resource ownership and cleanup;
- protocol and Tauri compatibility promises;
- trust boundaries and validation order;
- queue/cache/image/output budgets;
- Windows FFI, COM, D3D and `cfg` constraints;
- non-obvious performance decisions.

Do not narrate obvious statements or add comments to lower the effective-line metric.

### 5.5 Harden only after the split is green

Review each resulting file independently for:

1. security and vulnerabilities;
2. resource and memory lifetime;
3. performance and responsiveness;
4. missing failure-path tests.

Every reported finding must end in one of:

- a verified fix plus regression test;
- an explicitly justified non-issue, with the actual trust/ownership boundary;
- a residual risk assigned to the correct owning module or protocol migration.

Keep structural extraction and intentional behavior changes reviewable as separate steps. Do not mix speculative
optimizations into the initial move.

For each resulting file, record a short audit matrix rather than one broad statement:

| Dimension | Required questions |
| --- | --- |
| Trust boundary | Which Tauri/IPC/network/path/protocol inputs enter here, and where are they validated? |
| Resource owner | Who tears down listeners, timers, RAF, sockets, MessagePorts, AbortControllers, threads, channels, locks, COM/D3D objects, files and child processes? |
| Memory budget | Are image/network buffers, queues, caches, histories and persisted payloads bounded before allocation or read? |
| Hot path | Can this code broaden reactive subscriptions, persist per input sample, block the UI/accept thread, perform full-frame readback or introduce an unbounded retry loop? |
| Failure proof | Which regression test exercises cancellation, partial setup, teardown, timeout, malformed input and restart? |

Confirmed defects may be fixed only in the post-split slice and must include a regression test. A suspected issue
that is not reproduced or proven remains an investigation result, not a security claim.

### 5.6 Run final gates and record evidence

For each batch, append a progress record to this document containing:

- target and before/after effective/physical lines;
- new module responsibilities and maximum resulting file size;
- preserved exports/commands/events/protocols;
- structural baseline command/results;
- hardening findings, fixes, non-issues and residual risks;
- final focused/dependent/ratchet/format/encoding results;
- explicit statement that no per-batch release was built.

Use fresh results. A previous AI's successful command is not evidence for your edited tree.

## 6. Recommended batch order and module boundaries

The order deliberately establishes stable leaf and transport boundaries before splitting event-order-sensitive
integration hubs.

### 6.1 Atomic sub-batches and stop conditions

- H0 is the required measurement and behavior baseline. No production source extraction starts before it is
  recorded.
- H1-H6 establish leaf modules and stable facades before the native crate root moves.
- H7 is one logical ownership migration but several compilable sub-batches; do not attempt an 11,882-line rewrite
  in one patch.
- H8 closes every remaining checker item, including tests, scripts, styles and locally maintained forks.
- A sub-batch is complete only when its selected baseline file and every new result are at most 700 effective
  lines, its focused proof is green, and its post-split audit has a recorded disposition.
- Keep intermediate states compilable and testable. If the ratchet necessarily remains red while one hard-cap
  facade is being drained, continue that same logical batch and do not report it complete.
- Re-run the live effective-line report after each sub-batch; newly exposed offenders join H8 automatically.

### H0 - Preserve and verify Phase 79-A tooling

- Re-read the inherited checker, lexer, policy, baseline and workflow changes.
- Run the 15 checker tests and ratchet.
- Run the two workflow contract tests that were modified by Phase 79-A.
- Confirm generated directories, alternate Cargo targets and `graphify-out` are excluded by tested policy.
- Do not regenerate the baseline from the dirty working tree; it is bound to the exact tagged commit/tree.

Exit: tooling tests and ratchet pass; inherited changes remain intact.

### H1 - Tauri API facade and pure frontend services

Execute H1 as separate ownership moves rather than one frontend-wide patch:

- **H1-A**: `api.ts` stable facade plus transport/error core;
- **H1-B**: boot/settings, capture, session/history and overlay/window clients;
- **H1-C**: Loom/Surface, Talk/voice, Tea and image/clipboard/resource clients;
- **H1-D**: sticker geometry and hit-test primitives;
- **H1-E**: editing/history propagation, export/raster, graph image resolution and synthetic overlay events;
- **H1-F**: split the corresponding oversized tests by behavior contract.

#### H1-A module graph recorded before extraction

| Module | Responsibility and owner | Allowed dependencies | Forbidden dependency | Surface and focused proof |
| --- | --- | --- | --- | --- |
| `api.ts` | Stable typed import path and composition facade; owns no transport resource. | Domain clients and private transport/browser modules. | Consumers must not be imported back into the facade. | Public `api`, types, runtime probe and browser listener export; API browser and source contracts. |
| `apiTypes.ts` | Shared structural DTOs used by the facade and callers; owns no runtime state. | Session, snapshot and archive value types only. | No runtime transport, facade, component or store import. | Type-only exports re-exported by `api.ts`; application/test typechecks and existing consumer imports. |
| `apiTransport.ts` | Tauri availability, one-time fallback diagnostics and raw invoke boundary; owns the warned-method set. | `@tauri-apps/api/core` only. | No facade, client, component or store import. | Private functions re-used by the facade/browser adapters; typecheck and API browser contracts. |
| `apiBrowserLoomTransport.ts` | Browser Loom request sockets, response-error mapping, handshake fallback and push subscription lifecycle; owns sockets, timers and handler registry. | Protocol types, Surface capability declaration and the transport diagnostic helper. | No `api.ts`, domain client, component or store import. | Private request helpers plus facade-re-exported listener; WebSocket request/push tests. |
| `apiBrowserArt.ts` | Browser Art action translation, formal-result validation and terminal event delivery; owns no socket. | Protocol types, browser Loom request helper and transport diagnostic helper. | No `api.ts` or application/store import. | Private dispatch fallback; browser Art contract tests. |
| `apiBrowserSession.ts` | Browser preview schema, revision check, quota compaction and localStorage access; owns the storage key and data-URL compaction threshold. | Session/snapshot value types only. | No `api.ts`, transport, component or store import. | Private load/save fallbacks; browser session tests. |

H1-A is a behavior-preserving ownership move first. Browser transport hardening starts only after the same 29-test
focused baseline passes from the split tree. H1-B/C later move the domain methods out of the stable facade.

H1-A completed that sequence: the unchanged 29-test focused baseline passed after the ownership move, and the
hardening follow-up finished with 31 focused tests. The remaining domain methods intentionally stay behind the
stable facade until H1-B/C establish their own module graphs and focused baselines.

#### H1-B module graph recorded before extraction

| Module | Responsibility and owner | Allowed dependencies | Forbidden dependency | Surface and focused proof |
| --- | --- | --- | --- | --- |
| `api.ts` | Stable composition facade; retains the H1-C Talk/Loom/Tea, enhancement, shared-memory, system and file/clipboard clients until their owning batch. | H1-A transport/browser modules plus the four H1-B clients. | Extracted clients must never import the facade. | Existing `api` import path and public type/runtime exports; API browser, direct caller and source-owner contracts. |
| `apiBootSettings.ts` | Boot profile plus tool/application/shortcut/font settings; owns no persistent state or external resource. | `apiTransport`, boot-profile normalization and app/API value types. | No facade, component, store or browser transport import. | Boot-profile unit tests, app-settings/font source contracts and application/test typechecks. |
| `apiSessionHistory.ts` | Session and color/screenshot history command boundary; owns browser-preview fallback selection but not browser storage. | `apiTransport`, `apiBrowserSession`, snapshot/session/API value types. | No facade, component or store import. | Browser persistence/revision tests, session callers and save/source contracts. |
| `apiOverlayWindow.ts` | Overlay/window/input-mode command boundary; owns command names and argument casing, not native listeners or window resources. | `apiTransport` and `PinRect`. | No facade, component, store or capture implementation import. | Overlay, focus, input-shield, capture-readiness and direct source-owner contracts. |
| `apiCapture.ts` | Native region/window/long-capture command boundary and long-session DTOs; owns no frame, timer or native session resource. | `apiTransport`, capture-state and API value types. | No facade, component, store, browser Loom or overlay client import. | Capture-window, long-capture, HDR and session source-owner contracts plus typechecks. |

H1-B repeats the H1-A sequence: record and pass a focused structural baseline, move ownership without changing
runtime behavior, pass the same baseline from the split tree, and only then harden `apiBrowserSession.ts` with
new regression tests. Source-text contracts must follow the new owning file rather than forcing implementation
details back into the stable facade.

#### H1-C module graph recorded before extraction

| Module | Responsibility and owner | Allowed dependencies | Forbidden dependency | Surface and focused proof |
| --- | --- | --- | --- | --- |
| `api.ts` | Stable composition facade and public re-export boundary; owns no transport or fallback state. | H1-A/H1-B clients plus the four H1-C clients. | No component, store or caller may be imported back into the facade. | Existing `api` value, DTO/runtime/listener exports, application/test typechecks and API contracts. |
| `apiTypes.ts` | Shared Talk/voice, Loom-plan, Tea, image/color and existing API DTOs; owns no runtime state. | Existing snapshot/session value types only. | No transport, facade, component or store import. | Type-only exports re-exported by `api.ts`; voice/Loom source contracts and consumer typechecks. |
| `apiVoice.ts` | Talk voice settings and one-shot capture command boundary; owns only creation of browser default values. | `apiTransport` and Talk/voice DTOs from `apiTypes`. | No facade, browser Loom transport, component or store import. | Voice hotkey/local-capability source contracts and browser fallback isolation. |
| `apiLoomSurface.ts` | Loom brain plan, handshake, action dispatch, shader, enhancement, OCR and translation routing; owns no socket or listener. | Protocol/Shader value types, `apiTransport`, `apiBrowserArt`, `apiBrowserLoomTransport` and Loom/API DTOs. | No facade, component state or application/store import. | Browser Loom/Art tests, local-capability source contract and typechecks. |
| `apiTea.ts` | Tea ticket creation command boundary; owns no HTTP client, daemon process or persisted context. | `apiTransport` and Tea DTOs from `apiTypes`. | No facade, component, store or other domain client import. | Tea desktop-entry source contract and application/test typechecks. |
| `apiImageResource.ts` | Shared-memory, cursor/color, image-path/cache, native drag/export and clipboard command boundary; owns command names and argument casing, not native buffers/files. | `apiTransport`, `FileNamingContext` and image/color DTOs. | No facade, component, store, capture client or native implementation import. | Image import/edit/export, drag, clipboard, color-picker and guardrail source contracts. |

H1-C preserves `api.ts` as the sole caller-facing import path. The initial move must keep command names, argument
keys/casing, browser fallback behavior and public DTO shapes unchanged, and must pass the same focused baseline
before any fallback-object isolation fix is introduced. Network/path/native resource policy remains with H6/H7;
the TypeScript command clients must not claim ownership of resources released by the native implementations.

#### H1-D module graph recorded before extraction

| Module | Responsibility and owner | Allowed dependencies | Forbidden dependency | Surface and focused proof |
| --- | --- | --- | --- | --- |
| `stickerGeometry.ts` | Stable caller-facing facade; owns no geometry implementation or runtime resource. | The H1-D geometry owner modules. | Owner modules must never import the facade. | Existing public types, constants and functions; nine focused geometry/edit/source-contract test files. |
| `stickerGeometryTypes.ts` | Shared geometry value types; owns no runtime state. | No runtime dependency. | No annotation implementation, facade, component or store import. | Type-only exports re-exported by the facade and application/test typechecks. |
| `stickerGeometryMath.ts` | Primitive point, rotation, scale and point-cloud bounds math. | Sticker point values and shared geometry types only. | No annotation union, facade, DOM, component or store import. | Geometry/edit unit tests and large-point-cloud bounds regression proof. |
| `stickerArrowGeometry.ts` | Arrow anchor, head and shaft geometry. | Sticker point values only. | No facade, annotation owner, DOM, component or store import. | Arrow geometry and line-handle unit tests. |
| `stickerShapeGeometry.ts` | Triangle/polygon vertices plus rounded SVG/canvas paths. | Sticker point values and shared geometry types. | No facade, annotation owner, component or store import. | Geometry unit tests and shape-preview contract. |
| `stickerTextGeometry.ts` | Text/serial metrics and the reusable browser measurement context. | Sticker annotation types and serial metrics. | No facade, bounds, hit-test, component or store import. | Text sizing contract plus geometry and transform tests. |
| `stickerAnnotationBounds.ts` | Annotation, center and group bounds. | Math, arrow and text geometry plus shared types. | No facade, hit-test, transform, component or store import. | Geometry/transform tests and transform-mode source contract. |
| `stickerAnnotationHitTest.ts` | Shape-aware annotation hit testing and topmost selection. | Math, arrow, shape, text and bounds owners. | No facade, edit/transform, component or store import. | Geometry unit tests and selection-order regression proof. |
| `stickerAnnotationEditGeometry.ts` | Clone, translate, box resize and line-endpoint edits. | Annotation values, Solid store unwrapping and shared handle types. | No facade, bounds/hit-test/transform, component or store import. | Edit/resize/line-handle tests and transform-mode source contract. |
| `stickerAnnotationTransforms.ts` | Per-node and group rotation/scaling around explicit pivots. | Math, bounds and text geometry plus annotation values/shared types. | No facade, hit-test/edit, component or store import. | Edit/transform unit tests and transform-mode source contract. |

H1-D follows the same two-stage boundary: first move the existing implementation into the acyclic owner graph and
pass the identical focused baseline; only then address bounded polygon allocation, large-array bounds scans,
topmost-hit selection allocation and text-measurement reuse with explicit regression tests. All production callers
continue to import `stickerGeometry.ts`; source-text contracts must inspect the real owner as well as the facade.

#### H1-E1 sticker-editing module graph recorded before extraction

| Module | Responsibility and owner | Allowed dependencies | Forbidden dependency | Surface and focused proof |
| --- | --- | --- | --- | --- |
| `stickerEditing.ts` | Stable caller-facing facade; owns no editing implementation or mutable runtime resource. | The five H1-E1 pure-function owners. | Owner modules must never import the facade. | Every existing constant/helper export, direct unit tests and owner-aware source contracts. |
| `stickerEditingDefaults.ts` | Shared colors, highlighter policy and fresh annotation/image/tool default factories. | Sticker editing value types only. | No facade, component, store or runtime service import. | Domain/default/tool/style tests plus source-owner contracts. |
| `stickerEditingGeometry.ts` | Pointer clamping, shape/line constraints and crop-frame calculations. | Sticker point and image-edit value types only. | No facade, frame viewport, component or store import. | Foundation and geometry/crop unit contracts. |
| `stickerStyleValues.ts` | Palette normalization, alpha/transparent semantics, numeric style adjustment and serial metrics. | Sticker color-state values plus the transparent-color constant from defaults. | No facade, component, store or DOM import. | Color, opacity, effect and style/source-owner contracts. |
| `stickerFrameGeometry.ts` | Whole-sticker scaling, contain placement, minified-window restore and image/annotation viewport projection. | Sticker point and image-edit value types only. | No facade, editing geometry, component, store or DOM import. | Wheel, scale, minify and double-click contracts. |
| `stickerEditingModels.ts` | Fresh eraser stroke/group records, serial labels and immutable border toggling. | Sticker annotation/group/image-edit value types only. | No facade, other owner, component or store import. | Snapshot, border and foundation tests. |

H1-E1 is a pure ownership move first: preserve every default value, clamping/snap rule, return-object identity rule,
viewport precedence and public import path under the identical focused baseline. Only after that proof may bounded
input hardening be considered; user-visible truncation or persisted-data rejection belongs at the actual load/import
boundary rather than in these arithmetic helpers.

#### H1-E2 graph-image resolution module graph recorded before extraction

| Module | Responsibility and owner | Allowed dependencies | Forbidden dependency | Surface and focused proof |
| --- | --- | --- | --- | --- |
| `graphImageResolution.ts` | Stable caller-facing facade; owns no traversal or parameter implementation. | The five H1-E2 resolution owners. | Owner modules must never import the facade. | All ten existing resolver exports and the fixed graph/node/display/sticker baseline. |
| `imageGraphPrimitives.ts` | Image-port classification, capability lookup, first matching input-link selection and safe object-field access. | Unit/protocol value types and the Art capability lookup only. | No traversal owner, facade, store or component import. | Graph and node-parameter unit tests plus application/test typechecks. |
| `graphTraversalResolution.ts` | Cycle-bounded formal-pending, output-value, connected-port and unit-image traversal. | Image-graph primitives and the disabled-input marker. | No node-param, execution-input, canvas-display, facade, store or component import. | Formal-output, propagation, visited-set and first-link graph tests. |
| `nodeParamResolution.ts` | Non-secret effective Art parameter defaults, linked-value coercion and numeric bounds. | Image-graph primitives, graph traversal and Art control-param policy. | No execution/display owner, facade, store or component import. | Node-parameter and graph resolution tests. |
| `executionImageInputs.ts` | Declared primary/auxiliary image inputs, missing-port detection and execution input resolution. | Image-graph primitives and graph traversal only. | No node-param/display owner, facade, store or component import. | Graph image-resolution and node-parameter tests. |
| `canvasDisplayResolution.ts` | Canvas-only preview/upstream/source precedence for Art, relays and locally edited stickers. | Graph traversal and the disabled-input marker. | No node-param/execution owner, facade, store or component import. | Canvas display and sticker pass-through tests. |

H1-E2 is a pure ownership move first. Preserve mutable `visited`-set propagation, first-match `links.find` behavior,
formal Art output isolation from `previewSrc`, secret/internal parameter filtering, linked-value coercion, manual input
fallbacks and canvas/sticker precedence under the identical focused baseline. Security or complexity changes require a
separate post-move proof and must not be hidden inside the extraction.

#### H1-E3 sticker-export module graph recorded before extraction

| Module | Responsibility and owner | Allowed dependencies | Forbidden dependency | Surface and focused proof |
| --- | --- | --- | --- | --- |
| `stickerExport.ts` | Stable caller-facing facade; owns no render implementation or browser resource. | The source, composite and operation owners. | Owner modules must never import the facade. | All seven existing exports and the fixed 14-file export/rasterize/style baseline. |
| `stickerExportSource.ts` | Graph-aware base/direct image selection plus graph-store runtime adapters. | Graph store, graph-image resolution, synced-image policy and value types. | No canvas, drawing, composite, operation or facade import. | Composite/source unit tests and production caller typechecks. |
| `stickerAnnotationDrawing.ts` | Per-annotation drawing, effect masking, eraser strokes and render-rank policy. | Sticker effects, geometry, editing metrics/colors, canvas primitives and value types. | No source/composite/operation/facade or graph-store import. | Effect, highlighter, style and text sizing tests. |
| `stickerAnnotationLayer.ts` | Stable rank/z ordering and single-wash highlighter compositing. | Annotation drawing, highlighter policy and canvas stroke primitive. | No source/composite/operation/facade or graph-store import. | Highlighter/effect/rasterize tests. |
| `stickerCompositeRenderer.ts` | Base image contain/crop/flip/opacity, erase, border, raster layer, editable annotations and output sizing. | Export source, annotation layer/drawing, content-frame resolver and image loader. | No operation/beautify/facade or direct graph-store import. | Composite contain, opacity, border, propagation, rasterize and effects tests. |
| `stickerExportBeautify.ts` | Export-only padded background, rounded clip and shadow composition. | Beautify layout/background owner and image loader. | No graph, annotation, composite, operation or facade import. | Beautify export tests. |
| `stickerExportOperations.ts` | Formal-pending gate, direct-source fast path, final beautify, base-layer and transparent rasterization operations. | Graph store/pending resolver, source, composite, annotation layer, beautify and image loader. | No facade import. | Export, rasterize, drag-out and runtime caller contracts. |

H1-E3 is a pure ownership move first. Preserve blur-before-mosaic render rank, within-rank z order, the single
highlighter wash, effect destination-in masks, base/crop/flip/opacity/erase/border/raster/annotation order, Art formal
pending gate before direct export, image-content output sizing, transparent-layer error behavior and export-only
beautify under the identical focused baseline. Canvas dimension budgets, decode cancellation, CORS/data-URI policy,
offscreen reuse and encoding changes require separate post-move evidence at the real image-load/export boundary.

#### H1-E4 overlay synthetic-event module graph recorded before extraction

| Module | Responsibility and owner | Allowed dependencies | Forbidden dependency | Surface and focused proof |
| --- | --- | --- | --- | --- |
| `overlaySyntheticEvents.ts` | Stable caller-facing facade plus the global-mouseup trust predicate. | Type/constant owner and dispatcher owner only. | Internal owners must never import the facade. | Existing public types, constants, factory and 11-file event/runtime baseline. |
| `overlaySyntheticTypes.ts` | Payload/event/dependency/dispatcher contracts, public event names and click thresholds. | No runtime owner. | No facade, DOM implementation, component or store import. | Application/test typechecks and facade import coverage. |
| `overlaySyntheticState.ts` | Pointer capture/down/hover/click/gesture/move-relay state plus exact reset semantics. | No runtime dependency beyond DOM value types. | No target/dispatch/facade/component import. | Pointer-reset, click/double-click and core dispatcher tests. |
| `overlaySyntheticTargets.ts` | Live hit testing, editable/interactive targets, sticker-root pass-through and JavaScript Surface frame resolution. | Injected overlay dependencies only. | No state mutation, event construction, dispatch owner, facade, component or store import. | Surface, linking, sticker-target, drag and input-shield tests. |
| `overlaySyntheticHover.ts` | Exact pointer/mouse out/leave/over/enter transition ordering and hover-state ownership. | Overlay state only. | No hit testing, surface relay, main dispatch or facade import. | Hover relay and core event-order tests. |
| `overlaySyntheticDispatch.ts` | Dispatcher orchestration, capture/bypass/pin policy, DOM event synthesis, Surface gesture relay and native move relay. | Types/constants, state, targets and hover owners. | No facade, component or store import. | Full 11-file event/runtime baseline. |

H1-E4 is a pure ownership move first. Preserve Shift bypass, captured-target pinning, live link target resolution,
whole-sticker drag pinning, hover transition order/bubbling, JavaScript Surface focus/gesture ownership, click and
double-click thresholds, reset omissions and native move-relay `try/finally` under the identical focused baseline.
Coordinate validation, cross-realm `EventTarget` checks and Surface origin/capability policy are post-move changes and
must not be hidden inside the extraction.

#### H1-F oversized-test module graph recorded before extraction

| Existing test | Behavior-contract result | Shared test-only dependency | Focused proof |
| --- | --- | --- | --- |
| `graphImageResolution.test.ts` | Formal-image boundaries, primary-image traversal, capability/parameter policy, auxiliary-image resolution and missing-image-port contracts. | One small sticker fixture owner; production imports remain through `graphImageResolution.ts`. | Identical 20-test graph baseline plus test TypeScript check. |
| `stickerEditTransforms.test.ts` | Basic frame scaling, effect/shape scaling, frame flipping, geometry transforms and geometry hit testing. | No shared runtime fixture; each contract keeps only its required inline values and imports. | Identical 13-test transform/hit-test baseline plus test TypeScript check. |
| `overlaySyntheticEvents.test.ts` | Core hover/click, drag/link capture, JavaScript Surface relay, Art Surface pass-through and dispatch metadata/reset contracts. | One DOM harness owner used only by the split overlay tests. | Identical 28-test observable-event baseline plus test TypeScript check. |

H1-F is test-only structural movement. Preserve every assertion and test body first; do not use the split to weaken a
source or behavior contract, change production code, regenerate the oversized baseline, or merge independent event
scenarios. New `*.test.ts` files must be discovered by the existing Vitest defaults, while helper owners must not use
the test suffix. Each result must remain below 500 effective lines; the behavior-contract target is roughly 150 lines.

Split `src/services/api.ts` into:

- shared `safeInvoke`, error mapping and browser fallback transport;
- boot/settings client;
- capture client;
- session/history client;
- overlay/window client;
- Loom/Surface client;
- Talk/voice client;
- Tea client;
- image/clipboard/resource client.

Preserve every command name, argument key/casing, return type and browser-preview failure/fallback behavior.
Keep `api.ts` as the stable export facade.

Then split pure sticker/image services by actual ownership:

- geometry primitives and bounds;
- per-shape transforms and hit testing;
- edit/history propagation;
- raster/export and filename policy;
- graph image resolution;
- synthetic overlay event projection.

Targets include `stickerGeometry.ts`, `stickerEditing.ts`, `stickerExport.ts`,
`graphImageResolution.ts` and `overlaySyntheticEvents.ts` plus their oversized tests.

### H2 - Annotation and unit frontend

Execute H2 as at least three independently proven moves:

- **H2-A**: annotation controller, edit-session state and pointer/tool dispatch;
- **H2-B**: annotation renderers, overlays, effects, text/crop/eraser and portal integration;
- **H2-C**: `UnitView` and the parameter/top-strip/property/shader/JavaScript-Surface component families.

Split `StickerAnnotationLayer.tsx` into:

- controller and edit-session state;
- pointer/drag/tool dispatch;
- selection/gizmo overlays;
- freehand/line/arrow renderer;
- shape renderer;
- mosaic/blur/effect renderer;
- crop/eraser behavior;
- text editing/renderer;
- context menu/portal integration.

Keep high-frequency preview work imperative and transient. Do not write persistent graph state per pointer move.

Split `UnitView.tsx`, `UnitParamsPanel.tsx`, `StickerTopStrip.tsx`,
`StickerTopStripPropertyBar.tsx`, `ShaderPreview.tsx`, `JavaScriptSurface.tsx` and related tests into focused
controllers/views. Keep protocol validation and resource budgets outside presentational components.

### H3 - Application orchestration and styles

Execute listener/lifecycle extraction before visual CSS ownership. Do not split CSS until the component owners
that will import each layer are stable.

Reduce `src/app.tsx` to application composition and explicit subsystem hooks for:

- Tauri listener registration/cleanup;
- session restore/persistence;
- capture lifecycle and readiness;
- overlay input and native drag authority;
- keyboard shortcuts and actions;
- Loom/Surface coordination;
- Talk/Tea coordination;
- canvas/workflow coordination.

The current listener setup registers many asynchronous Tauri subscriptions and later collects unlisten
callbacks. Add regressions for partial listener-registration failure and repeated mount/unmount so an early
failure cannot leak subscriptions or create duplicate events.

Split `src/app.css` only after component ownership is stable. Use explicit ordered layers/files for tokens/reset,
shell/layout, canvas/overlay, dialogs/menus, sticker/annotation UI, integration surfaces and responsive/theme
rules. Preserve cascade order, selector specificity and the current terminal-style dark/signal-yellow/green
visual baseline. Run visual/browser checks; passing TypeScript is not CSS evidence.

### H4 - Screenshot capture backend

Characterize SDR, HDR/scRGB, target selection and failure fallback independently before moving them. Split backend
selection from pixel conversion so Windows FFI ownership and pure conversion tests do not share one module merely
because both previously lived in `screenshot.rs`.

Split `src-tauri/src/screenshot.rs` into:

- public capture models/profile;
- display and target selection;
- Windows Graphics Capture backend;
- SDR/GDI fallback;
- HDR/scRGB analysis and color metadata;
- pixel conversion and encoding;
- output metadata/error mapping.

Preserve HDR/scRGB and SDR contracts as distinct behavior. Keep Windows symbols behind their existing guards
and retain compilable paired non-Windows behavior where present.

### H5 - Long capture

Split pure overlap/candidate analysis before session, scroll and capture ownership. This creates deterministic
leaf modules that can be tested without window automation before lifecycle code moves.

Split `src-tauri/src/long_capture.rs` into:

- target/focus discovery and window hit testing;
- axis/direction/session model;
- scroll/frame capture;
- overlap analysis;
- stitch planning;
- pixel composition;
- output encoding and terminal result.

Long capture remains SDR by design. Preserve focus/target stability, cancellation, output bounds and resource
cleanup. Use the existing LongCapture and CaptureWindowTarget/Stability contract families as the behavior map.

### H6 - Loom/Hook protocol integration

Treat Loom source as read-only. Compatibility proof comes from Hook DTO/serde tests, schemas, recorded fixtures and
runtime connector tests; do not edit Loom to make a Hook extraction pass.

Split `src-tauri/src/loom_hook.rs` into:

- protocol DTOs and version constants;
- handshake/capability negotiation;
- connector state;
- listener/transport;
- shared-memory/resource handling;
- action routing;
- error redaction and diagnostics.

Preserve `loom.hook.v1` and `loom.surface.v1`, exact serde fields, event names, action/resource semantics,
reconnect behavior and secret-safe errors. Do not revive obsolete compatibility protocols.

### H7 - Native crate root

Reduce `src-tauri/src/lib.rs` to Tauri composition and an auditable command registry. Extract, in dependency
order:

- runtime boot, CLI, help/version/self-check and logging;
- path/cache/temp and native-drag staging ownership;
- image/clipboard and remote-image cache I/O;
- managed state and app bootstrap;
- overlay/window/tray lifecycle;
- native mouse queue and coalescing;
- keyboard/global shortcuts and hook thread;
- drag export and Explorer notification;
- capture command adapters;
- session/settings/history persistence;
- local Loom/Talk/Tea/service bridges;
- tests grouped by responsibility.

Keep the exact Tauri command names, signatures, argument casing, managed-state types, event names/payloads,
CLI flags, bundle identity and command registration order where behavior depends on it. If ordinary Rust modules
would force hundreds of artificial visibility changes, a documented lexical `include!` facade is acceptable,
but each included file must still have one responsibility and be formatted/tested directly.

Execute H7 in dependency order:

1. **H7-A - boot and diagnostics**: CLI/help/version/self-check, boot profile and logging;
2. **H7-B - filesystem and image I/O**: paths, cache/temp, clipboard, local image reads and remote-image cache;
3. **H7-C - managed state**: app bootstrap, persisted settings/session/history owners and Tauri state wrappers;
4. **H7-D - window lifecycle**: overlay, canvas, tray, dialogs and visibility transitions;
5. **H7-E - native input**: bounded mouse queue, move coalescing, key/button edge ordering and hook thread;
6. **H7-F - drag export**: unique staging, target selection, copy cleanup and Explorer notification;
7. **H7-G - command adapters**: capture and Loom/Talk/Tea/voice bridges over already extracted owners;
8. **H7-H - composition facade**: final command registry, plugin setup, startup/shutdown order and grouped tests.

After H7-H, `src-tauri/src/lib.rs` must be an auditable composition facade at or below 700 effective lines. A
lexical `include!` is not permission to hide a second oversized file: every included fragment is checked under the
same thresholds and must have a real owner name.

### H8 - Remaining mandatory files and soft-limit decisions

Process every remaining checker item, including:

- locally maintained `scap-targets`/`scap-direct3d` code;
- oversized Rust connector contract tests;
- large Vitest files;
- real-runtime/acceptance PowerShell scripts;
- JavaScript Surface bootstrap/smoke code;
- selection, color picker, shader, voice, device and sync modules.

Split tests by behavior contract or scenario, not arbitrary test count. Keep fixture builders separate when this
improves ownership, but do not weaken assertions. For PowerShell, preserve Windows PowerShell 5.1 parsing,
native exit-code propagation, UTF-8-no-BOM output, cleanup and quoting behavior.

Exit: `npm run check:effective-lines:strict` passes; no file exceeds 700; every 501-700 file has a valid current
exception rather than an informal paragraph.

## 7. Hook invariants that must not regress

### 7.1 Frontend state and hot paths

- Persistent graph edits go through `graphStore.actions`.
- Pointer/drag/edit previews remain transient and must not persist graph state per sample.
- Native overlay drag samples remain authoritative while native drag is active.
- Move samples may be coalesced; Down/Up/key/Escape/delete/emergency-exit edges remain ordered.
- Drag release commits graph position once.
- Cancel, blur, timeout and watchdog paths clear transient DOM/GPU/input state.
- Component extraction must not broaden subscriptions or rerender the whole canvas on every move.
- Tauri/event/browser listeners, timers, RAF, sockets, MessagePorts, object URLs and abort controllers have
  explicit teardown paths.

### 7.2 Coordinates, drag export and Explorer

- Keep physical-global, monitor-logical, WebView-client and scale-factor coordinates explicit.
- Preserve negative-origin and mixed-DPI monitor behavior.
- Explorer/desktop target resolution must use the release point's physical global coordinates.
- A missing/unsupported export target fails without writing elsewhere.
- Successful export retains Explorer refresh through `SHChangeNotify`.
- Existing `Ctrl+1` capture behavior and real drag preference remain stable.

Targeted regressions should cover multiple DPI scales, Explorer subfolders, desktop targets, no target, source
read failure, destination write failure, partial-file cleanup and external-file path policy.

### 7.3 Native resources and persistence

- Native drag staging is unique per operation and bounded; failed copies and stale operations clean up without
  deleting an active drag directory.
- Process/thread/watchdog/channel shutdown is owned and observable.
- Cursor/input state is restored on normal, abnormal and emergency exit.
- COM, D3D, capture frames, image buffers and file handles have explicit release owners.
- History/settings/session persistence must not silently turn a partial overwrite into permanent data loss.
- File/cache/history queues and image dimensions/encoded payloads remain bounded.

### 7.4 Protocol and security

- Tauri command arguments and return values retain exact casing and shape.
- Browser-preview fallbacks must not silently claim native drag/capture success.
- Surface origin/source/protocol/resource validation remains fail-closed.
- Path checks consider `..`, symlinks/reparse points, nonexistent destinations and check/open races.
- Remote image downloading must be reviewed at the URL/network boundary for localhost/private/metadata targets,
  redirect behavior, timeout, response size, MIME/byte signature and cache races. Do not claim SSRF protection
  until the actual connector behavior is tested.
- Error/log/persistence paths must not expose tokens, credentials or private provider identifiers.
- UIAccess/signing checks remain fail-closed.

## 8. Focused post-split audit priorities from current code

These are investigation targets, not pre-approved patches:

1. `src-tauri/src/lib.rs` drag-export target selection and copy cleanup:
   verify multi-DPI/Explorer/desktop targeting, source-path policy, partial writes and `SHChangeNotify` behavior.
2. Native drag staging and retention cleanup:
   verify concurrency, crash leftovers and protection of active staging directories.
3. History persistence:
   current save/load ownership should be checked for atomic replacement, corruption recovery and bounded history.
4. Remote image cache:
   verify SSRF/redirect/timeout/size/content validation and concurrent writes before changing policy.
5. `path_is_within` and related path boundaries:
   test traversal, symlinks/reparse points, nonexistent leaves and TOCTOU assumptions.
6. `src/app.tsx` asynchronous listener registration:
   prove cleanup on partial setup failure and repeated mount/unmount.
7. Capture/annotation hot paths:
   compare before/after performance; do not optimize without a stable measurement.

Planning-time source inspection adds these concrete validation targets without pre-approving a patch:

- `cache_remote_image_asset` currently accepts HTTP(S) URLs and the reqwest/PowerShell download paths must be
  tested against loopback, private, link-local/metadata, DNS rebinding and redirect targets before SSRF protection
  is claimed;
- the current remote-image path can buffer a response before applying the 64 MiB result limit, so H7-B must prove
  peak-memory behavior with a large chunked response and move enforcement before unbounded buffering if confirmed;
- `read_image_from_path` must be checked against the product's intended allowed roots, symlink/reparse-point races,
  metadata/read TOCTOU and privacy expectations before any path policy is changed;
- asynchronous listener setup in `app.tsx` must prove teardown after partial registration failure and repeated
  mount/unmount before listener ownership is considered safe.

## 9. Verification commands

Use `rtk` for external executables. Run the smallest relevant command during development, then the owning phase
gate. Examples below assume the Hook repository root.

### 9.1 Every batch

```powershell
rtk npm run test:effective-lines
rtk npm run check:effective-lines
rtk git diff --check
```

For frontend/TypeScript changes:

```powershell
rtk npm run lint
rtk npm run typecheck
rtk npm run typecheck:test
rtk npm test -- <focused-test-file-or-filter>
```

For Rust/native changes:

```powershell
rtk cargo fmt --check --manifest-path src-tauri\Cargo.toml
rtk cargo test --manifest-path src-tauri\Cargo.toml <focused-filter> -- --test-threads=1
```

If Rust implementation is split with `include!`, run `rustfmt --check` directly on every facade/fragment because
Cargo's ordinary module discovery may not format included fragments independently.

For CSS/visual/JavaScript Surface changes, add the relevant browser/visual contract instead of relying only on
typecheck.

After every write batch, re-read the affected area and verify all new/modified text is UTF-8 without BOM or
trailing whitespace.

### 9.2 Hook phase/final source gates

```powershell
rtk npm run verify:version
rtk npm run audit:licenses
rtk npm run test:effective-lines
rtk npm run check:effective-lines:strict
rtk npm run lint
rtk npm run typecheck
rtk npm run typecheck:test
rtk npm test
rtk npm run test:parallel
rtk npm run test:performance
rtk npm run test:surface-browser
rtk cargo fmt --check --manifest-path src-tauri\Cargo.toml
rtk powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\run-rust-tests-ci.ps1
rtk npm run build
rtk git diff --check
```

Install Playwright Chromium once if the browser smoke reports it is missing:

```powershell
rtk npx playwright install chromium
```

Also run the focused contract families for the changed ownership: overlay ordering, coordinate/DPI, real drag,
capture focus/targeting, long capture, sticker annotation/editing, JavaScript Surface, Loom/Surface connector,
release provenance/signing and built-EXE behavior.

`npm run verify:local` is not a lightweight check: it runs the aggregate chain and then calls the local release
builder. Do not run it per batch or when a release side effect is not intended. Before using it at final closure,
inspect its output destination and ensure it cannot overwrite an existing artifact; prefer the explicit unique
release commands in Section 10.

Fresh H0 command evidence from 2026-08-23:

- `npm run test:effective-lines`: 15/15 checker tests passed.
- `npm run check:effective-lines`: 493 scanned files and 7/15/20 remaining tiers; ratchet passed.
- the two modified workflow contract files: 5/5 tests passed.
- lint, application typecheck and test typecheck passed.
- serial Vitest: 263/263 files and 1,146/1,146 tests passed in 714.89 seconds.
- parallel Vitest: 263/263 files and 1,146/1,146 tests passed in 211.75 seconds.
- performance gate: 1/1 file and 3/3 tests passed.
- JavaScript Surface browser smoke: all seven expected scenarios completed with `passed: true`.
- Cargo formatting passed; the Rust CI runner passed 252 library tests and all enabled connector/voice contracts,
  with the real Tea daemon smoke remaining intentionally ignored because no daemon was running.
- the frontend production build transformed 146 modules and passed. Its 572.85 kB JavaScript chunk retains the
  existing non-fatal Vite chunk-size warning and is a later performance/code-splitting review target.

The first sufficiently long serial Vitest run exposed two H0 integration defects: Vitest collected the new
`node:test` checker as an empty suite, and this work order used machine-local absolute paths. The Vitest discovery
boundary now preserves its defaults while excluding `scripts/tests/**`; this document uses repository placeholders.
The focused documentation contract passed 2/2, the checker remained 15/15, and both complete Vitest modes then
passed with the totals above.

## 10. Final release closure

Do not build a release after an individual split batch. Build once after all Hook queue items and hardening work
are complete, strict mode passes, full source/runtime gates pass and documentation is current.

There are two distinct closure checkpoints:

1. **source-complete**: all code, tests, reports and scoped diffs are reviewed and green; this checkpoint does not
   require or imply a commit, tag, push or release;
2. **formal release**: the user explicitly authorizes the coherent Hook commit and release operation, after which
   the exact reviewed commit is cleanly packaged with provenance.

The inherited Phase 79-A changes make the worktree intentionally dirty. Therefore the formal release prerequisite
cannot be satisfied until the user authorizes committing the complete Hook-only change set. If that authorization
is not given, stop at source-complete and report `release pending authorization`; do not silently produce or label
a dirty candidate as a formal release.

Release prerequisites:

1. Before authorization, scoped status contains only the preserved Phase 79-A files and reviewed Phase 79 work;
   after the authorized commit, `git status --porcelain --untracked-files=all` is empty.
2. The user has authorized the commit/release operation and approved a new unused version/candidate ID.
3. `package.json`, both package-lock version fields, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` and
   `src-tauri/tauri.conf.json` agree on strict SemVer.
4. Existing release directories and files remain untouched.
5. The output directory below `<hook-release-root>` is new and empty.

Current release-root content that must not be deleted or overwritten includes:

- `20260823-phase78-remaining-work-r93`
- `20260823-phase78-remaining-work-r92`
- `20260818-stock-focus-drag-runtime-r64`
- existing loose text files in the Hook release root

Build a clean portable candidate into an explicit new directory without `-Force`:

```powershell
rtk powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File .\scripts\build-local-hook-exe.ps1 `
  -OutputDir <hook-release-root>\<new-unused-id> `
  -RequireCleanSource
```

Package the exact executable and adjacent provenance, again without overwriting:

```powershell
rtk powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File .\scripts\package-release-zip.ps1 `
  -ExePath <hook-release-root>\<new-unused-id>\hook.exe `
  -OutputDir <hook-release-root>\<new-unused-id> `
  -Tag <approved-tag-or-candidate-id>
```

Verify:

- built `hook.exe --version` and `hook.exe --self-check` semantic results;
- executable and ZIP existence, size and SHA-256;
- `build-provenance.json` has the final reviewed commit and `gitDirty=false`;
- provenance artifact name/hash exactly match the packaged executable;
- ZIP contains only `hook.exe`, provenance, project license, notices and required third-party license files;
- native candidate preflight with an explicit expected SHA-256;
- real native/dual-end acceptance only after all existing Hook instances are exited normally and the user accepts
  the process/UI side effects.

The current public package is the portable ZIP. Do not publish an installer or claim UIAccess support from an
unsigned executable. UIAccess requires a real digital signature and a trusted install location such as Program
Files. Signing workflow activation, provider identifiers, protected approvals, tags, pushes and GitHub releases
all require explicit user authorization. Never use `-Force` to replace an existing release artifact unless the
user names that exact artifact and authorizes replacement.

## 11. Completion checklist

- [x] Inherited Phase 79-A Hook changes are preserved and verified.
- [ ] Every hard-cap and mandatory queue item is processed.
- [ ] No handwritten source/test/script/style/local fork file exceeds 700 effective lines.
- [ ] Every remaining 501-700 file has a current machine-readable cohesion exception.
- [ ] Major frontend/native integration files are composition facades rather than algorithm stores.
- [ ] New modules have clear ownership/invariant comments without padding.
- [ ] Tauri, event, serde, protocol, persistence, CLI and release contracts remain covered.
- [ ] Each resulting module has completed security, resource-lifetime and performance review.
- [ ] Confirmed high/critical security defects and resource leaks have regression evidence.
- [ ] Hot paths have no unexplained performance regression.
- [ ] Effective-line strict mode passes.
- [ ] Full frontend, browser, Rust, runtime and build gates pass from the final tree.
- [ ] `git diff --check`, UTF-8/BOM and scoped change review pass.
- [ ] Final release is produced only from clean committed source into a new release directory.
- [ ] Release provenance reports the reviewed commit and `gitDirty=false`.
- [ ] Previous source changes and release candidates remain intact.
- [ ] If commit/release authorization is absent, source closure explicitly reports `release pending authorization`
      instead of claiming the task is released.

## 12. Progress record template

Append one section per completed batch:

```markdown
### YYYY-MM-DD - Hook Phase 79 batch HN: <ownership boundary>

- Target and baseline: `<path>` at N effective / M physical lines.
- Scoped Git state before the batch: inherited paths plus the exact batch-owned paths.
- Structural result: facade/module list, responsibility, maximum resulting file size.
- Preserved contracts: exports, Tauri commands/events, serde/protocol/persistence/CLI behavior.
- Structural proof before hardening: exact commands and pass counts.
- Hardening review:
  - confirmed fixes and regression tests;
  - verified non-issues and why;
  - residual risks and owning boundary.
- Final evidence:
  - focused tests;
  - direct dependents/typecheck;
  - formatter/lint;
  - effective-line tests and ratchet counts;
  - `git diff --check` and encoding checks.
- Generated evidence: effective-line JSON/runtime artifacts and confirmation that generated outputs are ignored
  and not part of the source commit.
- Scoped Git state after the batch: exact modified/new source paths and any unexpected drift investigation.
- No release was built for this individual batch; Hook Phase 79 remains in progress.
```

Never write `passed`, `fixed`, `safe`, `released` or `complete` without fresh command/runtime/artifact evidence.

### 2026-08-23 - Hook Phase 79 batch H0: measurement and behavior baseline

- Target and baseline: inherited Phase 79-A checker/policy/workflow files; no production source was split.
- Scoped Git state before the batch: the five inherited tracked modifications and the Phase 79-A/work-order
  untracked paths listed in Section 2; branch `main` remained one commit ahead of `origin/main`.
- Structural result: `vite.config.ts` now keeps Vitest's default exclusions and assigns `scripts/tests/**` only to
  its intended Node test runner. The work order uses sanitized checkout/release placeholders.
- Preserved contracts: no Tauri command, event, protocol, persistence, CLI or product runtime implementation changed.
- Structural proof before hardening: checker 15/15, ratchet 493 files at 7/15/20, and workflow contracts 5/5.
- Hardening review:
  - confirmed fixes: prevented cross-runner test discovery and removed machine-local roots from active docs;
  - regression proof: documentation sanitization contract 2/2 and full serial/parallel Vitest totals below;
  - residual risk: the production JavaScript chunk exceeds Vite's advisory 500 kB threshold and remains assigned
    to the later frontend ownership/performance batches; no H0 product security or resource-lifetime claim is made.
- Final evidence:
  - serial Vitest 263 files / 1,146 tests; parallel Vitest 263 files / 1,146 tests;
  - performance 1 file / 3 tests; JavaScript Surface browser smoke seven scenarios;
  - lint, application/test typechecks, Cargo formatting, Rust CI runner and frontend build passed;
  - Rust CI runner: 252 library tests plus 14 Loom, 11 Talk, 1 Tea client, 2 voice-core and 4 voice-session
    contract tests; one real-daemon Tea smoke intentionally ignored;
  - effective-line checker 15/15 and ratchet 493 files at 7/15/20; `git diff --check` passed.
- Generated evidence: `artifacts/effective-code-lines.json` and `h0-*.log` are covered by repository ignore rules
  and are not source-commit inputs.
- Scoped Git state after the batch: inherited paths remain; `vite.config.ts` is the only additional tracked source
  path and this work order remains intentional untracked documentation. No unexpected drift was found.
- No release was built for H0; Hook Phase 79 remains in progress.

### 2026-08-23 - Hook Phase 79 batch H1-A: API facade and browser transport core

- Target and baseline: `src/services/api.ts` at 1,191 effective / 1,327 physical lines and
  `__tests__/integration/api.browser.test.ts` at 565 effective / 636 physical lines.
- Scoped Git state before the batch: retained all H0 and inherited Phase 79-A paths; branch `main` and the inherited
  five tracked workflow/package changes were not reset, reverted or released.
- Structural result:
  - `api.ts` is now the stable facade at 480 effective / 552 physical lines;
  - shared DTOs moved to `apiTypes.ts` at 101 / 116, and Tauri invocation/fallback diagnostics moved to
    `apiTransport.ts` at 29 / 36;
  - browser Loom transport, Art delivery and preview persistence moved to `apiBrowserLoomTransport.ts` at 224 / 256,
    `apiBrowserArt.ts` at 288 / 300 and `apiBrowserSession.ts` at 150 / 159;
  - browser API tests were split by transport/Art versus persistence/fallback ownership: 399 / 442 and 160 / 189;
    their shared browser harness is 69 / 81. Every H1-A result is at or below the 500-line acceptable limit.
- Preserved contracts: the `api` object and `api.ts` import path, public DTO/runtime/listener exports, Tauri command
  names, argument keys and casing, browser Art translation, formal-result validation, preview persistence schema,
  and browser fallback behavior remain available through the original facade.
- Structural proof before hardening: the split tree passed the unchanged API browser and direct source-contract
  baseline at 5 files / 29 tests before any behavior fix was applied.
- Hardening review:
  - confirmed fixes: malformed browser responses now settle the request, clear their timer and close the socket;
    request transport errors also clear the timer and close the socket; adding or removing push listener methods now
    refreshes the active subscription instead of silently omitting later methods;
  - regression proof: added malformed-JSON cleanup, unreachable-server socket cleanup and multi-method subscription
    refresh tests, then retained the existing Art, push, persistence and fallback contracts;
  - verified non-issues: H1-A introduced no per-message or pointer hot-path subscription work; refresh happens only
    when the listener method set changes. Type-only and facade modules own no external resource;
  - residual risks: browser preview persistence can still report an incremented revision after repeated storage
    failure, performs only shallow nested validation and has a cross-tab revision race; H1-B owns that review. Browser
    Art payload budgets and dynamic action validation remain H1-C/H6 work. Local unauthenticated Loom WebSocket and
    handshake compatibility require protocol/server evidence and remain assigned to H6. Native cache/image bounds
    remain assigned to H7-B.
- Final evidence:
  - focused API/direct-dependent contracts passed at 6 files / 31 tests;
  - application typecheck, test typecheck and lint passed;
  - effective-line checker passed 15/15; the ratchet scanned 500 files at 7/14/19 for `>1500`, `701-1500` and
    `501-700`, improving the H0 offender counts without adding a new oversized file;
  - production frontend build passed with 150 transformed modules. Its 573.00 kB minified JavaScript chunk retains
    the existing non-fatal Vite size warning and remains later performance/code-splitting work;
  - `git diff --check` passed; documentation sanitization passed 2/2; all 11 H1-A modified/new text files
    validated as strict UTF-8 without BOM or trailing whitespace.
- Generated evidence: the production frontend output and effective-line report remain covered by repository ignore
  rules and are not source-commit inputs.
- Scoped Git state after the batch: H1-A owns the facade, five extracted service modules, the split browser tests,
  their shared test harness and this progress record; inherited Phase 79-A/H0 paths remain intact.
- No release was built for H1-A; Hook Phase 79 remains in progress.

### 2026-08-23 - Hook Phase 79 batch H1-B: domain clients and browser-session hardening

- Target and baseline: the H1-A facade `src/services/api.ts` at 480 effective / 552 physical lines and
  `apiBrowserSession.ts` at 150 / 159. Two stale H1-A source-text assertions were first redirected from the facade
  to `apiTypes.ts`; the resulting pre-H1-B focused baseline passed at 17 files / 100 tests.
- Scoped Git state before the batch: retained every inherited Phase 79-A, H0 and H1-A path; no parent, sibling,
  Loom or release path was modified.
- Structural result:
  - `api.ts` remains the only public composition facade and is now 270 effective / 312 physical lines;
  - boot/settings, session/history, overlay/window and native capture routing moved to `apiBootSettings.ts` at
    29 / 37, `apiSessionHistory.ts` at 53 / 59, `apiOverlayWindow.ts` at 36 / 53 and `apiCapture.ts` at 124 / 137;
  - browser-session validation is isolated in `apiBrowserSessionValidation.ts` at 107 / 122; the hardened storage
    owner is 196 / 207 and its focused browser test is 246 / 282. Every H1-B result remains below 500 effective lines.
- Preserved contracts: consumers still import the same `api` object and public types from `api.ts`. Command names,
  argument casing (including `clickThrough`, `active`, `enabled`, long-capture options and session revision keys),
  return types, browser fallbacks, capture ordering and overlay/click-through caller contracts are unchanged.
  Source-text tests now inspect each command/type's actual owner rather than requiring implementation text in the
  facade.
- Structural proof before hardening: both the pre-move and post-move trees passed the same 17-file / 100-test
  baseline; application and test typechecks passed after composition through the four client objects.
- Hardening review:
  - confirmed fixes: session arguments now use concrete sticker/link/group types instead of `any[]`; browser session
    loads reject malformed nested stickers, links, groups, frozen entries and archive indexes; two failed storage
    writes now reject instead of falsely returning an incremented revision; quota compaction also removes known
    oversized frozen/archive data URLs; app-settings browser defaults clone both nested settings objects; capture
    routing no longer logs screenshot coordinates and dimensions;
  - regression proof: browser fallback coverage grew from 8 to 11 tests for double-write failure, nested record
    rejection, nested compaction and isolated settings defaults. The final owning-contract set is reported below;
  - verified non-issues: the four extracted clients own no socket, timer, listener, frame buffer or native capture
    session. Validation runs only at browser load/save boundaries, and deep compaction runs only after a storage
    write fails. Workflow archive hints remain a backend file-snapshot merge input and are intentionally not treated
    as a browser archive index;
  - residual risks: localStorage provides no atomic compare-and-swap across browser tabs, so simultaneous preview
    writers can still lose an update despite the revision check. Native overlay maintenance/input-hook lifetime and
    capture-session teardown remain H7-D/E/G runtime responsibilities. The browser-preview store is quota-bounded by
    the browser but has no independent product-level collection-count budget.
- Final evidence:
  - focused API/browser/direct-caller/source-owner contracts passed at 17 files / 103 tests;
  - lint plus application and test typechecks passed;
  - effective-line checker passed 15/15; the ratchet scanned 505 files at 7/14/19 for `>1500`, `701-1500` and
    `501-700`, adding no oversized file;
  - production frontend build passed with 155 transformed modules. Its 574.53 kB minified JavaScript chunk retains
    the existing non-fatal Vite warning and remains later performance/code-splitting work;
  - `git diff --check` passed; documentation sanitization passed 2/2; all 21 H1-B modified/new text files validated
    as strict UTF-8 without BOM or trailing whitespace. Scoped status contains only inherited and H0/H1-owned Hook
    paths.
- Generated evidence: the production frontend output and effective-line JSON remain ignored and are not
  source-commit inputs.
- Scoped Git state after the batch: H1-B owns four domain clients, the browser-session validator/storage changes,
  source-owner contract updates, browser fallback regressions and this record; inherited changes remain intact.
- No release was built for H1-B; Hook Phase 79 remains in progress.

### 2026-08-23 - Hook Phase 79 batch H1-C: integration and image-resource clients

- Target and baseline: the H1-B `src/services/api.ts` facade at 270 effective / 312 physical lines. The fixed
  Talk/voice, Loom/Surface, Tea, image/resource, browser API and direct source-owner baseline passed before the move
  at 16 files / 82 tests.
- Scoped Git state before the batch: retained every inherited Phase 79-A, H0, H1-A and H1-B path; no parent,
  sibling, Loom or release path was modified.
- Structural result:
  - `api.ts` is an import-compatible composition facade at 49 effective / 52 physical lines;
  - Talk/voice routing moved to `apiVoice.ts` at 28 / 32, Loom planning/protocol/enhancement routing to
    `apiLoomSurface.ts` at 62 / 71, Tea routing to `apiTea.ts` at 13 / 15, and image/shared-memory/drag/clipboard
    routing to `apiImageResource.ts` at 120 / 130;
  - public Talk/voice and Loom plan DTOs moved to the type-only `apiTypes.ts`, now at the 150-line design center
    (150 / 172). The hardened browser Loom transport is 224 / 256 and its fallback test is 268 / 310. Every H1-C
    result remains below 500 effective lines.
- Preserved contracts: callers still import the same `api` object, listener/runtime helpers and public types from
  `api.ts`. Facade spread order preserves the previous command property order. Tauri command names, argument
  keys/casing, request/response DTO shapes, browser-only failure messages, Loom WebSocket methods and OCR/translation
  request identities are unchanged. Source-text contracts now inspect their real owning client and keep facade
  composition assertions rather than requiring implementations to remain in `api.ts`.
- Structural proof before hardening: both the pre-move and post-move trees passed the identical 16-file / 82-test
  baseline. Application and test TypeScript typechecks also passed after composition through the four new clients.
- Hardening review:
  - confirmed fixes: browser voice settings now return a fresh value for every fallback call, and failed browser
    handshakes now construct a fresh nested capability tree instead of sharing caller-mutable module state;
  - regression proof: two isolation tests mutate the first returned voice/handshake value and verify that a second
    call remains pristine. The final focused set grew to 16 files / 84 tests. One formatting-coupled voice source
    assertion exposed by the multiline safe-invoke call was narrowed to the actual method and command contracts;
  - verified non-issues: the four new clients allocate no socket, timer, listener, image buffer, native handle or
    filesystem resource. `apiBrowserLoomTransport.ts` remains the socket/timer owner with the H1-A close, timeout,
    unsubscribe and reconnect proofs. The clients add only constant-time request-object construction and do not
    broaden reactive subscriptions or enter pointer/render hot paths;
  - residual risks: local unauthenticated WebSocket policy, handshake/schema validation, dynamic action and error
    semantics remain H6 responsibilities. Native shared-memory trust, remote-image SSRF/redirect and pre-buffer size
    enforcement, local path policy, clipboard/drag file lifetime, Talk response limits/correlation and Tea response
    privacy remain H7-B/F/G responsibilities. The enhancement-capability catch-all still conflates unavailable and
    malformed responses; changing that user-visible fallback requires H6 protocol evidence.
- Final evidence:
  - focused API/browser/direct-caller/source-owner contracts passed at 16 files / 84 tests;
  - lint plus application and test typechecks passed;
  - effective-line checker passed 15/15; the ratchet scanned 509 files at 7/14/19 for `>1500`, `701-1500` and
    `501-700`, adding no oversized file;
  - production frontend build passed with 159 transformed modules. Its 574.61 kB minified JavaScript chunk (174.37
    kB gzip) retains the existing non-fatal Vite size warning and remains later performance/code-splitting work;
  - `git diff --check` passed; documentation sanitization passed 2/2; all 20 H1-C modified/new text files validated
    as strict UTF-8 without BOM or trailing whitespace. Scoped status contains only inherited and H0/H1-owned Hook
    paths.
- Generated evidence: `.output` and the effective-line JSON remain covered by repository ignore rules and are not
  source-commit inputs.
- Scoped Git state after the batch: H1-C owns four domain clients, shared DTO ownership, facade composition,
  source-owner contract updates, the two browser fallback regressions and this progress record; inherited changes
  remain intact.
- No release was built for H1-C; Hook Phase 79 remains in progress.

### 2026-08-23 - Hook Phase 79 batch H1-D: sticker geometry ownership and hardening

- Target and baseline: `src/services/stickerGeometry.ts` at 1128 effective / 1256 physical lines. The fixed
  geometry, edit, line/resize and source-owner baseline passed before the move at 9 files / 60 tests.
- Scoped Git state before the batch: retained every inherited Phase 79-A, H0 and H1-A through H1-C path; no parent,
  sibling, Loom or release path was modified by this batch.
- Structural result:
  - `stickerGeometry.ts` is an import-compatible explicit re-export facade at 44 effective / 56 physical lines;
  - shared types are 13 / 18, primitive math 133 / 153, arrow geometry 79 / 95, shape geometry 125 / 152 and
    text geometry 57 / 67;
  - annotation bounds are 136 / 147, hit testing 253 / 267, edit geometry 143 / 160 and transforms 240 / 259.
    Every H1-D source result is below 500 effective lines, with no soft-limit exception.
- Preserved contracts: production callers retain the same `stickerGeometry.ts` import path and all 28 original
  public declarations. Shape, arrow, text-baseline, brush-mask, clone, translation, resize, line-endpoint, group and
  per-node transform results remain behind that facade. Source-text contracts now inspect the real bounds, edit,
  transform and text owner while also asserting the facade surface.
- Structural proof before hardening: both the pre-move and post-move trees passed the identical 9-file / 60-test
  baseline. Application TypeScript typecheck also passed after composition through the acyclic owner graph.
- Hardening review:
  - confirmed fixes: polygon sides are finite and clamped to the existing editor range of 3 through 12 before
    allocation; point-cloud, line/arrow and annotation-group bounds use iterative unions rather than large spread
    argument lists; topmost selection uses a stable linear scan without cloning/sorting the annotation array; text
    measurement reuses one detached canvas context rather than allocating a canvas per hit/bounds query;
  - regression proof: five tests cover NaN/Infinity/huge polygon counts, 150,000-point line bounds, 150,000-entry
    group bounds, equal-z stable selection without input mutation, and one-context/two-measurement reuse. The final
    focused set passed at 11 files / 65 tests;
  - verified non-issues: the owner graph has no facade back-import or cycle. Geometry owns no socket, timer, listener,
    file, native handle or reactive subscription. The cached canvas/context pair is a single bounded module-lifetime
    browser resource and is never attached to the DOM. Arrow-head bounds still include both shaft and head padding;
  - residual risks: geometry coordinates, annotation counts and point counts have no product-level input budget, so
    deliberately huge valid inputs remain linear CPU/memory work even though they no longer overflow argument stacks.
    Rejecting or truncating persisted annotation data belongs at its load/import boundary because doing so here would
    silently change user content. A replaced global `document` realm would retain the first measurement context;
    Hook's normal desktop document lifetime does not replace that realm.
- Independent read-only review found no public-export loss, behavior drift or dependency cycle and confirmed the
  stable equal-z winner, arrow bounds, polygon clamp, large-array scans and canvas reuse against the implementation.
- Final evidence:
  - focused geometry/edit/source-owner contracts passed at 11 files / 65 tests;
  - lint plus application and test typechecks passed;
  - effective-line checker passed 15/15; the ratchet scanned 520 files at 7/13/19 for `>1500`, `701-1500` and
    `501-700`, reducing the soft-over-limit tier by one and adding no oversized file;
  - production frontend build passed with 167 transformed modules. Its 574.69 kB minified JavaScript chunk (174.43
    kB gzip) retains the existing non-fatal Vite size warning and remains later performance/code-splitting work;
  - `git diff --check` passed; documentation sanitization passed 2/2; all 15 H1-D modified/new text files validated
    as strict UTF-8 without BOM or trailing whitespace. Scoped status contains only inherited and H0/H1-owned Hook
    paths.
- Generated evidence: `.output` and the effective-line JSON remain covered by repository ignore rules and are not
  source-commit inputs.
- Scoped Git state after the batch: H1-D owns the facade plus nine geometry owners, two owner-aware source contracts,
  two focused regression files and this module graph/progress record; inherited changes remain intact.
- No release was built for H1-D; Hook Phase 79 remains in progress.

### 2026-08-23 - Hook Phase 79 batch H1-E1: sticker-editing ownership and bounded defaults

- Target and baseline: `src/services/stickerEditing.ts` at 625 effective / 700 physical lines. The fixed editing,
  wheel, tool, style, minify, snapshot, opacity, domain, scale, effect, color, border, highlighter and source-owner
  baseline passed before the move at 18 files / 89 tests.
- Scoped Git state before the batch: retained every inherited Phase 79-A, H0 and H1-A through H1-D path; no parent,
  sibling, Loom or release path was modified by this batch.
- Structural result:
  - `stickerEditing.ts` is an import-compatible explicit re-export facade at 48 effective / 58 physical lines;
  - defaults/factories are 156 / 166, pointer/shape/crop geometry 154 / 171, style values 91 / 108, frame/viewport
    geometry 186 / 204 and small immutable models 46 / 54. Every H1-E1 source result is below 500 effective lines,
    with no soft-limit exception;
  - each owner identifies its responsibility, and the graph remains acyclic: style values depend only on the
    transparent-color default, while geometry/frame/models depend only on sticker value types.
- Preserved contracts: production callers retain the same `stickerEditing.ts` import path and all 34 original
  `export const` declarations. Default values, palette contents, clamp/snap rules, crop and minified viewport
  precedence, saved-frame copying, no-crop `unitRect` identity and immutable border/group/model behavior are unchanged.
  Five source-text contracts now inspect the real owner while retaining facade assertions.
- Structural proof before hardening: both the pre-move and post-move trees passed the identical 18-file / 89-test
  baseline. Application and test TypeScript typechecks passed after composition through the five owners.
- Hardening review:
  - confirmed fixes: serial-annotation radius now rejects non-finite persisted values before rounding/clamping, so
    `NaN` and either infinity use the existing radius-14 default; default palette/profile factories continue to
    return independent arrays and nested profile records rather than caller-shared session state;
  - regression proof: focused tests cover normal and 8/96 boundary metrics, `NaN`, positive infinity, and mutation
    isolation between successive default-factory calls. The final focused set grew to 18 files / 90 tests;
  - verified non-issues: the five owners are pure/stateless and allocate no socket, timer, listener, DOM/canvas,
    file, native handle or reactive subscription. Their work is constant-time except palette operations over the
    existing small user-visible array. The public default-palette constant remains mutable for current consumer type
    compatibility, but no current caller mutates it and session factories clone it;
  - residual risks: other geometry/style arithmetic still assumes finite trusted editor coordinates and settings.
    Product-level validation, persisted-data budgets and user-visible rejection/truncation belong at the load/import
    boundary rather than silently changing content inside these helpers. Freezing the public palette would require a
    coordinated consumer prop-type change in the later H2 `ColorPicker.tsx` ownership batch.
- Independent read-only review found no public-export loss, behavior drift or dependency cycle, confirmed all 34
  exports and default/clamp/snap/viewport/object-identity contracts, and found no additional high-confidence resource
  or performance defect in the extracted owners.
- Final evidence:
  - focused editing/source-owner contracts passed at 18 files / 90 tests; geometry consumers passed at 3 files / 29
    tests;
  - lint plus application and test typechecks passed;
  - effective-line checker passed 15/15; the ratchet scanned 525 files at 7/13/18 for `>1500`, `701-1500` and
    `501-700`, reducing the soft-over-limit tier by one and adding no oversized file;
  - production frontend build passed with 172 transformed modules. Its 574.72 kB minified JavaScript chunk (174.44
    kB gzip) retains the existing non-fatal Vite size warning and remains later performance/code-splitting work;
  - `git diff --check` passed; documentation sanitization passed 2/2; all 13 H1-E1 modified/new text files
    validated as strict UTF-8 without BOM or trailing whitespace. Scoped status contains only inherited and
    H0/H1-owned Hook paths.
- Generated evidence: `.output` and the effective-line JSON remain covered by repository ignore rules and are not
  source-commit inputs.
- Scoped Git state after the batch: H1-E1 owns the facade plus five pure-function owners, five owner-aware source
  contracts, one focused unit-test extension and this module graph/progress record; inherited changes remain intact.
- No release was built for H1-E1; Hook Phase 79 remains in progress.

### 2026-08-23 - Hook Phase 79 batch H1-E2: graph-image resolution ownership and dynamic-key safety

- Target and baseline: `src/services/graphImageResolution.ts` at 510 effective / 606 physical lines. The fixed graph,
  node-parameter, canvas-display and sticker-pass-through baseline passed before the move at 4 files / 38 tests.
- Scoped Git state before the batch: retained every inherited Phase 79-A, H0 and H1-A through H1-E1 path; no parent,
  sibling, Loom or release path was modified by this batch.
- Structural result:
  - `graphImageResolution.ts` is an import-compatible explicit re-export facade at 14 effective / 23 physical lines;
  - image/capability primitives are 87 / 107, cycle-bounded graph traversal 150 / 176, effective node parameters
    95 / 114, execution image inputs 185 / 208 and canvas display precedence 51 / 66. Every H1-E2 source result is
    below 500 effective lines, with no soft-limit exception;
  - each owner identifies its responsibility. The graph is acyclic: traversal depends on primitives; parameter and
    execution owners depend on traversal/primitives; canvas display depends on traversal; the facade only re-exports.
- Preserved contracts: production callers retain the same `graphImageResolution.ts` import path and all ten public
  resolver exports. Mutable visited-set propagation, cycle termination, first matching link selection, formal Art
  output isolation from `previewSrc`, sticker relay/local-edit/manual-data behavior, linked value coercion, manual
  input fallback, missing-port order and canvas display precedence are unchanged.
- Structural proof before hardening: both the pre-move and post-move trees passed the identical 4-file / 38-test
  baseline. Application and test TypeScript typechecks passed after composition through the five owners.
- Hardening review:
  - confirmed fixes: dynamic parameter and image-port names now use own-property reads and enumerable data-property
    definitions, preserving `__proto__`/`constructor` as data without prototype mutation or inherited-value confusion;
    capability-declared secret/internal control parameters are excluded from defaults, manual values and linked-value
    resolution; prototype-named auxiliary inputs are correctly reported missing instead of reading object prototypes;
  - performance cleanup: boolean coercion reuses two bounded module-level sets and linked-parameter traversal no
    longer allocates a filtered copy of the link list. Normal key order, descriptors and JSON serialization remain
    equivalent;
  - regression proof: three focused tests cover safe prototype-named parameter defaults/manual values, internal
    control defaults/manual/link filtering and missing `constructor`/`__proto__` auxiliary ports. The final focused set
    grew to 5 files / 41 tests; existing secret-parameter coverage also remains green;
  - verified non-issues: the five owners allocate no socket, timer, listener, DOM/canvas, file, native handle or
    reactive subscription. Module-lifetime alias/boolean sets are fixed-size. Independent post-fix review found no
    export loss, behavior drift, dependency cycle, prototype leak or normal descriptor/order regression;
  - residual risks: recursive paths are cycle-bounded but repeatedly scan unit/link arrays, so deliberately deep or
    large valid graphs can consume superlinear CPU and eventually native stack. Total unit/link/depth budgets belong at
    the graph load/import boundary; silently truncating resolution here would change valid workflow semantics. Secret
    filtering also necessarily depends on current capability metadata for non-internal vendor-defined IDs.
- Final evidence:
  - focused graph/parameter/display/pass-through contracts passed at 5 files / 41 tests; direct sticker-export
    dependents passed at 2 files / 3 tests;
  - lint plus application and test typechecks passed;
  - effective-line checker passed 15/15; the ratchet scanned 531 files at 7/13/17 for `>1500`, `701-1500` and
    `501-700`, reducing the soft-over-limit tier by one and adding no oversized file;
  - production frontend build passed with 177 transformed modules. Its 574.92 kB minified JavaScript chunk (174.49
    kB gzip) retains the existing non-fatal Vite size warning and remains later performance/code-splitting work;
  - `git diff --check` passed; documentation sanitization passed 2/2; all nine H1-E2 modified/new text files validated
    as strict UTF-8 without BOM or trailing whitespace. Scoped status contains only inherited and H0/H1-owned Hook
    paths.
- Generated evidence: `.output` and the effective-line JSON remain covered by repository ignore rules and are not
  source-commit inputs.
- Scoped Git state after the batch: H1-E2 owns the facade plus five resolution owners, two focused regression-test
  changes and this module graph/progress record; inherited changes remain intact.
- No release was built for H1-E2; Hook Phase 79 remains in progress.

### 2026-08-23 - Hook Phase 79 batch H1-E3: sticker-export rendering ownership and finite canvas safety

- Target and baseline: `src/services/stickerExport.ts` at 690 effective / 795 physical lines. The fixed export,
  contain, effect, beautify, highlighter, rasterize, propagation, opacity, border, style, text and drag-out baseline
  passed before the move at 14 files / 68 tests.
- Scoped Git state before the batch: retained every inherited Phase 79-A, H0 and H1-A through H1-E2 path; no parent,
  sibling, Loom or release path was modified by this batch.
- Structural result:
  - `stickerExport.ts` is an import-compatible explicit re-export facade at 11 effective / 14 physical lines;
  - graph-aware source selection is 48 / 56, annotation drawing/effects 293 / 316, ordered/highlighter compositing
    46 / 52, frame/composite rendering 204 / 223, export beautify 46 / 55 and final operations 89 / 104. Every
    H1-E3 source result is below 500 effective lines, with no soft-limit exception;
  - the 293-line drawing owner remains one cohesive annotation renderer; splitting its switch across shape/text/effect
    modules would add cross-owner dispatch without improving the current sub-500 ownership boundary. The DAG remains
    acyclic: source and drawing are leaves; layer depends on drawing; composite depends on source/layer/drawing; final
    operations depend on source/composite/layer/beautify; the facade only re-exports.
- Preserved contracts: production callers retain the same `stickerExport.ts` import path and all seven public exports.
  Blur-before-mosaic rank, within-rank z order, single-wash highlighter alpha, destination-in effect masks,
  crop/contain/flip/opacity/erase/border/raster/annotation order, formal-pending gate before direct export,
  image-content sizing, transparent-layer selection/errors and export-only beautify are unchanged. Seven source-text
  contracts now inspect the real owner while retaining facade/caller assertions.
- Structural proof before hardening: both the pre-move and post-move trees passed the identical 14-file / 68-test
  baseline. Application and test TypeScript typechecks plus lint passed after composition through the six owners.
- Hardening review:
  - confirmed fixes: shared canvas dimension normalization rejects `NaN` and either infinity before image decode or
    browser allocation while preserving finite round/clamp behavior; effect canvases preserve their prior `Math.ceil`
    sizing and reject non-finite bounds; beautify layout, corner radius and shadow inputs normalize non-finite persisted
    values instead of producing zero/invalid canvases;
  - regression proof: three tests cover pre-allocation sticker-dimension rejection, non-finite effect rejection and
    non-finite beautify layout normalization. The final focused set grew to 14 files / 71 tests;
  - verified non-issues: the owners create no timer, listener, socket, file, native handle or reactive subscription.
    Canvas and Image values are operation-local and become garbage-collection candidates after completion; the split
    adds no retained cache or process-lifetime bitmap. Highlighters already share one layer per composition and
    image-content conversion avoids its extra canvas when dimensions/placement already match;
  - residual risks: very large but finite canvases remain unrestricted to avoid silently breaking legitimate long
    captures. Multiple effect layers, the full frame, optional image-content/beautify canvases and base64 `toDataURL`
    can create substantial peak memory. `loadImage` has no cancellation, remote CORS still depends on server headers,
    and concurrent exports rely on browser GC. A product-wide pixel/depth/concurrency budget, cancellation contract and
    encoding policy belong at the shared image import/export boundary rather than this one renderer.
- Independent read-only review found no public-export loss, render-order/precedence drift or dependency cycle and
  confirmed that finite normal rounding, effect ceil sizing, beautify layout/shadow behavior and export-only paths
  remain intact.
- Final evidence:
  - focused export/rasterize/style/runtime contracts passed at 14 files / 71 tests;
  - lint plus application and test typechecks passed;
  - effective-line checker passed 15/15; the ratchet scanned 537 files at 7/13/16 for `>1500`, `701-1500` and
    `501-700`, reducing the soft-over-limit tier by one and adding no oversized file;
  - production frontend build passed with 183 transformed modules. Its 575.17 kB minified JavaScript chunk (174.64
    kB gzip) retains the existing non-fatal Vite size warning and remains later performance/code-splitting work;
  - `git diff --check` passed; documentation sanitization passed 2/2; all 20 H1-E3 modified/new text files validated
    as strict UTF-8 without BOM or trailing whitespace. Scoped status contains only inherited and H0/H1-owned Hook
    paths.
- Generated evidence: `.output` and the effective-line JSON remain covered by repository ignore rules and are not
  source-commit inputs.
- Scoped Git state after the batch: H1-E3 owns the facade plus six export owners, shared canvas/beautify finite-input
  guards, seven owner-aware source contracts, three focused unit-test extensions and this module graph/progress record;
  inherited changes remain intact.
- No release was built for H1-E3; Hook Phase 79 remains in progress.

### 2026-08-23 - Hook Phase 79 batch H1-E4: overlay synthetic-event ownership and finite coordinates

- Target and baseline: `src/services/overlaySyntheticEvents.ts` at 540 effective / 632 physical lines. The fixed
  overlay event, runtime, drag-out, Surface, pointer-reset, input-shield, hover, sticker-target and port-linking
  baseline passed before the move at 11 files / 81 tests.
- Scoped Git state before the batch: retained every inherited Phase 79-A, H0 and H1-A through H1-E3 path; no parent,
  sibling, Loom or release path was modified by this batch.
- Structural result:
  - `overlaySyntheticEvents.ts` is an import-compatible facade and trust-gate owner at 18 effective / 23 physical
    lines;
  - event types/constants are 41 / 56, pointer/click state 46 / 51, target/Surface hit testing 163 / 181, exact hover
    transitions 55 / 60 and dispatcher orchestration 277 / 300. Every H1-E4 production result is below 500 effective
    lines, with no soft-limit exception;
  - the import graph is acyclic and one-way: dispatcher to hover/state/targets/types, hover to state, targets to types,
    and facade to dispatcher/types. Internal owners do not import the facade.
- Preserved contracts: all public types, constants, factory and trust predicate retain the existing facade path. The
  extraction preserves reset omissions for hover/click/gesture history, exact pointer-before-mouse hover ordering,
  Shift sticker bypass, live target resolution while linking, whole-sticker drag pinning, JavaScript Surface focus and
  gesture ownership, pointer-before-mouse dispatch, 4/8-pixel click thresholds, 320 ms double-click timing and native
  move-relay `try/finally` cleanup.
- Source-text contracts now inspect the real dispatcher/state/target/hover/type owner rather than assuming the facade
  contains implementation. The 577-effective / 677-physical-line characterization test remained behavior-only and
  unmodified; splitting that inherited oversized test remains explicitly owned by H1-F.
- Post-move input hardening: raw native/plugin `x`, `y`, `globalX` and `globalY` values now accept only finite numbers,
  fall back from client to global coordinates and finally to zero, and keep valid negative coordinates unchanged.
  Two focused tests cover `NaN`, positive/negative infinity, fallback ordering and dispatched client/screen values.
- Independent behavior, security/resource and scope reviews found no blocking regression. Deferred H6/H7 risks are
  non-finite wheel delta validation, cross-realm DOM constructors/type checks, short-lived detached hover/click target
  retention and the remaining non-drag hover `elementFromPoint` cost; broadening those policies here would mix a
  higher-risk semantic change into the proven extraction.
- Verification after the pure move: application and test TypeScript checks passed and the identical 11-file baseline
  remained 81/81 green. Final verification passed application/test TypeScript checks plus 12 files / 83 tests,
  including the two new coordinate cases.
- Repository gates:
  - ESLint passed with zero warnings;
  - effective-line ratchet scanned 543 files at 7/13/15 for `>1500`, `701-1500` and `501-700`, reducing the
    soft-over-limit tier by one and adding no oversized file;
  - production frontend build passed with 188 transformed modules. Its 576.68 kB minified JavaScript chunk (174.92
    kB gzip) retains the existing non-fatal Vite size warning and remains later performance/code-splitting work;
  - `git diff --check` passed; all 16 H1-E4 modified/new source and test files validated as strict UTF-8 without BOM,
    with a trailing newline.
- Generated evidence: `.output` and the effective-line JSON remain covered by repository ignore rules and are not
  source-commit inputs.
- Scoped Git state after the batch: H1-E4 owns the facade plus five event owners, nine owner-aware source contracts,
  one focused coordinate regression file and this module graph/progress record; inherited changes remain intact.
- No release was built for H1-E4; Hook Phase 79 remains in progress and H1-F is next.

### 2026-08-24 - Hook Phase 79 batch H1-F: oversized test ownership

- Targets and baseline:
  - `graphImageResolution.test.ts` was 925 effective / 971 physical lines with 20 tests;
  - `stickerEditTransforms.test.ts` was 589 / 629 with 13 tests;
  - `overlaySyntheticEvents.test.ts` was 577 / 677 with 28 tests;
  - the identical three-file baseline passed before movement at 61/61 tests.
- Scope: this batch changed only Hook tests and this work-order record. It did not change production code, the effective
  line baseline/policy, Loom, a sibling project or any release path, and it retained every inherited dirty path.
- Graph resolver result: 20 tests now live in formal-boundary 161 / 174, primary-traversal 242 / 255,
  capability/parameter 133 / 140, auxiliary-image 289 / 300 and missing-port 119 / 124 files, supported by a fresh
  sticker fixture at 13 / 15. The 289-effective auxiliary contract remains cohesive and below 500; another split would
  separate one multi-image policy across artificial files without approaching a limit.
- Sticker transform result: 13 tests now live in basic frame scaling 123 / 131, effect/shape scaling 109 / 116, frame
  flipping 143 / 151, geometry transforms 180 / 196 and hit testing 50 / 55. Imports are narrowed to each behavior
  owner, and only the flip contract retains the global document stub cleanup that it uses.
- Overlay event result: 28 tests now live in core hover/click 122 / 144, drag/link capture 74 / 96, JavaScript Surface
  relay 117 / 134, Art Surface pass-through 101 / 115 and dispatch metadata/reset 97 / 117 files. The 108 / 120 shared
  harness creates fresh DOM elements, maps, closures and dispatcher state for every test; each suite clears its DOM in
  `afterEach`, and dispatcher creation installs no global listener.
- Every H1-F result is below 500 effective lines; 12 of 15 test owners are at or below 161 effective lines, while the
  three larger owners remain cohesive at 180, 242 and 289 with no soft-limit exception. The three original oversized
  files were deleted rather than retained as compatibility wrappers.
- Preserved proof:
  - after the pure move, test TypeScript and the explicit 15-file set passed at 61/61; after import cleanup the same
    gate passed again at 61/61;
  - the repository-supported four-worker full suite passed 280/280 files and 1167/1167 tests, proving default discovery
    of every split file. The default one-worker `npm test` attempt exceeded the 10-minute command budget before a
    report, so it is recorded as a timeout rather than a pass or failure; no test failure was reported, and the complete
    parallel run supplied the full-suite result.
- Repository gates:
  - application and test TypeScript checks passed; ESLint passed with zero source warnings;
  - effective-line checker tests passed 15/15, and the ratchet scanned 557 files at 7/12/13 for `>1500`, `701-1500`
    and `501-700`. Relative to H1-E4, H1-F removed one mandatory-tier and two soft-tier files without updating the
    baseline or adding an exception;
  - production frontend build passed with 188 transformed modules. Its unchanged 576.68 kB minified JavaScript chunk
    (174.92 kB gzip) retains the existing non-fatal Vite size warning;
  - `git diff --check` passed; the 15 tests, two helpers and this work-order record validated as strict UTF-8 without
    BOM and with a trailing newline.
- Independent body-count, fixture/harness and scope reviews confirmed the exact 20 + 13 + 28 test distribution, no
  duplicate test title, per-test state isolation and no blocking finding. One initial review count incorrectly mixed in
  earlier H1-A/D/E hardening tests; the reviewer corrected the scoped H1-F count to 61.
- No release was built for H1-F; Hook Phase 79 remains in progress and H2 is next.

### 2026-08-24 - Hook Phase 79 batch H2-A1 plan and pre-move baseline

- Initial target: `src/components/StickerAnnotationLayer.tsx`, whose named component and four-prop caller contract
  remain owned by the existing path. `UnitView.tsx` is the sole production caller; no default or lazy import exists.
- Behavior-preservation boundary: keep annotation order, selection state, graph-history/sync timing, pointer capture,
  transient high-frequency previews, pointer-up persistence, SVG/DOM order, data attributes and Tauri/window listener
  cleanup unchanged. H2-A1 is structural only; feature hardening follows an identical post-move proof.
- Fixed pre-move proof passed application and test TypeScript checks plus the 20-file / 85-test annotation source,
  pointer, transform, text, crop, effect, color-picker, history and placement contract set.
- Planned acyclic module graph before extraction:
  - `stickerAnnotationTransformController.ts` owns transform interaction state shapes plus pure move/rotate/scale,
    line-reshape and box-resize preview composition. It depends only on sticker editing types and geometry services;
  - `StickerAnnotationLayer.tsx` remains the composition owner, passes current annotations and modifier state into the
    pure transform owner, and retains signals, persistence, pointer routing and rendering during this sub-batch;
  - later H2-A owners will extract persistence/history, text-session lifecycle, crop/eraser sessions and pointer/tool
    routing without importing the component facade. H2-B render owners will depend on controller data rather than the
    controller importing renderers, preventing a controller/view cycle.
- The current 19 source-text contract files will be redirected only when their asserted implementation moves. Facade
  placement/import contracts continue to inspect `StickerAnnotationLayer.tsx`; tests will not be weakened by merely
  concatenating every source file.
- Scope is Hook source, Hook tests and this work-order record only. Loom, siblings, parent-repository files and release
  paths are excluded, and every inherited dirty path must remain intact.

### 2026-08-24 - Hook Phase 79 batch H2-A/B: annotation controller and render ownership

- Target and baseline: `src/components/StickerAnnotationLayer.tsx` started at 2,538 effective / 2,732 physical lines.
  The composition facade is now 465 / 485, and every extracted annotation controller, renderer, overlay and helper is
  below the 500-line acceptable limit.
- Ownership result: persistence/history, pointer down/commit/runtime, transforms, wheel handling, lifecycle, erase,
  text entry, numeric safety, view models, element renderers and draft/selection overlays now have named owners. The
  facade retains composition, public props and event ordering; source-text contracts follow the exact implementation
  owner instead of concatenating unrelated files.
- Post-split hardening: non-finite geometry is rejected at the numeric boundary; pointer-release commits are
  single-flight; wheel commits are serialized; pointer runtime and desktop color-picker overlay listeners are disposed;
  and color payloads are validated before they enter annotation styles.
- Fresh proof after the completed move: the broad annotation/color/effect/shape set passed 24 files / 84 tests. The
  application and test TypeScript checks, lint and production frontend build also pass as part of the H2-C1 gate below.
- Independent read-only review found no public-contract loss, render-order regression, leaked pointer listener or
  remaining annotation file above 500 effective lines.
- No release was built for H2-A/B; Hook Phase 79 remains in progress.

### 2026-08-24 - Hook Phase 79 batch H2-C1: JavaScript Surface and UnitView ownership

- Targets and baseline: `src/components/JavaScriptSurface.tsx` started at 838 effective / 902 physical lines and is now
  495 / 521, with 393 / 429 contracts and 57 / 63 geometry owners. `src/components/UnitView.tsx` started at 1,518 /
  1,672 and is now 420 / 469; its native-drag, port-registry, image-model, Surface controller and visual leaf owners are
  all below 500 effective lines.
- The 692 / 718 classic bootstrap remains a registered cohesive 501-700 exception: CSP sandbox bootstrap state,
  runtime protocol ordering and teardown share one closure, so splitting it would add a cross-module security boundary.
  Base64 entry budgets, token validation, serialized messages, observer/listener cleanup and object-URL revocation remain
  mandatory ratchets for that exception.
- Post-split hardening: UnitView uses a reactive element accessor; delayed port RAF/timer work is canceled and stale DOM
  geometry is rejected; native preflight calls are serialized; browser drag Blob URLs are revoked on drag end, timeout
  or disposal; local paths reject control characters and encode URI path segments; async drag, file fallback, Surface
  resource/attach and Surface-event failures verify current unit/generation ownership before mutation; and malformed OCR
  geometry or colors are excluded from inline styles.
- Regression proof: the H2-C set passed 41 files / 205 tests, including new runtime tests for native preflight/Blob
  cleanup, stale drag cache writes, file fallback disposal/path changes, Surface attach/resource generations, port timer
  cleanup and pure OCR/file-URL validation. The application TypeScript check, test TypeScript check and zero-warning lint
  passed. The production frontend build passed with 216 transformed modules; the existing 596.03 kB minified chunk
  warning remains non-fatal and joins later performance ownership work.
- Effective-line proof: lexer tests passed 15/15; ratchet mode scanned 594 files with no violations and tiers
  `>1500=5`, `701-1500=11`, `501-700=13`. Strict mode now excludes UnitView and all new H2 owners; it still fails on
  the documented remaining queue, including the H2-C `ShaderPreviewRuntime` test, top-strip/property/params families,
  H3 application/styles and later native phases.
- Two independent read-only audits found no high-confidence behavior regression or new high/medium security/leak issue
  across source priority, crop/minified geometry, Surface/shader lifecycle, drag paths, z-order and port ownership.
- No release was built for H2-C1; remaining H2-C families are next and Hook Phase 79 remains in progress.

### 2026-08-24 - Hook Phase 79 batch H2-C2: UnitParamsPanel ownership and lifecycle hardening

- Target and baseline: `src/components/UnitParamsPanel.tsx` started at 1,014 effective / 1,139 physical lines and is now
  380 / 428. Candidate results are 196 / 210, expanded execution settings 263 / 275, port rows and bounded uploads
  309 / 327, the grouped scroll region 276 / 300, the deferred port-registry controller 58 / 66 and the bounded
  candidate fingerprint helper 34 / 38. Every owner is below the 500-line acceptable limit; no cohesion exception is
  required.
- Ownership result: the facade retains public props, effective parameter values, text editing, panel geometry and render
  order. Candidate fallback/selection, input/output rows, grouped scrolling, expanded execution/sticker controls and
  deferred port measurement now have explicit owners. Source-text contracts follow the exact owner rather than being
  weakened after extraction.
- Post-split hardening: candidate fallback reads verify candidate generation, unit, index and cache path before mutation;
  the candidate fingerprint is fixed-size instead of duplicating data URLs; inline uploads accept only the established
  raster formats, reject empty or over-32-MiB files, validate decoded dimensions and pixels, abort replaced readers and
  ignore work after disposal; image-ratio resize rejects stale source/geometry callbacks while preserving the required
  delayed layout tick; scroll state uses a 512-entry recent-unit bound; and all port/scroll/settings RAFs, timers,
  observers and retained DOM registrations are canceled or released at their lifecycle boundary.
- Regression proof: the focused UnitParams set passed 15 files / 58 tests, including new stale candidate-path/disposal,
  upload type/size/latest-selection/disposal, image-resize source/geometry/layout/disposal, scroll RAF/bounded-registry and
  port registration replacement/settlement/disposal tests. Application and test TypeScript checks and zero-warning lint
  passed. The production frontend build passed with 222 transformed modules; the existing non-fatal chunk warning remains
  at 598.71 kB minified / 181.35 kB gzip and stays in later performance ownership work.
- Effective-line proof: lexer tests passed 15/15; ratchet mode scanned 605 files with no violations and tiers
  `>1500=5`, `701-1500=10`, `501-700=13`. UnitParamsPanel left the mandatory tier, reducing that tier by one while the
  hard and soft tiers remained unchanged. Strict mode now fails only on the 15 documented remaining files; no
  UnitParams facade, owner, helper or new test appears in that queue.
- Independent read-only audits found and drove fixes for a lost post-resize layout tick and completed port registrations
  retaining DOM elements. Final review confirmed current-request layout behavior, stale/disposal guards and settled port
  release; no remaining high/medium-confidence H2-C2 regression or lifecycle issue was found.
- No release was built for H2-C2; StickerTopStrip/property and ShaderPreview families remain in H2-C, so Hook Phase 79 is
  still in progress.

### 2026-08-24 - Hook Phase 79 batch H2-C3: top-strip, property and Shader preview ownership

- Targets and baselines: `StickerTopStrip.tsx` started at 1,011 effective / 1,073 physical lines and is now 496 / 548;
  `StickerTopStripPropertyBar.tsx` started at 853 / 920 and is now 396 / 419; `ShaderPreview.tsx` started at 568 / 624
  and is now 457 / 495. The 1,134 / 1,345 `ShaderPreviewRuntime.test.tsx` monolith was removed after all 18 original test
  cases were preserved in six focused runtime files, each between 139 and 292 effective lines. Every H2-C3 source and
  test owner is below the 500-line acceptable limit, so no 501-700 cohesion exception is required.
- Top-strip ownership: create tools are 379 / 389, edit actions 221 / 230, Surface view 96 / 101 and shared chrome 20 /
  22. Property crop, selection and dropdown controllers are 185 / 204, 176 / 193 and 202 / 224; numeric policy is 13 /
  14, while the field and section render owners remain 393 / 422 and 424 / 438. The facades retain public props,
  composition and mutation ordering; source contracts now verify the parent-to-owner call chain rather than old
  single-file text locations.
- Top-strip hardening: history/rasterize actions are single-flight and surface failures; crop/raster operations verify
  captured unit/source/edit generations before committing; flip captures exact history before asynchronous mutation;
  installed-font discovery deduplicates concurrent requests and retries failures; menu registry IDs and RAF/listener
  lifetimes are captured and released; and background workflow/rectangle sync rejections are reported without undoing a
  successful local edit or becoming unhandled promises.
- Shader ownership: the render/export scheduler is 176 / 198, image policy 29 / 35 and `ShaderRenderer.ts` 349 / 466.
  The facade keeps renderer/context/prefetch/parameter/fallback/layout composition while the controller owns RAF
  coalescing, latest-only single-flight PNG publication and a 5-second stuck-export watchdog. The image policy admits
  only supported raster data URLs and established browser/Tauri image sources, converts desktop paths only in Tauri,
  and enforces an 8,192-pixel dimension plus 32-Mi-pixel allocation budget for textures, fallback dimensions and PNG
  export.
- Shader hardening additionally rejects stale or disposed file-fallback recovery, excessive or stale replacement
  textures, exhausted sampler units, null texture/VAO/VBO allocations, missing `a_position`, thrown/errored texture
  uploads and post-disposal texture callbacks. Rejected replacement textures are deleted so an older image cannot be
  reported as the newly loaded source. HTTPS/blob/asset image sources remain supported product inputs; browser CORS and
  the configured Tauri asset scope remain their authority boundaries rather than an incompatible host-only list.
- Fresh regression proof: the complete Shader contract/runtime set passed 15 files / 56 tests. The broad top-strip,
  property, Art shortcut, drag/synthetic relay, style, history, rasterize and minified Shader set passed 36 files / 138
  tests after two stale monolith-source assertions were redirected to their exact new owners. Application and test
  TypeScript checks and zero-warning source lint passed. The production frontend build passed with 236 transformed
  modules; the existing non-fatal bundle warning is now 605.06 kB minified / 183.30 kB gzip and remains H3/H6 debt.
- Effective-line proof: lexer tests passed 15/15; ratchet mode scanned 633 files with no violations and tiers
  `>1500=5`, `701-1500=7`, `501-700=12`. Relative to H2-C2, three top-strip/property/test files left the mandatory tier
  and ShaderPreview left the soft tier. Strict mode fails only on the 12 documented remaining H3/native/script files;
  no H2-C3 facade, owner, helper or test appears in that queue.
- Independent read-only behavior review found no high/medium split regression and confirmed all 18 original Shader
  runtime cases plus new regressions. Security/resource review findings for sampler limits, GL allocation/upload failure,
  oversized fallback retention and stuck export completion were implemented and regression-tested; no known H2-C3
  high/medium issue remains.
- No release was built for H2-C3. H2-C is complete, but Hook Phase 79 continues with H3; Loom and sibling repositories
  and the shared release root remain untouched.

### 2026-08-24 - Hook Phase 79 batch H3: application, capture and stylesheet ownership

- Targets and baselines: `src/app.tsx` started at 2,121 effective / 2,398 physical lines and is now 491 / 541;
  `src/hooks/useSelection.ts` started at 1,065 / 1,187 and is now 438 / 514; `src/app.css` started at 968 / 1,190
  and is now an 8 / 9 ordered entry sheet. Every new H3 source owner is at or below the 500-line acceptable limit, so
  no H3 cohesion exception is required.
- Application ownership: listener registry/setup, surface/pointer/command/Art control events, startup lifecycle, Art
  delivery/workflow, native actions, Tea tickets, sticker editing, canvas interactions and shortcut composition now have
  explicit owners. `app.tsx` retains dependency assembly and application composition. The listener registry proves
  reverse-order cleanup after partial registration failure, late disposal, repeated disposal and exactly-once cleanup in
  five direct tests.
- Capture ownership: automatic long capture is 489 / 519, capture-unit materialization 88 / 98 and precise-selection
  resolution 106 / 118. Automatic finish is single-flight, a new start waits for pending teardown, cleanup cannot reset a
  newer session and capture-input failures are observed. Precise selection rejects stale in-flight responses and invalid
  session/DPR state. Six direct controller/background-task regressions plus the existing nine-file capture contract set
  passed; the latter retained all 50 tests.
- Stylesheet ownership: the entry sheet imports theme foundation, terminal primitives, feature surfaces, unit workspace,
  settings dialog and parameter controls in their original cascade order. These owners are respectively 171, 220, 233,
  110, 170 and 62 effective lines. A byte-derived rule/order comparison after comment and whitespace removal matched the
  pre-split sheet exactly (24,747 characters on each side), including duplicate override selectors, `:where` specificity
  and `!important` rules. The eight owner-aware CSS contract files passed all 36 tests.
- Post-split hardening: detached application commands now use a rejection-observing background-task boundary whose logs
  expose only the rejection category, not a potentially sensitive message. The startup capability handshake now runs in
  standalone profiles instead of being incorrectly suppressed by the static boot flag, while failure still degrades to
  standalone mode. Source-text contracts were redirected to exact owners without dropping their ordering, normalization,
  drag, export, propagation, scalar-output or reconnect assertions.
- Fresh regression proof: the 10 formerly stale integration contracts plus the Loom startup unit test passed 11 files /
  48 tests. The complete parallel Vitest gate passed 312 files / 1,254 tests. Application and test TypeScript checks and
  zero-warning source lint passed. The JavaScript Surface browser smoke passed in Chromium 149, including the expected
  timer, DOM-node, CPU and memory budget rejection scenarios.
- Build and line proof: lexer tests passed 15/15; ratchet mode scanned 660 files with no violations and tiers
  `>1500=4`, `701-1500=5`, `501-700=12`. The production frontend build passed with 253 transformed modules; CSS is
  69.29 kB minified / 12.38 kB gzip and JavaScript is 612.44 kB / 183.31 kB gzip. The existing non-fatal JavaScript chunk
  warning remains explicit H6 performance debt.
- Audit limits: no confirmed H3 path escape, retained-listener leak or stale-session overwrite remains. The frontend
  automatic-long-capture fallback can still retain an unbounded frame list if backend session ownership fails and is
  carried into H5 resource work; high-frequency pointer relay remains dependent on existing native coalescing because no
  measured regression justified a behavior-changing throttle. Detached work outside the H3 orchestration paths was not
  globally rewritten.
- No release was built for H3. Hook Phase 79 continues with H4 screenshot backend work; Loom, sibling repositories and
  the shared release root remain untouched.

### 2026-08-24 - Hook Phase 79 batch H4: screenshot backend ownership and hardening

- Baseline and facade: `src-tauri/src/screenshot.rs` started at 2,044 effective / 2,336 physical lines and is now
  474 / 524. The facade retains the public capture profile/models and exact `screenshot::...` re-exports; no compatibility
  shim or line-limit exception was added.
- Owner map: pixel conversion/BT.2020 PQ encoding is 241 / 267, display/target selection 253 / 275, output dispatch and
  error mapping 191 / 205, SDR/GDI fallback 159 / 184, scRGB/HDR analysis and metadata 116 / 131, Windows HDR display
  probing 168 / 177, WGC frame policy 183 / 211 and WGC session ownership 455 / 506. Every H4 file is at or below the
  500-effective-line acceptable limit.
- Behavior preservation: public capture signatures and `HdrPqImage` remain at their existing facade paths. HDR capture
  still requires StandardRegion, Windows 11 and an HDR-enabled selected display; LongCapture remains SDR. Dispatch order
  remains transient HDR, then SDR WGC, then GDI, with the existing downgrade and overlay-compensation metadata. WGC
  transient sessions retain `start -> receive/timeout -> stop`, while the COM capturer remains thread-local.
- Security/resource hardening: GDI crop offsets, dimensions and origin additions are now checked before crossing the
  Win32 FFI boundary, rejecting narrowing, subtraction and addition overflow. Zero-sized WGC frames return an empty crop
  instead of indexing a nonexistent pixel. Opt-in persistent WGC is bounded to one blocking worker per process; other
  workers use transient capture, preventing one retained full-screen frame pool per blocking-pool thread.
- Performance hardening: GDI converts directly from the live DIB mapping into the RGB result and no longer copies a full
  4-byte-per-pixel intermediate buffer. WGC video-hole heuristics sample a clamped crop view in place rather than
  materializing a complete temporary crop; an equivalence regression proves the sampled decision matches the prior
  materialized-crop behavior.
- Fresh proof: all screenshot owner tests passed 28/28, capture integration tests passed 45/45 and the complete Rust gate
  passed 289 tests with one pre-existing ignored test. The first complete run observed one unrelated Windows access-denied
  failure in `app_settings::tests::concurrent_corrupt_backups_allocate_distinct_files_without_errors`; the isolated test
  then passed three consecutive runs and the immediate complete rerun passed, so no unrelated settings code was changed.
  HDR/dead-code source contracts passed 2 files / 6 tests, Rust formatting and scoped diff checks passed, and the effective
  line analyzer passed 15/15.
- Line proof: ratchet mode scanned 668 files with no violations and tiers `>1500=3`, `701-1500=5`, `501-700=12`.
  Relative to H3, `screenshot.rs` left the hard-cap tier without creating any H4 soft-tier file.
- No release was built for H4. Hook Phase 79 continues with H5 long-capture work; Loom, sibling repositories and the
  shared release root remain untouched.

### 2026-08-24 - Hook Phase 79 batch H5: long-capture ownership and bounded resources

- Baseline and facade: `src-tauri/src/long_capture.rs` started at 5,611 effective / 6,144 physical lines and is now
  49 / 56. The facade uses documented responsibility-named lexical owners so the dense private overlap/signature graph
  did not require artificial public visibility. Public long-capture models, analysis/stitch entry points, capture entry
  point and incremental stitcher remain at their existing module paths.
- Owner map: target/focus discovery is 242 / 267, shared resource policy 124 / 135, analysis foundation 303 / 346,
  fixed-chrome candidates 436 / 464, pixel scoring 365 / 402, directional analysis 395 / 418, pair API 127 / 134,
  aggregate composition 334 / 356, motion signatures 408 / 433, signature matching 432 / 470, adjacent matching
  267 / 277, aggregate search 259 / 273, aggregate merge 293 / 329, batch stitching 263 / 279 and capture loop
  140 / 145. Test owners range from 50 to 328 effective lines. Every H5 source and test owner is below 500 effective
  lines; no soft-limit exception was created.
- Behavior preservation: LongCapture remains SDR and the existing axis, direction, fixed-chrome, reverse-scroll,
  duplicate, target/focus and tolerant-skip semantics remain covered. Source-text contracts now resolve the compiled
  `include!` owners instead of treating the facade as a monolith. The native session still uses its existing infallible
  flatten adapter; push-time invariants bound every multi-segment aggregate, and an unexpected invariant failure now
  logs a terminal category and returns an empty image instead of panicking. H7 will propagate the internal fallible
  flatten result after the oversized crate root is split, rather than modifying that owner early.
- Security and resource hardening: caller-controlled data URLs are rejected before large Base64 allocation, decoded
  through `image::ImageReader` with strict dimension limits and a decoder allocation budget, then checked again before
  RGB conversion.
  Shared budgets cap frames at 512, one frame at 32,768 pixels per axis / 64 MiPixels, resident batch inputs and output
  images at 128 MiPixels, encoded image bytes at 64 MiB and the output axis at 131,072 pixels. Direct scroll capture
  validates non-zero dimensions, projected resident pixels, checked center coordinates, a 10-second per-step settle
  ceiling and a five-minute total settle ceiling before taking a screenshot.
- Arithmetic hardening: crop coordinates use checked `i64` to `u32` conversion and checked ends; segment axis totals,
  image dimensions, output cursors, signature-list lengths, origins and capture projections reject overflow before
  allocation or image operations. Signature vector capacity uses checked arithmetic and fallible reservation.
- Performance hardening: analysis-driven stitching now stores prepend/append segments and flattens once instead of
  reallocating and copying the complete output for every frame. Fixed-chrome matching uses binary range selection over
  sorted signature positions before evaluating candidates, preserving thresholds and tie-breaking while avoiding scans
  of impossible positions. Vertical composition preallocates overlap metadata; deeper signature representation changes
  were deliberately deferred because they would alter shared candidate ownership without measured evidence.
- Fresh proof: targeted long-capture Rust tests passed 52/52; all 42 baseline tests remain active after restoring seven
  split-boundary attributes, and ten resource / arithmetic regressions were added. The complete Rust gate passed 299
  tests with one pre-existing real-daemon test ignored. The exact LongCapture, LongCaptureSession,
  CaptureWindowStability and CaptureWindowTarget contracts passed 4 files /
  26 tests. Rust formatting passed and the effective-line ratchet scanned 690 files with tiers `>1500=2`,
  `701-1500=5`, `501-700=12`; relative to H4, long capture left the hard-cap tier without creating soft-tier debt.
- No release was built for H5. Hook Phase 79 continues with H6 Hook-owned Loom protocol integration; Loom, sibling
  repositories and the shared release root remain untouched.

### H6 completion evidence - Hook-owned Loom protocol integration

- Scope and baseline: Loom remained read-only and no sibling repository was inspected or modified. The Hook-owned
  `src-tauri/src/loom_hook.rs` baseline was 3,442 effective / 3,672 physical lines. Its focused Rust boundary passed
  27 tests and the nine direct source contracts passed 36 tests before extraction.
- Structural result: the old file is now a 40-effective / 45-physical-line lexical facade over responsibility-named
  owners for protocol models, diagnostics/state, formal delivery, Art transport, settings, local/remote listeners,
  handshake, action dispatch, Surface event/attachment/control/resource transfer, input paths and shader handling.
  Tests are separately owned by delivery, hardening, input-image, routing and stream fragments. The largest result is
  `art_transport.rs` at 463 effective / 467 physical lines; `action_dispatch.rs` is 426 / 436 and every other H6
  production or test owner is below 300 effective lines. All 23 facade/owner/test files are at or below 500 effective
  lines, so H6 needs no 501-700 exception.
- Source-contract preservation: `__tests__/helpers/loomHookRustSources.ts` resolves only the facade's compiled
  `include!` graph. The nine contracts that previously treated the monolith as one text file now inspect the same
  compiled owner graph without weakening their assertions. Exact command names, serde casing, `loom.hook.v1`,
  `loom.surface.v1`, event names and existing local path/file/asset URL behavior remain unchanged.
- Image and resident-memory gates: Art inputs are capped at 32 sources, bounded encoded/source totals and 256 MiB of
  decoded RGBA data per execution. Encoded images are rejected before Base64 allocation, decoded through
  `ImageReader` with 32,768-axis / 64-MiPixel / 256-MiB allocation limits, and dimension/payload equality is checked
  before shared-memory copy or PNG fallback. Formal shared-memory output now requires `size == width * height * 4`
  within the same bounds; inline formal output is limited to safe raster MIME types and 64 MiB of decoded data.
- Transport and protocol gates: leased Surface resources retain exact SHA-256 id/path, MIME, size and expiry checks,
  are streamed under a 16-MiB cap even without a trustworthy `Content-Length`, re-check lease validity after I/O, and
  verify the actual shared-memory mapping length before its unsafe slice is read. Surface JSON responses are streamed
  under 8 MiB; request JSON is measured with a non-allocating bounded writer before network dispatch. Instance ids are
  validated and encoded as URL path segments. WebSocket control, shader, listener and Art response frames now have
  channel-appropriate hard limits before JSON parsing; stream envelopes cap message count and per-message size.
- Concurrency, diagnostics and performance: blocking Art execution has two bounded worker slots and short control
  operations have an independent eight-slot pool, so action floods cannot create unbounded operating-system threads
  and long Art work cannot consume every control slot. Handshakes are single-flight, validate request identity,
  negotiated transport, response size, list counts and required identity fields. Connection-state events are emitted
  only on real transitions, removing the remote poller's repeated idle true/false event traffic. Remote response
  bodies, URLs, filesystem paths, secrets and control characters are no longer copied verbatim into Art payloads,
  Surface command errors or runtime diagnostics.
- Intentional compatibility/lifetime dispositions: the single claimed listener remains process-owned for the Tauri
  state lifetime; adding a second shutdown protocol without an existing restart owner would expand behavior rather
  than fix an accumulating per-action leak. `loom.hook.art.resources.release` remains unwired until the frontend
  consumer's shared-memory lifetime can be propagated through the H7 command-adapter split; releasing immediately
  after emit could invalidate a buffer before it is read. Generic Surface MIME remains accepted because the existing
  JavaScript Surface contract intentionally consumes `application/javascript` through a strict consumer-side parser;
  the formal Art image path is independently allowlisted. Existing local file/asset URL behavior is preserved because
  it is part of the characterized Tauri asset contract; H7-B owns the broader native path/cache authority review.
- Fresh focused proof: default-feature and no-default-feature Loom Hook Rust boundaries each passed 37 tests (the 27
  baseline tests plus ten resource, protocol, concurrency and diagnostic regressions). The nine exact frontend source
  contracts passed 9 files / 36 tests. Rust formatting passed.
- Fresh broad proof: the complete Rust gate passed 309 tests with one pre-existing real-daemon test ignored. Application
  and test TypeScript checks, zero-warning source lint and the production frontend build all passed. Vite transformed
  253 modules and produced 69.29 kB CSS (12.38 kB gzip) plus 612.44 kB JavaScript (183.31 kB gzip). The existing
  non-fatal single-chunk warning is byte-for-byte unchanged from the H3 evidence and remains an application-level H8
  performance/code-splitting decision rather than an H6 native transport regression.
- Effective-line proof: ratchet mode scanned 713 files with no violations and tiers `>1500=1`, `701-1500=5`,
  `501-700=12`. Relative to H5, `loom_hook.rs` left the hard-cap tier and no new soft-tier file was created.
- No release was built for H6. Hook Phase 79 continues with H7 native crate-root extraction; Loom, sibling repositories
  and the shared release root remain untouched.

### 2026-08-24 - Hook Phase 79 batch H7: native crate-root ownership and command hardening

- Baseline and facade: after the preceding H6 extraction, `src-tauri/src/lib.rs` was still 10,752 effective / 11,826
  physical lines. It is now a 214-effective / 297-physical-line composition facade. Private native implementation and
  crate-root tests moved into responsibility-named lexical owners without widening visibility, renaming Tauri commands
  or changing command registration order.
- Owner map: `src-tauri/src/native` now contains 67 production owners and 12 test owners. Production responsibilities
  cover session persistence/assets, drag export, clipboard/cache, image input, remote-image caching, long-capture
  sessions, mouse/keyboard routing, overlay/window policy, voice entry, app setup/runtime and the remaining command
  families. The largest result is `native/tests/input_lifecycle_early.rs` at 439 effective / 470 physical lines;
  `input_lifecycle_queue.rs` is 433 / 459 and the largest production owner is `capture_input_state.rs` at 393 / 432.
  Every H7 facade, production owner and test owner is below 500 effective lines, so H7 creates no soft-limit exception.
- Contract preservation: source-text contracts for settings and file naming use the repository's recursive
  `hookLibRustSources` helper so they inspect the compiled `include!` graph instead of silently testing only the facade.
  A non-test `cargo check --lib` also caught and prevented an extraction-time `#[cfg(test)]` boundary from hiding the
  production image encoder. Existing command names, serde shapes, startup composition and input/capture behavior remain
  covered by the crate and frontend contracts.
- Session/settings durability: a stale expected session revision is rejected before any image asset is created. Content-
  addressed image assets use exclusive creation, complete writes and `sync_all`, with partial-file cleanup and the
  existing process/file lease. History and tool settings now share bounded 8-MiB reads, serialized I/O and unique-temp
  atomic replacement; malformed JSON returns a corruption error rather than silently becoming default empty state.
- Image/network hardening: local/remote/clipboard images are bounded at 64 MiB encoded and 256 MiB decoded RGBA, with
  checked dimensions and exact RGBA layout before allocation/copy. Remote image URLs reject credentials and non-public
  IPv4/IPv6 destinations (including mapped IPv4), resolve before dispatch, disable redirects, pin the direct host,
  stream under a hard byte limit and keep URL/query/error details out of runtime logs. The PowerShell fallback also uses
  header-first streaming, disabled redirects and the same limit. A configured external proxy can still perform its own
  DNS resolution; redirects remain disabled and prevalidation is retained, but proxy-side DNS pinning is a documented
  residual rather than being claimed as solved.
- Drag/cache and diagnostics hardening: clipboard RGBA dimensions and payload equality are validated before ownership is
  taken. Native drag staging and path-based drag export inspect regular-file metadata and enforce the same 64-MiB limit
  again on the actual stream, removing partial targets on failure. Local-image and drag-export diagnostics now record
  only a file name/category rather than full user paths. Remaining input-hook lock granularity and explicit Windows hook-
  thread shutdown are H8 performance/lifecycle review items; no unmeasured thread-model rewrite was mixed into H7.
- Fresh proof: Rust formatting and `cargo check --lib` passed; the complete library gate passed 282 tests. The exact
  AppSettings, HookPublicIdentity, CacheSettingsFileLifetime and FileNaming frontend contracts passed 4 files / 12 tests.
  Test TypeScript checking, zero-warning source lint, production frontend build and `git diff --check` passed. Vite again
  transformed 253 modules and produced 69.29 kB CSS (12.38 kB gzip) plus 612.44 kB JavaScript (183.31 kB gzip); the
  existing non-fatal 500-kB chunk warning remains an H8 application-level performance decision.
- Effective-line proof: analyzer tests passed 15/15 and ratchet mode scanned 793 files with no violations at tiers
  `>1500=0`, `701-1500=5`, `501-700=12`. H7 removes the final hard-cap violation. The live H8 queue is therefore the
  remaining five mandatory-tier and twelve soft-tier files; the prior smaller estimate that counted only native soft-tier
  files is superseded by this repository-wide report.
- No release was built for H7. Hook Phase 79 continues with H8 final oversized-owner closure; Loom, sibling repositories
  and the shared release root remain untouched.

### 2026-08-24 - Hook Phase 79 batch H8: final oversized-owner and acceptance closure

- Queue closure: H8 started from the H7 repository-wide queue of five mandatory-tier and twelve soft-tier files. The
  fresh strict report now scans 849 files at tiers `>1500=0`, `701-1500=0`, `501-700=1`, with no violations and no
  warnings. Therefore no code file remains that requires another split under the Phase 79 policy.
- Owner closure: the final queue covered the locally maintained `scap-targets` and `scap-direct3d` crates, Rust connector
  contracts, oversized Vitest scenarios, native-candidate and Tea real-runtime PowerShell harnesses, JavaScript Surface
  smoke tooling, selection/color/shader/voice/device owners and `syncService`. The last extraction batch moved backend
  rectangle scheduling, device identity/pairing/session attempts, Direct3D settings/frame/staging/capture work, homepage
  asset construction and Surface browser scenarios into responsibility-named owners. Entrypoints remain thin facades and
  every extracted owner is at or below 500 effective lines.
- Sole soft-limit exception: `public/javascript-surface-bootstrap.js` is 692 effective / 718 physical lines at source hash
  `c6b3b69e72e556d1dd1180dd045256013f93df32f4d998fc071a1dec690dac5a`. It remains one CSP-pinned classic-script
  lifecycle for opaque-origin sandbox policy, host protocol, gesture relay, budgets, entry loading and deterministic
  teardown. Splitting it would add cross-script globals or a module-loader boundary inside the sandbox and increase
  initialization/teardown race risk. The checked exception expires for review on 2026-09-23 and may not grow above 700.
- Device-session hardening: identity files are bounded, use unique flushed/synced temporary files and atomic replacement,
  retain the process lock and Unix `0600` mode, and redact private keys and tokens from `Debug`. The session cache prunes
  expiry, is bounded to 64 entries and evicts the earliest expiry. Device HTTP responses stream under a 256-KiB limit.
  Windows identity material remains stored under the existing application-data authority; a DPAPI migration was not
  mixed into this structural task and remains an explicit residual security decision.
- Direct3D hardening: capture settings validate item size and positive in-bounds two-dimensional crop geometry. Mapped
  frames validate pointers, row pitch and checked allocation arithmetic under a 512-MiB cap. The three-entry staging pool
  is lease-aware and recovers a poisoned mutex, so a mapped buffer is not reused while a consumer still owns it. Frame and
  item handlers are unregistered on teardown and partial registration is cleaned up without setter/device/context panics.
- Script and browser hardening: homepage capture propagates native Node/Python exit codes, detects early Hook exit, checks
  critical Win32 bounds/move/cursor errors and caps bitmap dimensions/pixels. Surface browser scenarios bound messages and
  recorded events, time out fetches and frame loads, release ports/handlers/modifier keys in `finally`, and reject unknown
  scenario filters rather than reporting a false pass. PowerShell 5.1 AST parsing and real owner-level smoke execution
  covered the split homepage modules and exact PNG/PNG/GIF output contract.
- Contract migration: source-text tests now read the existing recursive `hookLibRustSources` compiled `include!` graph,
  explicit Loom connector owners and split PowerShell harness owners. The original failure set passed 45 files / 187
  tests after migration; assertions still check the real behavior markers and no implementation was moved back into a
  facade merely to satisfy a lexical contract.
- Fresh frontend proof: version metadata, dependency licenses, zero-warning source lint, application and test TypeScript
  checks, the 15 effective-line analyzer tests and strict line gate all passed. Serial and four-worker Vitest gates each
  passed 314 files / 1,259 tests. Runtime performance passed 3/3, and the seven-scenario Surface browser report passed its
  healthy, stray-message, pointer-routing and four expected budget-failure contracts.
- Fresh native/build proof: Rust formatting passed. The complete Rust CI script passed the 294-test main suite plus
  14-, 11-, 1-, 2- and 4-test target suites with zero failures; one configured real-environment test remained ignored.
  The production build transformed 256 modules and produced 70.25 kB CSS (12.55 kB gzip) plus 613.70 kB JavaScript
  (183.73 kB gzip). The non-fatal 500-kB single-chunk warning remains an application bundle/code-splitting risk; it is not
  a source-file line-policy violation and was not hidden by raising the warning threshold. `git diff --check` passed.
- No release was built for H8. Phase 79 source and test closure is complete inside Hook only; Loom, sibling repositories
  and the shared release root remain untouched. Any release build still requires explicit user authorization.
