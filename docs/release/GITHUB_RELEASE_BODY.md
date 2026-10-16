## Otter v0.2.33

本版本汇总实时贴图、标注编辑与本机 Loom 联动改进，并加强本地连接和发布安全边界。

### 主要更新

- 改善大量标注下模糊工具的跟随响应，修复裁剪区域与标注位置不一致的问题。
- 修复实时贴图在源窗口最小化、恢复和输入超时后的交互问题，避免普通贴图操作
  被误判为主动恢复浏览器；保留源窗口的任务栏入口。
- 暂时性捕获重建失败不再永久停止更新；窗口恢复后继续出帧，并清除对应旧提示。
  实时贴图即使尚无首帧或读取失败，也可通过 Esc 关闭。
- 原生 Otter 默认自动发现并认证连接本机 Loom，无需额外启动脚本；可通过
  `HOOK_ENABLE_LOOM_HOOK=0` 显式关闭。OCR、翻译等扩展仍需在 Loom 中安装、启用和授权。
- 完善实时投射的 H.264 协商、图像回退、观看端重连和撤销处理，修复部分 DPI
  坐标与解码边界问题。
- 加强本地桥接的 TLS 证书校验、连接绑定认证、扩展授权及恢复和发布来源验证。

建议与 Loom V0.2.2 配套升级。翻译模型或服务需单独配置，发布包不包含本地模型。
浏览器实时贴图仍是原生窗口捕获，不是固定网页内容；后台交互兼容性取决于源程序。
本次发布不代表所有网站、多机、公网、HDR 或 tile-wall 场景均已完成验收。

### 下载与运行

下载 `otter-windows-x64-v0.2.33.zip`，解压后直接运行 `otter.exe`。可同时下载对应的
`.zip.sha256` 校验完整性。公开附件仅保留 ZIP 和校验文件；构建来源、SBOM、
manifest 和完整校验清单仍由发布流水线生成并验证，作为维护侧证据保留。

Free code signing provided by [SignPath.io](https://signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/), applies only after Otter is provisioned
and a hosted signing request receives manual approval.

This portable release does not claim to be a signed UIAccess installer.

**完整更新记录**：[v0.2.32...v0.2.33](https://github.com/aiaimimi0920/Otter/compare/v0.2.32...v0.2.33)
