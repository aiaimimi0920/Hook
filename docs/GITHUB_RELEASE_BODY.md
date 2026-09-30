## Hook v0.2.31

This release fixes text-tool cursor visibility and screenshot restoration after
restart, improves sticker editing, and adds the opt-in Loom tile-wall terminal.

### Highlights

- Keep the mouse pointer visible while entering annotation text and actively
  restore its state when editing ends, without requiring physical mouse movement.
- Restore saved screenshot images after restart by granting the WebView access
  to managed image files while keeping session and settings files inaccessible.
- Improve text, annotation, bitmap erasing and export behavior, preserving source
  resolution and reducing unnecessary work during interactive edits.
- Add opt-in tile-wall presentation, output identification, Live and declarative
  Art display, and controlled input routing through the Loom wall protocols.
- Harden Live relay ownership, presentation lifetimes and resource cleanup.
- Update rustls to 0.23.45 to address RUSTSEC-2026-0285.

Browser windows use native capture without an extension. Scrolling or switching
tabs changes the captured pixels; retaining the original page across those actions
is not supported. Actual performance depends on the source, crop sizes, hardware
and concurrent work.

Tile-wall support is an early opt-in integration and requires a compatible Loom
build. Scheduled playback and complete multi-computer acceptance remain pending.

### Package notes

The public Release intentionally keeps the download surface small. Ordinary users
should download `hook-windows-x64-v0.2.31.zip`; users who want to verify the download
should also download its matching `.zip.sha256` file. Extract the ZIP and run
`hook.exe`. Build provenance, SBOMs, manifests, and full checksum inventories are
still generated and verified in the release pipeline, but remain maintainer-side
evidence instead of public Release assets.

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/), applies only after Hook is provisioned
and a hosted signing request receives manual approval.

This portable release does not claim to be a signed UIAccess installer.
