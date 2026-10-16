# Otter Features and Manual Regression Matrix

[Documentation](README.md) · [Getting started](guide/getting-started.md) · [中文教程](guide/getting-started.zh-CN.md)

This is a reference for current controls and manual regression scenarios, not a
record that every scenario passed on the current build. For a first session, use
the getting-started guide above. Jump to [global shortcuts](#1-native-global-shortcuts),
[frontend shortcuts](#2-frontend-shortcuts), [pointer controls](#3-pointer-and-wheel-controls),
or [sticker editing](#5-sticker-editing-regression-matrix).

## System dialog priority

On the ordinary Windows desktop, standard dialogs (`#32770`), modal-frame windows
and windows with a disabled owner take priority over existing stickers. Both the
visual overlay and native input shield go below the dialog; synthetic input excludes
its physical rectangle. Exposed stickers remain interactive. Explicit capture,
sticker interaction or focus can reclaim priority; later foreground changes or an
external click yield again. Background hit-map refreshes do not claim priority.
Maintenance uses the existing 250 ms timer and also respects visible foreign
foreground windows above the sticker host, regardless of dialog class. New button
and wheel events additionally check the actual Windows point target and relative
Z-order, so visible foreign windows cannot be accepted solely by a stale sticker
hit map. Underlying applications reached through click-through are not mistaken
for windows above the sticker. Capture and mouse-move streams retain their fast path.
Relative order is checked in both directions: Windows shell system-band dialogs
can be absent from the ordinary overlay's upward window chain. Their downward
chain must still prove that they are above the overlay; a point hit alone is not
enough to classify a click-through underlying application as an occluder.

Manual acceptance: existing sticker then file/confirmation dialog; dialog then
capture/new sticker; exposed sticker interaction; rapid alternating clicks; negative
monitor coordinates; Windows firewall permission prompts overlapping stickers;
closing the dialog; UAC/lock-desktop entry and return during
capture/drag/edit. Secure-desktop capture/overlays are unsupported: input is yielded,
transient gestures canceled, and ordinary-desktop input restored without changing UAC.
Policy/unit and hidden-HWND Z-order tests do not replace this interactive acceptance.

## Loom restart connection

Check successful connection followed by normal exit/restart, manual disconnect
followed by restart, cancellation during startup reconnect, an offline saved
target, and changed/revoked server identity. Only the saved successful target is
attempted; history alone does not authorize restart connection. Closing a dialog
does not disconnect. Device authentication and server approval remain required.

## Long-capture result preview

During native `Ctrl+3` recording, a click-through thumbnail beside the selected
region shows the current stitched result and its full output dimensions. It
prefers the right side, falls back to the left and stays within the viewport;
when neither side fits, inset placement requires successful capture exclusion.
The preview preserves the whole image's aspect ratio, updates at most twice per
second, and does not write capture files. Check first frame, continued scrolling,
reverse scrolling, pause-to-finish agreement, near-edge selection, cancellation,
restart, and exclusion failure.
Native desktop capture exclusion and input acceptance require manual verification.

The preview has up/down/left/right viewfinder buttons. Each click moves only the
sampling rectangle, by at most 64 logical pixels with overlap, clamped to the
viewport. The rectangle size, session and stitched content are preserved. The
first movement upgrades the existing aggregate to a two-dimensional covered canvas;
later samples are placed by verified overlap and viewfinder displacement (including
logical-to-physical pixel scaling). No wheel events are sent to the background.
Only these buttons intercept pointer input during recording. Controls wait for
the updated preview before accepting another move; stale-position samples are discarded.

L-shaped paths retain transparent, unsampled gaps in the preview. Finish crops to
the largest-area axis-aligned rectangle whose every pixel was sampled, discarding
the other parts of the L. Equal-area ties prefer topmost, then leftmost. Coverage
is explicit alpha, not a test for black/white pixels. Spatial capture is bounded
to 64 megapixels and 512 recorded frames. Unverifiable overlaps fail closed rather
than inventing image content. Test turns, negative-direction moves, revisits that
fill a gap, continued page scrolling after a turn, and final no-hole crop.

## System clipboard submenu

The sticker context menu ends with a compact separator and **剪贴板**. Hover or
focus it to open the scrollable Windows history list. Its custom scrollbar supports
both wheel and thumb dragging through native overlay input. All sticker submenus
align with the hovered row when space permits, shift vertically into the viewport,
and open to the left when the right side cannot fit them. Native hit rectangles
follow the relocated panels, including asynchronously loaded clipboard entries.
Only Bitmap and
Text formats are read; file lists, HTML-only data and other formats are excluded.
Images create independent stickers without replacing the target; text adds centered
annotations with undo and existing edit propagation. Multiline text becomes one
annotation per nonempty line. Check event-driven updates, empty/disabled/denied
states, selection after scrolling, menu dismissal during image decoding, and cleanup.
Windows history remains the source of truth; no separate archive or clipboard writes
are performed. Reads are limited to 25 items, 4 MiB per encoded image, 16 MiB total,
8192 pixels per image dimension, 64 MiB decode allocation, and 64 KiB/256 lines of text.
Oversized or unsupported items are skipped. Native Windows acceptance is separate
from mocked component tests and compilation.

## Text and numbering properties

With the text tool active, a single click on the topmost text annotation reopens its existing content instead of creating another annotation. The edit preserves its ID, position, font, size and style. Enter/blur commits, Escape cancels, unchanged text creates no history entry, and content changes support undo/redo. Empty space still starts a new text annotation; serial annotations keep their existing interaction.

Creation and selected-annotation properties use the compact drawing toolbar shell, aligned to the main toolbar with viewport avoidance. Text orders color, size, font; numbering orders fill, foreground, radius, font. Check alpha checkerboards and a diagonal mark at zero alpha, 8–999 integer inputs, increment/decrement and arrow keys, Enter/blur commit, Escape cancellation, font scrolling and viewport clipping. Selected edits preserve creation defaults and use the existing undo history. Numbering foreground still controls both the border and digit; this UI does not introduce separate colors or new typography options.

## Pencil and paintbrush

The pencil dropdown enables an independent natural paintbrush. Check compact color/size/opacity/smoothing fields, independent numeric profiles, equal-width pencil versus speed-sensitive, lightly softened brush rendering, a single-click dab, cancelled strokes, one history entry per stroke, undo/redo, and rasterization consistency. Legacy pencil and highlighter annotations retain their rendering. Native pressure and cross-Loom object editing are not claimed; rasterize natural brush strokes before using the existing remote edit protocol. See [freehand editing](features/FREEHAND_EDITING.md).

## Bézier path editing

Use the line-tool dropdown to create a Bézier path. Double-click a curve to insert an anchor without changing its shape; drag either endpoint's `+` handle to extend. Right-click a white anchor and choose “删除节点” to merge adjacent segments or trim the first/last segment. Deletion may change the local curve shape; at least one segment remains. Yellow tangent handles cannot be deleted separately. Check insertion, both-end extension/deletion, disabled deletion on the final segment, menu dismissal, undo/redo, and rasterization. See [curve editing](features/BEZIER_EDITING.md).

Local Loom Art/extension integration is native-only and enabled by default;
`OTTER_ENABLE_LOOM_OTTER=0` disables it. The legacy `HOOK_ENABLE_LOOM_HOOK=0`
applies only when the canonical variable is absent; see [environment precedence](development/RENAMING.md#环境变量).
In browser preview, verify that local UI/session work
still functions, no Loom request/push WebSocket is opened, and Art execution
finishes with a local unsupported error rather than uploading images or inventing
a result. A native paired-version runtime is required for real integration.

Projection target buttons show device/group/user icons and confirmed successful target counts,
and open the corresponding tab in the shared target dialog.
Receive placeholders use a gray background. The checkable tray “自启动” item controls current-user Windows login startup; re-enable it after moving the portable executable.
The tray's “接收投射” creates a blank sticker and opens the shared QR/link import panel inside it; acceptance fills the same sticker. Both receiver import buttons open this same tabbed panel with the requested method selected. Tray shortcut hints use the configured bindings and a separate aligned native menu column.
Available targets show one ID and checkbox per row; checking starts projection,
unchecking cancels it. Per-row markers distinguish pending, success and failure;
success requires receiver display or a confirmed remote unlink. Retry failed
operations inline. Group checkboxes aggregate member state and indicate partial
selection; stopping a group updates the same device rows, including overlaps.
Check long device/group and font lists with both the mouse wheel and scrollbar
drag, including the last row, Escape dismissal and restored trigger focus.
The user dropdown reports that user projection is not yet available.

The receive toolbar has a read-only flow indicator and one import button. Verify
both QR PNG and projection-link input in its compact sticker-anchored dialog, explicit Import confirmation,
error/retry feedback, Escape and focus restoration. The sender identifier remains;
the revision-number management button is removed.

This document records currently implemented user-facing controls. It is a manual
verification guide, not an implementation specification. When behavior changes,
verify the code first and update this file with the same change.

Self-hosted HTTPS Loom with a private CA supports [origin-scoped process trust](security/SECURITY_BOUNDARIES.md#origin-scoped-loom-https-trust).
Check async/blocking HTTP and LiveRelay/wall WSS together: the selected origin
accepts its valid certificate, while a wrong hostname, expired/untrusted
certificate, malformed configuration or redirect fails closed. Other origins
retain WebPKI trust. Restart Otter after a CA change; device pairing remains
mandatory. These TLS checks do not replace native two-machine projection proof.

## 1. Native global shortcuts

These shortcuts are registered by the Tauri host and can be triggered while
another application has focus.

| Shortcut | Current behavior | Manual check |
| --- | --- | --- |
| `Ctrl+1` | Enter region/window capture mode. Hovering a valid visible window highlights it; double-click captures the revalidated window target. | Test empty desktop, ordinary windows, overlapping windows, secondary monitors, and cancel with `Escape`. |
| `Ctrl+2` | Enter live region/window capture mode. Double-click chooses a revalidated full window. A drag fully contained by one valid program window binds a fixed window-local pixel region; other drags use a screen region. | Select a 50×50 area at offset (100,100), move the source window, and confirm the view still shows that same UI area. |
| `Ctrl+3` | Enter long-capture mode, with four-direction viewfinder movement during recording. | Capture a scrollable page, move the viewfinder horizontally and vertically, verify the final no-hole crop, then cancel and retry to confirm session cleanup. |
| `Ctrl+E` | Toggle sticker editing, including projection invitations, device/group multiselect and opt-in two-way v1 annotation editing. Enabled Capability Plugins may contribute namespaced menus and actions. | Select overlapping targets, retry partial sends, switch source-only direction, merge separate objects and explicitly resolve same-object conflicts. Check durable restart, Escape focus and native popup clicks. Shared Loom needs no official login; account mode keeps its login requirement and does not support two-way editing. |
| `Ctrl+Alt+Space` | Toggle the configured Talk voice session between start and stop. | Verify both edges and confirm dictated text is inserted only after a completed session. |
| Three `Esc+Delete` chords, with less than 400 ms between chords | Emergency exit. Both keys must overlap, then both must be released before the next chord counts. The main process and independent watchdog share this rule. | Verify three full press/release cycles exit; repeated Esc alone, Delete alone, autorepeat, and releasing only one key must not exit. |
| `Ctrl+Alt+Shift+F12` | Backup emergency-exit chord handled by the watchdog. | Verify it terminates Otter and restores cursor/input state. |

The tray currently exposes **Capture**, **Live capture**, **Long capture**,
**Open existing image**, **Receive projection**, checkable **Autostart**, and **Quit**.
Live capture enters the same window-aware
selection surface: double-click selects a revalidated full window, while a drag
inside one valid window creates a window-relative region. A drag not fully
contained by one valid window creates a display-region source. The settings dialog remains implemented, but
its tray entry is temporarily hidden.

Device delivery confirmation uses a bottom-right desktop prompt with accept,
reject and defer actions. Deferred invitations remain available in the receiver
panel; polling does not repeatedly reopen the same deferred prompt. Native hit
rectangles and direct synthetic input handling keep the prompt interactive.
The receive tab offers a persistent device-wide policy: automatic approval,
manual approval (default), or always reject. All sticker panels share the setting;
existing received stickers remain linked. Server authorization and deny rules are
not bypassed by local automatic approval.

## 2. Frontend shortcuts

### 实时投射（LiveRelay，不是二维码投射或屏幕墙）

- 源端：`Ctrl+2` 创建实时截图，在其 Unit 参数面板中“发布到 Loom”。
- 观看端：使用已配对的默认 Loom，打开支持 Surface 的 Art Unit 参数面板；等待 Surface
  挂载后，刷新列表、选择会话、“加入观看”。缺少绑定、源未连接或正在加入时禁用加入按钮。
- 服务端决定观看权限。加入不会请求 controller；观看窗口中的“请求控制”仍是独立操作。
- 被删除的设备可显式“重新配对”；只重新提交原 public key，不自动批准、加入或请求控制。
  新身份通过正常 Surface 重挂载获取绑定。批准后刷新、选择并加入，旧 closed viewer 不阻止
  新 viewer，但旧 relay 的身份、终态与空帧缓存不能复活。活动或 recovering viewer 仍去重。
- 检查空列表、长标题/设备 ID、键盘选择、错误/重试、连续点击、面板关闭及 Surface 换代。
  已打开窗口不因关闭参数面板而结束；未完成的加入被取消后不应留下新 viewer。
- 观看窗口的[只读诊断槽](features/LIVE_RELAY_DIAGNOSTICS.md)输出 source/epoch/frame、接收计数、
  codec/字节和解码提交耗时；epoch/停止使旧提交失效，无图像、标题或错误正文。
  原生基线必须另绑实际 EXE/进程 SHA；不把这些字段当物理 FPS 或跨机延迟。
- 原生两机、权限撤销和性能矩阵仍须按实际包验证，不把组件测试当作网络/物理显示验收。

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
| `Ctrl+4` | selected unit | Not registered by Otter core. The official OCR Capability Plugin contributes re-recognition and complete-result copying while enabled. |
| `Alt+4` | selected unit | The enabled official OCR plugin contributes this shortcut. Toggle cached OCR overlays; recognize and show them if no result exists. |
| `Ctrl+5` | selected image unit | The enabled translation plugin translates from cached OCR, recognizing first when needed. Repeated use refreshes translation while preserving OCR content. |
| `Alt+5` | selected image unit | Toggle cached translation without a model request; produce OCR and translation on first use. |
| `Ctrl+Shift+4` | canvas | Cycle sticker chrome: all controls → border only → hidden → all controls. |
| `Q` / `W` / `E` / `R` | selected unit or sticker editing | Select the annotation transform mode: select, move, rotate, or scale. |

Ordinary `Escape`/`Delete` context actions and triple-`Esc+Delete` emergency exit
are separate mechanisms. Either key may complete a chord; simultaneous means
overlapping down states, not identical event timestamps. Every cycle must release
both keys, and adjacent chord presses must be less than 400 ms apart. Holding one
key and repeatedly pressing the other does not advance the counter. Three Esc
presses alone no longer close Otter. Do not lengthen the emergency window to
compensate for missed input; fix the input path instead.

OCR text overlays preserve native substring selection. A plain block click copies
that block; `Shift+click` toggles bounded multi-block selection without moving the
sticker. The contributed OCR toolbar can copy cached full text, reconstruct relative
layout, or copy selected blocks in reading order. Re-running OCR clears the selection.

OCR and translation use separate attachments and mutually exclusive overlays.
Showing translation suppresses OCR without changing the OCR visibility preference.
Hiding translation restores OCR unless the user explicitly hid it. `Alt+4` while
translation is visible selects OCR and hides translation; a second `Alt+4` hides
OCR too. Visibility changes preserve attachment revisions, digests, text, and
geometry. Re-recognizing the image invalidates the older translation.

With the updated Loom OCR capability, each OCR block uses the dominant nearby
background color from its source region after estimated text-color exclusion.
Similar sampled colors are grouped; translation inherits the region colors rather
than a shared contrasting fill. Text contrast remains independently protected.
Legacy migration preserves available per-block background evidence. Cached results
are not silently rewritten: rerun `Ctrl+4`, then `Ctrl+5`, to refresh old colors.

The focused `ocrTranslationVisibility.test.tsx` regression drives command and
shortcut dispatch into the real attachment store and rendered overlay, including
first use, repeated toggles, persistence, and an in-flight translation.

QR/barcode recognition is a child capability of the installed official OCR
Capability Plugin. `Ctrl+4` performs text and code recognition together; the
unit toolbar intentionally exposes cached OCR actions instead of a redundant
manual code-recognition item. The package writes a generic
`neuro.official/ocr.codes.v1` attachment. `Alt+4`
toggles the text and code overlays together. Each green frame has a center
action circle that opens a package-declared panel for copying, closing, or
opening credential-free HTTPS results. Otter core does not register a decoder,
QR-specific component, or QR-specific graph port; it only provides the generic
permission-checked external URL broker.

## 3. Pointer and wheel controls

| Input | Current behavior | Manual check |
| --- | --- | --- |
| Left drag | Move a sticker/unit while preserving the initial cursor offset. | Move slowly and rapidly across monitors; the sticker must not detach or chase alternating pointer streams. |
| `Alt` + drag | Align/snap against nearby units. | Confirm Alt still reaches other applications when Otter is not handling the interaction. |
| `Ctrl` + drag | Cascade/stack placement. | Confirm final order and positions are committed once at release. |
| `Shift` + drag | Native file drag-out to Explorer or the desktop. | Confirm the exported PNG uses the shared visible filename rules. |
| `Ctrl` + wheel | Resize the hovered sticker around its intended anchor. | Check image, annotations, links, and crop geometry together. |
| `Alt` + wheel | Adjust sticker opacity. | Verify it works before and after entering edit mode. |
| Double-click sticker | Toggle minified/full view. | Test stickers with many annotations; live image and annotation layers must remain mounted and visible, without switching to a baked bitmap. |

## 4. Capture and image regression matrix

All applications, including browsers, use native Live capture. Moving a source
window retains its window-local crop. Scrolling its content or switching tabs
updates the crop to the newly displayed pixels. Browser document binding and
extension installation are no longer part of this feature.

Route B native GPU presentation is automatic for eligible Windows Live images,
with `OTTER_LIVE_GPU_PREVIEW=0` forcing JPEG compatibility. See [GPU presentation](features/LIVE_GPU_PRESENTATION.md). Its additional
gate must prove native pixels plus the existing Unit/editor/input behavior;
ordinary browser screenshots and submission counters alone do not prove native
compositor visibility or monitor FPS. Copy/save/native Shift-drag can request a
bounded lossless GPU snapshot, with stale-result rejection and exported-file cache
invalidation. Healthy native presentation skips continuous CPU readback/JPEG when
no relay publisher needs encoded frames; publishing keeps budgeted JPEG production
without disabling the native plane or multiplying CPU permits.
editing, Art, stop and unsupported composition retain ordinary Unit behavior.
The gate also covers static-source fallback, capture health without encoded frames,
and an animated-source CPU sample; submission counts are not monitor FPS.

- Region capture follows the physical cursor without losing button edges during
  fast movement.
- Window targeting excludes Otter's hidden/overlay host, desktop surfaces, taskbar,
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
  Hidden/offscreen consumers without relay publication keep 1 FPS capture health but no automatic JPEG work;
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
  See [resource admission](features/LIVE_RESOURCE_ADMISSION.md) for limits and diagnostics.
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
  the source's integrity must not exceed Otter's. An elevated Otter can therefore
  control an ordinary same-user source without weakening upward-input refusal.
  Refused input remains owned by the Live content and shows a deduplicated Unit
  notice instead of falling through to ordinary sticker dragging.
- Shared Otter shortcuts take precedence over source input, including Ctrl+E,
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
- Minify/restore keeps live content mounted and visible, clips the full-size
  content frame, and ignores baked-preview arrivals rather than replacing live layers.
- Finish a content-eraser stroke with existing blur annotations: retain the decoded
  blur until its replacement is ready, without a blank or gray flash. Increasing
  blur strength or changing geometry must not retain a weaker or misaligned frame.
- Save, clipboard image export, and drag-out use the same Unicode-safe visible
  naming templates. Internal caches and content-addressed assets do not.

## 6. Workflow and persistence regression matrix

- Art capabilities come from the current `loom.hook.v1` contract; Otter must not add
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
- Ordinary Alt key use in another application is not cancelled by Otter.
- Normal quit, emergency quit, and watchdog termination restore system cursor and
  transient input state.
- Starting Otter after a force-killed instance restores the configured system cursor
  before capture mode can begin.
- Native minimize, higher-integrity targets, other Windows sessions, and secure
  desktop input remain fail-closed rather than reporting successful control.

## 8. Tile terminal regression matrix

The opt-in `--tile` / `--tile-output` entry is described in
[TILE_TERMINAL.md](features/TILE_TERMINAL.md). It has its own output mutex and device
identity path and does not start the ordinary capture workspace.

- Images and existing Live sessions follow one versioned crop/rotation mapping;
  creating a placement does not create a second source program or capture.
- Declarative Art reuses an existing instance and one ephemeral attachment per
  output. Repeated placements share that attachment; ordinary source state and
  formal results survive view cleanup and later edits.
- Art input uses applied-layout authorization, host confirmation and declared
  cancellation. Stable controls retain text drafts while accepted edits finish;
  slow execution does not erase a newer queued absolute value edit.
- An input grant belongs to one endpoint, presenter lease, layout revision and
  placement. A contending endpoint receives a refusal without stealing control.
- Authority feedback leaves the image visible and the canvas hit-testable.
- Click, drag, wheel and keyboard produce observable effects in the source;
  dragging a push button must not activate it as a click.
- Blur, invalid layout, source loss and output crash release held source input;
  delayed network results do not restore invalid authority or old frames.
- Output loss is detected while network work is pending; stale authorization
  clears static and dynamic presentations independently of control I/O.
- Closing the manager leaves the output running. Restarting that output keeps
  the same source session and application state; closing it releases only its
  own presentation resources.
- Freeze retains only an already complete frame for the current mapping and
  presenter lease. Art polling and media decoding stop; accepted source work
  continues. Black removes all content. Both modes immediately reject new wall
  input at the daemon, release Live control and report each output's application.
- Resume advances the layout revision and loads current source state. Output
  restart, authorization loss, geometry changes or black-to-freeze cannot replay
  old frozen pixels: the output is cleared and reports `frame_unavailable`.
- Physical identification shows the enumerated output name, device/output IDs,
  pixels and a countdown, even before assigning a wall. Its lease-owned request
  lasts at most 10 seconds; repeated commands do not extend it or revise geometry.
  Management distinguishes acceptance from the output's application report and
  preserves dirty layout drafts. Covered input is paused; Escape/close dismisses
  the marker without exiting the output. Freeze/black must resume first.

`scripts/tests/Invoke-TileWallNativeInputProbe.ps1` uses an isolated packaged
daemon and terminal with a native Rust WGC/input source harness and a WinForms
client-region fixture. Its output records executable paths, digests, source
effects, teardown and measured observation latency. This is one-physical-output
evidence. `scripts/tests/Invoke-TileWallArtProbe.ps1` adds installed PowerShell
Art execution, rapid cross-field input, bounded acknowledgement stress,
confirmation/cancellation, resources and daemon/output recovery. Physical
multi-machine seams/synchronization and longer soaks remain separate acceptance
requirements.
