# Security Policy

## Supported releases

Security fixes are applied to the current `main` branch and to the latest
public `Vx.x.x` release when a release is required.

## Reporting a vulnerability

Do not publish credentials, private screenshots, exploit details, or other
sensitive material in a public issue.

1. Prefer GitHub private vulnerability reporting when the repository exposes
   that option:
   <https://github.com/aiaimimi0920/Hook/security/advisories/new>
2. If the private form is unavailable, open a minimal issue at
   <https://github.com/aiaimimi0920/Hook/issues> asking the maintainer to
   establish a private contact channel. Do not include sensitive details in
   that issue.

Include the affected version, reproduction steps, impact, and any suggested
mitigation. The maintainer will acknowledge the report, investigate it, and
coordinate disclosure after a fix is available.

## Product security boundary

Hook is a screenshot, sticker-editing, and local visual-workflow application.
It is not intended to exploit vulnerabilities, bypass endpoint protection,
hide malware, inject code into other processes, or create unauthorized
persistence. Its UIAccess-oriented Windows package uses the documented Windows
manifest, digital-signature, and trusted-install-location model rather than a
security-control bypass.

## Signing incidents

Suspected signing-key, signing-account, or release-provenance incidents are
handled under [`docs/CODE_SIGNING_POLICY.md`](docs/CODE_SIGNING_POLICY.md).
