# 发布包、签名与本地数据

[English](packages.md) · [文档中心](../README.md)

## 发布包

Hook 已更名为 **Otter（水獭）**。以下说明针对当前源码构建；此前已发布的
Hook v0.2.33 等历史包保留原有附件名称和 `hook.exe`，请运行对应包内实际包含的
程序，不要改写旧下载链接。兼容边界见[更名说明](../RENAMING.md)。

- **便携版（当前推荐）**
  - 解压后直接运行 `otter.exe`；
  - 当前普通构建和版本标签发布中唯一面向用户的包；
  - 包含项目许可证、第三方归属说明和随包源码许可证；
  - 如果 Windows 阻止 Otter 与 **任务管理器** 等提权前台窗口交互，可以暂时尝试
    以**管理员身份**运行 Otter。
- **安装版（未来签名版本）**
  - 仓库保留 UIAccess 安装脚本和 SignPath 准备内容；
  - 在签名服务和受保护审批环境启用前，安装版不是当前公开包。

版本标签工作流会把 UIAccess 未签名候选及其摘要保留为短期 Actions 审核证据；
它们不会作为公开 Release 资产显示。

公开 Release 中普通用户只需要下载便携版 ZIP；希望验证下载完整性的用户再下载
对应的 `.zip.sha256` 校验文件。GitHub 自动生成的源码 ZIP 和 tarball 仍然面向开发者保留。

详见 [`UIACCESS_DISTRIBUTION.md`](../../UIACCESS_DISTRIBUTION.md) 和
[`docs/RELEASE_STRATEGY.md`](../RELEASE_STRATEGY.md)。正式发布的干净源码构建、
校验和、SBOM、证明与草稿核验流程见
[`docs/release-provenance.md`](../release-provenance.md)，依赖清单与漏洞响应规则见
[`docs/DEPENDENCY_SECURITY.md`](../DEPENDENCY_SECURITY.md)。

## 代码签名状态

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/) 只会在 Otter 项目完成开通、托管签名
请求经过人工审批后适用。除非某个 Release 明确包含已批准的签名安装版，否则当前
便携包应视为未签名产物。

- [代码签名策略](../CODE_SIGNING_POLICY.md)
- [隐私策略](../PRIVACY_POLICY.md)
- [安全策略](../../SECURITY.md)
- [治理与签名角色](../../GOVERNANCE.md)
- [第三方归属说明](../../THIRD_PARTY_NOTICES.md)

## 本地数据目录

当前公开 Tauri 包标识符是 `com.yamiyu.hook`。Otter 只读写该标识符对应的数据目录，
不会探测、读取或迁移旧标识符的数据目录。开发与测试自动化可以显式设置
`OTTER_APPDATA_DIR` 来选择隔离目录（`HOOK_APPDATA_DIR` 保留为回退项）。
