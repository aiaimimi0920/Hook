# Hook Live Screenshot Protocol Boundary

Status: Phase 9 network-readiness candidate for the declared Win32/WinForms baseline. Public NAT relay remains unavailable.

Hook implements the source and viewer sides of `loom.live.v1`. The matching Loom
candidate and canonical schema live in `protocol/LIVE_SCREENSHOT_PROTOCOL.md`
and `protocol/schemas/live-control.v1.schema.json` in the independent Loom
repository. Hook keeps its Rust media codec/sequence checks and TypeScript
presentation contract independent, with shared wire fixtures in both repositories.

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

The historical input baseline covers same-integrity Windows WinForms controls
and 150% DPI. It does not establish support for every Electron, Qt, custom-drawn,
elevated or protected window, or every mixed-DPI monitor combination. Creating
an Art Unit is not proof that every plugin completed execution. Candidate desktop
checks do not replace the exact package's full tests and clean-source release gates.

The static Phase 1 declaration in `src/services/liveProtocol.ts` remains
`status: "contract_only"`; it is a schema descriptor, not a runtime health
claim. Phase 6 reports source/viewer and UIA availability only after the
corresponding runtime owner starts and its capability probe passes.

## Transport split

### Device-token renewal within an existing session

Renewal retains session, device and epoch identity. When a viewer is already
a member, Hook reads the authenticated member snapshot's `requesterControl`
before attaching, validates session/device/epoch and initializes both control
and input cursors from it. The input cursor must leave room for a next JavaScript-safe
sequence. The attachment advances control once and uses its
fresh `viewer_joined` revision as the event bootstrap anchor. Missing cursor
support requires a Loom upgrade; a concurrent sequence conflict fails closed
without parsing error messages, resetting identity or automatic replay. Joining
does not acquire input authority.

Source recovery stops and joins the old publishers before reading the same
member snapshot. Its acknowledged control cursor and per-observation positions
seed the replacement runtime. UIA retains sequence positions but discards old
fingerprints, cached values and stability intervals in both shared state and worker
tracking, requiring fresh samples to become stable. A failed post-retirement request
keeps the still-owned source eligible for the existing bounded recovery retry;
removed, replaced and revoked sources cannot be revived by that failure handler.
A different epoch, changed source owner or closed session rejects recovery;
newly created sessions start empty. Old input edges and controller authority
are never restored. These software contracts do not substitute for native
default-TTL acceptance of the matching Hook and Loom candidates.

An existing Device-authenticated viewer retains its original credential. An actual
HTTP 401 from its resume, event poll or member snapshot terminates that local
viewer with `live_viewer_authorization_required`, clears cached frames and local
control state, and stops retrying the rejected credential. This decision precedes
body reads, including oversized, truncated or malformed error payloads. Close the old viewer
and explicitly join again using the normal authorization path. This is not
in-place credential renewal, a server-session close, device revocation, automatic
pairing or a controller grant. Source recovery and non-Device authorization keep
their existing behavior. Other HTTP statuses and ordinary media Close frames do
not become terminal merely because their text mentions expiry or HTTP 401;
previously confirmed terminal errors survive late replies.

Control is strict JSON with `protocolVersion`, `sessionId`, `epoch`, `sequence`,
`messageType`, and `payload`. Lifecycle, authority, input button/key edges,
permissions, observations, and trigger audit are reliable and ordered. Only
mouse-move samples may be coalesced.

Media uses a separate binary channel. The 64-byte `NLLV` header carries epoch,
frame ID, capture/encode timestamps, dimensions, keyframe flag, dropped-frame
count, color space, codec, and payload length. The queue contract is two or three
latest frames; a slow viewer never blocks capture.

The LiveRelay viewer schedules its next native poll against an 80ms interval
measured from the start of the current iteration using a monotonic clock. The
descriptor read, payload IPC, image preparation and bounded browser decoding count toward that interval.
Only one iteration is in flight per viewer; an overrun yields at least 1ms and
does not replay missed ticks. Empty polls retain the same cadence, source status
polls retain their 400ms completion delay, and errors retain a 500ms backoff.
The scheduling policy is independent of the media profile: latest-frame buffers,
authorization and old-client compatibility remain in place. It is separate from
the screen-wall selection buffer and QR image synchronization.

`LiveRelayPollCadence.test.ts` exercises the controller with delayed reads,
eviction, closure and cancellation. Its `measures synthetic` cases report
store-update cadence and sampled held-frame age for a simulated 30fps source.
These use a mocked decoder and are deterministic scheduling measurements, not native IPC/CPU, browser
decode/paint, physical display or cross-device latency measurements. More local
frame updates can increase receiver work even though the poll ceiling stays at
12.5/s; native receiver CPU and real two-device presentation need separate
acceptance before claiming an end-to-end speedup.

### Decoded submission and bounded measurement

The viewer keeps the previous decoded bitmap until `Image.decode()` succeeds
for the next frame and its dimensions match. Only one candidate decode is owned
by each viewer, with a 1000ms timeout and cancellation on stop/dispose. Failed,
cancelled, closed-session and old-generation/epoch candidates release their Blob
URLs without replacing the current frame. Epoch changes clear the old frame and
poll cursor. Unknown codecs and non-sRGB pixels are rejected before payload IPC;
the H.264 wire enum is not a functioning Hook decoder or a negotiated video path.

`submittedFrameId` is the local poll cursor, not a render acknowledgement.
The transient `presentation` field retains only the latest sample:

- `liveSessionId`, `epoch`, `frameId`, and `evidence=decoded_submitted`;
- `codec`, `payloadBytes` and `imageBytes` (IPC bytes and the actual decoder input);
- `readMs`, `prepareMs`, `decodeMs`, and `submittedAtMs`, using the receiver
  WebView's monotonic clock.

This sample proves successful browser decoding followed by a store submission.
It does **not** prove that a visible DOM image was composited, that a physical
screen changed, or measure capture-to-display latency. No sender timestamp is
subtracted from a receiver clock. The sample contains no image data or Blob URL,
does not grow a history, is cleared with the frame and is not persisted.
The BMP buffer is passed directly to Blob construction without the previous
additional full-size ArrayBuffer copy; Blob/IPC themselves are not zero-copy claims.

Run `LiveRelayPresentation.test.ts` for cancellation, timeout, identity/profile
rejection and delayed-output regressions. The real Chromium decoder and canvas
readback check is:

```powershell
node scripts/test-live-relay-presentation-browser.mjs <evidence-directory>
```

Its synthetic pixels are not native capture or cross-device acceptance. For
[Loom #67](https://github.com/aiaimimi0920/Loom/issues/67), the two-device A baseline
still requires exact packages, device/network identity, static/scroll/motion
workloads, slow viewers, recovery/revocation, resource sampling and calibrated
or external presentation timing before claiming a performance improvement.

### JPEG 压缩直通与旧端回退

LiveRelay 媒体连接同时提供 `loom.live.jpeg.v1,loom.live.v1`，以服务端返回的
单个子协议作为本次连接的实际能力。列表不加空格，以兼容当前 tungstenite
0.24 的解析行为；旧 Loom 可直接选择 `loom.live.v1`。控制协议、发现结果中的
`frameStream.codec` 和持久业务数据不切换为 JPEG。

- 选择 JPEG 后，源端沿用已有采集 JPEG 的内容与质量，NLLV codec 字节为 `3`。
  不先解码为 BGRA、不重复 JPEG 编码。压缩帧超过 16 MiB 时仍可走原 raw 回退。
- 旧 Loom 选择 v1 时，源端仍发送 raw BGRA。新 Hook 也接受新连接中的 raw 回退；
  未协商 JPEG 的连接收到 codec `3` 必须拒绝，不能尝试当作 BMP 像素。
- 新观看端以 `image/jpeg` 直接构建 Blob，由同一有界 decoder 完成实际解码和
  尺寸复核。JPEG 不经过 BMP 包装；`imageBytes === payloadBytes`。raw 路径保持
  BMP 包装，两个路径沿用完全相同的 80ms 调度与 generation/取消规则。
- JPEG 必须是独立关键帧、sRGB，压缩数据至多 16 MiB，单边至多 16384，解码为
  BGRA 后至多 64 MiB。native 先校验 NLLV 和 JPEG 头尺寸，再允许像素分配；
  浏览器拒绝损坏的实际图像或尺寸不符结果，不把头解析当作解码成功。
- 新 Loom 给旧观看端和屏幕墙按帧懒转换回 raw；屏幕墙仍使用其独立的 NLWM
  raw/PNG adapter，不更改公共时序或协议。具体缓存/并发边界见 Loom 协议文档。

源端本地预览与 relay 各自消费：本地 IPC 仍一次性取走指定帧及之前的队列项，
但不移除 relay 的最新帧快照。三个本地队列项和至多一个最新快照共享不可变 JPEG
字节；队列非空时最新快照与尾帧使用同一分配，队列清空后只保留最新一帧。
relay 按自己的 frame ID 取新快照，不在采集锁内复制 JPEG。IPC 需要的独占 Vec
在释放采集锁后取得或复制；NLLV 封包仍需要独立发送缓冲，不宣称全链路零复制。
停止或显式清空时同时释放队列与最新快照，在途消费者引用按既有生命周期释放。
`live_capture_type_tests` 覆盖消费先后顺序、共享字节、淘汰、单次读取及最终释放。

两仓库的 `protocol/fixtures/live-jpeg-v1.nllv` 是同一个 64×32 合成图像 wire fixture，
不是桌面截图。Rust 测试覆盖原 JPEG 字节不变、实际 legacy 解码像素、真实握手
回退和坏帧；浏览器脚本实际解码 BMP/JPEG，并覆盖坏图、尺寸错误和取消。
该开发候选尚不代表跨设备帧龄、CPU、物理显示或长期稳定性的验收。
回滚任一端到旧版本仍会选择 raw 路径，无持久数据迁移。

## Security boundary

Parsing is not authorization. Hook accepts remote input only after Loom device,
attachment, controller, epoch, expiry, and revocation checks. Secure desktop,
other users/sessions, protected targets, and targets with higher integrity than
Hook fail closed. Same-user input to equal or lower integrity follows Windows
UIPI; an elevated Hook does not require an ordinary source to be elevated.
Source titles, pixels, UIA text, keyboard data, and OCR text are
sensitive and must not be written to normal logs.

An admitted Device media socket can receive WebSocket Close code `1008` (Policy)
with the exact reason `live_media_device_revoked`. Only that pair on a Device-authenticated
connection is a terminal authorization signal. Hook stops the local source/viewer relay,
clears controller authority and native viewer frames, and retains that error through shutdown.
An in-flight source recovery cannot replace that terminated relay; starting a new relay after
reapproval is a separate user action. This does not declare the entire Loom session closed.
Ordinary Close, HTTP 401/403/404, expiry, nonce exhaustion and network failures are not this signal.
The frontend clears the displayed image on its next closed snapshot and rejects candidates
after a known closed/generation transition. A decode already in flight may precede that snapshot;
this is not instantaneous server-to-display revocation or guaranteed Close delivery during network loss.

See [Live compatibility](LIVE_CAPTURE.md#compatibility-and-validation) for the
controlled support declaration. The contract intentionally contains capabilities for later
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
