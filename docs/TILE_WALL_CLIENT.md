# Tile wall client integration

Status: geometry, validated control transport, independent terminal entry and
empty-wall test-pattern, immutable images, Live media and endpoint-scoped Live
input and declarative Art views/actions are implemented. See [TILE_TERMINAL.md](./TILE_TERMINAL.md) for launch
commands and limits. Final multi-terminal acceptance remains in
Loom's [wall guide](../../Loom/docs/TILE_WALL.md); this is an internal
development slice, not the completed interactive-wall product.

The public wire contracts are Loom's `protocol/WALL_PROTOCOL.md`,
`protocol/WALL_CONTROL_API.md` and `protocol/schemas/wall.v1.schema.json`.
Hook remains a standalone repository and does not import private Loom source.
The public geometry fixture is mirrored under
`__tests__/fixtures/wall/wall-geometry.v1.json`; its bytes must match Loom's
`protocol/fixtures/wall-geometry.v1.json` before joint release.

## Native authorization and transport

The restricted `wall_request` Tauri command accepts only state, register, remove,
connect, heartbeat, disconnect, read_image, identify_report, fixed Live input/control operations,
and seven fixed `surface_*` operations documented in Loom's `WALL_SURFACE_API.md`.
It cannot call administrator layout
routes or caller-supplied URLs. Native discovery supplies the validated Loom
origin; non-loopback HTTP, userinfo, paths, queries and fragments are rejected.

`authorize_tile_request` uses the existing paired-device identity/cache path even
on loopback. Tiles do not inherit the local administrator bearer. The default
`remote-surface` feature is required; builds without it report an unavailable
pairing capability. Human approval still happens through the existing Loom device
management interface. Native registration supplies the authenticated device ID;
JavaScript cannot replace it with another device's ID.

Device credentials and fresh request nonces remain in native code. The command
returns only `{deviceId, body}`. It uses the shared proxy-aware HTTP client with
redirects disabled, a 15-second request timeout, 512 KiB request limit and 10 MiB
response limit (including streamed/chunked responses). That response limit covers
the bounded catalog plus endpoint-status metadata. No mutation is automatically
retried; HTTP 401 invalidates the existing session cache for the next request.
Errors expose a fixed code and optional HTTP status, never raw remote text or
credentials. Pairing has its existing separate bounded approval/session flow.

`read_image` calls only `/v1/walls/images/read`, passing the current endpoint,
presenter lease, layout revision and content hash. Its response limit is 24 MiB
and network timeout 8 seconds. One process-wide non-queueing semaphore bounds
image download/decode; the blocking decoder retains that permit if its awaiting
command is cancelled. Native admission checks the source SHA-256 and raster
format, limits dimensions and allocations, then emits only a normalized bounded
PNG data URL plus image ID and dimensions. No source URL or resource lease is
accepted from JavaScript. Control requests keep their independent limits.

The renderer owns at most 16 unique visible bitmaps and 16,777,216 retained
pixels. It downloads one missing image in the background while the serial
presenter continues reading state and heartbeating with a null applied revision.
Only a subsequent authenticated presenter tick paints a complete prepared set.
Layout/lease changes invalidate pending results; source identity permits reuse
of already verified immutable pixels. Clearing or pruning closes owned bitmaps.

## Frontend boundary

Art state has a separate serial cache owner, bounded resource URL cache and
ordered input controller. It reuses `DeclarativeSurface` and the host-owned
`SurfaceConfirmationDialog` without initializing the ordinary Hook workspace.
The default viewport is 800 x 600 unless a manifest view supplies `fullSize`,
with minimum size respected. At most four Art sources and sixteen Art placements
are admitted. Same-source placements share a single ephemeral attachment.

Declarative children use stable node IDs and reactive current-node lookup.
Unrelated snapshot updates preserve the existing input element, focus and
selection. Text/textarea drafts remain local while their host completion
promises are outstanding; instance, attachment or node replacement invalidates
late completions. The host waits for a fresh execution outcome, rather than
treating an accepted acknowledgement as completed editing.

The Art input queue is bounded to 32 entries. Absolute scalar value edits may
wait up to 30 seconds for preceding execution. An action queued behind the same
view's local edits waits for them within a 30-second total budget, then has at
most 1.5 seconds to revalidate and submit. Independent actions retain their
1.5-second expiry. Reported edit failure or exhausted execution wait discards
queued successor work. Expired actions report a notice. Every submission still
revalidates the view, generation, placement and unchanged control contract.
Accepted value edits have a separate 30-second outcome-wait budget; each native
request remains independently bounded. Uncertain mutations are never replayed.
The Art plane's `aria-busy` covers the tile's queued and in-flight value edits;
source state alone cannot prove that a later local blur event has already drained.
An input rejection discards that instance's queued successors and refreshes its
state without closing the readable view. This preserves a complete frame while a
freeze or identification command is propagating. The next gesture reads the
authoritative sequence before submission; the failed mutation is not replayed.
A failed state read still invalidates the view, and output/lease monitoring still
clears content after authorization is lost.

Mixed content uses a base media canvas, clipped declarative Art layers and one
optional upper media canvas. Higher Art is subtracted from upper media clips;
transparent media blends once above lower Art. Input clips independently
exclude all higher placements. An affine mapping applies crop and rotation to
the canonical Art viewport. Layout acknowledgement waits for all admitted
Surface state/resources and existing media readiness.

Surface requests use a four-second timeout and four native admission permits;
Surface image requests use eight seconds and share the single image decoder
permit. Live input retains its 4 KiB request, 8 KiB response and two-second
timeout limits. Error bodies are capped at 8 KiB and arbitrary server messages
are discarded. Asynchronous action failure exposes only the fixed sanitized
code, without clearing the last scene or conflating it with formal output.
Pending state includes continuous Art execution, which is not advertised as
explicitly cancelable. Loom retains at most 64 acknowledgement identities per
ephemeral view, protects unfinished work, and removes only that view's history
on cleanup. This history and its ownership metadata do not persist with the
ordinary source instance.

`src/services/apiWall.ts` uses `safeInvoke` without a successful browser-preview
fallback. It sends business DTOs and validates native response identity, wall
state, presenter leases and acknowledgements. A rejected or malformed response
does not become empty successful state. `wallProtocol.ts` creates immutable
snapshots; `wallGeometry.ts` uses the same snapshot for display and hit testing.

The client reports request completion only. Cancelling a JavaScript promise does
not cancel a Tauri command that has already entered native code. The serial
presenter waits for its owned operations and disconnects a late granted lease.
Escape allows one second for cleanup before native exit; a broken or late
connection then relies on the bounded server lease expiry. A new cycle reads
the catalog before reconciling registration; it does not blindly retry writes.

## Verification and iteration

- `npm test -- __tests__/unit/WallGeometry.test.ts __tests__/unit/WallApi.test.ts`
- `npm run typecheck:test` and `npm run lint`
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib wall_client::`
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib device_session::`

Native transport tests use real loopback HTTP sockets to check authentication
headers, identity injection, fixed routes, size claims/chunked overflow, truncated
responses, rejection and redaction. They do not claim completed multi-display
presentation. Static image iteration `v0.2.30.2` is built and verified in
`Neuro/release/Hook/v0.2.30.2-image`; the initial directory without `-image`
is retained as a failed CSP candidate. See Loom's stage 2 acceptance report for
the static-image evidence; current Live/input evidence is in Loom's stage 4
acceptance report. Real-process Art acceptance is exercised by
`scripts/tests/Invoke-TileWallArtProbe.ps1`; stage 5 records its executed scope.
Final multi-terminal acceptance remains open.

Physical identification uses optional strict endpoint metadata and a separate
lease-owned request/report. The native `identify_report` operation targets only
`/v1/walls/endpoints/identify/report`; the administrator command is not exposed to
the terminal. Rendering, input shielding, timeout, dismissal and upgrade rules
are specified in [WALL_IDENTIFICATION_API.md](../../Loom/protocol/WALL_IDENTIFICATION_API.md).
The presentation probe also exercises actual manager identification before its
display-control and recovery phases; executed scope is recorded by stage.
