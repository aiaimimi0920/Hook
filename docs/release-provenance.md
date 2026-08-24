# Hook Release Provenance

A publishable Hook release comes from a clean Git worktree and an exact
`Vx.y.z` tag that is reachable from `origin/main`. The dependency gate scans
that exact tag/ref; evidence from another commit does not authorize release.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\tests\Test-DependencySecurityContract.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-DependencySecurityScan.ps1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-release.ps1 `
  -VersionId Vx.y.z -OutputRoot ..\release\Hook -RequireCleanSource

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 `
  -PackageDir ..\release\Hook\Vx.y.z -RunSmoke -RequireCleanSource
```

The clean-source gate runs before the version destination is created. Formal
manifests and provenance must record `gitDirty=false` and
`sourceGitDirty=false`. A dirty candidate may be retained as runtime evidence,
but it is never a formal publication claim.

## Release subjects

- Portable Windows ZIP and its SHA-256 sidecar.
- CycloneDX 1.6 and SPDX 2.3 SBOMs.
- `provenance/build-provenance.json`.
- `manifest.json` and `checksums.sha256`.
- The reviewed unsigned UIAccess candidate digest JSON; the unsigned candidate
  executable remains a short-lived Actions artifact and is not published.

The verifier rejects traversal/reserved paths, reparse points, oversized
metadata and archives, duplicate ZIP entries, unexpected payload entries,
incomplete checksums, source/provenance mismatch, and SBOM schema mismatch.
`checksums.sha256` covers every formal release file except itself.

## GitHub attestations and publication

The tag workflow uses GitHub OIDC build-provenance and SBOM attestations. Runs
for one effective tag share a non-cancelling concurrency group and refuse an
existing draft or published release before building.

Publication is draft-first. Trusted repository code retrieves the draft by the
ID returned by its creating step, requires the exact asset set, compares every
remote byte count, and compares every GitHub-provided SHA-256 digest with a
streaming local digest. Only then is the draft published. Failure cleanup may
delete only that matching unpublished draft; it never deletes or overwrites a
published release. Fix a deterministic failure under a new version tag rather
than moving a published tag.

Any change to shipped source, embedded resources, dependencies, packaging, or
release tooling requires a new release ID and regenerated checksums, SBOMs, and
provenance. See [`DEPENDENCY_SECURITY.md`](DEPENDENCY_SECURITY.md) for the
inventory, vulnerability triage, exception, and incident-response rules.
