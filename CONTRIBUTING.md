# Contributing to Hook

Hook is a Windows-first Tauri/SolidJS application. Changes should be based on
current code, configuration, runtime behavior, and tests rather than historical
plans or archived conversations.

## 1. Before changing behavior

1. Identify the real event/data boundary that fails.
2. Read the exact implementation and its closest call sites.
3. Check relevant integration and runtime tests.
4. Prefer a narrow fix over a broad rewrite.
5. Do not retain compatibility branches for abandoned development-only behavior
   unless persisted user data or an active external protocol still needs them.

## 2. Ownership map

| Concern | Primary location |
| --- | --- |
| Persistent units, links, groups, library state | `src/store/graphStore.ts` |
| Transient selection, tools, panels, drag/edit state | `src/store/uiStore.ts` |
| Tauri command boundary | `src/services/api.ts` |
| Desktop event orchestration | `src/app.tsx` |
| Sticker/unit rendering | `src/components/UnitView.tsx` |
| Annotation editing | `src/components/StickerAnnotationLayer.tsx` |
| Capture frontend lifecycle | `src/hooks/useSelection.ts` |
| Native runtime, input, tray, commands | `src-tauri/src/lib.rs` |
| Capture implementation | `src-tauri/src/capture.rs`, `screenshot.rs` |
| Long-capture stitching | `src-tauri/src/long_capture.rs` |
| Release/build automation | `scripts/`, `.github/workflows/` |

## 3. Frontend rules

- Use TypeScript and avoid `any`; narrow `unknown` at the boundary.
- Put reusable decisions and transformations in `src/services/` or `src/hooks/`.
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
  `src/services/uiRegistry.ts` when the native click-through layer needs to know
  about them.

## 6. Tests and verification

Use the smallest relevant checks while developing, then run the appropriate
release gate before publishing a functional change.

```powershell
npm run typecheck
npm run test:performance
npm run test:parallel
npm test
cargo fmt --check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml
npm run build
```

`npm run verify:local` runs the full serial verification and also creates a local
release package. Use it only when that side effect is intended.

For documentation-only changes, run the documentation/contract tests that read
the changed files and verify links/paths. A full desktop rebuild is unnecessary
unless release behavior or embedded assets changed.

## 7. Release discipline

- Keep `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`,
  `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` versions aligned.
- Public release tags use `Vx.x.x`.
- The current user package is the portable Windows zip.
- A signing-candidate manifest is provenance metadata, not a signed installer.
- Never commit a PFX, private key, signing token, or private provider identifier.
- Every signed installer request must use the hosted reviewed workflow and fail
  closed when approval or configuration is missing.

## 8. Documentation discipline

- The code and tests are the source of truth.
- Keep only current operational docs in the working tree.
- Do not create per-task implementation-plan Markdown after the work is complete;
  use issues, commits, and Git history for temporary reasoning.
- Update `README.md`, `README.zh-CN.md`, and `docs/FEATURES.md` together when a
  user-facing shortcut or capability changes.
- Update `TECHNICAL_ARCHITECTURE.md` when module ownership, persistence,
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
