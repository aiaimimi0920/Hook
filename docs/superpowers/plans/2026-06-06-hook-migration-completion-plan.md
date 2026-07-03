# Hook Migration Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Historical naming note: this plan was written before the standalone voice
> project was renamed from `HookLess` to `Talk`. Any old voice-reference source
> path now maps to `C:\Users\Public\nas_home\AI\GameEditor\Neuro\Talk`.

**Goal:** Complete the remaining `Neuro/Hook` migration gaps by bringing over the still-missing ArtHook/HookLess behavior contracts without modifying the source/reference repositories.

**Architecture:** Treat `C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook` as the only writable target. Use `Z:\project\project\ArtNexus-GitHub\ArtHook` as the clean ArtHook behavior reference and `C:\Users\Public\nas_home\AI\GameEditor\Neuro\Talk` as the voice/config reference. Drive each batch with contract tests copied into `Hook`, verify RED first, apply only targeted implementation changes, then run focused tests plus type/Rust checks.

**Tech Stack:** SolidJS/TypeScript, Vitest, Tauri/Rust, PowerShell, ArtLoom/AHRP bridge, HookLess voice modules.

## 2026-06-07 status note

This implementation plan is now a historical source plan. The Hook migration
contracts, HookLess voice safety defaults, guarded real-app smokes, Hook -> Tea
real-daemon smoke, browser-preview Hook -> Tea UI smoke, and native
Tauri/WebView Hook -> Tea UI smoke have all been recorded in the migration
audits below. Do not treat the unchecked boxes in the detailed task body as the
current open backlog without first checking those audits.

Current canonical evidence:

- `Hook/docs/migration/hook-migration-completion-audit.md`
- `Hook/docs/migration/hook-real-smoke-audit.md`
- `scripts/smoke-hook-tea-real.ps1`
- `scripts/smoke-hook-tea-ui-real.ps1`
- `scripts/smoke-hook-tea-tauri-ui-real.ps1`

---

## Scope and hard constraints

### Writable target

- `C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook`

### Read-only references

- `Z:\project\project\ArtNexus-GitHub\ArtHook`
- `C:\Users\Public\nas_home\AI\GameEditor\Neuro\Talk`

### Do not touch

- `Gateway/scripts/probe-aistudio-live-request.mjs` has unrelated dirty changes.
- `.tmp/` is unrelated untracked workspace content.
- Do not edit, delete, reset, or reformat source/reference repos.
- Do not perform global branding replacement. `ArtLoom`, `AHRP`, protocol names, release script names, and compatibility labels may be deliberate integration terms.

### Required execution style

1. For each batch, copy or create the contract test first.
2. Run the batch test and verify it fails for the expected missing behavior.
3. Implement the minimal targeted migration in `Hook`.
4. Re-read changed files before testing.
5. Run the batch test again.
6. Run `npm run typecheck` after every frontend batch.
7. Run Rust formatting/compile-oriented checks after every Rust batch.
8. Preserve existing Hook-specific voice, capture, sticker, and local MVP behavior.

---

## Current evidence snapshot

Run from:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro'
```

Current target-only/new Hook migration changes already present or in progress:

```text
Hook/src-tauri/src/cli_engine.rs
Hook/src-tauri/src/lib.rs
Hook/src-tauri/src/mock_artloom.rs
Hook/src/app.tsx
Hook/src/components/UnitView.tsx
Hook/__tests__/integration/AhrpCloudOutputContract.test.ts
Hook/__tests__/integration/ArtNodePropagationContract.test.ts
Hook/__tests__/integration/ArtNodeSpawnSizingContract.test.ts
Hook/__tests__/integration/ArtScalarOutputContract.test.ts
Hook/__tests__/integration/LinkPropagationContract.test.ts
Hook/__tests__/integration/McpBoundaryContract.test.ts
Hook/__tests__/integration/ProcessNoWindowContract.test.ts
Hook/src-tauri/src/process_utils.rs
```

Previously completed and verified migration items:

- Windows no-window process wrapper through `src-tauri/src/process_utils.rs`.
- Direct MCP spawn command removed from Tauri command surface.
- Art delivery errors and scalar outputs handled in frontend delivery path.
- `UnitView` displays execution failure/error message.
- AHRP cloud output base64/error handling migrated into `mock_artloom.rs`.

Current RED batch already copied:

- `Hook/__tests__/integration/ArtNodePropagationContract.test.ts`
- `Hook/__tests__/integration/ArtNodeSpawnSizingContract.test.ts`
- `Hook/__tests__/integration/LinkPropagationContract.test.ts`

Known current RED command:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run `
  __tests__\integration\ArtNodePropagationContract.test.ts `
  __tests__\integration\ArtNodeSpawnSizingContract.test.ts `
  __tests__\integration\LinkPropagationContract.test.ts `
  --pool threads --maxWorkers 1 --no-file-parallelism
```

Expected before Batch 1 implementation:

- `ArtNodePropagationContract.test.ts` fails because link-created propagation and upstream-driven target port semantics are missing.
- `ArtNodeSpawnSizingContract.test.ts` fails because connected art node spawn still uses fixed `w: 250, h: 300` and hard-coded input port.
- `LinkPropagationContract.test.ts` fails because `useLinking` has no `UseLinkingOptions` / `onLinkCreated`.

Source-to-target test inventory gap:

```text
Missing in Hook and should be migrated:
  integration\ArtParamLinkTargetContract.test.ts
  integration\ColorTransferShaderContract.test.ts
  integration\DesktopLiveSyncContract.test.ts
  integration\GlobalAddArtNodeContract.test.ts
  integration\GlobalAddNodeMenuInteractionContract.test.ts
  integration\opportunisticArtLoomConnection.test.ts
  integration\StringParamCommitContract.test.ts
  integration\UnitAddNodeMenuCloseContract.test.ts
  integration\UnitParamsPanelGroupingContract.test.ts
  unit\shortcuts.test.ts

Source-only but not automatically in scope:
  integration\GitHubRepoLayoutContract.test.ts
```

`GitHubRepoLayoutContract.test.ts` is not a normal feature migration target because it asserts the public ArtHook GitHub repository layout (`ArtHook/src-tauri`, root release workflows, internalized capture crates). Only migrate or rewrite it if the task becomes "publish Hook as the same public ArtHook repo layout".

---

## File map

### Batch 1: link propagation and connected spawn

- Modify: `Hook/src/hooks/useLinking.ts`
  - Add `UseLinkingOptions`.
  - Notify `options.onLinkCreated?.(sourceId, targetUnitId, targetPortId)` after adding a link.
- Modify: `Hook/src/hooks/useUnitActions.ts`
  - Add image resolution and execution config imports.
  - Add `getSourceImageFrame`.
  - Add `getPrimaryImageInputPort`.
  - Use target port for upstream propagation.
  - Respect `propagation.listenUpstream` and `triggerMode.upstreamDriven`.
  - Resolve sticker/art image input through `resolveUnitImageFromGraph`.
  - Spawn connected art nodes using source frame size and capability-derived input port.
- Modify: `Hook/src/app.tsx`
  - Instantiate `useUnitActions()` before `useLinking(...)`.
  - Pass `onLinkCreated` callback that triggers `propagateFromUnit(sourceId)`.
- Tests:
  - `Hook/__tests__/integration/ArtNodePropagationContract.test.ts`
  - `Hook/__tests__/integration/ArtNodeSpawnSizingContract.test.ts`
  - `Hook/__tests__/integration/LinkPropagationContract.test.ts`

### Batch 2: Color Transfer / contextual shader migration

- Copy: `ArtHook/__tests__/integration/ColorTransferShaderContract.test.ts`
  to `Hook/__tests__/integration/ColorTransferShaderContract.test.ts`.
- Modify: `Hook/src/app.tsx`
  - Add `isContextualShaderArt`.
  - Skip contextual shader prefetch until image context is known.
  - Accept `CanvasUnits` rendered shader output and write it back to graph data.
  - Trigger `propagateFromUnit(id)` after shader render updates.
- Modify: `Hook/src/components/CanvasUnits.tsx`
  - Pass `onRendered: (id: string, dataUrl: string) => void` to each `UnitView`.
- Modify: `Hook/src/components/UnitView.tsx`
  - Resolve shader input/reference from connected params.
  - Pass `referenceImageSrc`, `artPath`, `requiresReference`, and `onRendered` to `ShaderPreview`.
- Modify: `Hook/src/components/ShaderPreview.tsx`
  - Support `referenceImageSrc`.
  - Force contextual shader prefetch with `inputSrc` and `referenceSrc`.
  - Export rendered output asynchronously via `canvas.toBlob`.
- Modify: `Hook/src-tauri/src/mock_artloom.rs`
  - Add/port `repair_artloom_art_path`.
  - Add/port `materialize_shader_image_input`.
  - Ensure `prefetch_shader` offloads blocking Python/shader work through `tauri::async_runtime::spawn_blocking`.
- Tests:
  - `Hook/__tests__/integration/ColorTransferShaderContract.test.ts`

### Batch 3: global Shift+1 add-node menu

- Copy:
  - `ArtHook/__tests__/integration/GlobalAddArtNodeContract.test.ts`
    to `Hook/__tests__/integration/GlobalAddArtNodeContract.test.ts`
  - `ArtHook/__tests__/integration/GlobalAddNodeMenuInteractionContract.test.ts`
    to `Hook/__tests__/integration/GlobalAddNodeMenuInteractionContract.test.ts`
  - `ArtHook/__tests__/unit/shortcuts.test.ts`
    to `Hook/__tests__/unit/shortcuts.test.ts`
- Modify: `Hook/src/store/uiStore.ts`
  - Add `globalAddNodeMenu` signal and `setGlobalAddNodeMenu`.
  - Ensure existing per-unit action menu state is preserved.
- Modify: `Hook/src/services/shortcuts.ts`
  - Register `open-global-add-node-menu` as Shift+1 (`key: '!'`, `modifiers: ['shift']`) with priority `100`.
  - Ensure Shift+1 dispatches global add menu even when a unit is selected.
- Modify: `Hook/src/hooks/useShortcuts.ts`
  - Add `onOpenGlobalAddNodeMenu`.
  - Add `onCloseGlobalAddNodeMenu`.
  - Register `open-global-add-node-menu` and `close-global-add-node-menu`.
- Modify: `Hook/src/app.tsx`
  - Import/render root-level `UnitAddNodeMenu`.
  - Add `GlobalAddNodeMenuPayload`.
  - Add `spawnStandaloneNode`.
  - Add `openGlobalAddNodeMenu(payload?)`.
  - Add `closeGlobalAddNodeMenu`.
  - Add Tauri listener for `trigger-open-global-add-node-menu`.
  - Keep `Ctrl+Alt+Space` voice hotkey UI/listeners intact.
- Modify: `Hook/src-tauri/src/lib.rs`
  - Add desktop Shift+1 global shortcut registration.
  - Emit `trigger-open-global-add-node-menu`.
  - Use full-screen overlay host, not canvas window, for desktop global menu.
  - Normalize physical cursor coordinates into local logical overlay coordinates.
  - Keep existing `Ctrl+Alt+Space` voice hotkey registration.
- Tests:
  - `Hook/__tests__/integration/GlobalAddArtNodeContract.test.ts`
  - `Hook/__tests__/integration/GlobalAddNodeMenuInteractionContract.test.ts`
  - `Hook/__tests__/unit/shortcuts.test.ts`
  - Existing `Hook/__tests__/integration/VoiceHotkeyContract.test.ts`

### Batch 4: remaining ArtHook small contracts

- Copy:
  - `ArtHook/__tests__/integration/ArtParamLinkTargetContract.test.ts`
  - `ArtHook/__tests__/integration/DesktopLiveSyncContract.test.ts`
  - `ArtHook/__tests__/integration/StringParamCommitContract.test.ts`
  - `ArtHook/__tests__/integration/UnitAddNodeMenuCloseContract.test.ts`
  - `ArtHook/__tests__/integration/UnitParamsPanelGroupingContract.test.ts`
  - `ArtHook/__tests__/integration/opportunisticArtLoomConnection.test.ts`
- Modify as indicated by RED:
  - `Hook/src/components/params/UnitParamControl.tsx`
    - Add parameter-row link target/drop support.
    - Pass finality for text controls as `(val, isFinal)`.
  - `Hook/src/components/params/controls/ImageControl.tsx`
    - Treat image-link button/drop as target drop, not outgoing link start.
  - `Hook/src/components/params/controls/StringControl.tsx`
    - Keep draft state on `onInput`.
    - Commit only on Enter or blur.
    - Call `props.onChange(next, true)` even when the committed value matches the current value.
  - `Hook/src/components/params/controls/NumberControl.tsx`
    - Preserve slider plus numeric stepper layout.
    - Use two-row slider layout markers.
  - `Hook/src/components/UnitParamsPanel.tsx`
    - Register floating parameter panel ports.
    - Use grouped parameter rendering through `buildArtParamGroups` and `shouldGroupArtParams`.
    - Keep grouped parameter labels non-collapsing.
    - Bound panel height and scroll only the parameter list.
  - `Hook/src/components/CanvasUnits.tsx`
    - Close per-unit action menu after `props.onAddNode(u.id, artId)`.
  - `Hook/src/store/uiStore.ts`
    - Add/confirm `uiActions.closeActions(id)`.
  - `Hook/src/services/protocol.ts`
    - Extend `ArtParam` with optional `group?: string`.
  - `Hook/src/services/syncService.ts`
    - Force image sync for `WORKFLOW_ID`.
    - Include `src`, `previewSrc`, and `rasterizedAnnotationLayerSrc` in global live snapshots.
  - `Hook/src/app.tsx`
    - Remove static `bootProfile?.artLoomEnabled !== false` guards from startup/reconnect handshake.
    - Keep startup ArtLoom bridge unavailable message non-fatal.
  - `Hook/src-tauri/src/mock_artloom.rs`
    - Ensure handshake is non-blocking and does not use a 3 second synchronous timeout.
- Tests:
  - All copied small-contract tests above.

### Batch 5: HookLess config and branding safety

- Inspect:
  - `Hook/src-tauri/src/voice/**`
  - `Hook/src-tauri/src/lib.rs`
  - `Hook/src/services/api.ts`
  - `Hook/src/app.tsx`
  - `HookLess` config/loading code.
- Decide and implement only the minimal missing runtime contract:
  - Keep safe MVP defaults unless there is a real config file path to load:
    - audio backend: `silent`
    - provider: `mock`
    - output: `dry_run`
    - clipboard backend: `fallback`
  - If config loading is missing and low-risk, add a `voice_config_path` or app-local config read path that falls back to the above defaults.
  - Do not rename protocol-facing ArtHook/ArtLoom strings unless tests prove they are just branding and not compatibility identifiers.
- Tests:
  - Existing Rust voice tests in `Hook/src-tauri/src/voice/**`.
  - Existing `Hook/__tests__/integration/VoiceHotkeyContract.test.ts`.
  - Add a config fallback contract only if config loading is implemented.

### Batch 6: final audit and verification

- Compare source/reference test inventory again.
- Explicitly document any intentionally unmigrated source tests.
- Run frontend full verification.
- Run Rust full verification.
- Run a final dirty-worktree check and report only files touched in `Hook`.

---

## Tasks

### Task 0: Baseline and inventory checkpoint

**Files:**

- Read-only check: `Z:\project\project\ArtNexus-GitHub\ArtHook`
- Read-only check: `C:\Users\Public\nas_home\AI\GameEditor\Neuro\Talk`
- Target check: `Hook`

- [ ] **Step 0.1: Capture current Hook status**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro'
git status --short -- Hook
```

Expected:

- Hook migration changes are visible.
- No `Gateway` or `.tmp` changes are included in the Hook-only status command.

- [ ] **Step 0.2: Recompute ArtHook test inventory gap**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro'
$src = rg --files 'Z:\project\project\ArtNexus-GitHub\ArtHook\__tests__' |
  ForEach-Object { $_ -replace '^Z:\\project\\project\\ArtNexus-GitHub\\ArtHook\\__tests__\\','' } |
  Sort-Object
$dst = rg --files 'Hook\__tests__' |
  ForEach-Object { $_ -replace '^Hook\\__tests__\\','' } |
  Sort-Object
Compare-Object -ReferenceObject $src -DifferenceObject $dst |
  ForEach-Object { '{0} {1}' -f $_.SideIndicator,$_.InputObject }
```

Expected before execution:

```text
<= integration\ArtParamLinkTargetContract.test.ts
<= integration\ColorTransferShaderContract.test.ts
<= integration\DesktopLiveSyncContract.test.ts
<= integration\GitHubRepoLayoutContract.test.ts
<= integration\GlobalAddArtNodeContract.test.ts
<= integration\GlobalAddNodeMenuInteractionContract.test.ts
<= integration\opportunisticArtLoomConnection.test.ts
<= integration\StringParamCommitContract.test.ts
<= integration\UnitAddNodeMenuCloseContract.test.ts
<= integration\UnitParamsPanelGroupingContract.test.ts
<= unit\shortcuts.test.ts
```

- [ ] **Step 0.3: Confirm current Batch 1 RED**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run `
  __tests__\integration\ArtNodePropagationContract.test.ts `
  __tests__\integration\ArtNodeSpawnSizingContract.test.ts `
  __tests__\integration\LinkPropagationContract.test.ts `
  --pool threads --maxWorkers 1 --no-file-parallelism
```

Expected:

- Fails for missing `UseLinkingOptions`, `onLinkCreated`, target-port upstream propagation, `resolveUnitImageFromGraph`, `getSourceImageFrame`, and dynamic connected node sizing/port selection.

### Task 1: Complete link propagation and connected spawn migration

**Files:**

- Modify: `Hook/src/hooks/useLinking.ts`
- Modify: `Hook/src/hooks/useUnitActions.ts`
- Modify: `Hook/src/app.tsx`
- Test: `Hook/__tests__/integration/ArtNodePropagationContract.test.ts`
- Test: `Hook/__tests__/integration/ArtNodeSpawnSizingContract.test.ts`
- Test: `Hook/__tests__/integration/LinkPropagationContract.test.ts`

- [ ] **Step 1.1: Add link-created callback contract to `useLinking`**

Implement these exact shapes in `Hook/src/hooks/useLinking.ts`:

```ts
interface UseLinkingOptions {
    onLinkCreated?: (sourceUnitId: string, targetUnitId: string, targetPortId: string) => void;
}

export function useLinking(options: UseLinkingOptions = {}) {
```

After `graphStore.actions.addLink(newLink);`, add:

```ts
options.onLinkCreated?.(sourceId, targetUnitId, targetPortId);
```

Keep the existing `syncService.performWorkflowSync()` call.

- [ ] **Step 1.2: Add unit-action imports and source-frame helper**

In `Hook/src/hooks/useUnitActions.ts`, add the migration imports:

```ts
import { DEFAULT_EXECUTION_CONFIG, type Unit } from "../types/unit";
import { resolveUnitImageFromGraph } from "../services/graphImageResolution";
import { getCapabilityInputsForPorts } from "../services/artPorts";
import { deriveUnitExecutionConfig } from "../services/nodeExecutionConfig";
```

Add above `useUnitActions`:

```ts
const getSourceImageFrame = (unit: Unit): { w: number; h: number } => {
    const savedRect = unit.data.savedRect;
    if (unit.data.minified && savedRect) {
        return { w: savedRect.w, h: savedRect.h };
    }

    return { w: unit.w, h: unit.h };
};
```

- [ ] **Step 1.3: Add primary input port resolver**

Inside `useUnitActions`, add:

```ts
const getPrimaryImageInputPort = (artId: string) => {
    const capability = graphStore.capabilities.find((item) => item.id === artId);
    const inputs = getCapabilityInputsForPorts(capability);
    const imageInput = inputs.find((input) =>
        (input.type || "").toLowerCase().includes("image") ||
        ["input", "input_image", "image"].includes((input.name || "").toLowerCase())
    );
    return imageInput?.name || inputs[0]?.name || "input_image";
};
```

- [ ] **Step 1.4: Replace old art-node propagation branch**

Replace the old first-param propagation block:

```ts
const firstParam = Object.keys(childUnit.params || {})[0] || "init";
const val = (childUnit.params || {})[firstParam] ?? true;
setTimeout(() => {
    handleParamChange(childId, firstParam, val);
}, 10);
```

with:

```ts
const childCapability = childUnit.artId
    ? graphStore.capabilities.find((item) => item.id === childUnit.artId)
    : undefined;
const childExecConfig = deriveUnitExecutionConfig({
    capability: childCapability,
    explicitConfig:
        graphStore.unitExecConfig[childId] ||
        childUnit.data?.executionConfig ||
        DEFAULT_EXECUTION_CONFIG,
});
if (!(childExecConfig.propagation?.listenUpstream ?? true)) return;
if (!(childExecConfig.triggerMode?.upstreamDriven ?? true)) return;

console.log(`[Propagation] Triggering Art Node ${childId} via ${l.toPortId}`);
const targetParam = l.toPortId || "input";
const val =
    graphStore.unitParams[childId]?.[targetParam] ??
    childUnit.params?.[targetParam] ??
    true;
setTimeout(() => {
    handleParamChange(childId, targetParam, val, true, "upstream");
}, 10);
```

- [ ] **Step 1.5: Replace direct parent preview lookup for sticker/art pass-through**

Replace:

```ts
const parentUnit = graphStore.units.find(u => u.id === fromUnitId);
const inputValue = parentUnit?.data?.previewSrc || parentUnit?.data?.src;
```

with:

```ts
const inputValue = resolveUnitImageFromGraph({
    units: graphStore.units,
    links: graphStore.links,
    capabilities: graphStore.capabilities,
    unitId: fromUnitId,
});
```

- [ ] **Step 1.6: Replace connected node spawn sizing and input port**

In `spawnConnectedNode`, replace fixed dimensions and hard-coded input link with:

```ts
const sourceFrame = getSourceImageFrame(u);
const capability = graphStore.capabilities.find((item) => item.id === artId);
const newId = crypto.randomUUID();
graphStore.actions.addUnit({
    id: newId,
    type: "art",
    artId,
    x: u.x + u.w + 50,
    y: u.y,
    w: sourceFrame.w,
    h: sourceFrame.h,
    params: {},
    inputs: [],
    outputs: [],
    data: {
        executionConfig: deriveUnitExecutionConfig({ capability }),
    },
});
graphStore.actions.addLink({
    id: crypto.randomUUID(),
    fromUnitId: fromId,
    fromPortId: "output",
    toUnitId: newId,
    toPortId: getPrimaryImageInputPort(artId),
});
syncService.updateBackendRects();
syncService.performWorkflowSync();
setTimeout(() => propagateFromUnit(fromId), 20);
```

- [ ] **Step 1.7: Wire link-created propagation in `app.tsx`**

Change:

```ts
const { startLinking, handleLinkDrop, handleInputLinkDrag, handleLinkHover } = useLinking();
const { handleParamChange, handleDoubleClick, spawnConnectedNode, performOcrAction, toggleTranslationAction, propagateFromUnit } = useUnitActions();
```

to:

```ts
const { handleParamChange, handleDoubleClick, spawnConnectedNode, performOcrAction, toggleTranslationAction, propagateFromUnit } = useUnitActions();
const { startLinking, handleLinkDrop, handleInputLinkDrag, handleLinkHover } = useLinking({
    onLinkCreated: (sourceId) => {
        setTimeout(() => propagateFromUnit(sourceId), 20);
    },
});
```

- [ ] **Step 1.8: Verify Batch 1**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run `
  __tests__\integration\ArtNodePropagationContract.test.ts `
  __tests__\integration\ArtNodeSpawnSizingContract.test.ts `
  __tests__\integration\LinkPropagationContract.test.ts `
  --pool threads --maxWorkers 1 --no-file-parallelism
npm run typecheck
```

Expected:

- Targeted tests pass.
- Typecheck passes.

### Task 2: Migrate Color Transfer contextual shader behavior

**Files:**

- Create: `Hook/__tests__/integration/ColorTransferShaderContract.test.ts`
- Modify: `Hook/src/app.tsx`
- Modify: `Hook/src/components/CanvasUnits.tsx`
- Modify: `Hook/src/components/UnitView.tsx`
- Modify: `Hook/src/components/ShaderPreview.tsx`
- Modify: `Hook/src-tauri/src/mock_artloom.rs`

- [ ] **Step 2.1: Copy Color Transfer contract test**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro'
Copy-Item -LiteralPath 'Z:\project\project\ArtNexus-GitHub\ArtHook\__tests__\integration\ColorTransferShaderContract.test.ts' `
  -Destination 'Hook\__tests__\integration\ColorTransferShaderContract.test.ts'
```

- [ ] **Step 2.2: Verify Color Transfer RED**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run __tests__\integration\ColorTransferShaderContract.test.ts --pool threads --maxWorkers 1 --no-file-parallelism
```

Expected:

- Fails for missing contextual shader filtering/reference handling/path repair/data URI materialization/toBlob behavior.

- [ ] **Step 2.3: Port frontend contextual shader code by focused diff**

Use the clean reference files for exact implementation shape:

```text
Z:\project\project\ArtNexus-GitHub\ArtHook\src\app.tsx
Z:\project\project\ArtNexus-GitHub\ArtHook\src\components\CanvasUnits.tsx
Z:\project\project\ArtNexus-GitHub\ArtHook\src\components\UnitView.tsx
Z:\project\project\ArtNexus-GitHub\ArtHook\src\components\ShaderPreview.tsx
```

Required strings/behaviors after implementation:

```text
src/app.tsx:
  isContextualShaderArt
  shaderArts.filter((art) => !isContextualShaderArt(art))
  onRendered={(id, dataUrl) => { ... propagateFromUnit(id) ... }}

src/components/CanvasUnits.tsx:
  onRendered: (id: string, dataUrl: string) => void

src/components/UnitView.tsx:
  getShaderInputSrc
  getShaderReferenceSrc
  referenceImageSrc={getShaderReferenceSrc()}
  requiresReference={isContextualShader()}
  onRendered={(dataUrl) => props.onRendered(props.unit.id, dataUrl)}

src/components/ShaderPreview.tsx:
  referenceImageSrc
  props.artPath
  prefetchShader(..., true, inputSrc, referenceSrc)
  key === "reference"
  canvas.toBlob
```

- [ ] **Step 2.4: Port Rust shader path/input repair**

Use clean reference:

```text
Z:\project\project\ArtNexus-GitHub\ArtHook\src-tauri\src\mock_artloom.rs
```

Required strings/behaviors after implementation:

```text
repair_artloom_art_path
materialize_shader_image_input
starts_with("data:")
artloom_shader_input
artloom_shader_reference
pub async fn prefetch_shader
tauri::async_runtime::spawn_blocking
prefetch_shader_blocking
```

- [ ] **Step 2.5: Verify Batch 2**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run __tests__\integration\ColorTransferShaderContract.test.ts --pool threads --maxWorkers 1 --no-file-parallelism
npm run typecheck
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected:

- Color Transfer contract passes.
- TypeScript and Rust checks pass.

### Task 3: Migrate global Shift+1 add-node menu

**Files:**

- Create: `Hook/__tests__/integration/GlobalAddArtNodeContract.test.ts`
- Create: `Hook/__tests__/integration/GlobalAddNodeMenuInteractionContract.test.ts`
- Create: `Hook/__tests__/unit/shortcuts.test.ts`
- Modify: `Hook/src/store/uiStore.ts`
- Modify: `Hook/src/services/shortcuts.ts`
- Modify: `Hook/src/hooks/useShortcuts.ts`
- Modify: `Hook/src/app.tsx`
- Modify: `Hook/src-tauri/src/lib.rs`

- [ ] **Step 3.1: Copy Shift+1/global-menu contract tests**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro'
Copy-Item -LiteralPath 'Z:\project\project\ArtNexus-GitHub\ArtHook\__tests__\integration\GlobalAddArtNodeContract.test.ts' `
  -Destination 'Hook\__tests__\integration\GlobalAddArtNodeContract.test.ts'
Copy-Item -LiteralPath 'Z:\project\project\ArtNexus-GitHub\ArtHook\__tests__\integration\GlobalAddNodeMenuInteractionContract.test.ts' `
  -Destination 'Hook\__tests__\integration\GlobalAddNodeMenuInteractionContract.test.ts'
Copy-Item -LiteralPath 'Z:\project\project\ArtNexus-GitHub\ArtHook\__tests__\unit\shortcuts.test.ts' `
  -Destination 'Hook\__tests__\unit\shortcuts.test.ts'
```

- [ ] **Step 3.2: Verify Shift+1 RED**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run `
  __tests__\integration\GlobalAddArtNodeContract.test.ts `
  __tests__\integration\GlobalAddNodeMenuInteractionContract.test.ts `
  __tests__\unit\shortcuts.test.ts `
  --pool threads --maxWorkers 1 --no-file-parallelism
```

Expected:

- Fails for missing global menu state, Shift+1 shortcut definition, root menu rendering, desktop event, and coordinate normalization.

- [ ] **Step 3.3: Implement frontend global menu**

Use clean reference files:

```text
Z:\project\project\ArtNexus-GitHub\ArtHook\src\store\uiStore.ts
Z:\project\project\ArtNexus-GitHub\ArtHook\src\services\shortcuts.ts
Z:\project\project\ArtNexus-GitHub\ArtHook\src\hooks\useShortcuts.ts
Z:\project\project\ArtNexus-GitHub\ArtHook\src\app.tsx
```

Required strings/behaviors after implementation:

```text
src/store/uiStore.ts:
  globalAddNodeMenu
  setGlobalAddNodeMenu

src/services/shortcuts.ts:
  id: 'open-global-add-node-menu'
  key: '!'
  modifiers: ['shift']
  priority: 100

src/hooks/useShortcuts.ts:
  onOpenGlobalAddNodeMenu
  onCloseGlobalAddNodeMenu
  open-global-add-node-menu
  close-global-add-node-menu

src/app.tsx:
  import { UnitAddNodeMenu } from "./components/UnitAddNodeMenu"
  interface GlobalAddNodeMenuPayload
  spawnStandaloneNode
  buildStandaloneArtNodeUnit
  selectionActions.set([newId])
  uiActions.openParams(newId)
  openGlobalAddNodeMenu(event.payload)
  closeGlobalAddNodeMenu
  payload?.x
  setGlobalAddNodeMenu({ visible: true, ... })
```

- [ ] **Step 3.4: Implement backend desktop Shift+1 event without breaking voice hotkey**

Use clean reference:

```text
Z:\project\project\ArtNexus-GitHub\ArtHook\src-tauri\src\lib.rs
```

Required strings/behaviors after implementation:

```text
trigger_open_global_add_node_menu
emit_global_add_node_menu_event
trigger-open-global-add-node-menu
Modifiers::SHIFT
Code::Digit1
show_overlay_host_impl(window, false)
current_cursor_position_physical
capture_window_metrics(window)
normalize_global_physical_to_local_logical
"globalX"
"scaleFactor"
```

Also verify these existing Hook voice strings remain:

```text
Ctrl+Alt+Space
register_voice_hotkey_success
voice-hotkey-event
voice-session-event
```

- [ ] **Step 3.5: Verify Batch 3**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run `
  __tests__\integration\GlobalAddArtNodeContract.test.ts `
  __tests__\integration\GlobalAddNodeMenuInteractionContract.test.ts `
  __tests__\unit\shortcuts.test.ts `
  __tests__\integration\VoiceHotkeyContract.test.ts `
  --pool threads --maxWorkers 1 --no-file-parallelism
npm run typecheck
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected:

- Global add-node menu contracts pass.
- Voice hotkey contract still passes.
- TypeScript and Rust checks pass.

### Task 4: Migrate remaining small ArtHook contracts

**Files:**

- Create: `Hook/__tests__/integration/ArtParamLinkTargetContract.test.ts`
- Create: `Hook/__tests__/integration/DesktopLiveSyncContract.test.ts`
- Create: `Hook/__tests__/integration/StringParamCommitContract.test.ts`
- Create: `Hook/__tests__/integration/UnitAddNodeMenuCloseContract.test.ts`
- Create: `Hook/__tests__/integration/UnitParamsPanelGroupingContract.test.ts`
- Create: `Hook/__tests__/integration/opportunisticArtLoomConnection.test.ts`
- Modify as needed:
  - `Hook/src/components/params/UnitParamControl.tsx`
  - `Hook/src/components/params/controls/ImageControl.tsx`
  - `Hook/src/components/params/controls/StringControl.tsx`
  - `Hook/src/components/params/controls/NumberControl.tsx`
  - `Hook/src/components/UnitParamsPanel.tsx`
  - `Hook/src/components/CanvasUnits.tsx`
  - `Hook/src/store/uiStore.ts`
  - `Hook/src/services/protocol.ts`
  - `Hook/src/services/syncService.ts`
  - `Hook/src/app.tsx`
  - `Hook/src-tauri/src/mock_artloom.rs`
  - `Hook/src/app.css`

- [ ] **Step 4.1: Copy small contract tests**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro'
$tests = @(
  'ArtParamLinkTargetContract.test.ts',
  'DesktopLiveSyncContract.test.ts',
  'StringParamCommitContract.test.ts',
  'UnitAddNodeMenuCloseContract.test.ts',
  'UnitParamsPanelGroupingContract.test.ts',
  'opportunisticArtLoomConnection.test.ts'
)
foreach ($test in $tests) {
  Copy-Item -LiteralPath "Z:\project\project\ArtNexus-GitHub\ArtHook\__tests__\integration\$test" `
    -Destination "Hook\__tests__\integration\$test"
}
```

- [ ] **Step 4.2: Verify small-contract RED**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run `
  __tests__\integration\ArtParamLinkTargetContract.test.ts `
  __tests__\integration\DesktopLiveSyncContract.test.ts `
  __tests__\integration\StringParamCommitContract.test.ts `
  __tests__\integration\UnitAddNodeMenuCloseContract.test.ts `
  __tests__\integration\UnitParamsPanelGroupingContract.test.ts `
  __tests__\integration\opportunisticArtLoomConnection.test.ts `
  --pool threads --maxWorkers 1 --no-file-parallelism
```

Expected:

- Fails only where target lacks the copied ArtHook behavior.

- [ ] **Step 4.3: Implement parameter link targets**

Required strings/behaviors after implementation:

```text
src/components/params/UnitParamControl.tsx:
  onLinkDrop?:
  onLinkMove?:
  isLinked?:
  data-param-link-target
  data-port-name={props.param.id}
  props.onLinkDrop?.(props.param.id)
  props.onLinkMove?.(props.param.id, e)

src/components/UnitParamsPanel.tsx:
  isParamLinked
  registerLinkTarget={(el) => registerPanelPort(el, param.id)}
  onLinkDrop={props.onLinkDrop}
  onLinkMove={props.onLinkMove}

src/components/params/controls/ImageControl.tsx:
  onLinkDrop?:
  onLinkMove?:
  props.onLinkDrop?.()
  props.onLinkMove?.(e)
  no props.onLinkStart?.(e.clientX, e.clientY)
```

- [ ] **Step 4.4: Implement text draft/commit finality**

Required strings/behaviors after implementation:

```text
src/components/params/controls/StringControl.tsx:
  createSignal
  commitDraft
  onInput={(e) =>
  event.key === "Enter"
  onBlur={commitDraft}
  props.onChange(next, true)
  no if (next !== props.value)

src/components/params/UnitParamControl.tsx text branch:
  onChange={(val, isFinal) => props.onChange(props.param.id, val, isFinal)}
  no onChange={(val) => props.onChange(props.param.id, val)}
```

- [ ] **Step 4.5: Implement grouped parameter panel and slider layout**

Required strings/behaviors after implementation:

```text
src/components/UnitParamsPanel.tsx:
  buildArtParamGroups
  shouldGroupArtParams
  data-param-group
  data-param-group-header
  param-scroll-container
  "max-height": "min(560px, calc(100vh - 96px))"
  "overflow-y": "auto"
  "max-height": "min(360px, calc(100vh - 300px))"
  <For each={group.params}>{(param) => renderParamControl(param)}</For>
  no toggleParamGroupExpanded
  no globalParamGroupExpandedRegistry

src/services/protocol.ts:
  group?: string

src/app.css:
  .param-scroll-container
  .param-scroll-container::-webkit-scrollbar
  scrollbar-color

src/components/UnitView.tsx:
  params={props.params}
  no params={props.unit.params}

src/components/params/controls/NumberControl.tsx:
  props.widget === "slider"
  type="range"
  data-param-number-input
  data-param-step-down
  data-param-step-up
  data-param-slider-layout
  data-param-value-row
  data-param-slider-row
  class="w-full min-w-0"
  no appearance-textfield
  no min-w-[72px]
```

- [ ] **Step 4.6: Implement add-node action close**

Required strings/behaviors after implementation:

```text
src/store/uiStore.ts:
  closeActions: (id: string)

src/components/CanvasUnits.tsx:
  props.onAddNode(u.id, artId)
  uiActions.closeActions(u.id)
```

`uiActions.closeActions(u.id)` must happen after adding the node.

- [ ] **Step 4.7: Implement desktop live sync image contract**

Required strings/behaviors after implementation:

```text
src/services/syncService.ts:
  const forceImageSync = targetWfId === WORKFLOW_ID
  if (forceImageSync && currentImg)
  const globalRfNodes = currentUnits.map
  shouldSyncImage(u, WORKFLOW_ID)
  src: u.data?.src
  previewSrc: u.data?.previewSrc || u.data?.src
  rasterizedAnnotationLayerSrc
```

- [ ] **Step 4.8: Implement opportunistic ArtLoom connection**

Required strings/behaviors after implementation:

```text
src/app.tsx:
  no if (bootProfile?.artLoomEnabled !== false)
  ArtLoom bridge unavailable during startup; continuing in standalone mode.
  if (event.payload?.connected) {
  no event.payload?.connected && bootProfile?.artLoomEnabled !== false

src-tauri/src/mock_artloom.rs:
  no Duration::from_secs(3)
  let backend_connected = {
```

- [ ] **Step 4.9: Verify Batch 4**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run `
  __tests__\integration\ArtParamLinkTargetContract.test.ts `
  __tests__\integration\DesktopLiveSyncContract.test.ts `
  __tests__\integration\StringParamCommitContract.test.ts `
  __tests__\integration\UnitAddNodeMenuCloseContract.test.ts `
  __tests__\integration\UnitParamsPanelGroupingContract.test.ts `
  __tests__\integration\opportunisticArtLoomConnection.test.ts `
  --pool threads --maxWorkers 1 --no-file-parallelism
npm run typecheck
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected:

- All copied small contracts pass.
- TypeScript and Rust checks pass.

### Task 5: Complete HookLess config and branding safety pass

**Files:**

- Inspect: `Hook/src-tauri/src/voice/**`
- Inspect: `Hook/src-tauri/src/lib.rs`
- Inspect: `Hook/src/services/api.ts`
- Inspect: `Hook/src/app.tsx`
- Inspect: `Talk`
- Optional create/test only if implementing config loading:
  - `Hook/__tests__/integration/VoiceConfigFallbackContract.test.ts`

- [ ] **Step 5.1: Audit HookLess-to-Hook voice migration**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro'
rg -n "VoiceConfig|default_voice_config|Ctrl\\+Alt\\+Space|AudioBackendMode|ProviderKind|OutputMode|ClipboardBackendMode|voice_mode|toml|config" `
  Hook\src-tauri\src\voice Hook\src-tauri\src\lib.rs Hook\src\services\api.ts Hook\src\app.tsx Talk
```

Expected:

- Hook safe MVP defaults are visible.
- Any HookLess config loader not yet represented in Hook is identified.

- [ ] **Step 5.2: Preserve safe MVP defaults unless config loading is explicit**

Required current-safe values:

```text
toggle shortcut: Ctrl+Alt+Space
audio backend: silent
provider: mock
output mode: dry_run
clipboard backend: fallback
voice mode: dictate unless user config overrides it
```

If no stable config path exists, do not invent a half-wired UI or destructive behavior. Record this as an intentional productization follow-up.

- [ ] **Step 5.3: Add config loading only if low-risk and contractable**

If implementing config loading, add a frontend or Rust contract that asserts:

```text
missing config => safe MVP defaults
present config => parsed settings summary reflects file values
invalid config => safe fallback plus visible error/log, not app crash
```

Then implement the smallest Rust-side load path that keeps existing defaults as fallback.

- [ ] **Step 5.4: Branding/compatibility audit**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
rg -n "ArtHook|ArtNexus|ArtLoom|arthook|artloom|HookLess|Neuro" src src-tauri package*.json *.ps1 *.bat README.md PROJECT_OVERVIEW.md TECHNICAL_ARCHITECTURE.md
```

Classify each finding:

```text
compatibility/protocol/runtime identifier: keep
release artifact/script name: keep unless release target changed
visible product branding: candidate rename only with dedicated UX/product decision
test fixture/log string: keep unless it misleads current behavior
```

- [ ] **Step 5.5: Verify Batch 5**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run __tests__\integration\VoiceHotkeyContract.test.ts --pool threads --maxWorkers 1 --no-file-parallelism
npm run typecheck
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo test --manifest-path src-tauri\Cargo.toml voice -- --nocapture
```

Expected:

- Voice hotkey and voice Rust tests pass.
- No unsafe voice behavior is enabled by default.

### Task 6: Final migration audit and full verification

**Files:**

- Read all changed Hook files.
- Optional create: `Hook/docs/migration/hook-migration-completion-audit.md`

- [ ] **Step 6.1: Recompute source test gap**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro'
$src = rg --files 'Z:\project\project\ArtNexus-GitHub\ArtHook\__tests__' |
  ForEach-Object { $_ -replace '^Z:\\project\\project\\ArtNexus-GitHub\\ArtHook\\__tests__\\','' } |
  Sort-Object
$dst = rg --files 'Hook\__tests__' |
  ForEach-Object { $_ -replace '^Hook\\__tests__\\','' } |
  Sort-Object
Compare-Object -ReferenceObject $src -DifferenceObject $dst |
  ForEach-Object { '{0} {1}' -f $_.SideIndicator,$_.InputObject }
```

Expected final:

```text
<= integration\GitHubRepoLayoutContract.test.ts
```

Allowed only if documented as intentionally out-of-scope for current `Neuro/Hook` target layout.

- [ ] **Step 6.2: Run full frontend verification**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
npm run typecheck
npm test
```

Expected:

- Typecheck passes.
- Full Vitest suite passes.

- [ ] **Step 6.3: Run full Rust verification**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected:

- Rust formatting check passes.
- Rust tests pass.

- [ ] **Step 6.4: Run migration-specific targeted suite once more**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run `
  __tests__\integration\ProcessNoWindowContract.test.ts `
  __tests__\integration\McpBoundaryContract.test.ts `
  __tests__\integration\AhrpCloudOutputContract.test.ts `
  __tests__\integration\ArtScalarOutputContract.test.ts `
  __tests__\integration\ArtNodePropagationContract.test.ts `
  __tests__\integration\ArtNodeSpawnSizingContract.test.ts `
  __tests__\integration\LinkPropagationContract.test.ts `
  __tests__\integration\ColorTransferShaderContract.test.ts `
  __tests__\integration\GlobalAddArtNodeContract.test.ts `
  __tests__\integration\GlobalAddNodeMenuInteractionContract.test.ts `
  __tests__\unit\shortcuts.test.ts `
  __tests__\integration\ArtParamLinkTargetContract.test.ts `
  __tests__\integration\DesktopLiveSyncContract.test.ts `
  __tests__\integration\StringParamCommitContract.test.ts `
  __tests__\integration\UnitAddNodeMenuCloseContract.test.ts `
  __tests__\integration\UnitParamsPanelGroupingContract.test.ts `
  __tests__\integration\opportunisticArtLoomConnection.test.ts `
  __tests__\integration\VoiceHotkeyContract.test.ts `
  --pool threads --maxWorkers 1 --no-file-parallelism
```

Expected:

- All migration-specific contracts pass together.

- [ ] **Step 6.5: Write final completion audit**

Create `Hook/docs/migration/hook-migration-completion-audit.md` with:

```markdown
# Hook Migration Completion Audit

## Sources

- Clean ArtHook: `Z:\project\project\ArtNexus-GitHub\ArtHook`
- Talk (formerly HookLess): `C:\Users\Public\nas_home\AI\GameEditor\Neuro\Talk`
- Target: `C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook`

## Migrated contracts

- Process no-window
- MCP boundary
- AHRP cloud output/error handling
- Art scalar outputs
- Link-created propagation
- Connected node sizing/input-port selection
- Color Transfer contextual shader
- Global Shift+1 add-node menu
- Parameter link targets
- Desktop live image sync
- String draft/commit finality
- Per-unit add-node menu close
- Grouped parameter panel/slider layout
- Opportunistic ArtLoom connection
- HookLess safe voice defaults

## Intentionally not migrated

- `GitHubRepoLayoutContract.test.ts`: source asserts public ArtHook repository layout, not current Neuro/Hook target layout.

## Verification

Paste exact command output summaries for:

- `npm run typecheck`
- `npm test`
- `cargo fmt --manifest-path src-tauri\Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- migration-specific targeted Vitest suite
```

- [ ] **Step 6.6: Final dirty-worktree report**

Run:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro'
git status --short
```

Expected:

- Hook migration files are listed.
- Existing unrelated `Gateway/scripts/probe-aistudio-live-request.mjs` and `.tmp/` remain untouched and explicitly called out as unrelated if still present.

---

## Milestones

### Milestone A: Core graph propagation complete

Criteria:

- Batch 1 targeted tests pass.
- `npm run typecheck` passes.
- Existing P0 AHRP/MCP/process contracts still pass.

### Milestone B: Contextual shader behavior complete

Criteria:

- `ColorTransferShaderContract.test.ts` passes.
- Frontend typecheck passes.
- Rust fmt/test passes.

### Milestone C: Global node creation UX complete

Criteria:

- Shift+1 frontend and desktop contracts pass.
- `VoiceHotkeyContract.test.ts` still passes.
- Frontend typecheck and Rust checks pass.

### Milestone D: Remaining ArtHook behavior contracts complete

Criteria:

- All small copied contracts pass.
- Frontend typecheck and Rust checks pass.

### Milestone E: HookLess safety and final audit complete

Criteria:

- Voice defaults remain safe.
- Branding/compat strings are classified, not blindly replaced.
- Only `GitHubRepoLayoutContract.test.ts` remains intentionally unmigrated from ArtHook tests.
- Full frontend and Rust verification pass.
- Completion audit document is written.

---

## Acceptance criteria for the whole plan

- `Neuro/Hook` contains all migrated behavior contracts except the explicitly out-of-scope public GitHub layout contract.
- `npm run typecheck` passes.
- `npm test` passes.
- `cargo fmt --manifest-path src-tauri\Cargo.toml -- --check` passes.
- `cargo test --manifest-path src-tauri\Cargo.toml` passes.
- No source/reference repository was modified.
- No unrelated `Gateway` or `.tmp` content was touched.
- HookLess voice remains safe-by-default unless explicit config loading is implemented and tested.

---

## Execution options

Plan complete and saved to `Hook/docs/superpowers/plans/2026-06-06-hook-migration-completion-plan.md`.

Recommended execution mode:

1. **Inline execution with checkpoints** for Batch 1 and Batch 2 because they touch shared files (`app.tsx`, `UnitView.tsx`, `mock_artloom.rs`).
2. **Parallel or semi-parallel execution** only after Batch 2:
   - Batch 3 frontend shortcut/menu work and backend shortcut work can be split if isolated worktrees are available.
   - Batch 4 parameter UI and sync/opportunistic connection work can be split, but merge carefully because `app.tsx`, `uiStore.ts`, and `CanvasUnits.tsx` may overlap with Batch 3.
3. Always run the relevant targeted tests before combining batches.
