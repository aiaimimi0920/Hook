> **Archived note:** This file is kept for historical design context and may not reflect the current Hook codebase. 当前实现请以仓库根目录 `README.md`、`PROJECT_OVERVIEW.md`、`TECHNICAL_ARCHITECTURE.md` 为准.

# Hook Editing Taxonomy Design

**Date:** 2026-06-28

## Goal

Rebuild Hook's sticker-editing UX and state model around three explicit editing domains so that transform modes, node creation, and whole-sticker processing no longer compete for the same toolbar and event-routing semantics. Use this refactor to make the move tool reliably move a single selected node again.

## Problem Summary

The current Hook editor already split `transformMode` from `activeTool`, but the UI and interaction layer still mix three different concerns:

1. **Editing existing nodes** via Q/W/E/R.
2. **Creating new nodes** such as shapes, text, serial numbers, brushes, mosaic, and blur.
3. **Processing the whole sticker** such as crop, content eraser, border, corner radius, opacity, canvas size, and rasterization.

This creates unstable classification, confusing toolbar layout, and interaction ambiguity inside `StickerAnnotationLayer.tsx`, where pointer routing still has to infer intent from a long condition chain. The repeated "move tool cannot move a single node" bug strongly suggests the current state/event model is still too mixed.

## Approved Product Direction

The user approved:

- Split the UI by **object of operation** rather than by old tool buckets.
- Use a **two-column editor**:
  - Left column: top-level editing domain.
  - Right column: tools and properties for that domain.
- Use three domains:
  - **Existing nodes**
  - **Create nodes**
  - **Whole-sticker processing**
- Keep node-property editing as a **contextual inspector** inside the existing-node domain, not as a separate top-level category.

## Information Architecture

### 1. Existing Nodes

Purpose: modify annotations that already exist.

Contents:

- Transform modes:
  - Select (`Q`)
  - Move (`W`)
  - Rotate (`E`)
  - Scale (`R`)
- Selection summary:
  - no selection
  - single selection
  - multi-selection
- Contextual node properties:
  - text: font, size, color, content
  - serial: font, radius, stroke/fill
  - shapes: stroke/fill/width/radius/sides
  - lines: width/dash/arrow/color
  - brush/highlighter: color/width
  - mosaic/blur nodes: brush size/strength

### 2. Create Nodes

Purpose: create new annotation nodes.

Categories:

- Shapes
- Paint
- Text markers
- Effects

Tools:

- Shapes: rect, round rect, ellipse, triangle, polygon, line, arrow
- Paint: brush, highlighter
- Text markers: text, serial
- Effects: mosaic, blur

Properties shown here are **default creation values**, not the live values of an existing selected node.

### 3. Whole-Sticker Processing

Purpose: modify the sticker itself rather than annotations.

Categories:

- Geometry
- Erase
- Appearance
- Canvas / Finalize

Tools/commands:

- Geometry: crop, flip X, flip Y
- Erase: content eraser
- Appearance: border, corner radius, opacity
- Canvas / Finalize: scale frame, rasterize selected, rasterize all, undo, redo

## Interaction Model

### Cross-cutting classification

Every editor action belongs to both:

1. A **domain**: existing / create / sticker
2. A **role**:
   - mode
   - tool
   - property
   - command

This resolves the old ambiguity where `crop`, `content-eraser`, and `color-picker` were squeezed into the same category system as node-creation tools.

### Domain persistence

Switching domains should preserve the last active state for each domain:

- existing domain remembers the last transform mode
- create domain remembers the last creation category and tool
- sticker domain remembers the last whole-sticker subcategory and interactive tool

Selection should remain available across domains, but only affects behavior where relevant.

### Keyboard behavior

- `Q/W/E/R` always switches to the **existing-node domain** and activates the corresponding transform mode.
- Clicking a node-creation tool switches to the **create domain**.
- Clicking crop or content eraser switches to the **whole-sticker domain**.

### Existing-node domain

- Pointer priority is always existing-node interaction.
- Q mode keeps the approved Godot-style modifiers:
  - drag: move
  - `Ctrl + drag`: rotate
  - `Alt + drag`: constrained move via axis gizmo
  - `Ctrl + Alt + wheel`: scale
- W mode: move gizmo is explicit and persistent.
- E mode: rotate around fixed center pivot.
- R mode: scale around fixed center pivot.
- Multi-select defaults to group-center rotate/scale.
- Multi-select + `Shift` switches rotate/scale to per-node centers.
- Text and serial nodes move/rotate/scale as nodes, but their internal text remains readable.

### Create-node domain

- Pointer priority is always new-node creation.
- Existing nodes remain visible but do not steal creation input.
- To modify existing nodes, the user must switch back to the existing-node domain.

### Whole-sticker domain

- Pointer priority is always whole-sticker processing.
- Crop and content eraser are interactive whole-sticker tools, not creation tools.
- Flip X / Flip Y are commands.
- Appearance edits affect the sticker container, not annotation defaults.

## State Model

Introduce explicit domain-aware state:

```ts
type StickerEditingDomain = "existing" | "create" | "sticker";
type StickerCanvasTool = "idle" | "crop" | "content-eraser";
```

Refactor persisted tool settings toward:

```ts
interface StickerToolSettings {
  domain: StickerEditingDomain;
  transformMode: StickerTransformMode;
  activeCreateTool: StickerCreateTool;
  activeCanvasTool: StickerCanvasTool;
  // existing numeric/color/font defaults...
}
```

Key changes:

- `StickerCreateTool` becomes creation-only.
- `crop`, `content-eraser`, and `color-picker` are removed from `StickerCreateTool`.
- `mode` stops being a runtime source of truth and becomes legacy-compatibility input only, if kept at all.

## UI Architecture

Restructure the toolbar into a domain shell and focused subpanels.

Recommended files:

- `src/components/StickerEditToolbar.tsx`
  - shell, positioning, high-level composition
- `src/components/StickerEditDomainNav.tsx`
  - left-side domain selector
- `src/components/StickerExistingNodePanel.tsx`
  - Q/W/E/R, selection summary, contextual inspector
- `src/components/StickerCreateNodePanel.tsx`
  - create categories, create tools, default parameters
- `src/components/StickerCanvasPanel.tsx`
  - geometry/erase/appearance/finalize controls

`stickerToolbarModel.ts` should evolve from one mixed tool list into:

- domain definitions
- create-domain categories
- sticker-domain categories
- helper labels and mappings

## Interaction-Layer Architecture

`StickerAnnotationLayer.tsx` should route by domain first:

```ts
switch (stickerToolSettings.domain) {
  case "existing":
    // transform / select / selected-node editing
    break;
  case "create":
    // create annotations only
    break;
  case "sticker":
    // crop / content eraser / sticker-only interactions
    break;
}
```

This is the main structural fix for the move-tool regression: it prevents creation and sticker-processing logic from competing with node-transform input.

## Move-Tool Root-Cause Hypothesis

The earlier hit-test fixes were necessary but did not fully solve the bug because the single-node move issue likely comes from mixed routing semantics rather than pure geometry:

- W mode can be visually active while the interaction path still depends on other tool state.
- `activeTool` currently contains non-creation modes such as crop/content eraser.
- `StickerAnnotationLayer.tsx` still has a long interleaved decision tree instead of domain-first dispatch.

The refactor should be validated specifically against single-node move in W mode and direct drag in Q mode for all major annotation types.

## Rollout Strategy

1. Add domain-aware state and persistence normalization.
2. Rebuild the toolbar into left-domain + right-panel layout.
3. Move crop/content eraser out of creation-tool semantics.
4. Refactor `StickerAnnotationLayer.tsx` to dispatch by domain first.
5. Re-run transform/move regression coverage.
6. Build a fresh release for manual testing.

## Test Strategy

### Automated

- state normalization tests for domain/create/canvas split
- contract test for toolbar/domain architecture
- regression tests for W-mode single-node movement
- regression tests for create-domain pointer priority
- regression tests for sticker-domain crop/content-eraser priority

### Manual

- W mode moves a single node
- Q mode drag still moves a single node
- switching to create domain no longer selects existing nodes on pointer down
- switching to sticker domain makes crop/content eraser exclusive
- text/serial default fonts vs live selected-node fonts remain correct

## Non-Goals for This Iteration

- Large-scale batch property editing for mixed multi-selection
- Full visual redesign outside the sticker editor panel
- Unrelated subproject changes outside `Neuro/Hook`

## Risks

- The toolbar component is already large, so partial migration can leave duplicate logic if not carefully cut over.
- Persistence compatibility must not lose user defaults for text/serial fonts.
- Move-tool fixes should not regress Q-mode modifier shortcuts.

## Acceptance Criteria

- The sticker editor clearly separates existing-node editing, node creation, and whole-sticker processing.
- `crop` and `content-eraser` are no longer modeled as creation tools.
- Q/W/E/R always operate within the existing-node domain.
- Single-node move works reliably in W mode.
- A fresh Hook release is generated after verification.
