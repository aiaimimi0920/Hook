# Otter SignPath Application Checklist

This document is the maintainer-facing working checklist for a future SignPath
Foundation application.

It is intentionally half pre-filled and half confirm-before-submit so the Otter
repository can stay public and reviewable without hardcoding private operator
details.

## How to use this file

1. use the pre-filled repository facts below as the public application source of
   truth;
2. manually confirm the maintainer-only facts before each submission or renewal;
3. use [the application draft](SIGNPATH_APPLICATION_DRAFT.md) for copy-ready answers;
4. re-check the reviewer risk notes before you send the application.

## Repository facts already prepared

- Project name: **Otter**
- Repository: `https://github.com/aiaimimi0920/Otter`
- Repository visibility: **public**
- Maintainer label used in public docs: **yamiyu**
- License: **MIT**
- Issue tracker: `https://github.com/aiaimimi0920/Otter/issues`
- README: [仓库根 README](../../README.md)
- Release page: `https://github.com/aiaimimi0920/Otter/releases`
- Code signing policy: `docs/release/CODE_SIGNING_POLICY.md`
- Privacy policy: `docs/security/PRIVACY_POLICY.md`
- Security policy: `SECURITY.md`
- Governance and public role assignments: `GOVERNANCE.md`
- Third-party notices: `THIRD_PARTY_NOTICES.md`
- UIAccess distribution notes: `docs/release/uiaccess-distribution.md`
- Release strategy: `docs/release/RELEASE_STRATEGY.md`
- Maintainer signing guide: `docs/release/MAINTAINER_SIGNING_GUIDE.md`
- Hosted signing workflow: `.github/workflows/signpath-signing.yml`
- Application answer draft: `docs/release/SIGNPATH_APPLICATION_DRAFT.md`

### Current package model

Otter currently distinguishes between two Windows release lanes:

- **portable**
  - asset shape: `otter-windows-x64-vx.y.z.zip`
  - current public release package
  - for quick trial and ordinary daily screenshot use
- **installer / UIAccess-oriented**
  - asset shape: `otter-windows-uiaccess-installer-vx.y.z.zip`
  - future signed public release package
  - for the signed trusted-location Windows path

### Public build/release model already documented

- new release versions are tagged as `vx.y.z`; historical `Vx.y.z` tags remain supported
- public builds are produced from GitHub Actions
- the current public phase is portable-first
- the installer/UIAccess lane is not treated as equivalent to an unsigned loose
  portable exe
- install/uninstall guidance lives in `docs/release/uiaccess-distribution.md`

## Maintainer facts to confirm before submission

These items must be confirmed by the maintainer at the time of application.

- [ ] GitHub maintainer account has MFA enabled
- [ ] signing-provider account has MFA enabled
- [ ] the intended signing approver still has access to the repository and
      signing provider
- [ ] the current repository release page shows real tagged releases
- [ ] the current application text still matches Otter's real public behavior
- [ ] the intended signing route is known for this submission:
      - SignPath Foundation
      - commercial provider
      - other hosted signer
- [ ] the maintainer understands that SignPath approval/release signing may
      require manual approval
- [ ] the `signpath-production` GitHub Environment has required reviewers
- [ ] the SignPath signing policy requires manual approval for every request
- [ ] the SignPath GitHub App can access this repository

### Private operator facts to fill at submission time

Do not hardcode these into the public repository; confirm them when filling out
the application:

- primary maintainer legal/contact identity
- signing approver identity
- organization identity, if applying as an organization
- final signing route and account identifiers

The repository deliberately uses GitHub Environment variables for those
identifiers; they are not application answers and must not be invented before
SignPath provisions the project.

## 申请文案的唯一维护位置

可复制的项目介绍、签名理由、发布方式与安装卸载说明统一维护在
[申请文案](SIGNPATH_APPLICATION_DRAFT.md)。本页只维护事实核对和审批清单，
避免两套申请回答逐渐不一致。提交前仍须核对真实账号、发布与签名状态。

## Risk and reviewer expectation notes

### Single-maintainer period

Otter may operate in a single-maintainer period. In that situation:

- the repository administrator may act as committer, reviewer, and approver;
- the public `docs/release/CODE_SIGNING_POLICY.md` still records those roles separately;
- the release review checklist still applies even when one maintainer performs
  more than one role.

### Do not blur package semantics

Never tell a reviewer that:

- an unsigned portable build is equivalent to the signed installer path; or
- UIAccess behavior can be guaranteed from the portable path alone.

The public explanation in `docs/release/uiaccess-distribution.md` should remain consistent
with the actual release lane behavior.

### Public reputation signals that help the application

Before submission, make sure the public repository still clearly shows:

- active source code rather than an empty placeholder;
- a readable README;
- visible releases/tags;
- a real issue tracker;
- public policy docs that match current behavior.

### Publisher-name expectation

If SignPath Foundation is the chosen route, remember that the eventual Windows
publisher display may reflect the signing provider rather than only the Otter
brand name.

## Final pre-submit check

- [ ] `docs/release/CODE_SIGNING_POLICY.md` still matches the real release process
- [ ] `docs/security/PRIVACY_POLICY.md` still matches the real product behavior
- [ ] `SECURITY.md` and `GOVERNANCE.md` still match the real team and reporting path
- [ ] `THIRD_PARTY_NOTICES.md` still matches bundled source and dependency locks
- [ ] `docs/release/uiaccess-distribution.md` still matches the real package model
- [ ] `docs/release/MAINTAINER_SIGNING_GUIDE.md` still matches the real workflow
- [ ] README and release page still expose the project as an active public
      Windows desktop tool
- [ ] no internal-only secrets or identities were accidentally committed while
      preparing the application
