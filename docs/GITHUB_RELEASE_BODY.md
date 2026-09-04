## Hook V0.2.1

Hook V0.2.1 makes OCR and barcode recognition installable Loom Capability Plugin
features while keeping Hook's capture and editing core generic. Existing local OCR
results are migrated to the extension attachment model when sessions are restored.

### Highlights

- Added a generic capability host for contributed commands, shortcuts, menus,
  attachments, overlays, notices, and bounded resource access.
- Moved OCR and barcode behavior behind the optional Loom capability package while
  preserving and migrating previously saved recognition results.
- Restored Ctrl+E drawing and annotation input after OCR overlays are present, while
  retaining click-to-copy and text-selection behavior outside edit mode.
- Hardened extension effect failure reporting, shortcut routing, acceptance
  authentication, cleanup checks, and release verification.

### Package notes

The public Release intentionally keeps the download surface small. Ordinary users
should download `hook-windows-x64-V0.2.1.zip`; users who want to verify the download
should also download its matching `.zip.sha256` file. Extract the ZIP and run
`hook.exe`. Build provenance, SBOMs, manifests, and full checksum inventories are
still generated and verified in the release pipeline, but remain maintainer-side
evidence instead of public Release assets.

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/), applies only after Hook is provisioned
and a hosted signing request receives manual approval.

**Full Changelog**: [V0.2.0...V0.2.1](https://github.com/aiaimimi0920/Hook/compare/V0.2.0...V0.2.1)
