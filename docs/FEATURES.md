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
| `Ctrl+2` | Enter live region/window capture mode. Double-click chooses a revalidated full window. A drag fully contained by one valid program window binds a fixed window-local pixel region; other drags use a screen region. | Select a 50×50 area at offset (100,100), move the source window, and confirm the view still shows that same UI area. |
| `Ctrl+3` | Enter vertical long-capture mode. | Capture a scrollable page, then cancel and retry to confirm session cleanup. |
| `Ctrl+E` | Toggle the selected sticker's editing toolbar. Enabled Capability Plugins may contribute namespaced menus and actions; no OCR menu is built into Hook core. | Toggle with no plugins installed, then enable OCR and confirm its contributed menu appears without restarting Hook and disappears on disable. |
| `Ctrl+Alt+Space` | Toggle the configured Talk voice session between start and stop. | Verify both edges and confirm dictated text is inserted only after a completed session. |
| Double `Escape` within 400 ms | Emergency exit. The main process and independent watchdog both observe distinct key presses. | Verify exit from canvas, capture, overlay, and a conflicting fullscreen application. |
| `Ctrl+Alt+Shift+F12` | Backup emergency-exit chord handled by the watchdog. | Verify it terminates Hook and restores cursor/input state. |

The tray currently exposes **Capture**, **Live capture**, **Long capture**,
**Open existing image**, and **Quit**. Live capture enters the same window-aware
selection surface: double-click selects a revalidated full window, while a drag
inside one valid window creates a window-relative region. A drag not fully
contained by one valid window creates a display-region source. The settings dialog remains implemented, but
its tray entry is temporarily hidden.

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
| `Ctrl+E` | canvas/overlay | Toggle the selected unit's sticker editing toolbar. Generic plugin menus are rendered only from active contributions. |
| `Ctrl+4` | selected unit | Not registered by Hook core. The official OCR Capability Plugin contributes re-recognition and complete-result copying while enabled. |
| `Alt+4` | selected unit | Not registered by Hook core. The official OCR Capability Plugin contributes overlay visibility and block interaction while enabled. |
| `Ctrl+Shift+4` | canvas | Toggle clean view. |
| `Q` / `W` / `E` / `R` | selected unit or sticker editing | Select the annotation transform mode: select, move, rotate, or scale. |

Single-`Escape` context actions and Double-`Escape` emergency exit are separate
mechanisms. Do not lengthen the 400 ms emergency window to compensate for missed
input; fix the input path instead.

OCR text overlays preserve native substring selection. A plain block click copies
that block; `Shift+click` toggles bounded multi-block selection without moving the
sticker. The contributed OCR toolbar can copy cached full text, reconstruct relative
layout, or copy selected blocks in reading order. Re-running OCR clears the selection.

QR/barcode recognition is a child capability of the installed official OCR
Capability Plugin. `Ctrl+4` performs text and code recognition together; the
unit toolbar intentionally exposes cached OCR actions instead of a redundant
manual code-recognition item. The package writes a generic
`neuro.official/ocr.codes.v1` attachment. `Alt+4`
toggles the text and code overlays together. Each green frame has a center
action circle that opens a package-declared panel for copying, closing, or
opening credential-free HTTPS results. Hook core does not register a decoder,
QR-specific component, or QR-specific graph port; it only provides the generic
permission-checked external URL broker.

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

All applications, including browsers, use native Live capture. Moving a source
window retains its window-local crop. Scrolling its content or switching tabs
updates the crop to the newly displayed pixels. Browser document binding and
extension installation are no longer part of this feature.

Route B native GPU presentation is automatic for eligible Windows Live images,
with `HOOK_LIVE_GPU_PREVIEW=0` forcing JPEG compatibility. See [GPU presentation](LIVE_GPU_PRESENTATION.md). Its additional
gate must prove native pixels plus the existing Unit/editor/input behavior;
ordinary browser screenshots and submission counters alone do not prove native
compositor visibility or monitor FPS. Copy/save/native Shift-drag can request a
bounded lossless GPU snapshot, with stale-result rejection and exported-file cache
invalidation. Healthy native presentation skips continuous CPU readback/JPEG;
editing, Art, stop and unsupported composition retain ordinary Unit behavior.
The gate also covers static-source fallback, capture health without encoded frames,
and an animated-source CPU sample; submission counts are not monitor FPS.

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
- Window Live crops share a WGC owner by HWND/process/size. Each Unit retains its
  delivery worker, three-frame queue and single-slot callback buffer. Slow local consumers discard obsolete
  video frames instead of blocking capture; lifecycle and errors are not placed
  in that lossy queue.
- Local video requests up to 60 FPS. A bounded frame-ready signal wakes encoding
  immediately instead of adding a second sampling interval after each JPEG.
  Full-source pixels and active consumer count reduce capture cadence under a
  shared budget, including for tiny crops of large windows. Interactive WGC pools
  use two full-source buffers. GPU contention retains/retries the newest owned
  texture, not synchronous CPU readback. Automatic fallback is globally serialized
  before staging/Map through JPEG and uses a pixel/rate budget plus measured cooldown.
  Hidden/offscreen consumers keep 1 FPS capture health but no automatic JPEG work;
  showing them resumes budgeted work. Explicit user snapshots remain independently bounded.
  Windows WIC performs full-resolution quality-82 JPEG encoding with 4:4:4 chroma;
  a logged software fallback preserves capture if the system codec fails.
  The frontend decodes the next JPEG before replacing the displayed URL, reuses
  the IPC binary view, and subtracts poll/read/decode work from the frame budget.
  Actual throughput remains source-, hardware-, size-, and concurrency-dependent.
- Repeat `Ctrl+2` after completing a selection to create resource-admitted concurrent
  local Live stickers. Same-window regions and different windows coexist; each
  session owns its crop, frame queue, input sequence, Unit, and stop channel.
- Admission uses source/crop memory estimates, available RAM, DXGI budget and
  sampled CPU/allocation growth, bounded by 16 sources rather than a fixed four.
  Pressure reduces cadence, refuses new work, and preserves existing Units.
  See [resource admission](LIVE_RESOURCE_ADMISSION.md) for limits and diagnostics.
  Creating a new selection does not replace existing Live Units. The desktop
  does not mount the global LIVE relay-panel badge; relay transport remains intact.
- The local live view starts at the selected screen rectangle and renders only
  the current frame with a theme-green border and four theme-yellow corners; it
  has no header, status panel, or visible buttons. Drag any yellow corner (or
  use `Alt`+drag) to move it, use `Alt+Shift`+drag to resize it without changing
  aspect ratio, `Ctrl`+wheel to resize around the pointer, `Alt`+wheel to change
  opacity, and `Alt+Delete` to close it. Native mouse-up, blur, pointer cancel,
  visibility loss, and teardown all terminate a local move. A non-streaming
  state does not present the last frame as healthy.
- A live drag wholly inside a declared-supported same-integrity Win32/WinForms
  window stores the selected rectangle in fixed window-local physical pixels.
  Moving the program therefore changes the absolute screen origin, not the
  captured UI region. Direct mouse, wheel, drag, and keyboard input is enabled
  automatically and uses the same cropped region transform, including across
  different Windows DPI-awareness contexts. The visible Live rectangle remains
  in logical CSS pixels while WGC frame descriptors retain physical pixel sizes.
  Every displayed pixel maps to the captured source; the yellow corner hit area
  is clipped to its L-shaped strokes so nearby source controls remain reachable.
- Live input requires the same user and session on the active default desktop;
  the source's integrity must not exceed Hook's. An elevated Hook can therefore
  control an ordinary same-user source without weakening upward-input refusal.
  Refused input remains owned by the Live content and shows a deduplicated Unit
  notice instead of falling through to ordinary sticker dragging.
- Shared Hook shortcuts take precedence over source input, including Ctrl+E,
  Tab, and Shift+1. Window blur, pointer cancellation, ending
  control, reclaim, close, and native session teardown all release tracked input.
- Same-window sessions share one visibility snapshot, keyed by HWND/process/thread
  identity. Closing one releases only its input and visibility lease; the last
  session restores the recorded source placement. Explicit source unhide is a
  window-wide action, visible to every region, not a session close. Temporary
  transparency changes during hit testing share the same lock. The independent
  watchdog uses a content-free, atomically replaced recovery journal on abnormal exit.
- Closing the source must show a real failure rather than silently retaining the
  last frame as a healthy live view. Closing the live view must stop and join its
  owner thread and clear buffered media.
- Static region/window and long-capture paths remain separate from live sessions.

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

- Art capabilities come from the current `loom.hook.v1` contract; Hook must not add
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
- Native minimize, higher-integrity targets, other Windows sessions, and secure
  desktop input remain fail-closed rather than reporting successful control.
