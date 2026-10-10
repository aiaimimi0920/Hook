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

## Origin-scoped Loom HTTPS trust

Public HTTPS Loom origins use the normal Rustls/WebPKI roots. For a self-hosted
private CA, an operator may set both `HOOK_LOOM_TLS_ORIGIN` (one HTTPS origin,
scheme/host/port only) and `HOOK_LOOM_TLS_CA_FILE` (an absolute certificate-only
PEM file path) in the Hook process environment. This does not install OS roots,
enable plaintext remote access, or change device pairing/session authority.

`src-tauri/src/loom_tls.rs` owns this immutable process configuration. It reads
at most 32769 bytes and accepts at most 32768 bytes / eight certificates; empty,
malformed, key-containing or mixed-content files and incomplete environment
pairs fail closed before trust-aware requests are sent. Invalid configuration
rejects all such HTTP/WSS client construction, including loopback, rather than
silently selecting another trust policy. Correcting or rotating it requires a
Hook restart. Errors never print PEM content or the configured file path.
Use a local regular file: the byte budget does not place a timeout on a stalled
network filesystem during this one-time initialization.

For example, set the process environment before starting the isolated Hook:

```powershell
$env:HOOK_LOOM_TLS_ORIGIN = "https://loom.example.test:8443"
$env:HOOK_LOOM_TLS_CA_FILE = "C:\LoomTrust\ca.pem"
```

Only the exact canonical HTTPS origin, and its equivalent WSS origin, receives
the additional CA. Other origins retain default WebPKI trust. Shared HTTP
client cache keys include the configured origin and CA digest; scoped clients
disable redirects after caller configuration. Async and blocking Loom HTTP,
LiveRelay WSS, and wall media WSS share the same Rustls certificate, hostname
and validity checks. Windows certificate-store changes are not this mechanism.
Remote-image, Tea and voice clients using the proxy-only builder are unchanged.

TLS termination is still an operator deployment responsibility: use a real
HTTPS/WebSocket terminator in front of a loopback daemon, preserve device
authorization headers, validate any external browser Origin before rewriting
the backend Host, and never treat `LOOM_TLS_TERMINATED=1` as proof of encryption.
Do not distribute daemon administrator tokens in remote discovery manifests.

## Remote image retrieval

`src-tauri/src/native/remote_image_cache.rs` validates destinations, rejects
non-public resolved addresses, disables redirects and bounds response streams.
Its reqwest client pins a validated address for direct connections, but also
applies the configured network proxy. Do not infer control over a remote proxy's
DNS resolution from reqwest's direct-host override.

Windows compatibility fallback uses reqwest with Schannel instead of a separate
PowerShell downloader. It receives the same validated socket address and shares
the primary transport's redirect and byte limits. The original hostname remains
the HTTP Host and TLS certificate/SNI identity. Other HTTP clients explicitly
retain Rustls. The remote-proxy DNS limitation above still applies.

Surface and LiveRelay async/blocking clients reject redirects regardless of
whether a private CA is configured. Changing origins requires explicit endpoint
configuration and authorization, not an HTTP redirect.

Art deliveries accept at most 64 candidates; automatic prefetch selects at most
three, selected-first. The native image-search cache uses a cross-process lock,
a 512 MiB / 1024-file quota and a 64 MiB admission reservation. A full cache
rejects new downloads without evicting images referenced by persisted Units.
Temporary writes are atomically published; crash leftovers count against quota.
This bounds cooperative Hook writers, not arbitrary local filesystem writers or
the disk space consumed by other applications. No historical user assets are
automatically deleted by this policy.

## Extension permission authority

Hook treats contribution permissions as requested privileges, not approvals.
Only `trusted` plugin bindings can register executable shortcuts, commands or
menus; the command owner and scope must match. Missing host-owned
`effectivePermissions` grants no resource access. The entire operation is bound
to the current extension session, exact snapshot, and Unit revision, including
after asynchronous image preparation and before applying returned effects.

Before reading images or attachments, Hook asks Loom to revalidate installed
package trust and persistent grants through `resource.authorization.v1`. Cached
overlay actions use a live check without a ticket. Uploads and attachment/context
invocations use short-lived, single-use tickets, issued after any prerequisite
OCR finishes. Loom consumes and revalidates before staging resources and checks
grants again before returning runtime effects. Revocation cannot retroactively
erase data already received or undo side effects already executed.

This requires a coordinated Hook/Loom upgrade. Resource tickets are not transport
authentication: session IDs and a successful application protocol handshake are
not proof of peer identity.

## Authenticated native local bridge

The native Art/shader/coordination callers and extension host use the private
`loom.json` `hookBridge` descriptor with protocol `loom.local-bridge.v1`.
`HOOK_ENABLE_LOOM_HOOK` must explicitly enable integration; the default is off.
Startup capability refresh and extension registrations obey the same gate as
direct native connection attempts. Local capture and standalone session restore
do not need to connect to Loom.

Native code accepts only the descriptor's canonical loopback WSS endpoint,
authenticates its pinned leaf certificate with Rustls/WebPKI, then proves the
private discovery token using a TLS 1.3 exporter bound to that connection.
The raw token is never sent in an HTTP header or exposed to JavaScript. The
TLS/upgrade handshake has one absolute three-second deadline. An explicitly
set `LOOM_HOOK_WS_URL` must exactly match trusted discovery; an endpoint alone
cannot authorize a connection, and there is no plaintext downgrade.

The extension WebView adapter has only open/send/poll/close IPC for the main
window. Native allowlists the four extension negotiation/authorization/invoke
methods, binds all later calls to an opaque epoch, and bounds each direction
to 128 queued messages and 64 MiB total. A message is also at most 64 MiB.
Only one poll and one send are in flight in the frontend. Connection errors do
not expose private native diagnostics. Stop cancels and joins the worker;
late open/poll results cannot update a newer frontend connection. Queued
received responses are drained before a terminal close is reported.

Pure browser preview has no access to this native trust boundary. Its handshake
returns only isolated local preview capabilities, network requests fail locally,
and push registrations create neither sockets nor reconnect timers. Art execution
reports a local unsupported error without reading/uploading inputs. The main
WebView CSP grants no loopback WebSocket origins and is not expanded from boot
configuration.

This development migration still requires the matching Loom Desktop adapter and
operational probes to be finished and jointly
validated before a paired release. Library or single-client tests are not a
claim that the whole migration has shipped. A mixed-version pair fails closed.
Private discovery ACLs do not defend against arbitrary same-user process-memory
access or code injection into either trusted application.

## Emergency watchdog recovery authority

The watchdog authenticates the held parent process's executable path and the
creator of its inherited key pipe before enabling recovery or emergency input.
The capturing process keeps an ephemeral Ed25519 signing key; only its public key
crosses that pipe. Recovery journals are signed, bounded to 64 KiB and 16 records,
and bind the Hook process ID. The same authenticated pipe streams the current
snapshot, including revocation; the watchdog restores only its latest in-memory
snapshot, never a journal reloaded from a replayable filesystem path. Unsigned
legacy JSON journals are not accepted.
The existing target PID/thread checks remain in force. This is not a claim of
protection against code injection into a trusted Hook process or arbitrary
same-user process-memory access; native UIAccess/crash recovery still requires
separate interactive acceptance.

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
inline registration in the explicitly guarded branch. Known non-ambient constructor/`self` declarations or writes anywhere in the
analysis retain the warning, as do constructor property mutations, local
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
