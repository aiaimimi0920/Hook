# Otter Documentation · 文档中心

从使用、反馈或开发入口开始，再按主题查阅详细说明。
Start with a task below, then follow the focused references.

| 想做什么 / Your goal | 从这里开始 / Start here |
| --- | --- |
| 了解与使用 Otter / Learn about Otter | [中文介绍与上手](../README.zh-CN.md#开始使用) · [English overview and quick start](../README.md#get-started) |
| 查快捷键与功能范围 / Check shortcuts and scope | [功能矩阵 / Feature matrix](FEATURES.md) |
| 反馈、改进文案或分享示例 / Report, improve or share | [参与共享指南](guide/contributing.zh-CN.md) · [Ways to contribute](guide/contributing.md) |
| 修改代码 / Work on code | [工程贡献规范 / Engineering guide](../CONTRIBUTING.md) · [技术架构 / Architecture](./architecture/overview.md) |
| 了解发布与安全要求 / Check release and security requirements | [发布策略 / Release strategy](release/RELEASE_STRATEGY.md) · [安全策略 / Security policy](../SECURITY.md) |

This directory contains documentation for the current product, release process and
public policy. Current code, configuration, workflows and tests remain the source
of truth. Documents are grouped by purpose and this index is the navigation entry.
这里整理当前产品、发布流程与公开策略；具体实现以当前代码、配置、工作流和测试为准。
目录按阅读目的组织；新增和迁移文件遵循[代码组织与开发规范](development/CODE_ORGANIZATION.md)。

## 使用与功能 / Using Otter

- [完整使用教程](guide/getting-started.zh-CN.md) · [Getting started](guide/getting-started.md) — preparation, capture, editing, nodes and projection.

- [能力详解](guide/capabilities.zh-CN.md) · [Capability details](guide/capabilities.md) — capture, stickers, connections and workflow boundaries.

- [Feature matrix](FEATURES.md) — implemented shortcuts and manual regression matrix.
- [Live capture](features/LIVE_CAPTURE.md) — capture scope, browser behavior and failure notices.
- [Live compatibility and validation](features/LIVE_CAPTURE.md#compatibility-and-validation) — controlled support matrix and evidence limits.
- [HDR capture](features/HDR_CAPTURE.md) — Windows HDR behavior and SDR fallback.
- [Image projection](features/QR_PROJECTION.md) — sending, receiving and two-way editing.
- [Loom connection](features/LOOM_CONNECTION.md) — connection history, reconnect and device authorization.
- [QR and barcode recognition](features/QR_BARCODE_RECOGNITION.md) — optional OCR capability and safe URL handling.
- [Freehand editing](features/FREEHAND_EDITING.md) · [Bézier editing](features/BEZIER_EDITING.md) — drawing and curve tools.
- [Tile terminal](features/TILE_TERMINAL.md) — terminal startup and its current acceptance boundary.

## 参与共享 / Contributing

- [中文参与指南](guide/contributing.zh-CN.md) · [English contribution guide](guide/contributing.md) — reports, ideas, examples, wording and documentation.
- [中文翻译教程](guide/translating.zh-CN.md) · [Translation guide](guide/translating.md) — documentation translation and interface wording boundaries.
- [Existing issues](https://github.com/aiaimimi0920/Otter/issues) — search before opening a new report.
- [Contribution entry point](../CONTRIBUTING.md) — choosing a contribution, opening a PR and reporting verification.
- [Engineering requirements](development/ENGINEERING.md) — code ownership, implementation rules, checks and delivery requirements.

## 开发与运行时 / Development and runtime

- [开发与验证](guide/development.zh-CN.md) · [Development and verification](guide/development.md) — requirements, commands, local builds and native acceptance boundaries.

- [Technical architecture](./architecture/overview.md) — current runtime, module, capture, input, persistence and release architecture.
- [代码组织与开发规范](development/CODE_ORGANIZATION.md) — 文件归属、模块边界和贡献验证要求。
- [独立仓库与迁移兼容](development/standalone-migration.md) · [更名兼容](development/RENAMING.md) — checkout、应用身份和旧协议边界。
- [意外退出排查](development/UNEXPECTED_EXIT_INVESTIGATION.md) — 保存现场、日志归因和 watchdog 验证。
- [Live resource admission](features/LIVE_RESOURCE_ADMISSION.md) — resource admission and pressure handling.
- [GPU presentation](features/LIVE_GPU_PRESENTATION.md) — native presentation and fallback.
- [Shared-source capture](features/LIVE_SHARED_SOURCE_CAPTURE.md) — shared window-capture ownership.
- [LiveRelay diagnostics](features/LIVE_RELAY_DIAGNOSTICS.md) — bounded evidence, timestamp semantics and executable/process identity requirements.
- [观看端断开诊断](features/LIVE_RELAY_DISCONNECT_DIAGNOSTICS.md) · [IPC 帧搬运](features/LIVE_RELAY_IPC_BLOB.md) · [H.264 实现与探针](features/LIVE_RELAY_H264_POC.md)。
- [视频捕获诊断](features/LIVE_VIDEO_CAPTURE_DIAGNOSTICS.md) — 自有窗口、截图与呈现证据边界。
- [Live protocol](features/LIVE_SCREENSHOT_PROTOCOL.md) — source/viewer, ordering, binary media and security boundaries.
- [Remote Surface](features/REMOTE_SURFACE_STAGED.md) — 当前启用与安全边界。
- [Tile wall client](features/TILE_WALL_CLIENT.md) — 墙面客户端契约与跨仓库依赖。
- [Asset library integration](features/ASSET_LIBRARY_INTEGRATION.md) — proposed ownership boundary and archived API reference; not an available Otter store or current service contract.

## 发布与签名 / Releases and signing

- [发布包、签名与本地数据](guide/packages.zh-CN.md) · [Packages, signing and local data](guide/packages.md) — user-facing package choices, signing status and data directory identity.

- [Release strategy](release/RELEASE_STRATEGY.md)
- [Versioning](release/VERSIONING.md) — 公开版本、内部迭代与历史标签兼容。
- [Release provenance](release/release-provenance.md) — clean-source packaging, checksums and verification.
- [UIAccess distribution](./release/uiaccess-distribution.md)
- [Code signing policy](release/CODE_SIGNING_POLICY.md)
- [Maintainer signing guide](release/MAINTAINER_SIGNING_GUIDE.md)
- [SignPath application checklist](release/SIGNPATH_APPLICATION_CHECKLIST.md)
- [SignPath application draft](release/SIGNPATH_APPLICATION_DRAFT.md)
- [Release body template](release/GITHUB_RELEASE_BODY.md)

## 安全与项目策略 / Security and project policy

- [Privacy policy](security/PRIVACY_POLICY.md)
- [Security boundaries](security/SECURITY_BOUNDARIES.md) — identity storage, remote-image destinations and native input lifecycle limits.
- [Security reporting](../SECURITY.md) — private vulnerability reporting and safe fallback.
- [Dependency security](security/DEPENDENCY_SECURITY.md) — dependency inventory and vulnerability response.
- [Governance and signing roles](../GOVERNANCE.md)
- [Third-party notices](../THIRD_PARTY_NOTICES.md)

## 文档维护 / Documentation rule

Completed implementation plans, migration checklists, smoke logs, and handoff
notes belong in Git history rather than the active documentation tree. The
`cleanup-base-20260928` tag covers an earlier cleanup only, not later migrations.
Keep current contracts, reproducible verification instructions and unresolved
acceptance limits; dated evidence must not be presented as current-build success.
If a document conflicts with the implementation,
correct or remove the document; do not change working code merely to match an old
plan.

Historical commits may contain sanitized path placeholders such as
`<otter-repo-root>`, `<legacy-artotter-root>`, and
`<legacy-artnexus-workflows-root>`. They describe old machine-local roots only
and are not active repository locations.
