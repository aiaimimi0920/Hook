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
- [`../SECURITY.md`](../SECURITY.md)
- [`../GOVERNANCE.md`](../GOVERNANCE.md)
- [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)

## Documentation rule

Completed implementation plans, migration checklists, smoke logs, and handoff
notes are preserved by Git history and the `文本优化前版本` tag rather than kept in
the active documentation tree. If a document conflicts with the implementation,
correct or remove the document; do not change working code merely to match an old
plan.

Historical commits may contain sanitized path placeholders such as
`<hook-repo-root>`, `<legacy-arthook-root>`, and
`<legacy-artnexus-workflows-root>`. They describe old machine-local roots only
and are not active repository locations.
