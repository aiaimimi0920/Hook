# Hook

<p align="center">
  <a href="README.md"><strong>English</strong></a>
  ·
  <a href="README.zh-CN.md"><strong>简体中文</strong></a>
</p>

<p align="center">
  面向 Windows 的桌面截图、贴图编辑与视觉工作流工具。
</p>

<p align="center">
  维护方：<strong>yamiyu</strong>
</p>

<p align="center">
  <a href="https://github.com/aiaimimi0920/Hook/actions/workflows/build-hook-exe.yml"><img src="https://github.com/aiaimimi0920/Hook/actions/workflows/build-hook-exe.yml/badge.svg" alt="Build Hook EXE" /></a>
  <img src="https://img.shields.io/badge/platform-Windows-0078D6" alt="Windows" />
  <img src="https://img.shields.io/badge/Tauri-v2-24C8DB" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/SolidJS-TypeScript-2C4F7C" alt="SolidJS TypeScript" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-F4EA2A" alt="MIT License" /></a>
</p>

## 为什么是 Hook

Hook 将透明桌面截图层和可持续编辑的贴图工作区放在同一个应用中。截图后可以继续
贴在桌面、编辑和标注，也可以连接到本地 Art/Loom 工作流。

## 核心能力

### 截图

- `Ctrl+1` 区域截图；
- 鼠标悬停窗口识别与双击窗口截图；
- Windows 11 HDR 感知截图，并自动降级到 SDR；
- `Ctrl+3` 长截图；
- 文件型截图载荷，避免不必要的大型 Base64 传输；
- 原生屏幕取色。

### 贴图工作区

- 持久化桌面贴图与可聚焦的画布模式；
- 裁剪、橡皮擦、边框、圆角、透明度、旋转、翻转和美化；
- 文本、编号、图形、线段、箭头、画笔、高亮、马赛克和模糊标注；
- 按真实几何形状命中标注，而不是只按外接矩形判断；
- 回收站、参考图库、分组、历史记录、撤销和重做；
- 保存、剪贴板和拖出文件采用统一的 Unicode 安全命名规则；
- 使用合成图缓存快速切换缩小视图和完整视图；
- 按住 Shift 将图片原生拖出到资源管理器。

当前快捷键和人工回归矩阵见 [`docs/FEATURES.md`](docs/FEATURES.md)。如果文档和
代码不一致，以当前实现为准。

### 工作流与本地能力

- 节点画布、连线、分组参数和 Shader 预览；
- Loom 能力发现、Art 执行与结果回传；
- 通过本地能力桥接可选接入 Talk 语音和 Tea 工单；
- 单实例、托盘驻留、运行日志和独立的紧急退出 watchdog。

## 运行与开发要求

- Windows 10 或 Windows 11；
- WebView2 Runtime；
- 前端开发使用 Node.js 22+；
- 桌面编译使用 Rust stable 与 MSVC 工具链。

只有所选 Windows 11 显示器报告 HDR 支持时才会进入 HDR 路径；不支持或内容仅为
SDR 时会自动降级。详见 [`docs/HDR_CAPTURE.md`](docs/HDR_CAPTURE.md)。

安装依赖并启动 Tauri 开发版本：

```powershell
npm install
npm run dev:tauri
```

常用检查：

```powershell
npm run typecheck
npm run test:performance
npm run test:parallel
npm test
cargo fmt --check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml
npm run build
```

`npm run verify:local` 会执行完整的串行验证，并继续构建和打包本地 Release；它不
是轻量级的 lint 命令。

直接构建便携 exe：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-local-hook-exe.ps1 `
  -OutputDir ..\release\Hook\local-build `
  -Force
```

开发规则见 [`CONTRIBUTING.md`](CONTRIBUTING.md)，当前运行时结构见
[`TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md)。

## 发布包

- **便携版（当前推荐）**
  - 解压后直接运行 `hook.exe`；
  - 当前普通构建和版本标签发布中唯一面向用户的包；
  - 包含项目许可证、第三方归属说明和随包源码许可证；
  - 如果 Windows 阻止 Hook 与 **任务管理器** 等提权前台窗口交互，可以暂时尝试
    以**管理员身份**运行 Hook。
- **安装版（未来签名版本）**
  - 仓库保留 UIAccess 安装脚本和 SignPath 准备内容；
  - 在签名服务和受保护审批环境启用前，安装版不是当前公开包。

版本标签工作流还可能附带 UIAccess 未签名候选的 provenance JSON。这个 JSON 是
审核元数据，不是安装包。

详见 [`UIACCESS_DISTRIBUTION.md`](UIACCESS_DISTRIBUTION.md) 和
[`docs/RELEASE_STRATEGY.md`](docs/RELEASE_STRATEGY.md)。

## 代码签名状态

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/) 只会在 Hook 项目完成开通、托管签名
请求经过人工审批后适用。除非某个 Release 明确包含已批准的签名安装版，否则当前
便携包应视为未签名产物。

- [代码签名策略](docs/CODE_SIGNING_POLICY.md)
- [隐私策略](docs/PRIVACY_POLICY.md)
- [安全策略](SECURITY.md)
- [治理与签名角色](GOVERNANCE.md)
- [第三方归属说明](THIRD_PARTY_NOTICES.md)

## 本地数据兼容性

当前公开 Tauri 包标识符是 `com.yamiyu.hook`。如果新目录为空，Hook 仍会回退读取
`io.github.aiaimimi0920.hook` 和 `com.vmjcv.hook` 创建的旧本地数据目录，避免升级
后丢失用户状态。

## 参与贡献

- Issues：<https://github.com/aiaimimi0920/Hook/issues>
- 开发与提交规范：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 文档索引：[`docs/README.md`](docs/README.md)

## 许可证

MIT，详见 [`LICENSE`](LICENSE)。

## 友情链接

- [linux.do](https://linux.do/) — 感谢 linux.do 社区帮助更多用户认识 Hook。
