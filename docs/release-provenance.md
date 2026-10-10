# Hook Release Provenance

A publishable Hook release comes from a clean Git worktree and an exact
`vx.y.z` tag that is reachable from `origin/main` (legacy uppercase tags remain
accepted). Internal `vx.y.z.n` builds cannot be published. See [versioning](VERSIONING.md).
The dependency gate scans
that exact tag/ref; evidence from another commit does not authorize release.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\tests\Test-DependencySecurityContract.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Invoke-DependencySecurityScan.ps1

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-release.ps1 `
  -VersionId Vx.y.z -OutputRoot ..\release\Hook -RequireCleanSource

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 `
  -PackageDir ..\release\Hook\Vx.y.z -RunSmoke -RequireCleanSource
```

The native gate above requires an interactive Windows desktop and WebView2 CDP;
maintainers run it before tagging. GitHub-hosted runners instead use
`-RunHeadlessSmoke`, which executes the packaged `hook.exe --self-check`, binds
the result to the verified executable digest and product version, enforces a
timeout, and uploads the smoke evidence. It is not a substitute for the local
60-second native Tauri/WebView2 acceptance.

The clean-source gate runs before the version destination is created. Formal
manifests and provenance must record `gitDirty=false` and
`sourceGitDirty=false`. A dirty candidate may be retained as runtime evidence,
but it is never a formal publication claim.

## 隔离前端构建与原生启动

Windows 隔离构建覆盖 `build.frontendDist` 时，使用相对于 `src-tauri` 的目录路径，
并核对解析后的目录和前端文件哈希。不要直接填入 `C:/...`：本项目当前 Tauri 工具链
可能优先将其解析为 URL，导致静态资源没有嵌入 EXE；编译和 headless self-check 仍可能成功。

便携性须另在目标机器启动实际 EXE，绑定其 SHA-256、进程和 WebView2，确认加载
`http://tauri.localhost/`、完成 `frontend-initialized`，不依赖构建机目录的 `file:///...`。
该启动检查仍不替代实际业务验收。失败候选及回执保留，修正包使用新的输出目录；
同一个内部版本号下的不同字节必须按各自 SHA 和 provenance 区分。

## Joint release acceptance

Before claiming a Hook/Loom joint release, use reviewed commits and unused output
directories in each independent repository. Run the full applicable Hook source
gates: lint, application/test type checks, frontend and Surface browser tests,
Rust formatting/tests, production build, strict effective-line checks and the
packaged executable's version/self-check contract. Record commands and results
against the actual source identity; old phase test totals are not current proof.

Verify the exact executable and ZIP contents/digests against their provenance.
Native candidate preflight must use the expected executable SHA-256, then run
the required native and paired-end scenarios. Loom must separately pass its
full source gates and `verify-release.ps1 -RunSmoke -RequireCleanSource` on its
exact package. Do not combine one repository's passing results with another's
untested candidate to claim joint acceptance.

The former Phase 79 source-modularization record is available through Git tag
`cleanup-base-20260928`. Its removal does not close full joint release acceptance.
Later clean commits, package construction and headless/QR checks alone do not
complete native, browser or physical-network gates. The current feature-specific
limits remain in [QR projection](QR_PROJECTION.md), [Live capture](LIVE_CAPTURE.md),
[tile terminal](TILE_TERMINAL.md) and [runtime security](SECURITY_BOUNDARIES.md).

## Public Release subjects and private evidence

The public GitHub Release intentionally contains only the portable Windows ZIP and
its SHA-256 sidecar. GitHub also shows its automatic `Source code (zip)` and
`Source code (tar.gz)` links for the tag.

The build still generates and verifies CycloneDX/SPDX SBOMs,
`provenance/build-provenance.json`, `manifest.json`, `checksums.sha256`, and the
reviewed unsigned UIAccess candidate digest. These remain local or short-lived
Actions evidence; they are not uploaded as public Release assets. The unsigned
candidate executable is never published as a Release asset.

The verifier rejects traversal/reserved paths, reparse points, oversized
metadata and archives, duplicate ZIP entries, unexpected payload entries,
incomplete checksums, source/provenance mismatch, and SBOM schema mismatch.
`checksums.sha256` covers every formal release file except itself.

## GitHub attestations and publication

The tag workflow uses GitHub OIDC build-provenance and SBOM attestations. Runs
for one effective tag share a non-cancelling concurrency group and refuse an
existing draft or published release before building.

The classifier resolves one immutable commit before dependency execution; scan,
build and publication all check out that commit. Build/test runners have only
contents-read permission. A separate publication runner downloads the exact
same-run artifact ID, independently verifies the full package against source and
lockfiles, and only then attests/publishes. It never installs dependencies or runs
the downloaded executable. Both SBOM formats must contain the complete unique
ecosystem/name/version inventory, including scoped, nested and aliased npm packages.

Signing is dispatched from main and passes input strings only as data. A read-only
preflight requires a successful same-repository `release-hook-tag.yml` run whose
head SHA and tag ref match the requested release. Manual candidate production must
therefore dispatch the release workflow **at the tag ref**, not at main with only
an input tag override. The protected signing runner checks out the authenticated
commit and downloads the exact authenticated artifact ID; artifact-contained
claims alone are never producer authentication.

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
