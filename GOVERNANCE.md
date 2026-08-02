# Hook Governance and Signing Roles

Hook is currently maintained as a small open-source project. Public identities
are recorded here without publishing private legal identity or account data.

## Maintainer

- Maintainer label: **yamiyu**
- GitHub repository owner and primary maintainer: **@aiaimimi0920**

## Development and code-signing roles

The primary maintainer currently fills the following roles during the
single-maintainer phase:

| Role | Assigned public identity | Responsibility |
| --- | --- | --- |
| Authors / Committers | `@aiaimimi0920` and any future collaborator with repository write access | Maintain source code, build scripts, and release configuration. |
| Reviewers | `@aiaimimi0920`; future reviewers must be repository collaborators | Review changes from contributors without write access, with special attention to build, workflow, dependency, and signing-policy changes. |
| Approvers | `@aiaimimi0920` after the signing-provider account is provisioned | Manually approve each signing request only after verifying its tag, workflow run, source revision, and artifact type. |

No role assignment waives the account-security requirements below. An approver
may act only while multi-factor authentication is enabled for both GitHub and
the signing provider and while the account retains the intended access.

## Change review

- Changes proposed by contributors without repository write access require
  maintainer review before merge.
- Release workflows, build scripts, dependency lockfiles, `.signpath/` policy
  files, and code-signing policy changes receive explicit release-impact
  review.
- During the single-maintainer phase, the maintainer records that review in the
  tagged release checklist and the hosted signing approval rather than claiming
  an independent second reviewer.

## Release and signing approval

- Public releases are produced from public `Vx.x.x` tags by GitHub Actions.
- Every SignPath signing request requires manual approval in SignPath.
- The `signpath-production` GitHub Environment must also have required reviewers
  configured before its signing secret is added.
- Private signing keys are never committed to this repository or exported into
  the workflow.
- An unsigned artifact must never be published under the signed
  installer/UIAccess package name.

The normative signing rules are in
[`docs/CODE_SIGNING_POLICY.md`](docs/CODE_SIGNING_POLICY.md).

## Security and privacy contact

- Security reports: [`SECURITY.md`](SECURITY.md)
- Privacy questions and ordinary project reports:
  <https://github.com/aiaimimi0920/Hook/issues>
