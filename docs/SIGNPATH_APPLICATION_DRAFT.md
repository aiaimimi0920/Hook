# Hook SignPath Application Draft

This file is a copy-ready English answer pack for a future SignPath Foundation
application.

Use it together with:

- `docs/SIGNPATH_APPLICATION_CHECKLIST.md`
- `docs/CODE_SIGNING_POLICY.md`
- `docs/PRIVACY_POLICY.md`
- `UIACCESS_DISTRIBUTION.md`

The answers below are intentionally written so they can be copied directly into
application fields and then lightly adjusted if the form wording changes.

## Project description

> Hook is an open-source Windows desktop screenshot and sticker-editing tool
> built with Tauri and SolidJS. It focuses on local capture, pinning,
> annotation, and visual desktop workflow organization rather than cloud-first
> image hosting.

## Why Hook needs code signing

> Hook also maintains a Windows UIAccess-oriented installer path. Some of
> Hook's overlay interaction scenarios require a digitally signed executable
> installed in a trusted location such as Program Files, so code signing is not
> just cosmetic for this package lane.

## How Hook releases are produced

GitHub Actions is the public hosted build path for Hook releases.

> Hook releases are built from the public GitHub repository using GitHub
> Actions. Release versions are tagged in the form Vx.x.x, and the public
> release assets are generated from that tagged source rather than from a
> private manual rebuild.

## Why portable and installer packages are different

> Hook publishes a portable package for ordinary daily screenshot use and a
> separate installer/UIAccess-oriented package for the trusted signed Windows
> path. The current public release phase is portable-first, and the repository
> does not describe those two packages as equivalent, because the installer path
> depends on signing and trusted-location requirements that the portable package
> does not guarantee.

## Install and uninstall explanation

> The public repository documents install and uninstall behavior in
> UIACCESS_DISTRIBUTION.md. The UIAccess-oriented installer path is designed for
> installation into Program Files\yamiyu\Hook, while the portable package is
> documented as an extract-and-run package that can be removed by deleting the
> extracted folder after the app is closed.

## Public policy documentation

> The public repository includes a code signing policy, a privacy policy, and
> UIAccess distribution notes. Those documents explain the release model, the
> distinction between portable and installer output, and the current local-first
> privacy baseline.

## Single-maintainer review explanation

> Hook may currently operate in a single-maintainer period. In that situation,
> the same repository administrator can act as committer, reviewer, and release
> approver, but the public code signing policy still records those roles
> separately and the release checklist still requires explicit review before a
> signed release is approved.

## Why SignPath is being requested

> Hook is an active open-source Windows desktop application with public source
> code, public releases, public issue tracking, and a documented release
> process. A signing solution is being requested so the Windows installer path
> can be distributed in a way that matches the platform's trust requirements for
> the UIAccess-oriented package lane.

## Maintainer submission reminder

Before using this draft in a real submission, confirm the current facts in:

- `docs/SIGNPATH_APPLICATION_CHECKLIST.md`
- `docs/CODE_SIGNING_POLICY.md`
- `docs/PRIVACY_POLICY.md`
- `UIACCESS_DISTRIBUTION.md`
