# Capability details

[简体中文](capabilities.zh-CN.md) · [Documentation / 文档中心](../README.md)

## Why Otter

Native Otter automatically discovers and connects to authenticated local Loom by
default. Set `OTTER_ENABLE_LOOM_OTTER=0` to disable integration; the legacy
`HOOK_ENABLE_LOOM_HOOK` is read only when the canonical variable is absent.
See [environment precedence](../development/RENAMING.md#环境变量).
Browser preview stays local: it does
not connect anonymously to Loom or execute real Arts. See [security boundaries](../security/SECURITY_BOUNDARIES.md#authenticated-native-local-bridge).

The explicit [global Loom connection](../features/LOOM_CONNECTION.md) remembers its last
successful target across Otter restarts. Manual disconnect cancels auto-reconnect
without deleting history; restart still requires valid device authorization.

Start Loom and open `otter.exe` directly for OCR/translation and other installed
extensions. Without Loom, local capture and editing remain available; no separate
Loom integration launcher is required.
On the ordinary Windows desktop, foreground dialogs and visibly higher external
windows take input priority over stickers; deliberate capture or sticker interaction can reclaim priority.
UAC secure-desktop capture/overlays are not supported; Otter yields input and cancels
transient gestures without changing Windows security settings.
Select an image sticker: `Ctrl+4` reruns OCR, `Alt+4` toggles OCR, `Ctrl+5` reruns
translation, and `Alt+5` toggles translation (missing results are created first).
The corresponding Loom capabilities must be installed, enabled, and authorized.

Otter combines a transparent desktop capture surface with a persistent sticker
workspace. Captures can remain on the desktop, be edited and annotated, or be
connected to local Art/Loom workflows without leaving the application.

[QR projection](../features/QR_PROJECTION.md) is available from the Ctrl+E toolbar and
links a sticker or formal Art image to another Windows Otter. Choose a shared
HTTPS Loom with device pairing and no official login, or the existing Loom
account mode. Receiver layout stays independent. Shared Loom supports online-device
selection and continuous delivery with receiver confirmation or automatic display.
Confirmation uses a compact bottom-right desktop prompt with accept, reject,
and defer actions. The receive tab exposes a persistent device-wide policy: automatic
approval, manual approval (default), or always reject. Policy changes leave existing
received stickers linked. Server authorization and deny rules still apply. A missing
saved preference defaults to manual approval; unreadable or invalid saved consent
fails closed to always reject until a valid policy is saved.
Manually trusted offline Loom peers also support delivery. Official premium relay
remains reserved. Historical isolated PC1/PC3 candidates passed checks using pinned
SSH forwarding; that evidence does not certify the current binary or direct LAN/NAT paths.

Self-hosted private-CA HTTPS Loom can use [origin-scoped process trust](../security/SECURITY_BOUNDARIES.md#origin-scoped-loom-https-trust)
for HTTP and media WSS, without changing Windows roots or device-pairing rules.
This configuration support is not direct-LAN two-machine acceptance evidence.

Projection now lives below the sticker settings panel, with send/receive icon tabs.
Receive placeholders use a gray background. The tray's checkable “自启动” item above Quit controls Windows login startup for the current user, using the executable path at enable time; re-enable after moving the portable application.
The tray's “接收投射” action creates a blank sticker and opens the same QR import dialog inside it; successful import fills that sticker. Tray shortcut hints follow the current configuration in a separate aligned column.
The fixed 320×280 target dialog uses device/group checkboxes to start or cancel
projection directly, with per-row pending/success/failure markers and safe retry.
Success follows receiver display or remote cancellation acknowledgement.
The receive tab displays both mutually exclusive flow buttons as read-only indicators.
Its QR and link import buttons open the same compact, sticker-anchored dialog with switchable QR/link tabs, also reused by tray reception, without explanatory
labels and receives content after an explicit
Import action; the sender identifier remains visible without a revision button.
Device/group/user icons show confirmed counts and open the corresponding dialog tab;
tab switching preserves its size. The source projection ID can be copied or unlinked,
and remains visible until remote unlink acknowledgement. Long target
and font lists support wheel scrolling and draggable scrollbars in the overlay.
The user dropdown reports the unavailable account service. This UI increment has
focused and browser coverage. Historical isolated candidates have also passed PC1/PC3
shared/cross-Loom policy, editing, batch-binding and stop checks over pinned SSH
forwarding; the batch check used two Loom identities on one physical receiver.
Shared and trusted cross-Loom v1 links also support opt-in two-way annotation
editing, source-controlled direction, durable retries and explicit conflict choices.
The base image stays fixed during an editing session; account-mode v2 and unsupported
annotation effects do not expose this editing capability.

## Core capabilities

### Cross-device LiveRelay

The Live capture Unit's **实时投射** panel publishes to the paired default Loom.
On the receiver, open a Surface-capable Art Unit's parameter panel, refresh the
LiveRelay list, select a session and explicitly join. This reuses the mounted
Surface attachment and server authorization; it does not grant remote control.
Closing the parameter panel keeps an established viewer open; closing it during
joining cancels that pending result. See [Live capture](../features/LIVE_CAPTURE.md).
If Loom deleted this device, choose **重新配对** to submit its existing public key again.
Loom approval, refreshing and joining remain explicit; a revoked old viewer stays closed.
The Windows [C1 H.264 path](../features/LIVE_RELAY_H264_POC.md) uses GPU capture textures,
hardware encoding and a native MF viewer decoder, with JPEG/raw compatibility.
PC1/PC3 functional evidence is separate from performance: A3-P was waived by the
user, and no throughput, CPU or physical-display improvement is claimed.
The viewer also exposes [bounded receiver diagnostics](../features/LIVE_RELAY_DIAGNOSTICS.md)
for source/epoch/frame and decoded-submitted stages, without pixels or private errors.
Actual executable/process SHA binding is external; these counters are not display FPS.

### Capture

- region capture through `Ctrl+1`;
- hovered-window targeting and double-click window capture;
- persistent single-device live capture through `Ctrl+2` or the tray. A drag
  fully contained by a valid program window keeps a fixed window-local pixel
  region when that program moves; other drags remain screen-region captures;
- repeat `Ctrl+2` for resource-admitted concurrent Live stickers, including different
  regions of the same program. Each has independent frames, placement, and input;
  closing one leaves the others running. No global desktop LIVE badge is shown;
- browser windows use the same native `Ctrl+2` capture without an extension.
  Scrolling or switching tabs changes the captured pixels; preserving the original
  webpage content across those actions is outside the Live capture scope;
- [runtime resource admission](../features/LIVE_RESOURCE_ADMISSION.md) replaces the fixed
  four-source cap: source/crop size, RAM headroom, DXGI budget and sampled CPU/load
  growth determine whether another source can start, within a 16-source safety
  ceiling. Pressure slows existing capture and rejects new work without deleting Units;
- local Live targets up to 60 FPS, using frame-ready wakeups, Windows JPEG
  encoding, and decode-before-display presentation. Actual rate depends on source
  updates, region size, hardware, and concurrent captures; queues remain bounded;
- multiple Live sources share a capture pixel/rate budget and one automatic CPU
  readback/encode permit. Hidden/offscreen views without a relay publisher reduce capture to 1 FPS and pause
  JPEG production; visible unsupported effects use bounded-rate fallback rather
  than unrestricted CPU pipelines. Layout polling shares one clock and Unit
  geometry sample. Same-window regions now [share one WGC source](../features/LIVE_SHARED_SOURCE_CAPTURE.md)
  while retaining independent crops, frame delivery, visibility and stop;
- automatic [route B GPU presentation](../features/LIVE_GPU_PRESENTATION.md) copies
  WGC textures into native swapchains without JPEG on that display branch. The
  copy/save and native Shift-drag export can request lossless GPU snapshots. The
  ordinary JPEG branch pauses CPU readback/encoding while GPU presentation is
  healthy and no relay publisher needs encoded images. JPEG/raw publishing retains
  budgeted JPEG production independently of local visibility; negotiated H.264 owns
  a separate GPU input demand and releases its JPEG demand after GPU input is available.
  Unsupported composition uses fresh decoded fallback pixels; set
  `OTTER_LIVE_GPU_PREVIEW=0` to force JPEG compatibility. This is not an FPS guarantee;
- the local live view starts at the selected screen position and contains only
  the current pixels, a theme-green border, and theme-yellow move corners.
  Drag any yellow corner to move it; clicking a captured control operates the
  source program directly. Like ordinary units, `Ctrl`+wheel resizes the live
  view around the pointer and `Alt`+wheel changes its opacity;
- same-integrity Win32/WinForms source windows, including validated child HWNDs
  hosted on another UI thread or helper process, can be logically hidden while
  capture continues, then controlled through ordered mouse, wheel, drag, and
  keyboard messages with explicit reclaim and watchdog recovery;
- Live input follows Windows UIPI direction: the same user's source may have
  equal or lower integrity than Otter. An administrator Otter is not blocked from
  controlling ordinary programs; upward, cross-user/session, and secure-desktop
  input stays blocked. Refusals appear as short Unit notices, not silent clicks;
- HDR-aware Windows 11 capture with automatic SDR fallback;
- long capture through `Ctrl+3`;
- long capture shows a scaled preview of the current stitched result beside the capture region;
- the preview's four arrow buttons move the sampling rectangle without scrolling the source;
  two-dimensional capture retains coverage and finishes with the largest fully sampled rectangle,
  rather than filling unsampled gaps;
- file-backed capture payloads to avoid unnecessary large Base64 transfers;
- native screen color picking.

### Sticker workspace

The sticker context menu's **剪贴板** submenu displays Windows clipboard history
(images and plain text only), refreshed by system clipboard events. Select an image
to create a new sticker, or text to add centered, undoable annotations to the target
sticker. Windows clipboard history must be enabled; Otter does not enable it or
store a separate clipboard archive.
Submenus shift vertically or open to the left to remain visible near screen edges;
the clipboard list supports wheel scrolling and a draggable scrollbar.

- persistent desktop stickers and a focused canvas mode;
- crop, erase, border, corner radius, opacity, rotate, flip, and beautify tools;
- text, numbering, shapes, lines, arrows, brush, highlighter, mosaic, and blur
  annotations;
- compact text/numbering properties share transparent color swatches, font selection, and 8–999 size/radius steppers for creation and selected annotations;
- with the text tool active, click an existing text annotation to edit its content; click empty space to create another text annotation;
- geometry-aware annotation selection instead of bounding-box-only hit testing;
- compact pencil/paintbrush properties with independent size, opacity and smoothing; natural speed-sensitive, lightly softened brush strokes support undo/redo and rasterization ([freehand editing](../features/FREEHAND_EDITING.md));
- editable multi-segment Bézier paths: double-click to insert anchors, drag endpoint `+` handles to extend, and right-click white anchors to delete them with undo/redo; see [curve editing](../features/BEZIER_EDITING.md);
- recycle bin, reference library, groups, history, undo, and redo;
- Unicode-safe naming for visible save, clipboard, and drag-export files;
- fast minified/full-view switching through cached composite previews;
- `Ctrl+Shift+4` cycles sticker chrome through all controls, border only and hidden;
- native Shift-drag file export to Explorer.

### Workflow and local integrations

- node canvas, links, grouped parameters, and shader previews;
- Loom capability discovery and Art execution/delivery;
- an opt-in [tile terminal](../features/TILE_TERMINAL.md) through `--tile`, presenting
  Loom-managed images, Live content and declarative Art on a selected physical
  output, with endpoint-scoped input and host-owned Art confirmation/cancellation.
  Loom can freeze, black out and resume a saved wall, with per-output application
  reports and paused input. Identify one screen by its actual output name with a
  marker lasting at most 10 seconds; Escape dismisses it without exiting the output.
  This remains an internal development slice;
  software scene/media scheduling is implemented, while physical synchronization,
  multi-computer acceptance and full long-duration tests remain pending;
- installable Loom Capability Plugins can contribute commands, shortcuts, toolbar
  menus, result attachments, overlays, and unit-scoped notices through generic host
  contracts; the official OCR package contributes its own `Ctrl+4`,
  `Alt+4`, cached full/layout copy, click-to-copy, and Shift+click multi-block
  selection behavior only while installed and enabled. The host still retains named
  OCR text-context, cached-overlay and older-snapshot renderer compatibility paths;
- OCR and translation keep independent cached results: `Ctrl+4` re-recognizes,
  `Ctrl+5` translates using existing OCR or recognizes first, and `Alt+4` / `Alt+5`
  toggle cached overlays or produce the missing result on first use. The overlays
  are mutually exclusive; hiding translation restores OCR only when it was not
  explicitly hidden. Visibility changes do not repeat OCR or model requests;
- all sticker and Art notices stay bound to their owning unit, stack in its upper-right corner, and can be dismissed one at a time;
- the official OCR package automatically performs bounded local QR/barcode
  decoding during `Ctrl+4`, then contributes generic result attachments, green hit markers, and
  click-to-copy behavior; OCR code decoding belongs to the package, separately from
  Otter's built-in projection-invitation QR import;
- optional Talk voice capture and Tea ticket creation through local capability
  bridges;
- single-instance enforcement, tray residency, runtime diagnostics, and an
  independent emergency-exit watchdog. Emergency exit uses three `Esc+Delete`
  press/release cycles with less than 400 ms between chords; both keys must be
  released between cycles. Esc alone no longer exits the application.
  `Ctrl+Alt+Shift+F12` remains the backup emergency-exit chord.

See [`docs/FEATURES.md`](../FEATURES.md) for the current shortcut and manual
regression matrix. The implementation remains the source of truth when a
document and the code disagree.
