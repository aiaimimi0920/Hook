# Hook Dependency Security

Hook applies inventory, advisory scanning, triage, remediation, and regenerated
release evidence as one supply-chain control loop. A green scan is a release
gate; it is not proof that unknown vulnerabilities do not exist.

## Deployed controls

- Dependabot checks Cargo, npm, and GitHub Actions weekly with bounded routine
  update groups. Security updates are not delayed by those grouping limits.
- OSV-Scanner 2.5.0 scans the exact committed lockfiles on pull requests,
  `main`, a weekly schedule, manual dispatch, and the exact release tag/ref.
- CodeQL runs extended Rust, JavaScript/TypeScript, and Actions queries.
- Formal releases contain CycloneDX 1.6 and SPDX 2.3 SBOMs, SHA-256 checksums,
  a manifest, and build provenance.

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
version and writes JSON evidence under `.tmp/dependency-security`.

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
