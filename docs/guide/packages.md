# Packages, signing and local data

[简体中文](packages.zh-CN.md) · [Documentation index](../README.md)

## Release packages

Hook has been renamed to **Otter**. The instructions below describe builds from
the current source. Previously published packages, including Hook v0.2.33, keep
their original filenames and `hook.exe`; use the executable actually included
in that release. See [rename compatibility](../RENAMING.md).

- **Portable (current recommended package)**
  - extract the zip and run `otter.exe`;
  - the only current user-facing package in ordinary builds and tag releases;
  - includes the project license, third-party notices, and bundled-source
    license texts;
  - if Windows blocks interaction with elevated foreground windows such as
    **Task Manager**, try running Otter as **administrator** as the current
    workaround.
- **Installer (planned for future signed releases)**
  - the repository retains the UIAccess installer and SignPath preparation;
  - the installer is not a current public package and must not be published
    until the signing provider and protected approval environment are active.

The tag workflow retains the unsigned UIAccess signing candidate and its digest as
short-lived Actions review evidence; neither is shown as a public Release asset.

For the public Release, ordinary users only need the portable ZIP. Users who want
to verify a download should also fetch the matching `.zip.sha256` sidecar. GitHub's
automatic source ZIP and tarball remain available for developers.

See [`UIACCESS_DISTRIBUTION.md`](../../UIACCESS_DISTRIBUTION.md) and
[`docs/RELEASE_STRATEGY.md`](../RELEASE_STRATEGY.md). Formal clean-source
packaging, checksums, SBOMs, attestations, and draft verification are documented
in [`docs/release-provenance.md`](../release-provenance.md); dependency
inventory and vulnerability response are in
[`docs/DEPENDENCY_SECURITY.md`](../DEPENDENCY_SECURITY.md).

## Code signing status

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/), applies only after the Otter
project is provisioned and a hosted signing request receives manual approval.
The current portable package must be treated as unsigned unless a release
explicitly includes an approved signed installer.

- [Code Signing Policy](../CODE_SIGNING_POLICY.md)
- [Privacy Policy](../PRIVACY_POLICY.md)
- [Security Policy](../../SECURITY.md)
- [Governance and Signing Roles](../../GOVERNANCE.md)
- [Third-Party Notices](../../THIRD_PARTY_NOTICES.md)

## Local data identity

The public Tauri bundle identifier and the only automatic local-data identity is
`com.yamiyu.hook`. Development and test automation can select an isolated root
explicitly with `OTTER_APPDATA_DIR` (`HOOK_APPDATA_DIR` remains a fallback);
Otter does not scan or migrate obsolete roots.
