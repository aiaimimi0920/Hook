## Hook V0.2.0

This is the first refactored Hook release. It keeps the capture preview and the
post-capture selection frame on the same outward-outline geometry, so the visible
capture range no longer appears to change when the result is committed.

### Highlights

- Unified yellow selection, precise-selection, and box-selection overlays with the
  same outward outline model used by the final white frame.
- Preserved mixed-window and protected-surface capture composition while keeping
  the physical cursor responsive and suppressing hover transitions during capture.
- Retained the split native capture pipeline, bounded resource cleanup, and release
  provenance/security gates from the refactored codebase.

### Package notes

The public Release intentionally keeps the download surface small. Ordinary users
should download `hook-windows-x64-V0.2.0.zip`; users who want to verify the download
should also download its matching `.zip.sha256` file. Extract the ZIP and run
`hook.exe`. Build provenance, SBOMs, manifests, and full checksum inventories are
still generated and verified in the release pipeline, but remain maintainer-side
evidence instead of public Release assets.

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/), applies only after Hook is provisioned
and a hosted signing request receives manual approval.

**Full Changelog**: [V0.1.11...V0.2.0](https://github.com/aiaimimi0920/Hook/compare/V0.1.11...V0.2.0)
