# Browser Live failure reasons - 2026-09-08

## Corrected boundaries

The extension already sends bounded `BROWSER_*` failure codes, but Loom's native
broker replaced them with `BROWSER_NATIVE_OPERATION_FAILED`. Hook's provider then
replaced failed command results with `BROWSER_PROVIDER_COMMAND_FAILED`. Both layers
now retain only failed-result codes matching the bounded browser code format.
Arbitrary exception text, malformed codes and nonterminal replies stay generic.
Effect-bearing results remain invalid and are never applied by the frame reader.

The command palette maps actionable cases to Chinese recovery instructions:
expired/missing selection, changed document, disconnected extension, unavailable
or revoked capability, missing authorization target and an import already running.
No failure falls back to capturing another screen region or following another tab.

## Validation

- Five real Windows named-pipe broker tests passed, including safe error forwarding,
  arbitrary-text rejection and pending-request cleanup.
- Fifteen Hook provider tests passed, including bounded error propagation and
  subscription cleanup after failed open.
- Two message tests cover recovery guidance and rejection of arbitrary error text.
- Native broker strict TypeScript checking passed.
- Hook production/test typechecks, focused ESLint and frontend production build
  passed; build took 1m 4s and retained the existing chunk-size warning.
- Strict line checks passed: Loom 994 files with 12 existing exceptions; Hook
  1114 files with no exceptions. Both independent Git diff checks passed.

This is incremental source work, not an installed release. Earlier component
candidates do not contain this change. The full installed browser -> Loom -> Hook
error path and the requested scrolling/tab-switch behavior still need product E2E
verification; these boundary tests do not substitute for that acceptance.
