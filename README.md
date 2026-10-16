<p align="center"><img src="./src-tauri/icons/otter-icon.svg" width="80" height="80" alt="Otter capture icon"></p>
<h1 align="center">Otter</h1>
<p align="center"><strong>Capture it. Pin it. Make it yours.</strong><br>Connect nodes. Create effects. Turn your desktop into a creative workspace.</p>
<p align="center">
  Website ·
  <a href="https://github.com/aiaimimi0920/Otter/releases">Download</a> ·
  <a href="./docs/README.md">Documentation</a> ·
  <a href="https://github.com/aiaimimi0920/Otter/issues">Feedback</a>
</p>
<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-36564f?style=flat-square" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/platform-Windows_10_%2F_11-36564f?style=flat-square" alt="Windows 10 / 11">
  <a href="https://github.com/aiaimimi0920/Otter/actions/workflows/build-otter-exe.yml"><img src="https://github.com/aiaimimi0920/Otter/actions/workflows/build-otter-exe.yml/badge.svg" alt="Build Otter EXE"></a>
</p>
<p align="center">English · <a href="./README.zh-CN.md">简体中文</a></p>

Otter is a free, open-source screenshot tool that brings capturing, annotating,
organizing and sharing into your everyday work. Turn your desktop into a workbench:
connect different processing nodes to combine functions, create effects and
explore more possibilities for the images you capture.

<details open>
<summary>Desktop workspace · Show / hide animation</summary>

<p align="center">
  <img src="./docs/assets/otter-workflow-demo-v2.gif" width="860" alt="Otter workflow demo: capture, translation, node processing, two-way projection, annotation, editing and drag-and-drop saving.">
</p>

</details>

[Features](#features) · [Get started](#get-started) · [Contribute](#contributing)

## Features

- **Capture the view you want.** Take region, window and scrolling screenshots, and pick colors from the screen.
- **Pin images to your desktop.** Keep references in view and organize your material with groups, the library and history.
- **Annotate freely and keep editing.** Crop, erase and rotate; add text, arrows and shapes; hide information with blur and mosaic.
- **Keep pinned images live.** Turn a window or part of the screen into a live pinned view to follow changing content and interact with supported source windows.
- **Connect nodes and combine effects.** Use Loom's OCR, translation and Art capabilities, connecting nodes to build your own processing flows.
- **Project your view to other devices.** Send images or live views to connected, paired devices for viewing and collaboration across screens.

[**Full features →**](./docs/FEATURES.md)

## Get started

- **Capture and pin:** Capture any area of your desktop and pin it anywhere on the desktop.
- **Edit quickly:** Use the editing toolbar to quickly annotate pinned images.
- **Connect a workflow:** Use Loom's node tools to assemble advanced workflows.
- **Share the view:** Use the push tools to send a pinned image's content to any client.

| Start here | What you need to do |
| --- | --- |
| [Download Otter](https://github.com/aiaimimi0920/Otter/releases) | Extract and launch the Otter App to get started. |
| Download Otter + Loom | Extract and launch the Otter App and Loom App. Install capability packages such as OCR and translation in Loom, and add commonly used MCP tools and Art nodes as needed to expand your creative workflow. |

1. Press **`Ctrl+1`** for a region screenshot, **`Ctrl+2`** for live capture, or **`Ctrl+3`** for a scrolling screenshot.
2. Select a pinned image and press **`Ctrl+E`** to show or hide the editing toolbar, or **`Tab`** to expand or collapse the parameter panel. After leaving editing or selection mode, press **`Esc`** to delete the pinned image.
3. With the corresponding Loom capabilities available, press **`Ctrl+4`** for OCR and **`Alt+4`** to toggle recognition results; press **`Ctrl+5`** to translate and **`Alt+5`** to toggle translation results; press **`Shift+1`** to open the Art menu and add a new node.
4. Select a pinned image, open the toolbar, and choose the projection button to project the pinned image to any connectable device.

[**Complete usage guide →**](./docs/guide/getting-started.md)

## Contributing

Bug reports, translations, documentation improvements and code contributions are welcome.
Start with [ways to contribute](./docs/guide/contributing.md) or the
[translation guide](./docs/guide/translating.md), and explore the
[repository layout](./TECHNICAL_ARCHITECTURE.md#2-repository-layout) to understand the code structure.
Code changes follow the [engineering contribution guide](./CONTRIBUTING.md).
Search [existing issues](https://github.com/aiaimimi0920/Otter/issues) before reporting a problem.

## License

Otter-owned code is [MIT licensed](./LICENSE). Dependencies retain their own
[licenses and notices](./THIRD_PARTY_NOTICES.md).
