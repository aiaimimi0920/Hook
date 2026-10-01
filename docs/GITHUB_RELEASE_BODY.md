## Hook v0.2.32

本版本汇总已验收的截图、贴图编辑和 Loom 投射改进，并统一公开版本元数据。

### 主要更新

- 修复长截图时的输入释放与交接，改善取消和重新开始的行为。
- 重复使用橡皮擦时保留原始像素分辨率，避免多次重采样造成画质损失。
- 复用图片资产，并将会话文件 I/O 移出 UI 线程，减少交互中的重复工作。
- 提供紧凑的二维码和可复制投射链接，支持在贴图内导入二维码图片或链接。
- 完善设备选择与受信任跨 Loom 投射；本地 Loom 可用时生成本地分享入口，
  不以远端可达性作为前置条件，继续保留签名认证边界。

浏览器窗口仍使用原生窗口捕获。滚动或切换标签页会改变捕获像素，不支持固定
原网页内容。Tile-wall 仍为需要兼容 Loom 的早期可选集成；本次发布不代表完整
多机、公网或所有 wall 场景均已验收。

### 下载与运行

下载 `hook-windows-x64-v0.2.32.zip`，解压后运行 `hook.exe`。可同时下载对应的
`.zip.sha256` 校验完整性。公开附件仅保留 ZIP 和校验文件；构建来源、SBOM、
manifest 和完整校验清单仍由发布流水线生成并验证，作为维护侧证据保留。

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/), applies only after Hook is provisioned
and a hosted signing request receives manual approval.

This portable release does not claim to be a signed UIAccess installer.

**完整更新记录**：[v0.2.31...v0.2.32](https://github.com/aiaimimi0920/Hook/compare/v0.2.31...v0.2.32)
