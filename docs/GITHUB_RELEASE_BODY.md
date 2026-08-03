## Hook Windows release

The portable archive is the current general-purpose package. Extract it and run
`hook.exe`. See the repository's
[UIAccess distribution notes](https://github.com/aiaimimi0920/Hook/blob/main/UIACCESS_DISTRIBUTION.md)
for installation, uninstallation, and package differences.

### Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/), applies only after the Hook
project is provisioned and the hosted request receives manual approval.

Signed installer/UIAccess assets are published only after the hosted SignPath
workflow and its manual approval complete. If a release contains only the
portable archive, that portable artifact must not be interpreted as a signed
UIAccess installer.

A release may also contain a
`hook-uiaccess-signing-candidate-Vx.x.x.json` provenance file. It records the
reviewed unsigned candidate's identity and digest; it is not runnable software
and does not mean the release has been signed.

- [Code signing policy](https://github.com/aiaimimi0920/Hook/blob/main/docs/CODE_SIGNING_POLICY.md)
- [Privacy policy](https://github.com/aiaimimi0920/Hook/blob/main/docs/PRIVACY_POLICY.md)
- [Security policy](https://github.com/aiaimimi0920/Hook/blob/main/SECURITY.md)
- [Governance and signing roles](https://github.com/aiaimimi0920/Hook/blob/main/GOVERNANCE.md)
- [Third-party notices](https://github.com/aiaimimi0920/Hook/blob/main/THIRD_PARTY_NOTICES.md)
