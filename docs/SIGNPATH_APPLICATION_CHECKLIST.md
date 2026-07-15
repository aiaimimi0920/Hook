# Hook SignPath Application Checklist

This document is the maintainer-facing working checklist for a future SignPath
Foundation application.

It is intentionally half pre-filled and half confirm-before-submit so the Hook
repository can stay public and reviewable without hardcoding private operator
details.

## How to use this file

1. use the pre-filled repository facts below as the public application source of
   truth;
2. manually confirm the maintainer-only facts before each submission or renewal;
3. reuse the copy-ready wording sections when an application form asks for a
   short project/release explanation;
4. reuse `docs/SIGNPATH_APPLICATION_DRAFT.md` when the application form needs
   fuller copy-ready answers;
5. re-check the reviewer risk notes before you send the application.

## Repository facts already prepared

- Project name: **Hook**
- Repository: `https://github.com/aiaimimi0920/Hook`
- Repository visibility: **public**
- Maintainer label used in public docs: **yamiyu**
- License: **MIT**
- Issue tracker: `https://github.com/aiaimimi0920/Hook/issues`
- README: `README.md`
- Release page: `https://github.com/aiaimimi0920/Hook/releases`
- Code signing policy: `docs/CODE_SIGNING_POLICY.md`
- Privacy policy: `docs/PRIVACY_POLICY.md`
- UIAccess distribution notes: `UIACCESS_DISTRIBUTION.md`
- Release strategy: `docs/RELEASE_STRATEGY.md`
- Maintainer signing guide: `docs/MAINTAINER_SIGNING_GUIDE.md`
- Application answer draft: `docs/SIGNPATH_APPLICATION_DRAFT.md`

### Current package model

Hook currently distinguishes between two Windows release lanes:

- **portable**
  - asset shape: `hook-windows-x64-Vx.x.x.zip`
  - current public release package
  - for quick trial and ordinary daily screenshot use
- **installer / UIAccess-oriented**
  - asset shape: `hook-windows-uiaccess-installer-Vx.x.x.zip`
  - future signed public release package
  - for the signed trusted-location Windows path

### Public build/release model already documented

- release versions are tagged as `Vx.x.x`
- public builds are produced from GitHub Actions
- the current public phase is portable-first
- the installer/UIAccess lane is not treated as equivalent to an unsigned loose
  portable exe
- install/uninstall guidance lives in `UIACCESS_DISTRIBUTION.md`

## Maintainer facts to confirm before submission

These items must be confirmed by the maintainer at the time of application.

- [ ] GitHub maintainer account has MFA enabled
- [ ] signing-provider account has MFA enabled
- [ ] the intended signing approver still has access to the repository and
      signing provider
- [ ] the current repository release page shows real tagged releases
- [ ] the current application text still matches Hook's real public behavior
- [ ] the intended signing route is known for this submission:
      - SignPath Foundation
      - commercial provider
      - other hosted signer
- [ ] the maintainer understands that SignPath approval/release signing may
      require manual approval

### Private operator facts to fill at submission time

Do not hardcode these into the public repository; confirm them when filling out
the application:

- primary maintainer legal/contact identity
- signing approver identity
- organization identity, if applying as an organization
- final signing route and account identifiers

## Copy-ready wording

Use or adapt these short English descriptions in an application form.

### What Hook is

> Hook is an open-source Windows desktop screenshot and sticker-editing tool
> built with Tauri. It focuses on local capture, pinning, annotation, and
> visual desktop workflow organization.

### Why Hook has a signed installer lane

> Hook also supports a Windows UIAccess-oriented installer path because some
> overlay interaction scenarios require a digitally signed executable installed
> in a trusted location such as Program Files. The repository therefore
> distinguishes between a normal portable package and a signed installer
> package.

### How Hook releases are produced

> Hook releases are built from the public GitHub repository by GitHub Actions
> using version tags in the form Vx.x.x. The public release page publishes a
> portable package for ordinary use and, when signing material is available, a
> separate signed installer/UIAccess package.

### Where policy and uninstall information live

> The public repository includes a code signing policy, a privacy policy, and
> UIAccess distribution notes. Those documents also explain the portable versus
> installer distinction and where install/uninstall guidance lives.

### Why the portable and installer packages are not described as equivalent

> Hook does not describe the portable package as equivalent to the signed
> installer/UIAccess package because the Windows trusted-location and signing
> requirements are different for those two paths.

## Risk and reviewer expectation notes

### Single-maintainer period

Hook may operate in a single-maintainer period. In that situation:

- the repository administrator may act as committer, reviewer, and approver;
- the public `docs/CODE_SIGNING_POLICY.md` still records those roles separately;
- the release review checklist still applies even when one maintainer performs
  more than one role.

### Do not blur package semantics

Never tell a reviewer that:

- an unsigned portable build is equivalent to the signed installer path; or
- UIAccess behavior can be guaranteed from the portable path alone.

The public explanation in `UIACCESS_DISTRIBUTION.md` should remain consistent
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
publisher display may reflect the signing provider rather than only the Hook
brand name.

## Final pre-submit check

- [ ] `docs/CODE_SIGNING_POLICY.md` still matches the real release process
- [ ] `docs/PRIVACY_POLICY.md` still matches the real product behavior
- [ ] `UIACCESS_DISTRIBUTION.md` still matches the real package model
- [ ] `docs/MAINTAINER_SIGNING_GUIDE.md` still matches the real workflow
- [ ] README and release page still expose the project as an active public
      Windows desktop tool
- [ ] no internal-only secrets or identities were accidentally committed while
      preparing the application
