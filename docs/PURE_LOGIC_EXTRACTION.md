# Pure-Logic Extraction & Testability Campaign

Status: **current**. This is a maintenance record of a focused, multi-round
refactor that pulled untested branchy logic out of the two heaviest integration
files (`src/app.tsx`, and one backend gap in `src-tauri/src/tea_client.rs`) into
small pure modules, each locked down with characterization tests.

It exists so a future maintainer can see *what moved, why it is safe, and what
is deliberately left alone*.

## 1. The discipline (invariants held every round)

Each round obeyed the same rules. They are worth continuing:

1. **Extract, don't rewrite.** Logic was moved verbatim; every "looks redundant"
   branch was preserved, never deleted. Much of that redundancy is load-bearing
   (edge-case handling), so it was kept and *pinned by a test* instead.
2. **Inject non-determinism and side effects.** `crypto.randomUUID`, `Date.now`,
   store reads (`graphStore.units/capabilities`), and reactive accessors are
   passed in as dependencies, so the extracted core is a pure function and tests
   are deterministic. Store writes, IPC, and sync stay in `app.tsx`.
3. **Characterization tests first.** New tests assert *current* behavior
   (including the quirky defaults) so a later change is a visible, intentional
   decision — not an accident.
4. **Never collapse a load-bearing divergence** without an explicit decision
   (see §4).
5. **Two-step, independently verifiable.** Step A adds the module + tests
   alongside the old code and proves them green; Step B switches `app.tsx` over
   and deletes the inline copy. Gate on `tsc --noEmit`, `eslint src`, and the
   full `vitest` suite (plus `cargo fmt --check` + `cargo test` for the Rust
   round).
6. **Repoint, don't weaken, the grep contract tests.** Several
   `__tests__/integration/*Contract.test.ts` assert that `app.tsx` *contains*
   specific source strings. When logic moved, those assertions were repointed to
   the new module (and re-spelled for injected params) — same fact, new location.
   None were weakened.

## 2. Result

- `src/app.tsx`: **1854 → 1378 lines** (−476, −26%).
- **8 pure modules** extracted (7 frontend + 1 backend hardening).
- **+86 frontend characterization test cases** across 7 unit-test files; the full
  frontend suite is **701 passing across 192 files**.
- **+4 Rust unit tests**; the backend lib suite is **118 passing**.
- Zero behavior change in every round except round 6 (a pure security *addition*)
  and round 8 (a diagnostic *addition*), neither of which alters functional flow.

## 3. Module inventory

| Module | Owns | Injected deps | Test file | Cases |
|---|---|---|---|---|
| `src/services/overlaySyntheticEvents.ts` | Synthetic overlay mouse-event engine (pointer capture, hover transitions, click/double-click synthesis) | `doc`, `elementFromPoint`, `isLinking`, `getDraggingStickerId`, `now`, `win` | `overlaySyntheticEvents.test.ts` | 16 |
| `src/services/sessionStickerMapping.ts` | Persisted sticker → `Unit` mapping **and** unknown-key drift detection | `capabilities` | `sessionStickerMapping.test.ts` | 16 |
| `src/services/graphImageResolution.ts` (added `resolveCanvasDisplayImage`) | Canvas display-image resolution (previewSrc → upstream → src, with cycle guard) | `units`, `links` | `resolveCanvasDisplayImage.test.ts` | 9 |
| `src/services/artDeliveryOutputs.ts` | Art-node delivery → output-port map (scalar `value ?? data`, preview/file merge) | — | `artDeliveryOutputs.test.ts` | 12 |
| `src/services/workflowInstantiation.ts` | Workflow snapshot → `{units, links}` transform + merge reducers | `existingUnits`, `capabilities`, `newId` | `workflowInstantiation.test.ts` | 14 |
| `src/services/deletionPlan.ts` | "What to delete" decision (annotation > multi-select > single sticker > none) | `units` | `deletionPlan.test.ts` | 10 |
| `src/services/teaTicketText.ts` | Tea work-order ticket text builders | — | `teaTicketText.test.ts` | 9 |
| `src-tauri/src/tea_client.rs` (added redaction) | Redacts bearer tokens + own auth token from untrusted error bodies | — | inline `#[cfg(test)]` | 4 |

`beginCaptureSelection` was inspected and left as-is: its pure decision already
lives in `src/services/captureState.ts` (`beginCaptureSelectionState`), a result
of earlier work in the same spirit.

## 4. Decisions deliberately preserved (do not "clean up" blindly)

- **Two image resolvers coexist on purpose.** `resolveCanvasDisplayImage` (canvas
  display, capability-agnostic, previewSrc-first) and `resolveUnitImageFromGraph`
  (capability-aware; for stickers resolves upstream *before* previewSrc and honors
  `DISABLED_PREFIX` / `image_path`) behave differently. `resolveCanvasDisplayImage.test.ts`
  contains a **divergence test** that pins the difference. Unifying them is a
  behavior change requiring a deliberate decision, not a refactor.
- **Session load is non-rejecting.** `detectUnknownSessionStickerKeys` only
  *logs* drift; it never rejects a session. A renamed/foreign session still loads
  with whatever the mapper understands. `KNOWN_SESSION_STICKER_KEYS` is locked to
  the `SessionSticker` type at compile time via `satisfies`.
- **`tea_client.rs` redaction is self-contained.** `loom_connector.rs` and
  `talk_connector.rs` each carry their own, *intentionally distinct*, redaction
  helpers. Tea got its own copy rather than forcing a shared one, precisely to
  avoid collapsing their divergence.

## 5. Remaining tech debt (candidates, not commitments)

Ordered roughly by value/risk. None are started.

1. **Connector duplication (`loom_connector.rs` ≈ `talk_connector.rs`, ~80%).**
   Real duplication, but with *silently divergent* behavior (non-2xx handling,
   trim semantics, sensitive-key lists). A shared module is worthwhile **only**
   after each divergence is characterized and consciously kept or removed.
2. **Voice HTTP clients have no timeout** (`src-tauri/src/voice/client.rs`), and a
   fresh `reqwest::Client` is built per utterance. Adding a timeout is a behavior
   change with a load-bearing risk: a long transcription may legitimately exceed
   any fixed bound. **Needs a maintainer decision on an acceptable ceiling**
   before implementing.
3. **The two remaining monoliths.** `src/components/StickerAnnotationLayer.tsx`
   (~2700 lines) and `src-tauri/src/lib.rs` (~8100 lines) are the largest files.
   `lib.rs` is a pure-movement split (grouped commands / overlay hooks / clipboard
   / shared-mem into modules, guarded by `cargo test`). `StickerAnnotationLayer`
   needs component-render tests (e.g. `@solidjs/testing-library`) *before* its
   transform/erase/text subsystems can be safely pulled into controller hooks.
4. **Grep contract tests are brittle.** Many `__tests__/integration/*Contract.test.ts`
   assert on source strings rather than behavior; they false-red on renames and
   green-light real regressions. Convert the highest-value ones to behavioral
   tests and demote the naming/packaging ones to explicit lint rules.
5. **Lint/clippy are not gated.** `eslint src` and `cargo clippy` run clean but
   are in neither CI workflow nor `verify:local`. Adding them is a few minutes and
   turns two dead gates live.

## 6. How to continue the pattern

Pick a cohesive chunk of branchy logic that is currently only guarded by grep (or
untested). Confirm it is genuinely pure once its store/reactive/random inputs are
injected. Then run the two-step play in §1. If the target is side-effect-bound
(UI wiring, store writes), extract only the *decision* and leave the *execution*
in place — that is what rounds 4, 5, 7, and 9 did.
