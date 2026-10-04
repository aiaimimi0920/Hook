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

[QR projection](docs/QR_PROJECTION.md) is available from the Ctrl+E toolbar and
links a sticker or formal Art image to another Windows Hook. Choose a shared
HTTPS Loom with device pairing and no official login, or the existing Loom
account mode. Receiver layout stays independent. Shared Loom supports online-device
selection and continuous delivery with receiver confirmation or automatic display.
Confirmation uses a compact upper-center desktop prompt with accept, reject,
and defer actions. Manually trusted offline Loom peers also support delivery. Official premium relay
remains reserved. Native PC1/PC3 acceptance passed using pinned SSH forwarding.

The projection secondary toolbar uses device/group checkboxes to start or cancel
projection directly, with per-row pending/success/failure markers and safe retry.
Success follows receiver display or remote cancellation acknowledgement.
The receive toolbar displays data flow as a read-only indicator. Its single import
compact, sticker-anchored dialog accepts a QR PNG or projection link without explanatory
labels and receives content after an explicit
Import action; the sender identifier remains visible without a revision button.
Count-free device/group/user icons open dropdowns; target rows show IDs and checkboxes. Long target
and font lists support wheel scrolling and draggable scrollbars in the overlay.
The user dropdown reports the unavailable account service. This UI increment has
focused and browser coverage. Isolated candidates have also passed PC1/PC3
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
joining cancels that pending result. See [Live capture](docs/LIVE_CAPTURE.md).
This UI path has focused coverage; native two-device performance acceptance is pending.
The viewer also exposes [bounded receiver diagnostics](docs/LIVE_RELAY_DIAGNOSTICS.md)
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
- [runtime resource admission](docs/LIVE_RESOURCE_ADMISSION.md) replaces the fixed
  four-source cap: source/crop size, RAM headroom, DXGI budget and sampled CPU/load
  growth determine whether another source can start, within a 16-source safety
  ceiling. Pressure slows existing capture and rejects new work without deleting Units;
- local Live targets up to 60 FPS, using frame-ready wakeups, Windows JPEG
  encoding, and decode-before-display presentation. Actual rate depends on source
  updates, region size, hardware, and concurrent captures; queues remain bounded;
- multiple Live sources share a capture pixel/rate budget and one automatic CPU
  readback/encode permit. Hidden/offscreen views reduce capture to 1 FPS and pause
  JPEG production; visible unsupported effects use bounded-rate fallback rather
  than unrestricted CPU pipelines. Layout polling shares one clock and Unit
  geometry sample. Same-window regions now [share one WGC source](docs/LIVE_SHARED_SOURCE_CAPTURE.md)
  while retaining independent crops, frame delivery, visibility and stop;
- automatic [route B GPU presentation](docs/LIVE_GPU_PRESENTATION.md) copies
  WGC textures into native swapchains without JPEG on that display branch. The
  copy/save and native Shift-drag export can request lossless GPU snapshots. The
  ordinary JPEG branch pauses CPU readback/encoding while GPU presentation is
  healthy. Unsupported composition uses fresh decoded fallback pixels; set
  `HOOK_LIVE_GPU_PREVIEW=0` to force JPEG compatibility. This is not an FPS guarantee;
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
  equal or lower integrity than Hook. An administrator Hook is not blocked from
  controlling ordinary programs; upward, cross-user/session, and secure-desktop
  input stays blocked. Refusals appear as short Unit notices, not silent clicks;
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
- an opt-in [tile terminal](docs/TILE_TERMINAL.md) through `--tile`, presenting
  Loom-managed images, Live content and declarative Art on a selected physical
  output, with endpoint-scoped input and host-owned Art confirmation/cancellation.
  Loom can freeze, black out and resume a saved wall, with per-output application
  reports and paused input. Identify one screen by its actual output name with a
  marker lasting at most 10 seconds; Escape dismisses it without exiting the output.
  This remains an internal development slice;
  scheduling and multi-computer acceptance are pending;
- installable Loom Capability Plugins can contribute commands, shortcuts, toolbar
  menus, result attachments, overlays, and unit-scoped notices without a Hook
  business branch; the official OCR package contributes its own `Ctrl+4`,
  `Alt+4`, cached full/layout copy, click-to-copy, and Shift+click multi-block
  selection behavior only while installed and enabled;
- OCR and translation keep independent cached results: `Ctrl+4` re-recognizes,
  `Ctrl+5` translates using existing OCR or recognizes first, and `Alt+4` / `Alt+5`
  toggle cached overlays or produce the missing result on first use. The overlays
  are mutually exclusive; hiding translation restores OCR only when it was not
  explicitly hidden. Visibility changes do not repeat OCR or model requests;
- all sticker and Art notices stay bound to their owning unit, stack in its upper-right corner, and can be dismissed one at a time;
- the official OCR package automatically performs bounded local QR/barcode
  decoding during `Ctrl+4`, then contributes generic result attachments, green hit markers, and
  click-to-copy behavior; Hook core contains no QR/barcode decoder or product branch;
- optional Talk voice capture and Tea ticket creation through local capability
  bridges;
- single-instance enforcement, tray residency, runtime diagnostics, and an
  independent emergency-exit watchdog. Emergency exit uses three `Esc+Delete`
  press/release cycles with less than 400 ms between chords; both keys must be
  released between cycles. Esc alone no longer exits the application.

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
npm run test:surface-browser
npm run test:parallel
npm test
npm run probe:live-screenshot:phase2
npm run probe:live-screenshot:phase3
cargo fmt --check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml
npm run build
```

`npm run verify:local` runs the complete serial verification chain and then
builds/packages a local release. It is not a lightweight lint-only command.

`npm run test:surface-browser` launches an isolated headless Chromium, imports
the production JavaScript Surface document builder, and exercises healthy,
timer, DOM, CPU long-task, and heap-growth budget paths. It does not launch a
second native Hook process or bypass Hook's global single-instance safety mutex.

The live-capture G2 probe is interactive and runs for 600 seconds by default. It
uses an animated same-integrity WinForms fixture to prove fresh WGC frames,
resize/recreate, source-close fail-closed behavior, session cleanup, and bounded
handle/private-memory growth. Its evidence is written below
`artifacts/live-screenshot-phase2/<run-id>` and is intentionally not committed.
Local WebView presentation uses raw Tauri binary responses carrying bounded JPEG
frames; it does not send frames through `loom.surface.v1` or JSON/Base64.

The G3 probe covers the deliberately narrow Windows 11, single-SDR-display,
same-integrity Win32/WinForms declaration. It verifies changing frames while the
source is a near-transparent compositor window, independent input edges, exact
restore, local reclaim, recovery-journal execution, and worker cleanup. Hook does
not claim native-minimize, elevated, cross-session, WPF, WinUI, or arbitrary
custom-control support from this result.

Validate a built native candidate in two stages. Preflight only hashes the
candidate, checks the CDP dependency/port, and reports any live Hook main or
watchdog process; it never launches or stops Hook:

Phase 71 is the canonical-only baseline: acceptance and release checks exercise
only the current app-data identity, publisher-qualified packages, and formal
`loom.hook.v1`/`loom.surface.v1` contracts. Obsolete compatibility paths are not
part of acceptance.

The acceptance scripts fail closed on SHA-256. Pass the candidate's matching
expected digest explicitly; historical script defaults do not identify the
current build. Each candidate needs its own 600-second soak, formal Surface
action/resource delivery, clean exit and restart-recovery evidence. Older
acceptance summaries remain in Git history and do not certify a later binary.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\Invoke-HookNativeCandidateAcceptance.ps1 `
  -HookExe ..\release\Hook\candidate\hook.exe `
  -ExpectedSha256 <candidate-sha256> `
  -PreflightOnly
```

After every existing Hook instance has been exited normally, remove
`-PreflightOnly` to run the real WebView2/Tauri IPC probe, global
single-instance refusal, process-tree memory soak, normal exit, watchdog/CDP
teardown, and restart check. The script uses isolated app data and WebView2
storage. It enables `HOOK_NATIVE_ACCEPTANCE=1` only for the spawned candidate so
the gated clean-exit command can return through the normal Tauri shutdown path;
it does not rename/bypass the mutex or disable global Hook behavior.

The Phase 69 dual-end gate uses the outer orchestrator instead of treating a
daemon-only or browser-only smoke as sufficient. It verifies both candidate
hashes, starts an isolated packaged Loom daemon and fixture Art Store, installs
the real dashboard Surface, and delegates to the native Hook runner:

```powershell
# Safe while another Hook is running: hashes/files/ports/processes only.
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\Invoke-HookLoomSurfaceCandidateAcceptance.ps1 `
  -HookExe ..\release\Hook\candidate\hook.exe `
  -ExpectedHookSha256 <candidate-sha256> `
  -LoomPackageDir ..\release\Loom\candidate `
  -ExpectedLoomDaemonSha256 <loom-daemon-sha256> `
  -PreflightOnly

# Safe isolated Loom-side rehearsal; does not launch Hook.
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\Invoke-HookLoomSurfaceCandidateAcceptance.ps1 `
  -HookExe ..\release\Hook\candidate\hook.exe `
  -ExpectedHookSha256 <candidate-sha256> `
  -LoomPackageDir ..\release\Loom\candidate `
  -ExpectedLoomDaemonSha256 <loom-daemon-sha256> `
  -ValidateLoomServicesOnly
```

With all existing Hook main/watchdog processes normally exited, omit both
switches for the full packaged Hook GUI → packaged Loom Surface click/resource/
formal-result loop, ten-minute process-tree soak, clean exit, restart recovery,
and final listener/process cleanup. The native runner waits for Hook's awaited
`frontend-initialized` marker before both the first Surface probe and the restart
probe, so CDP availability alone is not treated as frontend readiness.

When Loom reports a newly registered device as pending, the runner approves that
exact public-key device through the isolated Loom control plane while Hook waits
for the bounded authorization transition. Native acceptance exits through the
normal Tauri run loop and requires exactly one process-exit cleanup record before
checking watchdog, CDP, and restart recovery.

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

The tag workflow retains the unsigned UIAccess signing candidate and its digest as
short-lived Actions review evidence; neither is shown as a public Release asset.

For the public Release, ordinary users only need the portable ZIP. Users who want
to verify a download should also fetch the matching `.zip.sha256` sidecar. GitHub's
automatic source ZIP and tarball remain available for developers.

See [`UIACCESS_DISTRIBUTION.md`](UIACCESS_DISTRIBUTION.md) and
[`docs/RELEASE_STRATEGY.md`](docs/RELEASE_STRATEGY.md). Formal clean-source
packaging, checksums, SBOMs, attestations, and draft verification are documented
in [`docs/release-provenance.md`](docs/release-provenance.md); dependency
inventory and vulnerability response are in
[`docs/DEPENDENCY_SECURITY.md`](docs/DEPENDENCY_SECURITY.md).

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

## Local data identity

The public Tauri bundle identifier and the only automatic local-data identity is
`com.yamiyu.hook`. Development and test automation can select an isolated root
explicitly with `HOOK_APPDATA_DIR`; Hook does not scan or migrate obsolete roots.

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

Development CI policy: valid vulnerability, license, lint, format, and size findings
are advisory in independent reporting workflows. Tool/report/upload failures remain
errors; typechecking, builds, and functional tests stay blocking. Release checks and
`npm run verify:local` remain strict. See [dependency security policy](docs/DEPENDENCY_SECURITY.md).
