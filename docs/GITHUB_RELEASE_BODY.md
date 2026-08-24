## Hook V0.1.9

This release focuses on maintainability, runtime safety, dependency security,
and verifiable publication while preserving Hook's portable-first distribution.

### Added

- Added Windows CurrentUser DPAPI protection for the persistent Ed25519 device
  private key, including validated atomic migration from legacy plaintext data.
- Added exact-lock OSV scanning, CodeQL, Dependabot policy, CycloneDX 1.6 and
  SPDX 2.3 SBOMs, build provenance, checksums, and a formal release manifest.
- Added clean-source formal build and verifier scripts with traversal,
  reparse-point, resource-bound, archive-content, checksum, and tamper gates.
- Added draft-first GitHub publication with exact remote asset verification and
  GitHub OIDC build/SBOM attestations.

### Improved

- Split large Rust, TypeScript, test, and automation owners into cohesive files;
  the strict effective-code-line gate now reports no maintained file above 500
  effective lines.
- Reduced the primary Vite entry chunk from 613.70 kB to 435.09 kB by lazily
  loading Surface, shader, sticker-strip, and parameter-panel owners.
- Split the JavaScript Surface bootstrap into bounded maintained fragments and
  added deterministic byte-for-byte generation checks.
- Updated all directly fixable npm and Cargo advisory findings. Remaining
  exceptions are advisory-specific, time-bounded unmaintained transitive or
  Linux-only dependencies that are outside the formal Windows release.
- Expanded native candidate acceptance, resource cleanup, restart/persistence,
  homepage capture, release workflow, and regression contracts.

### Compatibility note

On Windows, first use migrates a valid legacy device identity to DPAPI-protected
schema 2. A Hook version older than V0.1.8 cannot read that protected identity;
rolling back can require deleting the identity and pairing the device again.

### 主要更新

- 将大量 Rust、TypeScript、测试与自动化大文件按职责拆分；严格有效代码行检查中，
  已无任何维护文件超过 500 行。
- Windows 设备私钥改为 CurrentUser DPAPI 加密，并对旧明文身份执行校验后原子迁移。
- 主 Vite 入口从 613.70 kB 降至 435.09 kB，并保持按需加载失败时的回退路径。
- 新增精确锁文件 OSV 扫描、CodeQL、Dependabot、双格式 SBOM、构建来源、清单、
  校验和、GitHub OIDC 证明和草稿优先发布核验。
- 修复所有当前可直接升级的 npm/Cargo 公告；剩余项仅为限时的停止维护传递依赖或
  不进入正式 Windows 产物的 Linux 依赖，并明确阻止未复核的 Linux 发布。

### Package notes

The portable archive remains the only current user-facing executable package.
Extract it and run `hook.exe`. The signing-candidate JSON is provenance metadata,
not an installer; the unsigned UIAccess executable is not published.

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/), applies only after Hook is
provisioned and a hosted signing request receives manual approval.

- [Release provenance](https://github.com/aiaimimi0920/Hook/blob/main/docs/release-provenance.md)
- [Dependency security](https://github.com/aiaimimi0920/Hook/blob/main/docs/DEPENDENCY_SECURITY.md)
- [Code signing policy](https://github.com/aiaimimi0920/Hook/blob/main/docs/CODE_SIGNING_POLICY.md)
- [Security policy](https://github.com/aiaimimi0920/Hook/blob/main/SECURITY.md)

**Full Changelog**: [V0.1.8...V0.1.9](https://github.com/aiaimimi0920/Hook/compare/V0.1.8...V0.1.9)
