# Hook Live Screenshot Protocol Boundary

Status: Phase 9 network-readiness candidate for the declared Win32/WinForms baseline. Public NAT relay remains unavailable.

Hook implements the source and viewer sides of `loom.live.v1`. The matching Loom
candidate and canonical schema live in `protocol/LIVE_SCREENSHOT_PROTOCOL.md`
and `protocol/schemas/live-control.v1.schema.json` in the independent Loom
repository. Hook keeps an independent TypeScript contract, strict parser, binary
codec, and sequence tracker so protocol drift fails tests in either repository.

## Hook responsibilities

- publish source window identity, physical region, capture strategy, and measured
  interaction/observation capabilities;
- render viewer frames and keep view position, scale, opacity, topmost, and
  click-through state local to each Hook;
- adapt capture, input, observation, and lifecycle messages without copying
  Loom's Art executor;
- reject unknown versions, message types, fields, invalid sequence/epoch changes,
  oversized frames, and malformed media headers;
- keep replaceable frame data out of persistent graph state and out of the
  Surface long-poll endpoint.

## Local Live Unit integration

Local Ctrl+2 captures are ordinary graph sticker Units, not a separate floating
window hierarchy. `liveCaptureUnit.ts` owns the transient source binding;
`UnitView` owns selection, placement, drag, shared panels, and Art connections.
Green edges and yellow drag corners identify Live content without a local
session toolbar. Source regions remain attached to the source window while the
viewer Unit moves independently in logical canvas coordinates.

Streaming frames remain transient. The first frame and explicit editor,
copy/save, Art, or stop boundaries commit a bitmap snapshot to the Unit. Opening
the shared editor freezes its visible snapshot and suspends source interaction;
copy/save during editing uses that snapshot rather than a hidden newer frame.
Closing the editor resumes the current Live image. This does not continuously
republish every capture frame as a new formal downstream Art result.

Shared Hook shortcuts take priority over source input. Yellow corners use the
ordinary Unit drag lifecycle, while content forwards supported mouse/key/wheel
events to the bound source. Button/key edges are ordered and never coalesced;
pending moves are queued before their matching edges. Blur, cancellation, and
teardown release held input. Removing a Unit stops its capture; a capture closed
before its first frame does not leave an empty graph Unit.

See [V0.2.10 native acceptance](LIVE_UNIT_V0_2_10_ACCEPTANCE.md) for the tested
WinForms/DPI baseline and the remaining release-gate limitations.

The static Phase 1 declaration in `src/services/liveProtocol.ts` remains
`status: "contract_only"`; it is a schema descriptor, not a runtime health
claim. Phase 6 reports source/viewer and UIA availability only after the
corresponding runtime owner starts and its capability probe passes.

## Transport split

Control is strict JSON with `protocolVersion`, `sessionId`, `epoch`, `sequence`,
`messageType`, and `payload`. Lifecycle, authority, input button/key edges,
permissions, observations, and trigger audit are reliable and ordered. Only
mouse-move samples may be coalesced.

Media uses a separate binary channel. The 64-byte `NLLV` header carries epoch,
frame ID, capture/encode timestamps, dimensions, keyframe flag, dropped-frame
count, color space, codec, and payload length. The queue contract is two or three
latest frames; a slow viewer never blocks capture.

## Security boundary

Parsing is not authorization. Hook accepts remote input only after Loom device,
attachment, controller, epoch, expiry, and revocation checks. Secure desktop,
other users/sessions, protected targets, and targets with higher integrity than
Hook fail closed. Same-user input to equal or lower integrity follows Windows
UIPI; an elevated Hook does not require an ordinary source to be elevated.
Source titles, pixels, UIA text, keyboard data, and OCR text are
sensitive and must not be written to normal logs.

See `docs/LIVE_SCREENSHOT_COMPATIBILITY_BASELINE.md` for the locked Phase 0
support declaration. The contract intentionally contains capabilities for later
phases without claiming they are currently implemented.

## Phase 6 observation behavior

Hook publishes UIA observations only from the paired source attachment. Each
observation has a positive sequence and timestamp, a bounded stable locator,
source/confidence, and at most 64 KiB of serialized value data. A relay stores at
most 256 current observations. `unknown`, `stale`, and `error` never carry a
value; UIA values shown as trusted require `source=ui_automation` and
`confidence=exact`.

The UIA owner is a dedicated MTA thread. Structure events invalidate a bounded
tree scan; exact properties are periodically re-resolved instead of retaining
provider-owned callback variants. AutomationId is the preferred stable identity,
while runtime ID is diagnostic only. Locator collisions and unsupported pattern
reads fail closed rather than inferring a value from the control type.

Session discovery is value-redacted. A viewer obtains the full current
observation snapshot only after attaching as a session member, then receives
reliable ordered observation events separately from replaceable media frames.

Stable UIA values emit a bounded one-second heartbeat while preserving their
original `stableSinceMs`. This lets Loom satisfy a deterministic stability
duration without treating every identical capture frame as a new state change.
Transient publication failure keeps the UIA owner alive, marks the observation
path as recovering, and retries without advancing either sequence.

## Phase 7 trigger boundary

Only a connected viewer can register a trigger. Hook validates the binding,
condition, 4 KiB/16-level/512-node operand bound, numeric operand type, and
Surface target before forwarding the viewer's next ordered control message to
Loom. The supported selector form is exactly
`{ "path": "/json/pointer", "value": expected }`.

Hook never evaluates a condition and never executes Art. Loom owns trust,
stability, edge/re-arm state, online authorization, deterministic idempotency,
and the existing Surface/Art action executor. In particular, the viewer's
offline state pauses remote trigger execution while source capture and
observation publication continue.

Attached viewers store Loom's bounded trigger registration snapshot and audit
stream. Reservation and final execution events use the same idempotency key, so
Hook replaces the provisional audit instead of showing two executions. The UI
shows registration count and recent `fired`, `skipped`, or `failed` reasons,
including trace fields for observation ID/sequence/source device/source type,
authorizer, and the Loom action request ID when one exists. Discovery responses
remain trigger-redacted.

## Phase 8 extension discovery

The local Tauri command `get_live_extension_capabilities` returns the strict
`hook.live.extensions.v1` report. It is capability discovery, not provider
activation. Every item declares its ID, kind, availability, execution owner,
trust boundary, optional observation source and confidence ceiling, plus a
required reason when unavailable. Rust and TypeScript independently validate the
same wire fields and reject duplicates, unknown fields, malformed IDs, visual
`exact` confidence, or an adapter that claims the native Hook trust boundary.

Browser, Electron, special-rendering, and visual observation providers are owned
by `loom_capability_plugin` and must cross
`loom_verified_capability_package`. Hook recognition cannot bypass Loom package
signature/revocation checks, content identity, permission grants, process
limits, or lifecycle state. OCR is an optional Loom Capability Plugin; Hook core
does not ship or silently invoke an OCR engine. App-specific code therefore
stays in an independently installable package instead of the Hook capture, UIA,
or relay modules.

This candidate reports the following entries as unavailable:

| Kind | IDs | Reason |
| --- | --- | --- |
| Application adapter | `browser_accessibility`, `electron_accessibility`, `special_rendering` | `adapter_package_not_installed` |
| Visual observation | `vision_observation` | `vision_provider_not_installed` |
| Extended interaction | `touch_input`, `pen_input`, `ime_input`, `clipboard_input`, `file_drop_input` | `backend_not_implemented` |

Unavailable means no live protocol input or provider output is emitted. The
existing same-integrity window-message backend remains mouse/key/wheel only.
Local clipboard and file-drag product commands are not treated as remotely
authorized live input. This prevents an unimplemented capability from appearing
usable merely because Hook has an unrelated local feature with a similar name.

All visual observations must identify `source=vision` and cannot claim more than
`high` confidence. UI Automation exact observations require a stable element
locator. Loom resolves the locked Surface action at dispatch time and rejects a
non-exact observation for high-risk actions. Users can still reclaim the single
controller immediately; optional semantic active actions continue through the
permission-checked Loom Surface/Art executor rather than executing inside Hook.

## Phase 9 network capability and latency

The local `get_live_network_capabilities` command returns the strict,
non-secret `hook.live.network.v1` report. It shows the configured Loom scope,
whether the remote-Surface build capability exists, the transport inventory,
non-loopback security requirements, latency/input policies, and privacy posture.
The report may expose the configured origin to the local user, but never device
tokens, proxy credentials, pairing secrets, or URL query data.

`websocket_binary` is available only when Hook has a valid loopback or private
HTTPS Loom origin. Non-loopback origins require HTTPS, the remote-Surface build,
and Loom device authentication. `cloud_relay` and `webrtc_turn` are explicitly
unavailable with `relay_provider_not_configured` and
`nat_traversal_not_configured`; schema presence does not imply that a public
relay, TURN server, bandwidth adaptation, or cloud control plane exists.

Viewer connections send bounded WebSocket Ping probes. Loom answers viewer Ping
frames, and Hook exposes the measured round-trip time with `measuring`, `low`,
`elevated`, or `high` state. Mouse moves remain replaceable and are coalesced at
16, 33, or 66 ms according to RTT. Mouse buttons, wheel, key edges, cancel,
authority, and lifecycle messages are not delayed or dropped by that policy.
Source-only sessions report RTT as unavailable because they do not receive
remote input.

The report fixes the current privacy posture to local-first, no cloud frame/OCR
persistence, no built-in telemetry, and no credential exposure. Runtime and
panic diagnostics are single-line, bounded, and redact bearer/assignment
credentials, compact tokens, URL userinfo, query, and fragment data before disk
or stderr output. This is a local policy contract, not evidence of an external
cloud retention audit; such evidence requires a configured provider.
