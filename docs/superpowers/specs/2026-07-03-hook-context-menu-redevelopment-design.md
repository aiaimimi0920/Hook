> **Archived note:** This file is kept for historical design context and may not reflect the current Hook codebase. 当前实现请以仓库根目录 `README.md`、`PROJECT_OVERVIEW.md`、`TECHNICAL_ARCHITECTURE.md` 为准.

# Hook Context Menu Redevelopment Design

**Date:** 2026-07-03

## Goal

Rebuild Hook's sticker right-click menu on top of the stable `v6版本` baseline without reusing any post-v6 context-menu implementation code, while preserving the existing `Ctrl+1 / Ctrl+3` screenshot capture paths.

## Non-Negotiable Development Rules

The user explicitly required the following constraints:

- Treat all prior post-v6 context-menu implementation code as **broken and unusable**.
- Do **not** reference or migrate that old implementation into the new work.
- Keep development focused inside the Hook subproject:
  - `C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook`
- Split implementation into multiple stages with intermediate testing after each stage.
- Protect the current working screenshot entry paths, especially:
  - `Ctrl+1`
  - `Ctrl+3`

This design therefore treats the current `v6版本` codebase as the only implementation baseline and rebuilds the feature from first principles.

## Product Scope

This redesign includes only:

1. sticker-level right-click menu
2. recycle-bin list behavior
3. reference-library list behavior
4. session-level persistence for those two collections
5. menu hit-testing, layering, and event swallowing

This redesign does **not** include:

1. rewriting screenshot capture flows
2. replacing existing save shortcut behavior
3. replacing or redesigning unrelated sticker editing features
4. reworking the old or new toolbar systems
5. any dependency on the broken post-v6 context-menu code

## Approved Interaction Decisions

The user approved the following detailed interaction contract:

### Persistence

- recycle bin and reference library are persisted by extending the existing `session.json`
- no second sidecar persistence file is introduced

### Snapshot semantics

- recycle-bin entries store a **full frozen sticker snapshot**
- reference-library entries store a **full frozen sticker snapshot**
- those snapshots preserve the sticker's visible edited state at the time of capture
- reference snapshots do **not** live-update when the source sticker changes later

### Reference-state behavior

- once a sticker is marked as reference, its menu keeps showing **Cancel Reference**
- the saved reference entry remains the old frozen snapshot
- if the user wants a new version in the reference list, they must:
  1. cancel reference
  2. set reference again

### Menu ownership

- only one context-menu instance may exist globally at a time
- right-clicking a sticker first selects that sticker, then opens its menu

### Restore / copy placement

- both recycle-bin restore and reference-library copy create a **new sticker instance**
- neither action restores the original runtime identity
- both actions place the new sticker near the interaction point
- placement rule:
  - use the right-click mouse position as the anchor
  - offset the new sticker by **(+50, +50)** relative to that mouse position
  - treat that offset point as the new sticker's top-left position

### Menu close model

- clicking outside the menu closes it
- pressing `Esc` closes it
- right-clicking another sticker closes the old menu and opens a new one
- if the target sticker disappears, the menu closes

## Architecture Overview

The redesign follows an isolation-first architecture:

1. **session/data layer**
   - recycle bin
   - reference library
   - snapshot capture and instantiation
2. **menu state/controller layer**
   - current menu target
   - current mouse anchor
   - active submenu
3. **menu UI layer**
   - top-level menu overlay
   - primary menu panel
   - secondary thumbnail list panels
4. **hit-test / event-safety layer**
   - menu rectangles registered into the existing overlay hit-map path
   - menu DOM swallowing to prevent bubbling into stickers

These layers are intentionally separate so the feature can be implemented and tested in stages without destabilizing capture.

## Existing Code Constraints

The current `v6版本` baseline already contains these sensitive systems:

- global screenshot shortcut registration in:
  - `src-tauri/src/lib.rs`
- app boot, capture listeners, and high-level overlay behavior in:
  - `src/app.tsx`
- session restore/save bridge in:
  - `src/services/syncService.ts`
  - `src/services/api.ts`
- sticker rendering and per-sticker interaction in:
  - `src/components/UnitView.tsx`

The redesign must plug into these systems without changing the meaning of the current capture state machine.

## Data Model Design

### Session file extension

The existing Rust `SessionData` structure will be extended from:

- `stickers`
- `links`
- `groups`

to:

- `stickers`
- `links`
- `groups`
- `recycleBin`
- `referenceLibrary`

Both new fields must be optional on read and default to empty arrays when loading older session files.

### Snapshot entry model

Both recycle-bin and reference-library collections use frozen entries, not live references to active stickers.

Each entry stores:

- entry id
- source sticker id at time of snapshot
- creation timestamp
- full frozen sticker snapshot payload
- any light metadata needed for UI state checks

### Sticker snapshot content

The frozen snapshot preserves the full visible sticker state needed to recreate what the user saw when the snapshot was captured, including the current edited image state and sticker-local visual state. The exact stored fields should be derived from the existing sticker session shape rather than invented separately, so the recreated sticker behaves like a normal persisted sticker.

### New-instance restoration rule

When restoring from recycle bin or copying from reference library:

- generate a fresh sticker id
- generate a fresh runtime instance
- do not reuse the old sticker id
- do not restore the old absolute placement
- place the new sticker at:
  - `x = menuMouseX + 50`
  - `y = menuMouseY + 50`

This ensures restore and copy are user-local actions near the current mouse context rather than hidden remote state restores.

### Recycle-bin rules

- max retained entries: **10**
- when adding the 11th entry:
  - drop the oldest one
- left click on an entry:
  - create a new sticker instance from snapshot
  - remove that entry from recycle bin
- right click on an entry:
  - permanently remove it from recycle bin

### Reference-library rules

- entries are persistent until explicitly removed
- setting reference adds a frozen snapshot if the current sticker is not already marked
- cancelling reference removes the linked entry for that sticker
- left click on an entry:
  - create a new sticker instance from snapshot
  - keep the entry in the library
- right click on an entry:
  - remove the entry from the library

## UI and State Design

### Global controller

The menu system is controlled by a single global controller, not by ad hoc local component state inside each sticker.

The controller owns:

- whether the menu is open
- target sticker id
- anchor mouse position
- active submenu:
  - none
  - recycle bin
  - reference library

### Open flow

On right-click of a sticker:

1. prevent native browser context menu
2. select that sticker
3. update the global controller with:
   - target sticker id
   - mouse x
   - mouse y
   - submenu = none
4. render the primary menu

### Primary menu content

The primary menu contains:

1. Close
2. Save
3. Recycle Bin
4. Clear Recycle Bin
5. Set Reference / Cancel Reference
6. Reference Library
7. Clear Reference Library

The Set/Cancel item text is state-dependent based on whether the selected sticker currently owns an active reference entry.

### Secondary menu model

Only one secondary menu can be open at a time.

- hovering Recycle Bin opens the recycle-bin thumbnail list
- hovering Reference Library opens the reference-library thumbnail list
- moving from one to the other switches the active submenu

### Rendering model

The menu must not be buried inside the sticker's clipped visual container.

Instead, it is rendered as a top-level overlay layer, ideally through a portal-style mount, so it is not affected by sticker crop/minify overflow behavior.

## Hit Testing and Event Safety

### Why this matters

Hook is not a plain webpage. It already uses an overlay hit-map and cursor-ignore behavior to control when the window should accept input. Therefore the new menu cannot rely on DOM visibility alone.

If the menu is visible but not represented in the overlay hit-map, it can become visible-but-unclickable.

### Layered defense

The redesign uses two independent protections:

1. **overlay hit-map registration**
   - ensure the window accepts pointer interaction over the visible menu
2. **DOM event swallowing**
   - ensure events that enter the window do not bubble through to the sticker underneath

Both are required.

### Hit-map strategy by stage

#### Stage 2: primary menu

Register a coarse menu bounding rectangle for the entire primary menu panel.

Purpose:

- make the full menu reliably clickable
- prevent immediate click-through failures
- avoid over-engineering the first interactive stage

#### Stage 3: secondary menus

When a submenu is open, register:

1. primary menu rectangle
2. active submenu rectangle
3. bridge rectangle between the hovered parent item and the submenu panel

The bridge rectangle is required so the mouse can travel from primary item to submenu without passing through a dead gap.

### Empty-area swallowing rule

Visible empty space inside the menu system is still interactive swallow area, not transparent pass-through area. This includes:

- panel padding
- gaps between menu items
- submenu background
- scroll container blank space
- parent/submenu bridge space

This is an explicit requirement because prior failures came from "visible but hollow" menu regions.

## Capture Isolation Rules

To protect `Ctrl+1 / Ctrl+3`, the redesign enforces these rules:

### Rule 1: capture start closes menus

Whenever the app enters any screenshot capture selection state:

- close primary menu
- close any active submenu

### Rule 2: no menu opening during capture selection

While the app is in active capture selection or long-capture selection state:

- sticker context menus cannot be opened

### Rule 3: menu system does not drive capture state

The menu system may:

- read selected sticker state
- read mouse anchor position
- trigger sticker close/save/reference/recycle operations

The menu system may **not**:

- modify capture hotkey registration
- alter the meaning of existing capture mode state
- change Rust shortcut handler semantics

## Proposed Code Boundaries

### Existing files to extend

- `src/app.tsx`
  - top-level menu layer mounting
  - capture/menu isolation coordination
- `src/components/UnitView.tsx`
  - right-click hook for sticker target selection + menu open
- `src/services/api.ts`
  - extended session data types
- `src/services/syncService.ts`
  - extended session restore/save bridge
- `src-tauri/src/lib.rs`
  - session schema extension
  - load/save compatibility

### New frontend files

- `src/services/stickerSnapshot.ts`
  - capture frozen sticker snapshots
  - instantiate new stickers from snapshots
- `src/services/stickerLibraryModel.ts`
  - recycle-bin and reference-library pure data operations
- `src/services/stickerContextMenuController.ts`
  - global menu state and transitions
- `src/components/StickerContextMenuLayer.tsx`
  - top-level overlay/portal host
- `src/components/StickerContextMenuPanel.tsx`
  - primary menu
- `src/components/StickerSnapshotListPanel.tsx`
  - reusable submenu thumbnail list panel

The first implementation should prefer small focused files rather than injecting large new logic blocks into `app.tsx` or `UnitView.tsx`.

## Testing Strategy

Implementation must be staged and verified after each stage.

### Stage 1: data-only verification

Verify:

- recycle-bin enqueue
- max-10 retention
- oldest eviction
- restore removes recycle entry
- reference add/remove
- frozen snapshot remains unchanged after source sticker edits
- session save/load roundtrip for recycle bin and reference library

No UI should be required for this stage.

### Stage 2: primary menu verification

Verify:

- right-click selects target sticker first
- only one menu exists globally
- outside click closes menu
- `Esc` closes menu
- primary actions work
- menu area does not click through to sticker

Required regression checks:

- `Ctrl+1` still opens normal capture
- `Ctrl+3` still opens long capture
- opening capture closes menus

### Stage 3: secondary menu verification

Verify:

- recycle-bin submenu opens from hover
- reference-library submenu opens from hover
- only one submenu at a time
- recycle-bin left click restores a new sticker instance
- recycle-bin right click deletes entry
- reference-library left click copies a new sticker instance
- reference-library right click removes entry
- new instances spawn at `(mouseX + 50, mouseY + 50)`

### Stage 4: hit-test and swallow verification

Verify:

- menu blank areas do not pass hover/click through
- submenu bridge area does not collapse interaction
- visible menus are fully clickable
- closing the menu clears any temporary interactive overlay rectangles

### Stage 5: visual polish verification

Verify:

- no redundant labels
- no redundant size/time/help text
- submenu default height is visibly larger than old expectations
- thumbnail browsing is easier

## Failure Policy

If any stage is unstable, implementation must stop and repair that stage before proceeding. This redesign explicitly rejects the prior "keep piling fixes on a broken interaction stack" failure mode.

## Acceptance Criteria

The redesign is only complete when all of the following are true:

- right-clicking a sticker reliably opens the primary menu
- the right-click target becomes selected first
- all primary actions are clickable
- recycle bin retains only the latest 10 entries
- recycle restore removes the restored entry
- reference add/remove text switches correctly
- reference-library copy keeps the library entry
- restored/copied stickers spawn near the interaction point with a fixed `(50, 50)` offset
- recycle bin and reference library persist inside `session.json`
- menu and submenu visible areas do not leak pointer events to the underlying sticker
- capture shortcuts still work and are not behaviorally regressed

## Implementation Recommendation

Use the staged isolation-first approach:

1. data layer
2. primary menu
3. secondary menus
4. hit-test / swallow hardening
5. visual polish

That sequence best satisfies the user's requirement for multiple development passes with intermediate testing and the requirement to avoid repeating the broken post-v6 implementation path.
