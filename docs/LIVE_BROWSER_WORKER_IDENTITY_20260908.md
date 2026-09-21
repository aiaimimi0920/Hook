# Browser Live full-shell worker identity correction

## Confirmed failure mechanism

The full-shell probe selected `context.serviceWorkers()[0]`. In the failed replay
the first worker was a different Edge extension:
`chrome-extension://ndcpkimcihhghdcddljkfmmjccdmcmof/background.rollup.js`.
The installed Browser Live worker was present but second:
`chrome-extension://gmhnbbhnghdgaomkjlnhaoggdllclkoa/worker.js`.

Evidence: `artifacts/browser-live-shell-20260908-r5/worker-selection.json`.
The test dispatched `Extensions.triggerAction` with the unrelated extension ID.
That explains the identified action-dispatch failure. It was a test discovery
defect, not evidence that the native capture implementation needed a longer timeout.

The probe now reads the installed native registration and requires exactly one
valid Browser Live extension origin. It selects only the exact registered worker
URL and waits for that worker's action listener. It never invokes the production
handler directly, fabricates a grant, or changes the user's browser profile.
Two focused Node tests cover another worker starting first, a lookalike worker
path from another extension, and malformed/ambiguous registrations.

## Stronger frame acceptance

The r6 replay passed the original screenshot-difference check, but visual review
showed a not-yet-loaded image in its initial screenshot. It is not counted as proof
of two valid changing frames. The probe now waits for decoded image dimensions
before the first screenshot, then requires a different decoded image source after
tab switching and source scrolling. Screenshot hashes must also differ.

The r8 full-shell replay passed this stronger check. Visual inspection confirmed
both actual Hook screenshots contain the selected green region and different
clock text; neither contains the old automatic read-only error notice:

- `artifacts/browser-live-shell-20260908-r8/hook-live-initial.png`
- `artifacts/browser-live-shell-20260908-r8/hook-live-offscreen.png`
- `artifacts/browser-live-shell-20260908-r8/summary.json`

The subsequent r9 replay also passed, giving two consecutive passes of the
stronger full-shell check. The final process check found no Hook or owned r5-r9
Edge processes. Strict line checks, script TypeScript, ESLint and both scoped
repository diff checks passed. Loom source was not changed in this step.

This route used the compiled Hook r3 executable, the real running Loom daemon,
the installed locally signed capability, registered native messaging and the
production Edge selection worker. It also verified failure notice dismissal in
the actual Hook sticker before preparing capture. It did not replace Hook with
a component harness or call the provider through a framed test client.

## Product boundary

Only acceptance code changed in this step; no new product binary was required.
The exercised executable remains:
`../release/Hook/browser-live-candidate-20260908-r3/V0.2.29/portable/hook.exe`,
SHA-256 `956466c547dae45d8e0c38b2c91e7de8d4aeba438ec7c65104823ab9e6c58286`.

The tested workflow is selected sticker, command-palette prepare, browser action
selection, command-palette import. It still uses an owned Edge profile. Ordinary
Ctrl+2 does not yet acquire a browser document grant, personal-profile extension
onboarding is not complete, and browser input remains read-only. Those are real
product gaps, not resolved by fixing this test. Do not mark the whole task done.
