# Browser frames through the existing Live Unit lifecycle

## Current delivery boundary

This step changes Hook production source, not just the browser feasibility
scripts. It adds the receiving backend needed to display an authorized browser
document in a normal Live sticker. The receiving backend is not yet registered
with a real Loom browser provider. **Ctrl+2 still starts native window capture.**
The complete scroll/tab-preserving product objective remains active and unmet.

No extension was installed, no personal browser was attached, and no existing
release artifact was replaced. The frontend was built successfully; a new EXE
was not packaged because the browser grant/transport entry is still missing.
Repackaging the current frontend would not deliver the requested browser feature.

## Implemented integration

- `createLiveCaptureController` now accepts a capture backend while retaining
  the existing native API as its default. Both backends use the same frame
  decoding, Unit creation, pointer routing, snapshot, stop and deletion lifecycle.
- Browser status uses `sourceKind: browser_document` and `browser_dom` when input
  is supported. It does not fabricate source HWND/process identity. Frame
  descriptors can carry PNG as well as JPEG.
- `browserLiveCaptureBackend.ts` receives a document source from a provider. The
  provider is responsible for installed-package/grant validation and mapping the
  selected rectangle to a specific tab/document. Hook does not discover debug
  ports, enumerate browser tabs or authorize itself.
- Each source keeps one encoded frame, coalesces overlapping polls, and retries
  the retained frame until the consumer advances its frame ID. Frame ownership
  is copied on receipt so provider buffer reuse cannot mutate a visible frame.
- Encoded bytes are bounded to 16 MiB per frame and 32 MiB retained per backend;
  logical source dimensions are bounded to 8192 per side and 4,194,304 pixels.
  These bounds do not replace provider-wide browser/GPU admission accounting.
- Open and poll have five-second deadlines. Late successful open is closed;
  stop/terminal poll failure aborts outstanding reads and invokes source close
  once. Late frames are not republished after session removal.
- The browser backend uses a conservative 2 FPS request target pending real
  extension latency/admission work. This is not a measured display FPS guarantee.
- Browser Unit snapshots use their retained decoded-frame bytes, never native
  GPU readback. Browser images do not register native GPU preview sessions.
- Controller disposal now removes only owned views, preserving other backends'
  Live stickers. Previously disposal cleared the whole shared view store.

## Fresh verification

- **50 tests passed** across browser backend (6), browser Unit runtime (2), native
  controller (12), snapshot lifecycle (13), and GPU preview runtime (17).
- The browser Unit test uses the real controller, backend, graph store and Live
  view store with a controlled source and mocked image decoding/native APIs. It
  proves PNG updates reach an ordinary sticker, background updates do not
  repeatedly persist image bytes, explicit snapshot commits the current frame,
  native capture/readback is unused, and disposal preserves a native Live view.
  It is not a real browser-to-Hook end-to-end acceptance.
- The GPU preview test explicitly mounts a browser source and verifies zero
  native capability/configure calls, including unmount.
- Production and test TypeScript checks passed. Focused ESLint passed for all
  five changed/new production source files. No standalone frontend formatter is
  configured; the existing formatting style was preserved.
- Strict effective-line check passed: 1,105 files, none above 500 effective
  lines. Production files touched here are 129-399 physical lines and UTF-8
  without BOM. No Rust changes were made.
- `npm run build` passed, producing `.output/public/index.html`; Vite reported
  a 29.76-second build and an existing large-chunk warning. Build evidence is in
  `artifacts/browser-live-unit-build.log`. PowerShell renders the native stderr
  warning with `NativeCommandError`, but the native build exit code was zero.
- Hook and Loom `git diff --check` passed; both retain pre-existing dirty work,
  with no staged changes. This turn changed Hook only.

## Remaining work / risks

1. Implement the actual Loom-authorized provider connection and browser grant
   lifecycle. The new provider interface alone provides no security approval.
2. Connect Ctrl+2 source selection, verifying active tab/document identity and
   screen/DPI/zoom-to-document coordinate mapping rather than guessing from HWND.
3. Bridge real extension frames into this backend, then test the rendered Unit
   across scroll, tab switch, editing, movement, source close and application exit.
4. Trace the real extension path's 0.6-2.6-second capture latency and implement
   fair multi-region scheduling and global resource admission before release.
5. Input is routed only when the provider advertises it; the provider must enforce
   document identity, input deadlines, cancellation and action semantics. The
   existing controller serializes input edges. An unresponsive provider input or
   close method is not forcibly terminated by this frontend adapter; process-level
   cancellation must be supplied by the Loom runtime.
6. Build and verify the integrated release in the requested release roots only
   after the provider/selection path is actually usable. Do not label this
   intermediate backend as the completed browser Live feature.
