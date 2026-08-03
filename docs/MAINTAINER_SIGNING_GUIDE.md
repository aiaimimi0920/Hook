# Hook Maintainer Signing Guide

This document is maintainer-facing. It complements the public policy documents:

- `docs/RELEASE_STRATEGY.md`
- `docs/CODE_SIGNING_POLICY.md`
- `docs/PRIVACY_POLICY.md`
- `SECURITY.md`
- `GOVERNANCE.md`
- `THIRD_PARTY_NOTICES.md`
- `UIACCESS_DISTRIBUTION.md`
- `docs/SIGNPATH_APPLICATION_CHECKLIST.md`
- `docs/SIGNPATH_APPLICATION_DRAFT.md`

Its purpose is to keep Hook ready for SignPath Foundation review or another
Windows signing provider without relying on tribal memory.

Hook is currently in a **portable-first** public release phase. For the
high-level phase definition, see `docs/RELEASE_STRATEGY.md`.

For a pre-filled application-oriented working sheet, use
`docs/SIGNPATH_APPLICATION_CHECKLIST.md`.

For fuller copy-ready English submission answers, use
`docs/SIGNPATH_APPLICATION_DRAFT.md`.

## Current release model

Hook currently maintains two Windows release lanes, but only one is public in
the current phase:

1. **portable**
   - current public artifact
   - useful for normal trial and daily screenshot workflows
2. **installer / UIAccess-oriented**
   - future public artifact for the signed-installer phase
   - intended for trusted-location installation
   - requires real signing material before publication

## Public docs that must stay in sync

Before applying for or maintaining a signing program, keep these docs current:

- `README.md`
- `README.zh-CN.md`
- `docs/RELEASE_STRATEGY.md`
- `UIACCESS_DISTRIBUTION.md`
- `docs/CODE_SIGNING_POLICY.md`
- `docs/PRIVACY_POLICY.md`
- `docs/README.md`

## SignPath-oriented readiness checklist

### Repository hygiene

- public repository is active and not an empty placeholder
- OSI-approved license is present
- release tags and release assets are visible
- public docs explain what the product does and how packages differ

### Maintainer account hygiene

- GitHub maintainer accounts use MFA
- signing-provider accounts use MFA
- only intended approvers can approve signing requests

### Policy hygiene

- code signing policy is public
- privacy policy is public
- installer behavior and uninstall path are documented

### Release hygiene

- signed artifacts come from hosted CI, not ad-hoc local rebuilds
- the installer lane is skipped when signing material is absent
- release notes do not blur portable and installer/UIAccess semantics

## Current GitHub workflow contract

The current portable-first public workflow contract is:

- portable build/publication stays active in GitHub Actions
- installer/UIAccess public release output is deferred until signing is ready

If the project later moves to SignPath Foundation, DigiCert, SSL.com, Azure
Artifact Signing, or another hosted signer, the workflow can change while the
public policy documents remain largely the same.

## Maintainer approval checklist for a signed release

Before approving a signed release:

1. confirm the tag matches the intended public version;
2. confirm the workflow ran from the correct repository and tag;
3. confirm the tag is reachable from the protected public `main` branch;
4. open the public `hook-uiaccess-signing-candidate-Vx.x.x.json` release asset
   and review its workflow run ID, commit, and SHA-256;
5. confirm the signed artifact belongs only to the installer/UIAccess lane;
6. confirm README and UIAccess docs still describe package differences
   accurately;
7. confirm no local hotfix binary was manually substituted into the release;
8. confirm the public privacy and code-signing documents are still accurate.

## If Hook uses SignPath Foundation

Additional operating reminders:

- expect manual approval in the release flow;
- keep release provenance obvious from the public GitHub repo;
- avoid undocumented side-loading of binaries;
- be prepared for the publisher name to reflect the signing provider rather than
  the Hook brand alone.

### Repository workflow configuration

The manual workflow is `.github/workflows/signpath-signing.yml`. Configure the
`signpath-production` GitHub Environment with required reviewers before adding:

- secret `SIGNPATH_API_TOKEN`
- variable `SIGNPATH_ORGANIZATION_ID`
- variable `SIGNPATH_PROJECT_SLUG`
- variable `SIGNPATH_SIGNING_POLICY_SLUG`

Install the SignPath GitHub App for this repository and set the SignPath project
default artifact configuration to a ZIP whose signed payload is `hook.exe`.
Configure the SignPath signing policy to require manual approval for every
request. Do not guess or commit any of these account identifiers.

After the normal tag workflow creates a portable GitHub release, manually run
`Sign Hook UIAccess Release` for the same public tag. Supply the release
workflow run ID and the reviewed SHA-256 from the public signing-candidate
manifest. The signing workflow downloads the exact candidate retained by that
run, verifies its tag, commit, run ID, public manifest, and bytes, then uploads
only that reviewed artifact to SignPath. It waits for approval, verifies the
returned Authenticode signature during packaging, and attaches the signed
installer zip to the existing release.

## If Hook uses a commercial provider instead

The same governance still applies:

- keep the public policy docs;
- keep release approvals manual for signed Windows installer output;
- do not weaken the distinction between portable and trusted installer builds.
