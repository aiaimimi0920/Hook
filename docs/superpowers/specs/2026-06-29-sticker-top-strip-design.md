# Hook Sticker Top Strip Design

**Date:** 2026-06-29

## Goal

Add a new sticker-level top strip overlay that appears whenever a sticker is selected, without replacing or refactoring the existing `StickerEditToolbar`. The new strip starts as an empty rectangular shell so later controls can be added incrementally.

## Approved Product Direction

The user approved the following product rules:

- Keep the existing sticker editing toolbar and all current UI behavior intact.
- Add a second, independent toolbar shell above the sticker.
- Show the new strip whenever the sticker itself is selected, even if the user is currently editing nodes inside that sticker.
- Do not require `activeStickerEditTargetId()` for visibility.
- For now, only render the outer frame/background; internal controls will be added later.

## Functional Requirements

### Visibility

Render the new top strip when all of the following are true:

- the unit type is `sticker`
- the unit is selected
- the sticker is not minified
- the canvas is not in clean-view mode

The strip must remain visible while the sticker stays selected, including cases where internal annotations are selected or manipulated.

### Geometry

The strip is anchored to the selected sticker's screen-space bounds.

#### Size

- fixed height: **80 px**
- minimum width: **400 px**
- preferred width: `max(400, sticker width)`
- final width must still be clamped to the visible viewport width

#### Horizontal placement

- default behavior: align the strip's **left edge** to the sticker's left edge
- if the sticker extends past the viewport's left side, align the strip's left edge to the viewport's left edge
- if the strip would extend past the viewport's right side, shift it left so the strip's right edge stays inside the viewport
- if the sticker is wider than the viewport, clamp the strip to the viewport width

#### Vertical placement

- preferred position: immediately above the sticker, touching its top edge
- if that position cannot fully show the strip, move it immediately below the sticker, touching its bottom edge
- if neither above nor below can fully contain the strip, choose the side with more available space and clamp the strip fully into the viewport

## Visual Requirements

The first implementation is intentionally minimal:

- rectangular bar
- **no rounded corners**
- visible border/base frame
- safe to extend later with interactive controls

The strip is a separate overlay from the old toolbar, not a style variant of it.

## Architecture

### New layout service

Create a dedicated layout helper for the new strip so its rules do not interfere with `StickerEditToolbar`:

- `src/services/stickerTopStripLayout.ts`

Responsibilities:

- own the constants for height and minimum width
- compute viewport-clamped `left`, `top`, `width`, and `height`
- encode the "above first, otherwise below, otherwise best-fit clamp" behavior

### New overlay component

Create a dedicated component:

- `src/components/StickerTopStrip.tsx`

Responsibilities:

- render the empty strip shell in a `Portal`
- compute layout from sticker bounds and viewport size
- stop pointer propagation so future controls can live inside it safely
- optionally register its rect in `uiRegistry` so overlay exclusion keeps working consistently with other floating UI

### UnitView integration

Modify `src/components/UnitView.tsx` so:

- the old `StickerEditToolbar` stays exactly where it is today
- the new `StickerTopStrip` is mounted independently when the sticker is selected

## Testing Strategy

### Unit tests

Add layout coverage for:

1. default above-sticker placement
2. left overflow snapping to viewport left
3. right overflow snapping inside viewport right
4. fallback from above to below
5. best-fit clamping when neither side fits
6. minimum width and fixed height behavior

### Integration / contract tests

Add source-level contract coverage for:

- existence of `StickerTopStrip`
- `UnitView` rendering it for selected stickers
- no replacement of the existing `StickerEditToolbar`
- use of the dedicated `stickerTopStripLayout` helper

## Risks and Constraints

- `UnitView.tsx` is already large, so the new strip should stay in its own component.
- The new strip must not reuse `StickerEditToolbar` layout code, because the old toolbar remains a separate UX surface.
- Future controls will expand this strip, so the first version should establish stable mounting and geometry now rather than overfitting to the current empty state.
