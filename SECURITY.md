# Security Policy

Help keep Otter safe by reporting suspected vulnerabilities privately.
**Do not post exploit details, credentials or private screenshots in public issues.**

[Report a vulnerability privately](https://github.com/aiaimimi0920/Otter/security/advisories/new) · [Privacy policy](docs/security/PRIVACY_POLICY.md) · [Security boundaries](docs/security/SECURITY_BOUNDARIES.md)

## Choose the right channel

| What happened? | Where to report it |
| --- | --- |
| A crash, display issue, editing bug or feature request without a security impact | [GitHub Issues](https://github.com/aiaimimi0920/Otter/issues) |
| Suspected unauthorized data access, credential exposure, permission bypass or unsafe package handling | The private reporting process below |
| A suspicious release, signing-key exposure or compromised signing account | The same private process; include the release URL and available file hashes |

## Reporting a vulnerability

1. Open [GitHub's private vulnerability form](https://github.com/aiaimimi0920/Otter/security/advisories/new).
   GitHub sign-in and repository support for private reporting are required.
2. If the form is unavailable, open a [minimal public issue](https://github.com/aiaimimi0920/Otter/issues)
   asking for a private contact channel. A title such as “Request for private security contact”
   is enough; **do not include reproduction details or sensitive attachments**.
3. Wait until a private channel is established before sending the full report.
   Do not assume a normal issue or pull request is private.

### What to include privately

- Affected Otter version or commit, package source, and Windows version.
- A short description of the security impact and required access or permissions.
- Minimal reproduction steps using test data you own, plus expected and actual behavior.
- Relevant sanitized logs, screenshots or a small proof of concept, if needed.
- For a suspicious binary: its download URL and SHA-256, without running it just to gather evidence.
- Any known workaround or suggested mitigation.

Never send live tokens, private keys or unrelated personal data. If a credential
was exposed, revoke or rotate it through its owning service; posting or forwarding
the secret is not necessary to demonstrate exposure.

### After you report

The maintainer reviews the report, may request additional reproduction information,
and coordinates a fix and appropriate disclosure with the reporter. This project
does not promise a fixed response or resolution time. Please keep sensitive details
private while a report is being investigated.

## Supported releases

Security fixes target the current `main` branch and the latest public `vx.y.z`
release when a release is required. Historical uppercase tags remain valid;
they do not imply that every historical release receives backports. Internal
four-part builds are development candidates, not a separate long-term support line.

Use the [official releases](https://github.com/aiaimimi0920/Otter/releases) and
their package-specific provenance and checksums. See [release provenance](docs/release/release-provenance.md)
for how artifacts are verified; a checksum alone does not establish trust in its source.

## Scope and safe testing

This policy covers Otter-owned code, its desktop integration boundaries and
artifacts distributed by this repository. When a report crosses into Loom or
another dependency, identify the affected versions and boundary so the relevant
maintainers can be involved; Otter cannot promise fixes on behalf of another project.

Test only on systems, accounts and data you own or have permission to use. Use
the smallest demonstration needed and avoid collecting other people's screenshots
or credentials. Otter is not intended to exploit vulnerabilities or bypass Windows
security controls; normal capture functionality alone is not evidence of a vulnerability.

## Related policies

| Topic | Reference |
| --- | --- |
| Local data and network behavior | [Privacy policy](docs/security/PRIVACY_POLICY.md) |
| Authentication, image handling and native input limits | [Security boundaries](docs/security/SECURITY_BOUNDARIES.md) |
| Dependency vulnerability handling | [Dependency security](docs/security/DEPENDENCY_SECURITY.md) |
| Signing-key, signing-account or release-provenance incidents | [Code signing policy](docs/release/CODE_SIGNING_POLICY.md) |

Use the private reporting process above for signing incidents too. Never attach a
private key, signing credential or malicious binary to a public issue.
