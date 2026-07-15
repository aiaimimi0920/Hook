# Hook Documentation Guide

This `docs/` directory is still primarily a **historical archive**, but it now
also contains a small set of **current policy documents** used by the public
release process.

## What to read first

If you want to understand the current project, start with the repository root:

- `README.md`
- `UIACCESS_DISTRIBUTION.md`
- `PROJECT_OVERVIEW.md`
- `TECHNICAL_ARCHITECTURE.md`

For current release trust/governance docs, also read:

- `docs/RELEASE_STRATEGY.md`
- `docs/CODE_SIGNING_POLICY.md`
- `docs/PRIVACY_POLICY.md`
- `docs/MAINTAINER_SIGNING_GUIDE.md`
- `docs/SIGNPATH_APPLICATION_CHECKLIST.md`
- `docs/SIGNPATH_APPLICATION_DRAFT.md`

## What is current here

### Policy docs

These files are current and are not archival-only:

- `RELEASE_STRATEGY.md`
- `CODE_SIGNING_POLICY.md`
- `PRIVACY_POLICY.md`
- `MAINTAINER_SIGNING_GUIDE.md`
- `SIGNPATH_APPLICATION_CHECKLIST.md`
- `SIGNPATH_APPLICATION_DRAFT.md`

## What is archived here

### `migration/`

Historical migration and smoke-audit records. Useful for tracing how Hook was ported or audited, but not guaranteed to match the current implementation.

### `superpowers/plans/`

Archived implementation plans from earlier development stages.

### `superpowers/specs/`

Archived design/spec documents written for earlier feature batches.

## Path placeholder rule

Machine-local absolute paths in archived docs have been normalized to placeholder roots such as:

- `<hook-repo-root>`
- `<neuro-root>`
- `<hook-runtime-root>`
- `<hook-release-root>`
- `<legacy-arthook-root>`
- `<legacy-talk-root>`
- `<legacy-artnexus-workflows-root>`

These placeholders preserve historical context without leaking a specific workstation layout.

## Interpretation rule

If a file under `docs/` conflicts with the current code or the root docs, treat
the `docs/` copy as historical context unless it is one of the current policy
docs listed above or it is explicitly refreshed.
