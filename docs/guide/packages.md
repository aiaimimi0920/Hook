# Packages, signing and local data

[简体中文](packages.zh-CN.md) · [Documentation index](../README.md)

## Release packages

Hook has been renamed to **Otter**. The instructions below describe builds from
the current source. Previously published packages, including Hook v0.2.33, keep
their original filenames and `hook.exe`; use the executable actually included
in that release. See [rename compatibility](../development/RENAMING.md).

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

See [`docs/release/uiaccess-distribution.md`](../release/uiaccess-distribution.md) and
[`docs/release/RELEASE_STRATEGY.md`](../release/RELEASE_STRATEGY.md). Formal clean-source
packaging, checksums, SBOMs, attestations, and draft verification are documented
in [`docs/release/release-provenance.md`](../release/release-provenance.md); dependency
inventory and vulnerability response are in
[`docs/security/DEPENDENCY_SECURITY.md`](../security/DEPENDENCY_SECURITY.md).

## Code signing status

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/), applies only after the Otter
project is provisioned and a hosted signing request receives manual approval.
Do not assume a portable executable is signed. A separately approved signed
installer does not establish a signature on the portable EXE; verify the exact
downloaded file and that release's package description.

- [Code Signing Policy](../release/CODE_SIGNING_POLICY.md)
- [Privacy Policy](../security/PRIVACY_POLICY.md)
- [Security Policy](../../SECURITY.md)
- [Governance and Signing Roles](../../GOVERNANCE.md)
- [Third-Party Notices](../../THIRD_PARTY_NOTICES.md)

## Local data identity

The public Tauri bundle identifier and canonical application-data identity is
`com.yamiyu.hook`. Development and test automation can select an isolated root
explicitly with `OTTER_APPDATA_DIR` (`HOOK_APPDATA_DIR` remains a fallback);
Otter does not scan or migrate obsolete application-data roots. This is not a claim
that every file is stored there: runtime logs use their own directory, and temporary
capture/clipboard files have separate bounded paths. See [exit diagnostics](../development/UNEXPECTED_EXIT_INVESTIGATION.md)
for the runtime log location; deleting a portable program folder is not a data reset.
