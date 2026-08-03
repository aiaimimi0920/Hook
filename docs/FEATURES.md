# Hook Features and Manual Regression Matrix

This document records currently implemented user-facing controls. It is a manual
verification guide, not an implementation specification. When behavior changes,
verify the code first and update this file with the same change.

## 1. Native global shortcuts

These shortcuts are registered by the Tauri host and can be triggered while
another application has focus.

| Shortcut | Current behavior | Manual check |
| --- | --- | --- |
| `Ctrl+1` | Enter region/window capture mode. Hovering a valid visible window highlights it; double-click captures the revalidated window target. | Test empty desktop, ordinary windows, overlapping windows, secondary monitors, and cancel with `Escape`. |
| `Ctrl+2` | Emit the OCR trigger to the frontend. | Confirm the intended OCR action runs without stealing unrelated modifier input. |
| `Ctrl+3` | Enter vertical long-capture mode. | Capture a scrollable page, then cancel and retry to confirm session cleanup. |
| `Ctrl+E` | Toggle the sticker editing toolbar. | Invoke it with a selected sticker and confirm focus moves to Hook. |
| `Ctrl+Alt+Space` | Toggle the configured Talk voice session between start and stop. | Verify both edges and confirm dictated text is inserted only after a completed session. |
| Double `Escape` within 400 ms | Emergency exit. The main process and independent watchdog both observe distinct key presses. | Verify exit from canvas, capture, overlay, and a conflicting fullscreen application. |
| `Ctrl+Alt+Shift+F12` | Backup emergency-exit chord handled by the watchdog. | Verify it terminates Hook and restores cursor/input state. |

The tray currently exposes **Capture**, **Long capture**, **Open existing image**,
and **Quit**. The settings dialog remains implemented, but its tray entry is
temporarily hidden.

## 2. Frontend shortcuts

These controls are context-sensitive. Most are ignored while the event target is
an input, textarea, or content-editable element; `Escape` remains active for
cancel/delete semantics.

| Shortcut | Context | Current behavior |
| --- | --- | --- |
| `Ctrl+C` / `Ctrl+V` | selected unit / canvas | Copy the selected unit or paste an internal unit, system image, or file payload. |
| `Ctrl+O` | canvas | Open an existing image for editing. |
| `Ctrl+H` | canvas | Toggle screenshot/color history. |
| `Ctrl+S` | selected unit | Save the selected image. |
| `Ctrl+Z` / `Ctrl+Y` | selected unit | Undo or redo sticker edits. |
| `Delete` / `Backspace` / `Escape` | selected unit | Delete the selected unit. |
| `Escape` | capture selection | Cancel the current screenshot selection. |
| `Escape` | sticker editing | Cancel the uncommitted sticker edit draft. |
| `Shift+1` (`Shift+!`) | selected unit | Toggle the compact Art actions menu. |
| `Tab` | selected unit | Toggle the parameter panel. |
| `Ctrl+E` | canvas/overlay | Toggle the sticker editing toolbar. |
| `Alt+2` | selected unit | Toggle OCR visibility. |
| `Alt+3` | selected unit | Toggle translation visibility. |
| `Ctrl+4` | canvas | Toggle clean view. |
| `Q` / `W` / `E` / `R` | selected unit or sticker editing | Select the annotation transform mode: select, move, rotate, or scale. |

Single-`Escape` context actions and Double-`Escape` emergency exit are separate
mechanisms. Do not lengthen the 400 ms emergency window to compensate for missed
input; fix the input path instead.

## 3. Pointer and wheel controls

| Input | Current behavior | Manual check |
| --- | --- | --- |
| Left drag | Move a sticker/unit while preserving the initial cursor offset. | Move slowly and rapidly across monitors; the sticker must not detach or chase alternating pointer streams. |
| `Alt` + drag | Align/snap against nearby units. | Confirm Alt still reaches other applications when Hook is not handling the interaction. |
| `Ctrl` + drag | Cascade/stack placement. | Confirm final order and positions are committed once at release. |
| `Shift` + drag | Native file drag-out to Explorer or the desktop. | Confirm the exported PNG uses the shared visible filename rules. |
| `Ctrl` + wheel | Resize the hovered sticker around its intended anchor. | Check image, annotations, links, and crop geometry together. |
| `Alt` + wheel | Adjust sticker opacity. | Verify it works before and after entering edit mode. |
| Double-click sticker | Toggle minified/full view. | Test stickers with many annotations; the transition should use the cached composite rather than rebuild the scene synchronously. |

## 4. Capture and image regression matrix

- Region capture follows the physical cursor without losing button edges during
  fast movement.
- Window targeting excludes Hook's hidden/overlay host, desktop surfaces, taskbar,
  hidden windows, and unsuitable tool windows.
- Final window capture revalidates the target instead of trusting a stale hover
  rectangle.
- HDR capture is attempted only for an eligible Windows 11 HDR display; unsupported
  or SDR-only paths fall back to SDR without failing the capture.
- Long capture remains SDR by design.
- Capture payloads may be file-backed; callers must not assume every image arrives
  as a large Base64 string.

## 5. Sticker editing regression matrix

- Crop updates the sticker's effective content dimensions and propagates the new
  geometry to matched-size/centered views.
- Erase, brush, highlighter, mosaic, blur, line, arrow, text, number, and shape
  previews update interactively and commit history once when the gesture ends.
- Annotation selection uses geometry-aware hit testing after a bounds prefilter;
  blank space inside a freehand annotation's bounding box must not select it.
- Annotation movement previews with an imperative transform and commits actual
  coordinates once on release.
- Minify/restore keeps the live content mounted and uses the current baked
  composite when available.
- Save, clipboard image export, and drag-out use the same Unicode-safe visible
  naming templates. Internal caches and content-addressed assets do not.

## 6. Workflow and persistence regression matrix

- Art capabilities come from the current Loom/AHRP contract; Hook must not add
  per-Art executors or legacy compatibility branches without an active protocol
  requirement.
- Shader-backed Art parameters should update the preview immediately through the
  general preview pipeline.
- Session load preserves readable data and reports unknown fields without rejecting
  a session solely because of schema drift.
- Restart restores units, links, groups, recycle bin, reference library, history,
  tool settings, and application settings through their current persistence paths.
- Removing or replacing a workspace/unit invalidates its related bounded caches.

## 7. Visibility and safety regression matrix

- A sticker intercepts pointer input only when its overlay is actually visible and
  not occluded by an exclusive/fullscreen foreground surface.
- Ordinary Alt key use in another application is not cancelled by Hook.
- Normal quit, emergency quit, and watchdog termination restore system cursor and
  transient input state.
- Starting Hook after a force-killed instance restores the configured system cursor
  before capture mode can begin.
