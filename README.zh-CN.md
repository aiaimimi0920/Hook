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
- 通过 `Ctrl+2` 或托盘进入单设备实时截图；拖拽区域完整位于有效程序窗口内时，
  绑定到该程序的固定窗口局部像素区域，程序移动后仍显示同一块 UI；其他拖拽保留
  屏幕区域捕获；浏览器也使用此原生流程，无需安装扩展。滚动网页或切换标签后，
  Live 显示对应区域的新内容，不再提供原网页内容的独立绑定；
- 重复使用 `Ctrl+2` 可创建按资源动态接纳的 Live 贴图，包括同一程序的不同区域；
  每张独立刷新、摆放和交互，关闭其中一张不影响其他张。桌面不再显示全局 LIVE 标签；
- [运行时资源接纳](docs/LIVE_RESOURCE_ADMISSION.md) 取代固定四路：根据源窗口和选区尺寸、
  内存余量、DXGI 显存预算、CPU 负载及采集增长估计决定能否新增，仍保留 16 路安全硬上限。
  负载过高时降低已有采集频率并拒绝新增，不自动删除已有贴图；
- 本地 Live 以最高 60 FPS 为目标，使用新帧唤醒、Windows JPEG 编码及解码后再显示，
  不再在处理每帧后额外等待完整帧周期；实际帧率取决于源刷新、区域大小、硬件和并发数量；
- 多张 Live 共用采集像素量/频率预算和一个自动 CPU 读回/编码许可。隐藏或完全移出视口后，
  源采集降为 1 FPS、暂停 JPEG 生产；不支持原生合成的可见贴图限速回退，避免同时开启多路
  不受限的 CPU 流水线。布局检查共用一个时钟及 Unit 几何采样；同窗口区域现在
  [共用一个 WGC 采集源](docs/LIVE_SHARED_SOURCE_CAPTURE.md)，仍保留独立裁剪、刷新、可见性和关闭；
- 自动使用[路线 B GPU 呈现](docs/LIVE_GPU_PRESENTATION.md)：将 WGC 纹理直接送入
  原生交换链，该显示分支不经过 JPEG；复制、保存及原生 Shift 拖拽导出可按需获取无损 GPU
  快照。GPU 健康呈现时跳过连续 CPU 读回和 JPEG 编码；不支持的组合效果使用新鲜解码帧回退。
  可设置 `HOOK_LIVE_GPU_PREVIEW=0` 强制 JPEG 兼容模式；这不等于对实际帧率的保证；
- 本地实时视图创建在刚才框选的位置，只显示当前捕获画面、主题绿色边框和主题黄色
  边角；拖动任一黄色边角即可移动，单击画面中的按钮会直接操作源程序；与普通 Unit
  一样，`Ctrl`+滚轮围绕指针缩放，`Alt`+滚轮调整透明度；
- 对同权限 Win32/WinForms 源窗口及其经过验证的跨 UI 线程/辅助进程子 HWND，提供
  持续捕获的逻辑隐藏，以及有序鼠标、滚轮、拖动、键盘控制、本地抢回和 watchdog 恢复；
- Live 输入遵循 Windows UIPI 的权限方向：允许同一用户的同级或较低权限源程序，
  不再误拦截管理员 Hook 操作普通程序；仍禁止向更高权限、其他用户/会话和安全桌面
  发送输入。输入被拒绝时显示贴图内短暂提示，不再静默无反应；
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
- 可选的 Loom OCR（`Ctrl+4` 始终重新识别所选贴图并复制全文，`Alt+4` 显示或隐藏按原文字号缩放的结果并启用点击复制，`Ctrl+E` 切换贴图工具栏且不会关闭 OCR 点击态）；工具栏 `OCR` 主菜单提供缓存全文、保留版式和已选文本复制，普通点击复制单块，`Shift+点击` 可按阅读顺序增减多个文本块；
- 所有贴图与 Art 块的通知都绑定到对应贴图区域，在右上角按时间堆叠显示，点击单条即可关闭；
- 同一 `Ctrl+4` 入口自动提供本地二维码/条码识别，`OCR` 工具栏不再重复提供手动扫码项；结果可在属性面板中复制、明确打开 HTTP(S) 地址，并通过 `recognized_url`、`recognized_text`、`recognized_codes` 输出端口连接工作流；
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
npm run probe:live-screenshot:phase2
npm run probe:live-screenshot:phase3
cargo fmt --check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml
npm run build
```

`npm run verify:local` 会执行完整的串行验证，并继续构建和打包本地 Release；它不
是轻量级的 lint 命令。

实时截图 G2 探针默认在交互式桌面运行 600 秒。它使用同权限、持续变化的 WinForms
夹具验证 WGC 新帧、尺寸变化后的重建、源关闭 fail-closed、会话清理，以及句柄和
私有内存增长上限；证据写入 `artifacts/live-screenshot-phase2/<run-id>`，不提交到
Git。本地 WebView 展示通过 Tauri 原始二进制响应读取有界 JPEG 帧，不把帧塞进
`loom.surface.v1`，也不进行逐帧 JSON/Base64 传输。

G3 探针只覆盖已锁定的 Windows 11、单 SDR 显示器、同权限 Win32/WinForms 范围：
源窗口变成接近透明的合成器窗口后仍产生变化帧，并验证独立输入边沿、精确恢复、
本地抢回、恢复日志执行和 worker 清理。该结果不承诺原生最小化、提权/跨会话、
WPF、WinUI 或任意自定义控件兼容。

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

版本标签工作流会把 UIAccess 未签名候选及其摘要保留为短期 Actions 审核证据；
它们不会作为公开 Release 资产显示。

公开 Release 中普通用户只需要下载便携版 ZIP；希望验证下载完整性的用户再下载
对应的 `.zip.sha256` 校验文件。GitHub 自动生成的源码 ZIP 和 tarball 仍然面向开发者保留。

详见 [`UIACCESS_DISTRIBUTION.md`](UIACCESS_DISTRIBUTION.md) 和
[`docs/RELEASE_STRATEGY.md`](docs/RELEASE_STRATEGY.md)。正式发布的干净源码构建、
校验和、SBOM、证明与草稿核验流程见
[`docs/release-provenance.md`](docs/release-provenance.md)，依赖清单与漏洞响应规则见
[`docs/DEPENDENCY_SECURITY.md`](docs/DEPENDENCY_SECURITY.md)。

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

## 本地数据目录

当前公开 Tauri 包标识符是 `com.yamiyu.hook`。Hook 只读写该标识符对应的数据目录，
不会探测、读取或迁移旧标识符的数据目录。

## 参与贡献

- Issues：<https://github.com/aiaimimi0920/Hook/issues>
- 开发与提交规范：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 文档索引：[`docs/README.md`](docs/README.md)

## 许可证

MIT，详见 [`LICENSE`](LICENSE)。

## 友情链接

- [linux.do](https://linux.do/) — 感谢 linux.do 社区帮助更多用户认识 Hook。
