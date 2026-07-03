> **Archived note:** This file is kept for historical migration/audit context and may not reflect the current Hook codebase. 当前实现请以仓库根目录 `README.md`、`PROJECT_OVERVIEW.md`、`TECHNICAL_ARCHITECTURE.md` 为准.

# Hook Migration Completion Audit

## Sources

- Clean ArtHook reference: `Z:\project\project\ArtNexus-GitHub\ArtHook`
- Talk voice/config reference, formerly HookLess: `C:\Users\Public\nas_home\AI\GameEditor\Neuro\Talk`
- Writable target: `C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook`

## Migrated contracts

- Process no-window spawning and detached subprocess handling.
- MCP boundary hardening: frontend contracts verify direct MCP spawn is not exposed through the Tauri command surface.
- AHRP cloud output and error handling.
- Art scalar output propagation.
- Link-created propagation from `useLinking` into upstream-driven graph execution.
- Connected art-node sizing and capability-derived image input port selection.
- Color Transfer contextual shader input/reference handling and rendered-output propagation.
- Global Shift+1 add-node menu, including frontend shortcut dispatch and desktop event plumbing.
- Parameter link targets.
- Desktop live image sync.
- String draft/edit commit finality.
- Per-unit add-node menu close after connected spawn.
- Grouped parameter panel and slider layout.
- Opportunistic ArtLoom connection with non-fatal startup fallback.
- HookLess safe voice defaults.

## Intentionally not migrated

- `integration\GitHubRepoLayoutContract.test.ts`: the source test asserts the public ArtHook repository layout. The current target is `Neuro/Hook`, so this is not a behavior contract for the migration target.

## Source test inventory

Command:

```powershell
$srcRoot = 'Z:\project\project\ArtNexus-GitHub\ArtHook\__tests__'
$dstRoot = 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook\__tests__'
$srcPrefix = ((Resolve-Path -LiteralPath $srcRoot).Path.TrimEnd('\') + '\')
$dstPrefix = ((Resolve-Path -LiteralPath $dstRoot).Path.TrimEnd('\') + '\')
$src = rg --files $srcRoot -g '!node_modules' | ForEach-Object { (Resolve-Path -LiteralPath $_).Path.Substring($srcPrefix.Length) } | Sort-Object
$dst = rg --files $dstRoot -g '!node_modules' | ForEach-Object { (Resolve-Path -LiteralPath $_).Path.Substring($dstPrefix.Length) } | Sort-Object
Compare-Object -ReferenceObject $src -DifferenceObject $dst
```

Summary:

```text
source_count=93
target_count=96
target-only:
  integration\ActionsMenuEscapeContract.test.ts
  integration\ProcessNoWindowContract.test.ts
  integration\TauriVersionAlignmentContract.test.ts
  integration\VoiceHotkeyContract.test.ts
source-only:
  integration\GitHubRepoLayoutContract.test.ts
```

## Verification

All commands below were run from `C:\Users\Public\nas_home\AI\GameEditor\Neuro` unless noted otherwise.

### Migration-specific targeted Vitest suite

Command:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
node_modules\.bin\vitest.cmd run `
  __tests__\integration\ProcessNoWindowContract.test.ts `
  __tests__\integration\McpBoundaryContract.test.ts `
  __tests__\integration\AhrpCloudOutputContract.test.ts `
  __tests__\integration\ArtScalarOutputContract.test.ts `
  __tests__\integration\ArtNodePropagationContract.test.ts `
  __tests__\integration\ArtNodeSpawnSizingContract.test.ts `
  __tests__\integration\LinkPropagationContract.test.ts `
  __tests__\integration\ColorTransferShaderContract.test.ts `
  __tests__\integration\GlobalAddArtNodeContract.test.ts `
  __tests__\integration\GlobalAddNodeMenuInteractionContract.test.ts `
  __tests__\unit\shortcuts.test.ts `
  __tests__\integration\ArtParamLinkTargetContract.test.ts `
  __tests__\integration\DesktopLiveSyncContract.test.ts `
  __tests__\integration\StringParamCommitContract.test.ts `
  __tests__\integration\UnitAddNodeMenuCloseContract.test.ts `
  __tests__\integration\UnitParamsPanelGroupingContract.test.ts `
  __tests__\integration\opportunisticArtLoomConnection.test.ts `
  __tests__\integration\VoiceHotkeyContract.test.ts `
  --pool threads --maxWorkers 1 --no-file-parallelism
```

Summary:

```text
Test Files 18 passed (18)
Tests 49 passed (49)
EXIT=0
```

### Frontend typecheck

Command:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
npm run typecheck
```

Summary:

```text
> arthook@0.1.0 typecheck
> tsc --noEmit
EXIT=0
```

### Full frontend test suite

Command:

```powershell
Set-Location 'C:\Users\Public\nas_home\AI\GameEditor\Neuro\Hook'
npm test
```

Summary:

```text
Test Files 96 passed (96)
Tests 259 passed (259)
EXIT=0
```

### Rust formatting

Command:

```powershell
cargo fmt --manifest-path Hook\src-tauri\Cargo.toml -- --check
```

Summary:

```text
EXIT=0
```

### Rust tests

Command:

```powershell
cargo test --manifest-path Hook\src-tauri\Cargo.toml
```

Summary:

```text
src\lib.rs: 24 passed
src\main.rs: 0 passed
tests\voice_core_contract.rs: 2 passed
tests\voice_session_contract.rs: 4 passed
Doc-tests arthook_lib: 0 passed
EXIT=0
```

## HookLess voice safety

The Hook target keeps the safe MVP voice path:

- toggle shortcut: `Ctrl+Alt+Space`
- audio backend: silent unless explicitly configured otherwise
- provider: mock unless explicitly configured otherwise
- output mode: dry run for safe orchestration defaults
- clipboard backend: fallback for safe clipboard insertion
- invalid or unavailable native behavior fails safely instead of silently enabling native side effects
