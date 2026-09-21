# Browser Live import entry checkpoint

## Implemented

- App registers `neuro.official/browser-live.open` with the command router and unregisters on teardown.
- Direct command execution starts the real Live controller with a pending browser selection, a fresh gesture token and the selected Unit revision. The existing provider still validates the installed trusted package and permissions.
- Imports without a selected Unit fail closed; overlapping imports are rejected and failure releases the in-flight guard.
- Pending browser imports use authorized source dimensions instead of the placeholder rectangle. Native selection geometry is unchanged.
- Command palette failures are visible with bounded error codes; arbitrary exception text is not displayed. Missing import targets have an actionable message.

## Fresh verification

- Import entry tests: 3 passed, including authorization forwarding, missing target, concurrency and retry.
- Real browser Live controller tests: 3 passed, including source geometry, rendering and cleanup isolation.
- Production and test TypeScript checks passed after correcting the new test fixture to return `undefined` instead of `null`.
- Focused production ESLint passed.
- Frontend production build passed in 25.30 seconds; the existing large-chunk warning remains. Log: `artifacts/browser-live-import-build.log`.
- Strict effective-line checker: 1112 files, no files above 500 effective lines.
- Hook `git diff --check` passed with existing line-ending warnings.

## Not a completed product release

The command becomes discoverable only when the provider's trusted contribution is installed. This checkpoint does not install a browser extension, register a native host, publish a signed capability package, or modify the user's browser profile. Empty-canvas authorization remains unresolved; no synthetic Unit target was introduced.

The backend currently collapses some remote errors into `BROWSER_PROVIDER_COMMAND_FAILED`; showing an error is now implemented, but preserving the precise safe remote failure reason remains follow-up work. Browser input, original-screen placement/DPI validation and one-frame-many-regions capture optimization are also outstanding.

No new full Hook executable is claimed or installed by this checkpoint. The earlier Loom browser component candidate remains separate from the full Hook application. Hook contains pre-existing uncommitted work, which was preserved; Loom source was not changed in this increment.
