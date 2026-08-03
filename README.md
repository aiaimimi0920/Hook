# Hook

<p align="center">
  <a href="README.md"><strong>English</strong></a>
  ·
  <a href="README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  Windows-first desktop capture, sticker editing, and visual workflow workspace.
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

## Why Hook

Hook combines a transparent desktop capture surface with a persistent sticker
workspace. Captures can remain on the desktop, be edited and annotated, or be
connected to local Art/Loom workflows without leaving the application.

## Core capabilities

### Capture

- region capture through `Ctrl+1`;
- hovered-window targeting and double-click window capture;
- HDR-aware Windows 11 capture with automatic SDR fallback;
- long capture through `Ctrl+3`;
- file-backed capture payloads to avoid unnecessary large Base64 transfers;
- native screen color picking.

### Sticker workspace

- persistent desktop stickers and a focused canvas mode;
- crop, erase, border, corner radius, opacity, rotate, flip, and beautify tools;
- text, numbering, shapes, lines, arrows, brush, highlighter, mosaic, and blur
  annotations;
- geometry-aware annotation selection instead of bounding-box-only hit testing;
- recycle bin, reference library, groups, history, undo, and redo;
- Unicode-safe naming for visible save, clipboard, and drag-export files;
- fast minified/full-view switching through cached composite previews;
- native Shift-drag file export to Explorer.

### Workflow and local integrations

- node canvas, links, grouped parameters, and shader previews;
- Loom capability discovery and Art execution/delivery;
- optional Talk voice capture and Tea ticket creation through local capability
  bridges;
- single-instance enforcement, tray residency, runtime diagnostics, and an
  independent emergency-exit watchdog.

See [`docs/FEATURES.md`](docs/FEATURES.md) for the current shortcut and manual
regression matrix. The implementation remains the source of truth when a
document and the code disagree.

## Requirements

- Windows 10 or Windows 11;
- WebView2 Runtime;
- Node.js 22+ for frontend development;
- Rust stable with the MSVC toolchain for desktop builds.

HDR capture is available only when the selected Windows 11 display reports HDR
support. Unsupported or SDR-only cases fall back automatically. See
[`docs/HDR_CAPTURE.md`](docs/HDR_CAPTURE.md).

## Development

Install dependencies and start the Tauri development application:

```powershell
npm install
npm run dev:tauri
```

Useful checks:

```powershell
npm run typecheck
npm run test:performance
npm run test:parallel
npm test
cargo fmt --check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml
npm run build
```

`npm run verify:local` runs the complete serial verification chain and then
builds/packages a local release. It is not a lightweight lint-only command.

Build a portable executable directly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-local-hook-exe.ps1 `
  -OutputDir ..\release\Hook\local-build `
  -Force
```

Development rules and module ownership are documented in
[`CONTRIBUTING.md`](CONTRIBUTING.md). The current runtime structure is documented
in [`TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md).

## Release packages

- **Portable (current recommended package)**
  - extract the zip and run `hook.exe`;
  - the only current user-facing package in ordinary builds and tag releases;
  - includes the project license, third-party notices, and bundled-source
    license texts;
  - if Windows blocks interaction with elevated foreground windows such as
    **Task Manager**, try running Hook as **administrator** as the current
    workaround.
- **Installer (planned for future signed releases)**
  - the repository retains the UIAccess installer and SignPath preparation;
  - the installer is not a current public package and must not be published
    until the signing provider and protected approval environment are active.

The tag workflow may also attach a provenance JSON file for the unsigned
UIAccess signing candidate. That JSON is review metadata, not an installer.

See [`UIACCESS_DISTRIBUTION.md`](UIACCESS_DISTRIBUTION.md) and
[`docs/RELEASE_STRATEGY.md`](docs/RELEASE_STRATEGY.md).

## Code signing status

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/), applies only after the Hook
project is provisioned and a hosted signing request receives manual approval.
The current portable package must be treated as unsigned unless a release
explicitly includes an approved signed installer.

- [Code Signing Policy](docs/CODE_SIGNING_POLICY.md)
- [Privacy Policy](docs/PRIVACY_POLICY.md)
- [Security Policy](SECURITY.md)
- [Governance and Signing Roles](GOVERNANCE.md)
- [Third-Party Notices](THIRD_PARTY_NOTICES.md)

## Local data compatibility

The public Tauri bundle identifier is `com.yamiyu.hook`. Hook preserves existing
local user state by falling back to older data directories created under
`io.github.aiaimimi0920.hook` and `com.vmjcv.hook` when the current directory is
empty.

## Contributing

Focused issues and pull requests are welcome:

- Issues: <https://github.com/aiaimimi0920/Hook/issues>
- Contribution guide: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Documentation index: [`docs/README.md`](docs/README.md)

## License

MIT. See [`LICENSE`](LICENSE).

## Friendly links

- [linux.do](https://linux.do/) — thanks to the linux.do community for helping
  introduce Hook to more users.
