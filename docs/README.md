# Hook Documentation

This directory contains only documentation that describes the current product,
release process, or public policy. Current code, configuration, workflows, and
tests remain the source of truth.

## Product and runtime

- [`../README.md`](../README.md) - English product overview and developer entrypoints.
- [`../README.zh-CN.md`](../README.zh-CN.md) - Simplified Chinese product overview.
- [`../TECHNICAL_ARCHITECTURE.md`](../TECHNICAL_ARCHITECTURE.md) - current runtime,
  module, capture, input, persistence, and release architecture.
- [`../CONTRIBUTING.md`](../CONTRIBUTING.md) - engineering and verification rules.
- [`FEATURES.md`](FEATURES.md) - implemented shortcuts and manual regression matrix.
- [`HDR_CAPTURE.md`](HDR_CAPTURE.md) - HDR capture behavior and SDR fallback rules.
- [`LIVE_CAPTURE.md`](LIVE_CAPTURE.md) - native capture scope, browser behavior,
  failure notices, and the current implementation/verification entrypoints.
- [`LIVE_RELAY_DIAGNOSTICS.md`](LIVE_RELAY_DIAGNOSTICS.md) - bounded receiver evidence,
  timestamp semantics and actual executable/process binding requirements.
- [`LIVE_RESOURCE_ADMISSION.md`](LIVE_RESOURCE_ADMISSION.md) - resource admission and pressure.
- [`LIVE_GPU_PRESENTATION.md`](LIVE_GPU_PRESENTATION.md) - GPU presentation and fallback.
- [`LIVE_SHARED_SOURCE_CAPTURE.md`](LIVE_SHARED_SOURCE_CAPTURE.md) - shared window capture ownership.
- [`QR_PROJECTION.md`](QR_PROJECTION.md) - projection, receiving, and two-way editing.
- [`QR_BARCODE_RECOGNITION.md`](QR_BARCODE_RECOGNITION.md) - optional OCR package
  code recognition, gestures, attachments, and safe URL handling.
- [`TILE_TERMINAL.md`](TILE_TERMINAL.md) - terminal startup and its acceptance boundary.
- [Live compatibility and validation](LIVE_CAPTURE.md#compatibility-and-validation) -
  controlled support matrix, native probes and evidence limits.
- [`LIVE_SCREENSHOT_PROTOCOL.md`](LIVE_SCREENSHOT_PROTOCOL.md) - `loom.live.v1`
  source/viewer, ordering, binary-media, and security boundaries.
- [`ASSET_LIBRARY_INTEGRATION.md`](ASSET_LIBRARY_INTEGRATION.md) - target
  AssetLibrary catalog, download, Loom-owned installation, and Hook activation
  boundary.

## Release and signing

- [`RELEASE_STRATEGY.md`](RELEASE_STRATEGY.md)
- [`CODE_SIGNING_POLICY.md`](CODE_SIGNING_POLICY.md)
- [`MAINTAINER_SIGNING_GUIDE.md`](MAINTAINER_SIGNING_GUIDE.md)
- [`SIGNPATH_APPLICATION_CHECKLIST.md`](SIGNPATH_APPLICATION_CHECKLIST.md)
- [`SIGNPATH_APPLICATION_DRAFT.md`](SIGNPATH_APPLICATION_DRAFT.md)
- [`GITHUB_RELEASE_BODY.md`](GITHUB_RELEASE_BODY.md)
- [`../UIACCESS_DISTRIBUTION.md`](../UIACCESS_DISTRIBUTION.md)

## Project policy

- [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md)
- [`SECURITY_BOUNDARIES.md`](SECURITY_BOUNDARIES.md) - identity storage, remote-image
  destination enforcement and native input lifecycle limits.
- [`../SECURITY.md`](../SECURITY.md)
- [`../GOVERNANCE.md`](../GOVERNANCE.md)
- [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)

## Documentation rule

Completed implementation plans, migration checklists, smoke logs, and handoff
notes are preserved by Git history and the `cleanup-base-20260928` tag rather than kept in
the active documentation tree. If a document conflicts with the implementation,
correct or remove the document; do not change working code merely to match an old
plan.

Historical commits may contain sanitized path placeholders such as
`<hook-repo-root>`, `<legacy-arthook-root>`, and
`<legacy-artnexus-workflows-root>`. They describe old machine-local roots only
and are not active repository locations.
