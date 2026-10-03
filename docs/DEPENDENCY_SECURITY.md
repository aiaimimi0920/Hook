# Hook Dependency Security

Hook applies inventory, advisory scanning, triage, remediation, and regenerated
release evidence as one supply-chain control loop. A green scan is a release
gate; it is not proof that unknown vulnerabilities do not exist.

## Deployed controls

- Dependabot checks Cargo, npm, and GitHub Actions weekly with bounded routine
  update groups. Security updates are not delayed by those grouping limits.
- OSV-Scanner 2.5.1 scans the exact committed lockfiles on pull requests,
  `main`, a weekly schedule, manual dispatch, and the exact release tag/ref.
- CodeQL runs extended Rust, JavaScript/TypeScript, and Actions queries.
- Formal release builds generate and verify CycloneDX 1.6 and SPDX 2.3 SBOMs,
  SHA-256 checksums, a manifest, and build provenance. The public Release keeps
  only the portable ZIP and its checksum sidecar; the remaining evidence stays in
  the maintainer/workflow verification boundary.

## Refreshing the release scan configuration safely

The code-scanning tool-status page tracks the default branch. A failed manual
release run on `main` can leave that workflow's configuration reporting failure
even when its OSV job succeeded; later successful tag runs do not refresh the
default-branch record. Check the failing job before changing scanner settings.

`Release Hook Tag` now runs pure advisory scans on `main` pushes and relevant
pull requests, preserving its existing `release-hook-tag.yml:osv-scan` identity.
Manual **scan-only=true** still scans the exact workflow commit. PR/main and
maintenance events skip the entire publication job, including its cleanup and
signing steps. Explicit typed false plus a valid three-part tag is required for
manual publication; valid tag pushes retain strict release enforcement.

Do not rerun an old release, move a tag, or delete scan history to clear a banner.
Verify scan completion and SARIF processing against the exact new main commit.

## Development advisory policy

During private development, valid vulnerability and static-quality findings are
reported without blocking ordinary product compilation or functional tests.
OSV runs the same pinned 2.5.1 binary from an immutable container digest, directly
instead of the upstream shell wrapper. Its full inventory JSON must cover all
four lockfiles, and its SARIF must cover each vulnerability alias group at every affected package,
version and lockfile location before a findings exit of 1 can become
advisory success. Unknown exits, missing/corrupt/incomplete evidence, startup,
network, reporter, and upload failures remain failed jobs. No blanket
`continue-on-error` is used.

Development uses `security/osv-advisory.toml` without release suppressions.
Full JSON/SARIF artifacts, step summaries, and existing deduplicated Security
alerts retain findings. No duplicate issues or additional credentials are needed.
The pinned reporter aggregates aliases, but emits a result per package/source.
Validation checks alias-group membership, package/version messages, physical
locations and the reporter's SHA-256 fingerprints; a retained ID alone is not
coverage. JSON evidence is never rewritten or reduced.

Development enables `--all-vulns`. Strict scanning preserves the scanner's normal
exit semantics without that flag: JSON can legitimately retain only uncalled or
unimportant findings with exit 0. Those records still require full SARIF coverage;
exit 0 with actionable findings (or any findings under `--all-vulns`) is rejected
as inconsistent evidence. Release scans keep the reviewed, time-bounded exceptions in `osv-scanner.toml`
and fail on unsuppressed findings after retaining reports.

`Code Quality Advisory` independently runs ESLint, stable Rust format checking,
license inventory, and the effective-line ratchet. It retains complete tool and
JSON evidence. ESLint fatal parsing/configuration errors, missing dependency
manifests, incomplete Cargo metadata, unknown line-checker diagnostics, and
unrecognized Rust format output remain errors. Format findings require a valid
in-repository diff with no stderr. Actual typechecking, compilation, checker
unit tests, frontend/native tests, and browser/performance tests stay blocking
in `Build Hook EXE`. Release and `npm run verify:local` keep their strict checks;
`verify:local` also creates release packages and is not a scan-only command.

Native repository protection settings are not changed by these workflows.
Any separate required-check policy must be reviewed explicitly.

## Machine-authoritative inventory

`security/dependency-security-policy.json` owns the inventory:

1. `package-lock.json` for the Solid/Tauri frontend and build toolchain.
2. `src-tauri/Cargo.lock` for the desktop application.
3. `src-tauri/crates/drag/Cargo.lock` for the independent drag crate.
4. `src-tauri/crates/scap-direct3d/Cargo.lock` for the capture backend crate.

Update the policy, workflow, Dependabot configuration, contract, and this
document together whenever a dependency-resolution boundary changes.

## Local gate

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\tests\Test-DependencySecurityContract.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-DependencySecurityScan.ps1
```

The installer downloads only the pinned Windows scanner, verifies its SHA-256,
and caches it under ignored `.tmp`. The scan also verifies the reported scanner
version and writes validated JSON evidence under `.tmp/dependency-security`.

For a local development report, pass `-Mode Advisory`. The default is `Enforce`,
so existing release/local callers retain their strict behavior.

## Triage and remediation

Record the locked package/version, dependency path, shipped target,
reachability, attacker-controlled inputs, exploit maturity, fixed version, and
affected release IDs. Treat active compromise or a suspected malicious package
as P0, reachable critical/high impact as P1, applicable high as P2, medium/low
as P3, and unmaintained/non-applicable transitive packages as P4.

Prefer a compatible upgrade, then removal, replacement, or feature containment.
Update lockfiles through package managers rather than editing resolved metadata.
Run focused tests, compile/typecheck gates, this contract, and the real OSV scan.
Any shipped dependency change requires a new release ID and regenerated SBOM,
provenance, manifest, and checksums; never rewrite prior release evidence.

## Temporary exceptions

`security/osv-scanner.toml` may contain only one `[[IgnoredVulns]]` entry per
canonical advisory. Each entry needs a concrete reason and an `ignoreUntil`
date no more than `maximumExceptionDays` in the future. The reviewing change is
the human approval record. Broad `[[PackageOverrides]]`, automatic renewal, and
invented approval identities are forbidden.

## Suspected malicious dependency incident

Stop installation, builds, releases, and promotion. Preserve lockfiles,
archives, hashes, SBOMs, provenance, logs, and runner details. Isolate affected
hosts, rotate reachable credentials, remove or pin away from the package using
a trusted source, and rebuild on a reviewed clean host. Mark affected releases;
do not silently replace them.

## Current baseline and limitations

The baseline was refreshed on 2026-08-24. Directly fixable npm and Cargo
findings were removed from the lockfiles. Remaining exception entries are
time-bounded unmaintained transitive packages or GTK/glib code that is not
compiled into Hook's formal Windows-only release. Those exceptions explicitly
block any future Linux publication until the Linux dependency stack is upgraded
or independently reassessed. The gate does not replace source review, runtime
reachability analysis, secret scanning, tests, or clean-source verification.
