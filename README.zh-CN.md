<p align="center"><img src="./src-tauri/icons/otter-icon.svg" width="80" height="80" alt="Otter 截图图标"></p>
<h1 align="center">Otter</h1>
<p align="center"><strong>截下画面，留在桌面，改成你想要的样子。</strong><br>连接节点，生成效果。让桌面成为你的创作工作台。</p>
<p align="center">
  官网 ·
  <a href="https://github.com/aiaimimi0920/Otter/releases">下载</a> ·
  <a href="./docs/README.md">文档中心</a> ·
  <a href="https://github.com/aiaimimi0920/Otter/issues">反馈</a>
</p>
<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-36564f?style=flat-square" alt="MIT 许可证"></a>
  <img src="https://img.shields.io/badge/platform-Windows_10_%2F_11-36564f?style=flat-square" alt="Windows 10 / 11">
  <a href="https://github.com/aiaimimi0920/Otter/actions/workflows/build-otter-exe.yml"><img src="https://github.com/aiaimimi0920/Otter/actions/workflows/build-otter-exe.yml/badge.svg" alt="Build Otter EXE"></a>
</p>
<p align="center"><a href="./README.md">English</a> · 简体中文</p>

Otter 是一款免费开源的截图工具，让截图、标注、整理与分享融入日常工作。
将桌面化作工作台，连接不同的处理节点，组合功能、制作效果，让截下的画面拥有更多可能。

<details open>
<summary>桌面工作区 · 展开 / 收起动画</summary>

<p align="center">
  <img src="./docs/assets/hook-home-demo.gif" width="860" alt="Otter 仓库现有演示：桌面上的截图、贴图和工作流示例卡片，以及贴图右键菜单。">
</p>

</details>

[功能](#功能) · [开始使用](#开始使用) · [参与共享](#参与贡献)

## 功能

- **截取所需画面。** 区域截图、窗口截图、长截图、实时截图，以及屏幕取色。
- **把参考留在桌面。** 持久化贴图、专注画布、分组、参考图库与历史记录。
- **继续编辑和表达。** 裁剪、擦除、旋转，添加文字、箭头、图形、笔触、模糊和马赛克，支持撤销与重做。
- **使用实时内容。** 将程序区域变成实时贴图，并与兼容的源窗口交互；适用程序兼容性和资源限制。
- **接入本地能力。** 通过已安装、启用并授权的 Loom 能力使用 OCR、翻译和 Art 工作流。
- **投射到另一台设备。** 通过已配对的 Loom 连接使用图片投射和 LiveRelay，保留接收端控制与服务端授权。

[**查看完整功能与快捷键 →**](./docs/FEATURES.md) · [实时截图](./docs/LIVE_CAPTURE.md) · [图片投射](./docs/QR_PROJECTION.md)

## 开始使用

- **截取钉图：** 截取桌面上任意画面，将画面钉在桌面的任意位置。
- **快速编辑：** 使用编辑栏内的工具，对钉图进行快速的标注处理。
- **连接流程：** 使用 Loom 的节点工具，进行高级工作流组装处理。
- **分享画面：** 使用推送工具，将贴图的画面推送给任意客户端。

| 从这里开始 | 需要做什么 |
| --- | --- |
| [下载 Otter](https://github.com/aiaimimi0920/Otter/releases) | 解压并启动 Otter App，即可开始使用。 |
| 下载 Otter + Loom | 解压并启动 Otter App 和 Loom App。在 Loom 中安装 OCR、翻译等能力包，也可按需添加常用的 MCP 工具和 Art 节点，拓展你的创作工作流。 |

1. 按 **`Ctrl+1`** 区域截图、**`Ctrl+2`** 实时截图，或 **`Ctrl+3`** 长截图。
2. 选中钉图，按 **`Ctrl+E`** 显示或隐藏编辑工具栏，**`Tab`** 展开或收起参数面板；退出编辑或选择状态后，按 **`Esc`** 删除钉图。
3. 对应 Loom 能力可用时，按 **`Ctrl+4`** 进行 OCR 识别，**`Alt+4`** 切换识别结果显示；按 **`Ctrl+5`** 翻译，**`Alt+5`** 切换翻译结果显示；按 **`Shift+1`** 打开 Art 菜单，添加新的节点。
4. 选中钉图，打开工具栏，选择投射按钮，可以投射钉图到任意可连接的设备上。

## 参与贡献

欢迎反馈问题、参与翻译、改进文档或贡献代码。
从[社区参与方式](./docs/guide/contributing.zh-CN.md)或[翻译教程](./docs/guide/translating.zh-CN.md)开始，
也可以从[项目目录说明](./TECHNICAL_ARCHITECTURE.md#2-repository-layout)了解代码结构。
代码修改请遵循[工程贡献规范](./CONTRIBUTING.md)，反馈前先搜索[已有 Issues](https://github.com/aiaimimi0920/Otter/issues)。

## 许可证

Otter 自有代码采用 [MIT 许可](./LICENSE)，依赖保留各自的[许可与声明](./THIRD_PARTY_NOTICES.md)。
