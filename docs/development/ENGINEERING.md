# Engineering contribution requirements

[Contributing to Otter](../../CONTRIBUTING.md) · [Documentation](../README.md)

These requirements apply to code contributions. Paths in code spans and commands
are relative to the repository root unless stated otherwise. Start with the
[development guide](../guide/development.md) for environment setup. File placement
and module boundaries follow the [code organization standard](CODE_ORGANIZATION.md).

## 1. Before changing behavior

1. Identify the real event/data boundary that fails.
2. Read the exact implementation and its closest call sites.
3. Check relevant integration and runtime tests.
4. Prefer a narrow fix over a broad rewrite.
5. Do not retain compatibility branches for abandoned development-only behavior
   unless persisted user data or an active external protocol still needs them.

## 2. Ownership map

File placement follows the [code organization standard](../development/CODE_ORGANIZATION.md).
Read its feature map, dependency rules and verification requirements first; do not
reintroduce global `components`, `services` or `hooks` directories.

| Concern | Primary location |
| --- | --- |
| Persistent units, links, groups, library state | `src/features/workspace/state/graphStore.ts` |
| Transient selection, tools, panels, drag/edit state | `src/features/workspace/state/uiStore.ts` |
| Tauri command boundary | `src/platform/tauri/api.ts` |
| Desktop event orchestration | `src/app/app.tsx` |
| Sticker/unit rendering | `src/features/workspace/components/UnitView.tsx` |
| Annotation editing | `src/features/stickers/components/StickerAnnotationLayer.tsx` |
| Capture frontend lifecycle | `src/features/capture/hooks/useSelection.ts` |
| Native runtime, input, tray, commands | `src-tauri/src/lib.rs` |
| Capture implementation | `src-tauri/src/capture.rs`, `screenshot.rs` |
| Long-capture stitching | `src-tauri/src/long_capture.rs` |
| Release/build automation | `scripts/`, `.github/workflows/` |

## 3. Frontend rules

- Use TypeScript and avoid `any`; narrow `unknown` at the boundary.
- Put domain decisions, hooks, state and UI together under the owning `src/features/<feature>/`.
- Use `src/shared/` only for domain-independent primitives; integrations and desktop adapters have explicit owners.
- Keep `app.tsx` focused on orchestration and side effects.
- Persistent edits go through `graphStore.actions`; do not write high-frequency
  pointer samples into persisted state.
- Use registered element references and imperative transforms for hot drag/edit
  previews. Commit the final model state once when the interaction ends.
- Prefer existing Tailwind utility classes for layout. Use inline styles for
  dynamic coordinates, sizes, opacity, transforms, and other runtime values.
- Add `app.css` rules only for shared theme tokens, global behavior, or effects
  that are impractical as utilities.

## 4. Rust and native-input rules

- Format Rust changes with `cargo fmt`.
- Preserve input edge ordering and pointer ownership across low-level hook,
  input-shield, Tauri event, and WebView paths.
- Move samples may be coalesced; button, Escape, delete, and emergency-exit edges
  must not be dropped.
- Keep screen-physical, monitor-logical, and WebView-client coordinates explicit.
- Use atomic/bounded file, cache, and queue behavior for long-running processes.
- Restore cursor and input state on normal exit, abnormal exit, and emergency
  watchdog termination.

## 5. Styling and UI

- The current visual baseline is the terminal-style dark surface with signal
  yellow/green accents.
- Avoid reintroducing the old rounded lavender/glass style.
- Keep overlays compact; screenshot content has priority over explanatory labels.
- Interactive overlays must register their hit rectangles through
  `src/platform/desktop/uiRegistry.ts` when the native click-through layer needs to know
  about them.

## 6. Tests and verification

Use the smallest relevant checks while developing, then run the appropriate
release gate before publishing a functional change.

```powershell
npm run lint
npm run typecheck
npm run typecheck:test
npm run test:performance
npm run test:parallel
npm test
npm run test:surface-browser
cargo fmt --check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml
npm run build
```

`test:parallel` excludes only `RuntimePerformanceGates.test.ts`: its wall-clock
budgets must not compete with other test workers. CI immediately runs that exact
file through `test:performance` with one worker and unchanged thresholds. The
serial `npm test` packaging gate still includes every test. It runs in
`frontend-serial` alongside the native build and `parallel-race` jobs.
For code, dependencies, workflows, build configuration, unknown paths and manual
runs, the stable `build-windows-exe` check fails unless all three succeed and
only then promotes the same-run candidate to `otter-portable-windows-x64`.

README, known root documentation, `docs/**/*.md` (except the release body), and
images in `docs/assets/` (except `github-home-hero.svg`, covered by the full
public-identity contract) use a lightweight documentation lane on PR/main events.
It checks the full Git diff, including deleted and renamed paths, then validates
changed text, whitespace and repository-relative link targets, then installs
locked npm dependencies to run the seven existing documentation/naming contract suites
and the documentation case from the mixed public-identity suite. Its unrelated
product source checks remain in the full product lane; an explicit guard rejects
a renamed/missing documentation case instead of silently running zero tests. No
full application/native test suite, desktop compilation or EXE artifact promotion
runs in this lane. The stable check still reports success/failure. Missing history,
empty diffs, executable/symlink paths, mixed code changes and classifier failures
never grant a documentation-only success. CI classifier and aggregate regression
tests run in both lanes. External URLs and heading anchors are not network-checked.
Loom contract links in `TILE_WALL_CLIENT.md` and `TILE_TERMINAL.md` point to the
independent GitHub repository and need separate network/version verification.
The checker retains narrow exceptions for historical sibling-checkout links;
other out-of-repository paths fail. Security and advisory workflows retain their
independent scans and reports.

`npm run lint` remains strict (`--max-warnings 0`) for local/release verification.
Development CI publishes valid findings through the independent advisory workflow. `npm run test:surface-browser` drives a real Chromium through
Playwright; run `npx playwright install chromium` once before its first use.

`npm run verify:local` runs the full serial verification and also creates a local
release package. Use it only when that side effect is intended.

For documentation-only changes, run the documentation/contract tests that read
the changed files and verify links/paths. A full desktop rebuild is unnecessary
unless release behavior or embedded assets changed.

## 7. Release discipline

- Keep `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` versions aligned.
- New public release tags use `vx.x.x`; existing uppercase tags remain accepted.
- Internal iterations use `vx.x.x.n` via `npm run version:internal`; do not bump
  public package versions for internal work. See `docs/release/VERSIONING.md`.
- The current user package is the portable Windows zip.
- A signing-candidate manifest is provenance metadata, not a signed installer.
- Never commit a PFX, private key, signing token, or private provider identifier.
- Every signed installer request must use the hosted reviewed workflow and fail
  closed when approval or configuration is missing.
- Run the exact-lock inventory and OSV gate described in
  [`docs/security/DEPENDENCY_SECURITY.md`](../security/DEPENDENCY_SECURITY.md) before release.
- Formal release evidence and draft-first publication follow
  [`docs/release/release-provenance.md`](../release/release-provenance.md).

## 8. Documentation discipline

- The code and tests are the source of truth.
- Keep only current operational docs in the working tree.
- Do not create per-task implementation-plan Markdown after the work is complete;
  use issues, commits, and Git history for temporary reasoning.
- Update `README.md`, `README.zh-CN.md`, and `docs/FEATURES.md` together when a
  user-facing shortcut or capability changes.
- Update `docs/architecture/overview.md` when module ownership, persistence,
  runtime input, capture, or release boundaries change.
- Machine-local paths and generated logs do not belong in tracked documentation.

## 9. Pull request checklist

- [ ] The change addresses the real implementation boundary.
- [ ] No unrelated code or user data was removed.
- [ ] New hot-path work is bounded and measured.
- [ ] Relevant tests cover the behavior, not only source strings when a runtime
      test is feasible.
- [ ] Documentation matches the final code.
- [ ] `git diff --check` is clean.
- [ ] The verification results and remaining risks are reported accurately.

Development CI policy: valid vulnerability, license, lint, format, and size findings
are advisory in independent reporting workflows. Tool/report/upload failures remain
errors; typechecking, builds, and functional tests stay blocking. Release checks and
`npm run verify:local` remain strict. See [dependency security policy](../security/DEPENDENCY_SECURITY.md).
