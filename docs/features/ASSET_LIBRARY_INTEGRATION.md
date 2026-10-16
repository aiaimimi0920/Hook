# AssetLibrary integration boundary and historical contract

This document preserves Otter's proposed catalog/install ownership boundary and
the historical API design used to discuss Art and Capability installation. Otter
does not currently contain an AssetLibrary client or store UI. It is not a
ready-to-implement contract for the current AssetLibrary service.

The API details below refer to the historical AssetLibrary OpenAPI `0.2.0` with
response schema `1.0`. Its source documents now live under AssetLibrary's `old/`
directory. Reconcile routes, authentication, download and installation behavior
with the service owners before implementation, then pin the reviewed commit or
release in integration tests. Do not treat archived schemas as current endpoints.

References (the first three are archived, not current service authority):

- [Archived AssetLibrary OpenAPI](https://github.com/aiaimimi0920/AssetLibrary/blob/main/old/contracts/openapi/openapi.yaml)
- [Archived download and Edge contract](https://github.com/aiaimimi0920/AssetLibrary/blob/main/old/docs/DOWNLOAD_SEARCH_EDGE.md)
- [Archived Loom client and installation contract](https://github.com/aiaimimi0920/AssetLibrary/blob/main/old/docs/LOOM_CLIENT_AND_PUBLISHER_CLI.md)
- [Loom-side integration guide](https://github.com/aiaimimi0920/Loom/blob/main/docs/ASSET_LIBRARY_INTEGRATION.md)

## Current status

| Area | Current state |
| --- | --- |
| AssetLibrary public API | External ownership; the API details below describe an archived implementation, not current deployment status. |
| AssetLibrary reusable installer | The historical design used `crates/loom-client`; current installer availability must be verified in the owning repository. |
| Otter store page/client | Not implemented. |
| Loom-to-AssetLibrary production adapter | External ownership; availability and contract must be verified against the selected Loom version. |
| Otter-owned Art execution | Intentionally not applicable; Loom owns execution. |
| App Update through AssetLibrary | Disabled and outside this integration. |

Do not call an unimplemented route, show an install as successful before Loom
activation completes, or describe the current local process as a production
service.

## Ownership boundary

Otter is the presentation and interaction surface. Loom remains the package,
execution, trust, and installation authority.

```text
Otter SolidJS/WebView
  -> Otter native Loom connector
    -> authenticated local Loom daemon
      -> AssetLibrary metadata API
      -> independent Account Service
      -> allowlisted AssetLibrary Edge download origin
      -> Loom control-plane package roots
  <- loom.extension.v1 contribution snapshot
  <- loom.hook.v1 Art definitions and execution results
```

The consequences are deliberate:

1. Otter may present catalog, search, release, permission, progress, and error
   information.
2. Otter must not download a Capability ZIP into the WebView, hold an Account
   bearer, receive an Edge ticket, verify a signing key, or activate package
   files.
3. Otter must not install or execute Art packages itself. Existing package Arts
   are forwarded to Loom through `loom.hook.v1`.
4. Loom owns staging, digest/signature verification, permission approval,
   dependency checks, activation, rollback, receipt synchronization, and the
   installed-package registry.
5. A Otter-triggered install still uses AssetLibrary `client_type: "loom"` while
   Loom owns the install target. Use `client_type: "hook"` only if a future,
   separately reviewed design gives Otter its own package cache and activation
   transaction.

This keeps one installed version and one trust decision for Loom Desktop and
Otter instead of creating two divergent local stores.

## Connection configuration

Otter should not introduce an AssetLibrary production URL of its own. It connects
to the already authenticated local Loom daemon using the existing secure Loom
connector. Loom owns the AssetLibrary API URL, Edge-origin allowlist, timeouts,
and Account Service session.

Development addresses and service health must be obtained from the active Loom and
AssetLibrary configuration, not from a workstation snapshot in this repository.
Production requires HTTPS and an exact trust/allowlist policy; plain HTTP is only
permitted for an explicitly configured loopback development origin.

Health, readiness and catalog probes belong to the AssetLibrary operator workflow.
Do not hard-code its ports in Otter or issue those probes from the renderer.

## Browsing store data

Otter's future store surface should request the following public data through a
Loom-owned adapter. Public browsing does not require an Account bearer.

| Purpose | AssetLibrary operation | Important behavior |
| --- | --- | --- |
| Art list | `GET /v1/public/packages?kind=art&limit=24` | Returns `PackagePage`. |
| Capability list | `GET /v1/public/packages?kind=capability&limit=24` | Returns `PackagePage`. |
| Search | `GET /v1/public/search?q=...&kind=...&tag=...&limit=24` | A `503` means search is unavailable, not zero results. |
| Package detail | `GET /v1/public/packages/{slug}` | A `404` is a missing/unavailable package. |
| Releases | `GET /v1/public/packages/{slug}/releases?limit=20` | Newest first; only verified artifact projections. |
| Publisher | `GET /v1/public/publishers/{slug}` | Public publisher identity. |

For list and search responses:

- require `schema_version == "1.0"`;
- render only `status == "published"` entries returned by the public contract;
- use `next_cursor` unchanged for the next page and never construct or decode it;
- keep `kind` distinct: `art` and `capability` are not interchangeable;
- bound query text to 200 characters, tags to 100 characters, and page size to
  `1..100`;
- treat an invalid response shape as a contract error, not as an empty page.

Package cards can rely on `id`, `slug`, `name`, `kind`, `summary`, and publisher
`id`/`slug`/`display_name`. Release selection must use the release response rather
than guessing from package summary data. Each release supplies:

- immutable release `id`, `version`, and `published_at`;
- compatibility products (`loom` or `hook`) and version requirements;
- declared permissions;
- one or more artifacts with `artifact_id`, `release_id`, lowercase SHA-256
  `digest`, `size_bytes`, safe `file_name`, `media_type`, and `signing_key_id`.

Otter should show compatibility and permissions before enabling the install
confirmation. The Loom daemon makes the authoritative compatibility and policy
decision again at install time.

## Installation request and result

The Otter UI should work against a small local interface owned by the Otter-to-Loom
connector, not against AssetLibrary HTTP directly. The interface must support:

- list/search/detail/release reads;
- install request for an exact `package_id`, `release_id`, and `artifact_id`;
- bounded progress updates (`queued`, `authorizing`, `downloading`, `verifying`,
  `staging`, `activating`, `receipt_pending`, `succeeded`, `failed`, `cancelled`);
- explicit cancellation;
- safe errors containing a code, retryability, and user-facing message;
- installed state keyed by canonical publisher/package identity and digest.

The exact local route/message names belong in the Loom protocol change that
implements this adapter. Until those names exist in Loom code and protocol tests,
Otter may build UI types and mock fixtures but must not bypass the boundary with a
temporary renderer-side downloader.

For a managed install, Loom performs this sequence:

1. Resolve an opaque Account Service bearer in the native daemon process.
2. Create a restricted download session for the exact artifact with a stable
   `Idempotency-Key` and `client_type: "loom"`.
3. Generate an ephemeral Ed25519 receipt key and request an install challenge
   bound to the session and current host profile.
4. Download bytes directly from the returned, allowlisted Edge URL. Send the
   returned ticket as `Authorization: Bearer`; never put it in the URL.
5. Verify session/artifact binding, archive SHA-256, canonical ZIP SHA-256,
   publisher key/signature, manifest identity, permissions, compatibility, and
   challenge expiry.
6. Run Loom's atomic installation transaction: prepare, commit, execute local
   post-commit checks, sign the InstallReceipt, then finalize. Roll back on every
   pre-finalize failure or cancellation.
7. Submit the signed InstallReceipt. A temporary receipt-sync failure becomes
   a durable `receipt_pending` state; it does not undo an already finalized local
   install.
8. Publish the new Art definition or Capability contribution snapshot to Otter.

Even a public Art should use this managed flow when the user chooses **Install**,
because the challenge supplies the current trust and compatibility snapshot and
the receipt records the installed release. The anonymous public Art download
route is suitable for browser/manual downloads, not a shortcut around managed
installation. Capability downloads are always restricted.

## Host compatibility data contributed by Otter

The install challenge contains a strict host profile. Loom assembles the final
profile, while Otter must expose its current facts without guessing:

- Otter product version;
- `hook_extension_api` version and feature list;
- `surface_api` version and feature list;
- supported Surface node identifiers.

API versions use `major.minor`. The current Otter extension protocol is
`loom.extension.v1`; its parser accepts extension API major version `1` and the
current exported constant is `1.0`. Unsupported major versions must fail closed.
Do not claim a feature or Surface node merely to make a package appear
installable.

## Activation into Otter

Otter does not discover package files. It learns installed behavior from Loom's
existing protocols:

### Art packages

Loom publishes `ArtCapability` definitions over `loom.hook.v1`. Otter renders the
declared parameters, ports, previews, and Surface metadata, then sends execution
back to Loom. UI behavior must come from package metadata such as
`metadata.capabilities`; it must never be inferred from an Art ID or framework
implementation detail.

### Capability packages

Loom publishes a `loom.extension.v1` contribution snapshot. Every plugin binding
must include and pass Otter's current parser validation for:

- `id` and `version`;
- lowercase SHA-256 `packageDigest`;
- `trustStatus` (`trusted`, `unsigned_developer`, `revoked`, or `untrusted`);
- lowercase SHA-256 `permissionGrantDigest`;
- `scopeId`.

Contributions are accepted only when the plugin/scope binding matches, IDs are
unique, list and total-count limits are respected, the snapshot is at most 2 MiB,
and any `when` expression compiles. Store installation must not add per-plugin or
OCR-specific branches to Otter.

An install is user-visible as complete only after:

1. Loom reports local activation success; and
2. Otter observes the corresponding trusted package digest in the current
   capability/extension snapshot.

This avoids showing an installed badge for a package that was downloaded but did
not become active.

## Secret and download rules

The following values must never cross into SolidJS state, WebView storage,
console output, analytics, crash reports, URLs, or persisted Otter sessions:

- Account Service bearer;
- Edge download ticket;
- presigned URL or private object-store key;
- receipt proof private key.

Catalog/release metadata and sanitized progress are safe to expose. Error bodies
must be bounded and redacted by the native boundary before presentation.

The native downloader owned by Loom must additionally enforce:

- exact scheme/host/port download-origin allowlist and redirect denial;
- HTTPS outside explicit loopback development;
- `Accept-Encoding: identity` and a single validated byte range when resuming;
- exact `206 Content-Range`, size, content length, and final SHA-256;
- bounded request/stall timeouts, retry count, buffers, and cancellation;
- private `.part` and binding state, digest-addressed verified cache, no-clobber
  final promotion, and no symlink/reparse traversal;
- verification again at the final cache path before installation.

Otter should display resumable progress but must not persist the sensitive session
or ticket needed to produce it.

## Offline and failure behavior

| Condition | Otter behavior |
| --- | --- |
| Public search returns `503` | Show “search temporarily unavailable”; do not show a valid empty result. |
| Account Service unavailable before challenge | Installation is blocked; browsing remains available. |
| Network drops during download | Keep resumable progress and allow bounded retry/cancel through Loom. |
| Challenge expires | Fail the install and obtain a new authorization; never activate on stale authority. |
| Compatibility/permission/trust check fails | Show the safe failure and do not offer a bypass. |
| Activation fails | Report failure after Loom rollback; do not update installed state. |
| Receipt sync fails after activation | Show installed with `receipt_pending`; Loom retries the non-secret signed receipt. |
| Loom is unavailable | Disable install/update actions; do not fall back to renderer-side installation. |

Idempotency keys are stable for retries of the same logical mutation and new for
a new user action. Never retry non-idempotent steps by inventing a fresh key after
an ambiguous response.

## Local end-to-end development

API health, readiness and catalog browsing do not prove full package download.
Verify the actual Edge and Account Service dependencies in their owning repositories;
this document does not certify a currently running deployment or account integration.

The historical implementation used the following composite gate. This is a
historical command, not a current checkout instruction: locate the matching
archived revision and inspect its dependencies and side effects before using it.
For new integration work, obtain the current gate from the service owner.

```powershell
Set-Location <asset-library-repo-root>
.\scripts\Test-P7Runtime.ps1 -StartDependencies
```

That historical gate owns its process-local test identity and Edge lifecycle. Do not copy its
test bearer into Otter configuration, source, fixtures, screenshots, or logs. A
passing AssetLibrary P7 gate does not prove the future Otter/Loom adapter; that
adapter still needs its own cross-repository runtime test.

## Implementation acceptance checklist

Before Otter can claim AssetLibrary support:

1. Loom exposes a versioned, authenticated local catalog/install/progress
   contract and tests it against pinned AssetLibrary schemas.
2. Otter introduces a typed connector interface; the renderer receives no secret
   or raw archive path.
3. Store UI follows the Neuro design system and has loading, empty, unavailable,
   incompatible, permission-review, progress, cancel, receipt-pending, and
   rollback-failure states.
4. Art and Capability filters remain distinct and pagination/search errors are
   contract-tested.
5. Installed badges are derived from Loom's digest-bound active registry/snapshot,
   not from a completed HTTP request.
6. Tests prove that bearers, tickets, private keys, and URLs are absent from
   renderer events, logs, persistence, and diagnostics.
7. A real local cross-process test proves browse -> authorize -> resume/download
   -> verify -> activate -> Otter snapshot -> receipt behavior, including cancel,
   corruption, expiry, and rollback.
8. App Update remains disabled until its separate TUF, root-key, host rollback,
   and signed-release gate is delivered.
