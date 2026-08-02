# Hook Development Plan

This file records the active implementation contract for changes that span
multiple development sessions. Historical design documents remain useful
references, but this plan is the current operational source of truth.

## Implemented scope: unified image file naming

Hook must use one naming system for every user-visible image file while keeping
internal content-addressed assets, image-search caches, runtime logs, and other
implementation-only state unchanged.

### Persisted settings

Global settings are stored under Hook's effective application-data directory in
`app-settings.json`:

```json
{
  "schemaVersion": 1,
  "fileNaming": {
    "stickerSavePattern": "Hook_{date}_{time}_{width}x{height}",
    "dragExportPattern": "{label}_{shortId}_{date}_{time}",
    "clipboardFilePattern": "Hook_{kind}_{date}_{time}",
    "titleMaxLength": 80,
    "collisionPolicy": "increment"
  }
}
```

Writes must use a temporary file, flush and sync it, then atomically replace the
destination. Invalid JSON must be preserved as a timestamped corrupt backup and
Hook must continue with defaults.

### Supported placeholders

| Placeholder | Meaning |
| --- | --- |
| `{app}` | Application name (`Hook`) |
| `{kind}` | Export kind such as `sticker` or `art` |
| `{label}` | User-visible capability or content label |
| `{title}` | Optional source title |
| `{process}` | Optional source process or capability identifier |
| `{unitId}` | Full Hook unit identifier |
| `{shortId}` | Last four Unicode scalar values of the unit identifier |
| `{width}` | Exported pixel width |
| `{height}` | Exported pixel height |
| `{date}` | Local date in `yyyyMMdd` format |
| `{time}` | Local time in `HHmmssff` format |
| `{timestamp}` | Unix time in milliseconds |

### Windows filename rules

- Preserve normal Unicode, including Chinese and Japanese text.
- Replace `/ \\ : * ? " < > |` and control characters.
- Reject empty stems, `.` and `..`.
- Neutralize `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, and `LPT1`-`LPT9`.
- Remove trailing spaces and periods.
- Limit final stems to 120 Unicode scalar values.
- Never allow a rendered template to escape its assigned output directory.

### Collision policy

Automatic exports allocate files with `create_new(true)`:

```text
name.png
name_2.png
name_3.png
```

An `exists()` check followed by a normal create is not acceptable because two
concurrent exports could overwrite each other.

### User-visible outputs covered

- automatic sticker image saves;
- Save As dialog default names;
- direct Explorer Shift-drag export;
- native file-drag names exposed to Explorer;
- sticker smart-clipboard file payloads;
- Art clipboard file payloads;
- ordinary and long captures when they are ultimately exported as stickers.

### Explicitly excluded internal names

- session content-addressed image assets;
- image-search cache entries;
- capture transport/cache files that are not exposed as final exports;
- runtime logs and internal state files.

## Current scope: SignPath release readiness

- keep the portable release lane operational;
- publish the exact SignPath attribution and code-signing policy links;
- document public security, privacy, governance, and signing roles;
- include project and bundled-source license notices in release archives;
- keep all product version fields aligned with the public `Vx.x.x` tag;
- submit only GitHub-hosted workflow artifacts to SignPath;
- require manual approval for every signing request;
- never commit a private key, PFX, API token, or private account identifier;
- fail closed rather than publishing an unsigned UIAccess installer.

SignPath organization/project/policy identifiers and maintainer MFA status are
external facts. They must be confirmed during onboarding and must not be
invented in repository history.

## Current scope: staged post-V0.1.6 efficiency optimization

The annotated tag `优化前的临时版本` at commit
`4eb603dab42fcdd7385096e1679991988547eff2` is the rollback and comparison
baseline for this program. Optimization work is deliberately split into narrow
batches so input, capture, rendering, and release behavior are never changed all
at once.

Every batch follows the same gate:

1. implement only that batch's scope;
2. add targeted regression and stress-oriented tests;
3. run the relevant frontend and Rust suites plus build checks;
4. commit the batch independently;
5. build a runnable package under `..\release\Hook`;
6. report the main changes and a focused manual-test checklist;
7. stop until the maintainer replies `测试通过，进行下一批优化`.

No later batch may start before the previous batch passes the manual gate.

### Batch 1: bounded native mouse-event transport

- replace the unbounded `CaptureMouseHookEvent` channel without reintroducing
  dropped `Down`/`Up` edges;
- coalesce replaceable high-frequency move samples while preserving event order,
  overlay pointer ownership, continuation semantics, and native-drag-preflight
  boundaries;
- expose deterministic queue/coalescing diagnostics for tests and runtime logs;
- stress-test move floods with interleaved capture and overlay edge events.

### Batch 2: display-aware window and HDR capture

- make target enumeration and final pixel capture use the same monitor identity;
- support secondary monitors, negative origins, and mixed DPI;
- revalidate hovered window geometry immediately before double-click capture;
- make HDR capability and SDR fallback decisions against the actual target
  display.

### Batch 3: shader lifecycle correctness

- add renderer generations so delayed image loads cannot write into a disposed
  or replacement renderer;
- reapply all uniforms and texture params after asynchronous renderer creation or
  contextual rebuild;
- invalidate renderers when cached shader code changes;
- add delayed-load, rebuild, disposal, and restored-session regression tests.

### Batch 4: shader and large-image performance

- remove full-frame synchronous `readPixels` visibility checks from the normal
  restored-session path;
- prevent overlapping full-resolution PNG preview encodes during live parameter
  adjustment;
- bound shader code, renderer, and texture cache lifetimes;
- benchmark 1080p, 2K, and 4K shader adjustment and restoration.

### Batch 5: sticker drag and large-canvas performance

- replace drag-start whole-document follower queries with registered element
  references;
- cache alignment/cascade targets and introduce a lightweight spatial lookup for
  large canvases;
- reuse unit lookup maps in link overlays;
- add blur, visibility, pointer-cancel, and watchdog cleanup for GPU-warm drag
  state while retaining the five-recent-sticker behavior.

### Batch 6: cache, settings, and internal-file lifetime

- reclaim image-search generations and other unit-scoped caches on deletion or
  workspace replacement;
- cache application settings in Tauri state instead of parsing the settings file
  for every export;
- make corrupt-settings backup allocation race-safe;
- allocate internal capture files atomically instead of relying only on a
  millisecond timestamp.

### Batch 7: Art transport, release provenance, and performance gates

- prefer local file/shared-memory delivery over JSON Base64 for large local Art
  inputs while retaining a compatible fallback;
- require signing tags to be reachable from the protected public release branch
  and bind signing requests to reviewed artifact digests;
- validate release versions before expensive build steps;
- add real runtime frame, queue-depth, memory, and soak tests alongside the
  existing source-contract tests;
- add a separate parallel/race-oriented CI lane without removing the stable
  serial test lane.

## Future scope (not part of the naming or signing-readiness implementation)

- automatic update checks;
- update download and installation;
- signed installer distribution.

Those items must not be implemented as side effects of the current naming work.
