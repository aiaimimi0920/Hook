# Getting started with Otter

[简体中文](getting-started.zh-CN.md) · [Documentation](../README.md)

Start with your first pinned image, then explore editing, nodes and projection. This guide describes current source; older releases may not include every feature.

## Prepare and launch

- Use Windows 10 or 11 with the WebView2 Runtime.
- Download the portable ZIP from [Otter Releases](https://github.com/aiaimimi0920/Otter/releases), extract it and run the included executable. Current-source builds use `otter.exe`; historical packages such as Hook v0.2.33 retain `hook.exe`. Follow the notes for your release.
- Local capture, pinned images and editing do not require Loom. OCR, translation and Loom-backed nodes require Loom separately, with the relevant capability packages installed, enabled and authorized. Starting Loom alone does not make every capability available.
- No verified combined Otter + Loom installer is provided here. See [packages, signing and local data](packages.md) for distribution details.

## 1. Capture and pin

1. Launch Otter, press **`Ctrl+1`**, and select the area to capture.
2. Move the resulting pinned image to the desired desktop position for reference or further editing.
3. Use **`Ctrl+2`** for live capture or **`Ctrl+3`** for long capture. Source compatibility and resource limits are explained in [live capture](../LIVE_CAPTURE.md).

UAC secure-desktop capture and overlays are unsupported. Live capture does not guarantee background input in every application or a fixed frame rate. See [security boundaries](../SECURITY_BOUNDARIES.md).

## 2. Edit and annotate

1. Select a pinned image and press **`Ctrl+E`** to show or hide the editing toolbar.
2. Use text, arrows, shapes, brushes, blur and other tools. Press **`Ctrl+Z`** to undo or **`Ctrl+Y`** to redo.
3. Press **`Tab`** to expand or collapse the selected image's parameter panel.
4. After leaving editing or selection mode, press **`Esc`** to delete the pinned image. An active edit draft, capture selection or dialog takes priority for cancellation or dismissal; when an annotation is selected, deletion may apply to that annotation.
5. Press **`Ctrl+S`** to save the selected image, or hold **`Shift`** to drag it into File Explorer.

Read more: [freehand editing](../FREEHAND_EDITING.md) · [Bézier editing](../BEZIER_EDITING.md) · [features and shortcuts](../FEATURES.md).

## 3. Use OCR, translation and Art nodes

Start Loom, install and enable the required capability packages, and complete Otter's connection and authorization. See [global Loom connection](../LOOM_CONNECTION.md) for connection, approval and reconnection details.

With an image selected:

| Shortcut | Action |
| --- | --- |
| **`Ctrl+4`** | Run the available OCR capability again and copy the complete result. |
| **`Alt+4`** | Toggle OCR results; recognize and display them if none exist. |
| **`Ctrl+5`** | Translate cached OCR content, recognizing first if needed. |
| **`Alt+5`** | Toggle translation results, generating the required results on first use. |
| **`Shift+1`** | Open the Art menu, then select an available capability to add a node. |

Connect nodes and assemble processing flows in Otter's node workspace; Loom supplies installed and authorized capabilities. Available nodes and parameters depend on those capabilities. OCR and translation overlays are mutually exclusive; toggling cached results does not repeat model requests.

## 4. Project a pinned image to another device

A device here means an Otter receiver that supports the existing projection protocol and has completed the required connection and authorization. It does not imply compatibility with every client or platform. Start with two Windows computers running Otter and paired to the same Loom:

1. Connect both devices to the same Loom and complete pairing and approval. Enable receiving on the receiver; new deliveries require manual approval by default.
2. On the sender, select a pinned image, press **`Ctrl+E`**, and open the projection panel below sticker settings.
3. Open the target device or device-group list and select an available target. The receiver accepts or rejects according to its policy; success is shown after the sender receives confirmation that the image was displayed.
4. Once associated, later edits on the sender continue to synchronize. Deselect the target to stop projection; closing the panel does not stop an existing association.

QR-code and link invitations are also supported. Receive them through the tray's receive-projection entry or the image's import panel. See [image projection](../QR_PROJECTION.md) for invitation expiry, cross-Loom trust, receiving policies and two-way editing limits.

## Troubleshooting

- OCR, translation or Art unavailable: check Loom connection and authorization, and whether the corresponding package is installed and enabled.
- Receiver missing: check both connections, pairing approval and the receiving policy. A connected status does not grant every remote capability.
- Unexpected shortcut behavior: check whether an image, annotation or text input is selected and whether editing is still active. Follow the current shortcut configuration.
- Before reporting, search [existing issues](https://github.com/aiaimimi0920/Otter/issues) and follow [ways to contribute](contributing.md). Include the version, reproduction steps and sanitized screenshots. Do not upload keys, tokens or private screen content.

[Capability details](capabilities.md) · [Development and verification](development.md)
