## Hook v0.2.30

This release adds native interactive Live stickers and reduces their background
and per-frame overhead.

### Highlights

- Capture a live window region with Ctrl+2, use multiple independent Live
  stickers, and forward input to the source application.
- Keep the selected window-local region when its window moves, with normal
  sticker placement, DPI handling, editing and movement controls.
- Share capture sources across crops from the same window and use native GPU
  presentation where supported, with bounded CPU fallback and resource cleanup.
- Reduce stable-layout IPC, idle presenter wakeups and redundant per-frame D3D
  setup without intentionally lowering video resolution or target frame rate.
- Use Ctrl+4 / Alt+4 for the optional OCR capability.
- Separate internal four-part build identities from public three-part releases.
- Upgrade Vitest to fix GHSA-82fw-gwwq-j7x9 and repair release-version checks.

Browser windows use native capture without an extension. Scrolling or switching
tabs changes the captured pixels; retaining the original page across those actions
is not supported. Actual performance depends on the source, crop sizes, hardware
and concurrent work.

### Package notes

The public Release intentionally keeps the download surface small. Ordinary users
should download `hook-windows-x64-v0.2.30.zip`; users who want to verify the download
should also download its matching `.zip.sha256` file. Extract the ZIP and run
`hook.exe`. Build provenance, SBOMs, manifests, and full checksum inventories are
still generated and verified in the release pipeline, but remain maintainer-side
evidence instead of public Release assets.

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/), applies only after Hook is provisioned
and a hosted signing request receives manual approval.

This portable release does not claim to be a signed UIAccess installer.
