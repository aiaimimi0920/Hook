# Runtime security boundaries

This document describes implementation limits to preserve when changing device
identity, remote-image fetching and native input. Vulnerability reporting remains
in [SECURITY.md](../SECURITY.md); dependency policy is in
[DEPENDENCY_SECURITY.md](DEPENDENCY_SECURITY.md).

## Device identity storage

Windows device private keys use DPAPI-protected schema v2 storage. Legacy schema
v1 keys are marked for migration on Windows; non-Windows readers reject the
Windows-protected schema. The implementation is
`src-tauri/src/device_session/identity_protection.rs`. The old modularization
record's deferred-DPAPI statement no longer describes this implementation.

This storage protection does not replace paired-device authorization, token
expiry, revocation or the operating system's account security. Do not include
private keys or tokens in diagnostics or ordinary application state.

## Remote image retrieval

`src-tauri/src/native/remote_image_cache.rs` validates destinations, rejects
non-public resolved addresses, disables redirects and bounds response streams.
Its reqwest client pins a validated address for direct connections, but also
applies the configured network proxy. Do not infer control over a remote proxy's
DNS resolution from reqwest's direct-host override.

The Windows PowerShell HttpClient fallback disables redirects and enforces the
encoded-byte limit, but receives a URL rather than the validated socket address.
It must not be described as providing the same DNS pinning as the direct
reqwest path. Preserve prevalidation and bounded reads; complete proxy/fallback
destination enforcement remains a security review boundary.

## Native input lifecycle and performance

The low-level mouse and keyboard hook workers in
`src-tauri/src/native/capture_mouse_worker.rs` and
`src-tauri/src/native/overlay_keyboard_install.rs` run Windows message loops and
unhook after those loops exit. Their installers discard the spawned join handles.
Explicit stop/join behavior during application shutdown and lock contention on
input paths require lifecycle/performance verification; source modularization
alone does not prove either property. This is not evidence of an observed leak.

Application bundle size and interactive latency are separate from effective
source-line limits. A passing line checker cannot close a bundling warning or a
native responsiveness concern; use current build output and runtime measurements.

## Acceptance

Source tests, headless self-checks, real native-window interaction and paired
device/network behavior are separate evidence. Follow
[release provenance](release-provenance.md), [QR projection](QR_PROJECTION.md),
[Live capture](LIVE_CAPTURE.md) and [tile terminal](TILE_TERMINAL.md) for their
specific gates and remaining physical-runtime limits.

## Dedicated QR worker and CodeQL model

The QR decoder registers its message handler only inside a positive
`DedicatedWorkerGlobalScope` runtime guard. The private worker channel carries
structured-cloned data with no page origin; payload validation is not origin
authentication. Loading the built worker as a Window module must not install a
Window message handler. The Chromium CI probe decodes a real QR fixture, checks
transferred pixels and malformed messages, and verifies that Window exclusion.
It does not replace interactive Windows WebView2 validation.

`.github/codeql` retains the official `js/missing-origin-check` metadata and all
stock origin/source checks. Its conservative extra case recognizes only a direct
inline registration in the explicitly guarded branch. Known global constructor
or `self` assignments anywhere in the analysis retain the warning, as do local
constructor shadows and unrelated guards. This static model assumes native
globals are not secretly replaced by external code; it is not a general proof
against arbitrary monkey-patching or compromised same-origin scripts.

The JavaScript CLI and packs are pinned in `upstream.json` and `qlpack.yml`.
`test-codeql-worker-model.mjs` fails on upstream query hash drift or any change to
the stock security-extended query set except this one replacement. Intentional
unsafe fixtures use `.fixture` files and are materialized outside the checkout
for real CodeQL tests; no application scan paths or SARIF results are filtered.
The source query and license are derived from the recorded GitHub CodeQL commit.
Update the pinned toolchain, packs, hash, fixtures and coverage evidence together
when adopting upstream releases; a fixed model is not permission to stop scanner
maintenance. Rust and Actions retain their existing suites and tool selection.
