# Hook

<p align="center">
  <a href="README.md"><strong>English</strong></a>
  ·
  <a href="README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  Open-source Windows desktop screenshot tool.
</p>

<p align="center">
  Maintained by <strong>yamiyu</strong>
</p>

<p align="center">
  <a href="https://github.com/aiaimimi0920/Hook/actions/workflows/build-hook-exe.yml"><img src="https://github.com/aiaimimi0920/Hook/actions/workflows/build-hook-exe.yml/badge.svg" alt="Build Hook EXE" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D6" alt="Windows" />
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/SolidJS-TypeScript-2C4F7C" alt="SolidJS TypeScript" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-F4EA2A" alt="MIT License" /></a>
</p>

Hook works well for quick capture and light editing.

## Table of contents

- [Why Hook](#why-hook)
- [Core capabilities](#core-capabilities)
- [Contributing](#contributing)
- [License](#license)

## Why Hook

Hook focuses on the gap between a screenshot utility and a heavier design tool:

- you can keep editing and organizing after capture
- stickers, annotations, and reference images can stay in the same desktop workspace
- the recycle bin and reference list make assets reusable
- the node canvas and local capability bridges make it more than an image collector

## Core capabilities

- **Capture and long capture**
  - region capture
  - long-capture sessions
  - file-backed capture payloads for desktop performance
- **Sticker and annotation workspace**
  - crop, border, opacity, raster effects, color pick and copy
  - text, numbering, shapes, brush, highlighter
  - recycle bin and reference list
- **Desktop workflow canvas**
  - node graph, links, grouped parameters, sync entry points
  - editing-oriented top toolbar and context menu
  - local startup helpers and single-instance control

## Contributing

Issues, build feedback, and focused improvement suggestions are welcome:

- Issues: <https://github.com/aiaimimi0920/Hook/issues>
- Local verification: run `npm run verify:local` before packaging or submitting changes.
- Public bundle identifier: `com.yamiyu.hook`. Hook keeps compatibility fallbacks for older local data directories created under `io.github.aiaimimi0920.hook` and `com.vmjcv.hook`.

## License

MIT
