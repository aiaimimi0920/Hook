# Live GPU presentation: route B

Status: automatic native presentation for eligible Windows Live Units, with JPEG compatibility fallback.
Release readiness still requires the exact candidate's package, runtime and clean-source gates.

## Scope and ownership

The experiment uses the existing Ctrl+2 Live graph Unit. It does not create a
second sticker window hierarchy, replace input routing, or use DWM thumbnails.
Loom's network/session contracts and Art executor are unchanged.

The Windows native branch is:

`shared window WGC texture -> owned BGRA8 ROI texture -> DXGI swapchain -> DirectComposition`

There is no CPU map or JPEG encode/decode in the healthy native display branch.
The existing JPEG branch supplies startup, unsupported composition and recovery.
Copy/save, native Shift-drag, edit entry, connected Art creation, recycle/reference
and explicit stop can request a lossless GPU snapshot independently of the JPEG queue.
After a successful owned copy, a valid visibility lease and a native submission
within 350 ms permit skipping CPU readback/JPEG. Transient contention retains one
owned mailbox texture for transfer when the compositor is available; it never
triggers a CPU readback. Stalled presentation, device errors and unsupported
layouts use a globally budgeted compatibility producer.

## Module boundaries

- `src-tauri/src/live_gpu/mod.rs`: native Tauri capability, active-session and
  main-window validation, physical layout contract.
- `frame.rs`: BGRA8 validation and owned GPU copy before WGC reuses its texture.
- `worker.rs`: one compositor owner, latest-frame slots, reuse, admission budget,
  lease expiry, latched failures and teardown.
- `presenter.rs`: Windows-only DirectComposition tree and per-Unit swapchains.
- `snapshot.rs`: bounded one-shot staging copies, CPU readback and lossless PNG
  encoding on blocking workers, never on the compositor thread.
- `work_budget.rs`: source pixel/cadence demand, visibility, fair automatic CPU
  admission and RAII encode-inclusive cooldown. No frame data is stored here.
- `src/services/liveGpuPreviewPolicy.ts`: physical geometry and overlap policy.
- `src/services/liveGpuPreview.ts`: existing image-element registration and
  bounded, serialized native layout requests. The ordinary image stays mounted.
- `liveGpuPreviewScheduler.ts`: one 80 ms clock and lazy Unit geometry sample
  shared by Live registrations, including CPU compatibility visibility updates.
- `liveGpuSnapshot.ts` and `liveCaptureUnit.ts`: binary snapshot validation,
  per-Unit request coalescing, capture-time ordering and explicit graph commits.
- `liveCaptureSnapshotAction.ts`: synchronous ordinary actions and asynchronous
  Live snapshot gates for editing, connected Art creation and frozen libraries.
- `screenshot/live_frame_handoff.rs`: latest owned GPU mailbox, reusable spare,
  and capture-arrival clock independent of optional encoded-frame delivery.
- `liveCaptureHandoff.ts`: controller-owned, coalesced transient PNG restoration
  and bounded paint wait before normal native-plane removal.

The graph Unit does not store presentation HWNDs, COM interfaces or GPU texture handles.
The Windows renderer is isolated, but no other platform backend is implemented.
Neither a browser WebGPU texture import nor zero-copy cross-adapter transport is
claimed. The native branch still uses supported Windows graphics APIs.

## Safety and compatibility boundary

- Normal Windows launches automatically attempt native presentation for eligible
  images. Set `HOOK_LIVE_GPU_PREVIEW=0` to force JPEG; `1` remains accepted.
  Exit existing Hook normally before running isolated candidate acceptance.
- Existing WebView2 video-safe GPU-disable switches remain unchanged. Native
  composition is separate from Chromium's GPU rendering configuration.
- The native visual is above WebView child HWNDs. The first slice therefore
  supports only plain, unrotated, non-minified, fully visible rectangular Live
  images at full opacity with no overlapping Units or registered panels.
- Editing, dragging, capture selection, annotations, unit notices, extension
  overlays, opacity, rotation, crop, rounded corners and complex scenes use the
  existing JPEG display. Unsupported does not mean those Unit features are removed.
- An inset clip preserves the green/yellow edge UI without rescaling the content.
  Occlusion checks use that same painted interior, not the unpainted border:
  fractional-DPI DOM rounding must not turn an adjacent port into an occluder.
- At most 16 session slots, subject to earlier adaptive source admission. One
  newest input frame per slot and bounded texture reuse remain. Presentation's
  payload budget follows the sampled DXGI budget (one third, capped at 1 GiB;
  256 MiB if unavailable). It estimates three input textures and two swapchain
  buffers per source, not measured total VRAM. The separate source reservation
  also charges WGC pools and crop/fallback allowances; see `LIVE_RESOURCE_ADMISSION.md`.
- Layout renewal is serialized, normally every 80 ms. Resize/scroll and shared
  UI state changes request earlier updates. A 350 ms expired lease hides the
  native plane even if the frontend stops renewing it.
- Device, format or budget errors latch the session into JPEG fallback. There is
  no automatic retry storm; stop/create a new Live session to probe again.
- Source-worker exit removes the corresponding GPU slot. App exit joins the
  compositor thread and releases its visuals. A disable request for a missing
  slot does not allocate a new slot.
- Disabled/expired slots retain bounded owned textures until source rebuild/stop
  so a static source can restore fresh fallback without a new capture callback.
  A capture-owner readback happens only if that texture is newer than its last
  encoded frame; it is never done by the compositor thread.
- Source rebuild clears GPU textures and increments a generation; old in-flight
  presentations cannot repopulate the new capture epoch's snapshot cache.

Layout and browser painting are not one atomic transaction. Normal suspension
prepares a transient PNG, decodes it and gives the DOM a bounded paint opportunity
before disable. Faults and lease loss can hide the plane sooner; the capture owner
independently restores a retained frame. Unregistered overlays remain an integration
risk and each new overlay must register its occlusion/hit rectangle.

## Explicit snapshot contract

`read_live_gpu_snapshot` accepts an active session ID from the main WebView. It
copies a retained owned GPU texture into independent staging storage while the
slot is locked; Map and PNG encoding happen after releasing the slot lock. A
COM reference to a reusable source texture alone would not preserve its pixels.

At most four snapshot jobs can be queued/running globally. Staging storage is
additional to the presentation budget: each source is limited to 64 MiB before
readback. CPU RGB and encoded buffers are also allocated only for these bounded
jobs. Automatic fallback has a separate single global permit, held from before
staging allocation through JPEG completion. JPEG freshness prevents repeat
readback of the same static frame. Nonblocking Map polling has a 1500 ms deadline; driver calls and PNG
encoding are not claimed to have an absolute end-to-end deadline.

### Multi-Live workload limits

- Source cadence scales requested rates against 120 frames/s and 124,416,000
  full-source pixels/s in aggregate, with a 1 FPS floor for capture health. These
  are scheduling targets, not measured GPU throughput or monitor FPS guarantees.
  Runtime resource pressure doubles the interval, capped at one second, until
  five low-load samples permit recovery. No extra sampler thread is created.
- Automatic CPU fallback admits at most one readback/encode at a time. Spacing
  is at least the larger of 1/30 second and frame pixels / 24,000,000. Completion
  also adds a cooldown equal to the measured readback/encode duration: slow
  drivers/codecs reduce work instead of occupying every worker continuously.
- Waiting consumers retain only their newest owned texture; FIFO admission with
  short request leases prevents a fixed worker poll order starving siblings.
  The permit does not throttle explicit copy/save/edit handoff snapshots, which
  retain their independent four-job limit and freshness contract.
- Hidden documents and fully offscreen Live images capture at 1 FPS, with no
  automatic JPEG production. Visibility restoration resumes work; partial
  occlusion and unsupported layering remain budgeted JPEG, not invisible.
- WGC latest-only frame pools allocate two full-source buffers instead of four.
  Same-window crops share one owner/pool, with independent owned ROI textures and
  Unit cadence. New subscribers request a generation-safe pool refresh for static
  initial pixels. Reservations remain conservative per Unit; see
  `LIVE_SHARED_SOURCE_CAPTURE.md` for source lifetime and validation boundaries.
- The presentation estimate excludes WGC pools, the bounded per-owner
  fallback textures/staging, driver allocations and explicit snapshots. It must
  not be reported as a total GPU-memory ceiling.
- Automatic compatibility readback preserves the previous 512 MiB per-frame
  safety bound; it does not inherit the native branch's tighter 64 MiB texture
  limit. Very large crops can still consume substantial memory and refresh slowly.

The raw IPC response is an eight-byte little-endian capture timestamp followed
by PNG bytes, capped at 64 MiB. Empty means no usable native texture or the
experiment is disabled; callers keep the JPEG baseline. Errors abort the export
instead of silently labelling an old image as a successful new snapshot.

Only explicit snapshot boundaries commit the returned pixels to graph
data. A pending request is shared by concurrent consumers of the same Unit.
Detach/replacement invalidates late results; active editing preserves the image
already shown in the editor. Older in-flight JPEG frames cannot overwrite a
newer committed GPU snapshot. Committing new pixels invalidates cached exported
file paths, and native drag prepares the snapshot before resolving its path or
composite export plan. Internal and system clipboards use the same prepared image.

Ctrl+E waits for the snapshot before opening the editor and refreshing native hit
rectangles. Selection changes and newer edit requests invalidate delayed entry.
Connected Art creation uses the same gate for shortcut and canvas-menu routes;
the source is committed before linking or scheduling propagation. Ordinary Units
retain synchronous creation/edit behavior. Keyboard deletion and context-menu
reference/close freeze prepared pixels before removing the Unit. Failed readback
leaves the Unit intact and reports a bounded, Unit-scoped notice.

Explicit stop coalesces concurrent requests, stops polling/new input, drains
queued input, and retains the native session until the snapshot is committed.
It releases the source even when readback fails, retaining the cached baseline
and returning the error. Graph deletion skips unnecessary readback. App disposal
remains immediate best-effort cleanup: it invalidates pending snapshots and does
not promise fresh exit-time pixels or await a blocked IPC operation.

The retained GPU frame may lag the newest source update; the snapshot is not an
atomic screenshot of a physical monitor refresh. Source-health timing now tracks
WGC arrival independently of JPEG encoding. Retained static fallback and stale
ordering are separate acceptance gates; submission counts do not establish latency.

## Verification

Focused geometry, eligibility, stale completion and cleanup tests:

```powershell
npx vitest run __tests__/unit/liveGpuPreviewPolicy.test.ts __tests__/unit/liveGpuPreviewRuntime.test.tsx
npx vitest run __tests__/unit/liveGpuSnapshot.test.ts __tests__/unit/liveCaptureSnapshotRuntime.test.ts __tests__/unit/unitNativeStickerDragController.test.ts
npx vitest run __tests__/unit/liveCaptureActionSnapshotRuntime.test.tsx __tests__/unit/LiveCaptureControllerRuntime.test.ts __tests__/unit/StickerToolbarShortcutRouting.test.ts
npx vitest run __tests__/unit/liveCaptureHandoffRuntime.test.ts
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib live_gpu
```

Owned-window compositor smoke, independent of Hook's running application:

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib live_gpu::native_tests -- --ignored --nocapture
```

It creates two temporary non-activating windows on the current desktop, changes a
colored source region, captures only that region through WGC and checks actual
desktop pixels at both output surfaces. It also checks independent disable/removal
and lease expiry. It also decodes lossless snapshots and verifies that a retained
staging copy preserves its original pixels after the source and GPU pool have
reused their textures. It requires an unobstructed SDR interactive desktop. Its pixel
sampling is NOT a monitor-FPS or latency benchmark and does not prove WebView
overlay compatibility. It stops its own capture and destroys only owned windows.
The second probe runs the production capture worker past its five-second health
timeout, checks that native delivery skips CPU conversion, and restores a JPEG
from a retained static frame after disabling the native plane. Both fixtures
initialize WinRT before capture and keep it alive until worker/window teardown;
the test runner does not provide the application's COM apartment lifetime.

After existing Hook has been exited normally, the real Unit gate is:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/Invoke-LiveUnitNativeProbe.ps1 -HookExe <candidate-hook.exe> -GpuPreview
```

This opts in only the spawned candidate and exercises Ctrl+2 placement/DPI,
native GPU submission, ordinary corner drag/release, source input, Tab, Ctrl+E
with a separate real binary GPU snapshot IPC response, owned editor pixels, GPU suspension
and Shift+1. A newer JPEG may legitimately win capture-time ordering while the
GPU readback was pending. It preserves global single-instance protection.
Tauri's `invoke` property is read-only. The probe does not replace it or claim
that a JavaScript assignment traces calls; source interaction is proved by the
owned fixture's state changes, and binary readback by a real command response.
Submission counters are diagnostics, not evidence that the monitor displayed each
frame. A real desktop visual check remains necessary for border/menu occlusion.

JPEG remains the compatibility baseline and explicit opt-out. The real Unit probe
also samples encoded frames, GPU submissions, skipped CPU readbacks, capture health
over six seconds and Hook process CPU time; these are not monitor-FPS measurements.
No 60/120 FPS, mixed-DPI, HDR, RDP or arbitrary-app support is inferred
from the small owned-window smoke.
