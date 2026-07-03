# Hook

> Open-source Windows desktop capture, sticker editing, and node-based visual workflow workspace built with **Tauri v2 + SolidJS**.

Hook 是一个面向 Windows 的开源桌面工具，聚焦三类能力：

- **截图与长截图**
- **贴图、标注与视觉整理**
- **节点式工作流画布与本地桌面能力桥接**

它适合用作轻量截图工作台、贴图白板、视觉批注工具，以及本地 AI / 工作流桌面前端。

## Current Status

- **Platform focus**: Windows first
- **Desktop shell**: Tauri v2
- **Frontend**: SolidJS + TypeScript
- **Backend**: Rust
- **Build**: Vinxi / Vite
- **Repository state**: active development, current root docs describe the live codebase

## Core Features

- Region capture and long capture
- Overlay / canvas / tray runtime modes
- Sticker editing, crop, borders, opacity, color copy
- Text, numbering, shapes, highlighter, brush, and annotation layers
- Recycle bin and reference list
- Node graph, links, parameter panels, and workflow sync
- Local capability bridges for Talk / Loom / Tea
- Native clipboard, file dialogs, global shortcuts, and desktop launch helpers

## Repository Layout

```text
Hook/
├── src/                        # SolidJS frontend
│   ├── app.tsx                 # Main frontend controller
│   ├── components/             # UI components
│   ├── hooks/                  # Interaction hooks
│   ├── services/               # Typed API, sync, sticker logic
│   ├── store/                  # Graph/UI state
│   └── types/                  # TypeScript types
├── src-tauri/                  # Rust / Tauri backend
│   ├── src/                    # Capture, long_capture, voice, connectors
│   ├── crates/                 # Hook-owned capture crates
│   └── tauri.conf.json
├── scripts/                    # Local development and build scripts
├── __tests__/                  # Vitest contracts and unit tests
├── .github/workflows/          # GitHub Actions
└── docs/                       # Archived plans, specs, migration records
```

## Requirements

Recommended local environment:

- **Windows**
- **Node.js 20+**
- **npm**
- **Rust stable toolchain**

## Quick Start

Install dependencies:

```bash
npm install
```

Run the desktop development shell:

```bash
npm run dev:tauri
```

Notes:

- `npm run dev:tauri` is the primary desktop development entrypoint.
- `npm run dev` can still be used for frontend-only development, but it is not a full desktop runtime path.
- `npm run build && npm run serve:static` is suitable for static browser preview only.

## Testing and Verification

Useful commands:

```bash
npm run typecheck
npm run test
npm run verify:local
```

`npm run verify:local` is the main local verification gate. It runs:

1. `npm run typecheck`
2. `npm run test`
3. `npm run build`
4. `build-hook-release.bat`

## Build a Local EXE

Recommended local build command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-local-hook-exe.ps1 -Force
```

Default output:

```text
..\release\Hook\hook.exe
```

Compatibility wrappers are also kept:

- `build-hook-release.bat`
- `package-hook-release.ps1`

They ultimately delegate to the Hook-local build script.

## Launching a Built EXE

Desktop launch helpers:

- `start-hook.bat`
- `start-hook.vbs`
- `stop-hook.bat`
- `launch-config.cmd`

Typical roles:

- `start-hook.bat`: visible entrypoint
- `start-hook.vbs`: hidden-window launcher for `hook.exe`
- `stop-hook.bat`: stop an existing Hook process

## GitHub Actions

This repository includes its own Windows EXE workflow:

- `.github/workflows/build-hook-exe.yml`

It builds and uploads:

- `release/Hook/hook.exe`

The current release target is the **minimal EXE payload only**.

## Documentation Map

### Current docs

These files describe the **current** codebase and should be treated as the primary source of truth:

- `README.md`
- `PROJECT_OVERVIEW.md`
- `TECHNICAL_ARCHITECTURE.md`

### Archived docs

These locations are historical records and may not reflect the current code:

- `docs/migration/*`
- `docs/superpowers/plans/*`
- `docs/superpowers/specs/*`

If a historical document conflicts with the current implementation, prefer the root docs above.

## License

MIT
