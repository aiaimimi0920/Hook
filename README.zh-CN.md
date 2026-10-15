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

[功能](#功能) · [开始使用](#快速开始) · [参与共享](#参与贡献)

## 功能

- **截取所需画面。** 区域截图、窗口截图、长截图、实时截图，以及屏幕取色。
- **把参考留在桌面。** 持久化贴图、专注画布、分组、参考图库与历史记录。
- **继续编辑和表达。** 裁剪、擦除、旋转，添加文字、箭头、图形、笔触、模糊和马赛克，支持撤销与重做。
- **使用实时内容。** 将程序区域变成实时贴图，并与兼容的源窗口交互；适用程序兼容性和资源限制。
- **接入本地能力。** 通过已安装、启用并授权的 Loom 能力使用 OCR、翻译和 Art 工作流。
- **投射到另一台设备。** 通过已配对的 Loom 连接使用图片投射和 LiveRelay，保留接收端控制与服务端授权。

[**查看完整功能与快捷键 →**](./docs/FEATURES.md) · [实时截图](./docs/LIVE_CAPTURE.md) · [图片投射](./docs/QR_PROJECTION.md)

## 快速开始

**运行 Otter：** 需要 Windows 10 或 11，以及 WebView2 Runtime。
从 [Releases](https://github.com/aiaimimi0920/Otter/releases) 下载便携版 ZIP，
解压后运行该包内实际包含的程序。

| 从这里开始 | 操作方式 |
| --- | --- |
| [下载发布版](https://github.com/aiaimimi0920/Otter/releases) | 选择便携版 ZIP，而非 GitHub 自动生成的源码压缩包；可选下载配套 `.zip.sha256` 校验完整性。 |
| 本地截图和编辑 | 启动程序，按 `Ctrl+1` 框选截图；本地截图和编辑不需要 Loom。 |
| OCR 和翻译 | 启动 Loom，安装并启用对应能力，完成 Otter 连接授权后选中图片贴图。 |
| [从源码构建](#开发) | 在 Windows 上准备 Node.js 22+、Rust stable 和 MSVC 工具链。 |

1. 按 **`Ctrl+1`** 区域截图、**`Ctrl+2`** 实时截图，或 **`Ctrl+3`** 长截图。
2. 选中贴图，按 **`Ctrl+E`** 显示或隐藏编辑工具栏。
3. 对应 Loom 能力可用时，按 **`Ctrl+4`** 识别、**`Ctrl+5`** 翻译；**`Alt+4` / `Alt+5`** 切换结果显示。

**包名说明：** Hook 已更名为 Otter。当前源码构建使用 `otter.exe`；
**v0.2.33** 等历史发布包仍包含 `hook.exe`，附件名称保持不变，请按该版本说明运行。
本页介绍当前源码，已发布的旧版本可能尚未包含下文所有能力。详见[更名说明](./docs/RENAMING.md)。

**签名与兼容性：** 除非 Release 明确包含经过批准的签名安装版，否则请将便携包视为未签名产物。
不支持 UAC 安全桌面截图或覆盖贴图。实时截图兼容性取决于源程序，不保证实际帧率或任意程序的后台输入。
[安全边界](./docs/SECURITY_BOUNDARIES.md) · [发布包](#发布包)

## 能力详解

<details>
<summary>连接、投射与完整能力说明</summary>

全局 Loom 连接会记住最后成功连接的目标：未手动断连就退出 Otter，下次启动自动尝试重连；
手动断连会取消自动重连但保留历史记录，仍须通过设备认证与服务端审批。
详见[全局 Loom 连接](docs/LOOM_CONNECTION.md)。

### 为什么是 Otter

原生桌面 Otter 默认自动发现并连接经过认证的本机 Loom；设置 `HOOK_ENABLE_LOOM_HOOK=0` 可关闭集成。
纯浏览器预览仅保留本地功能，不匿名连接 Loom 或执行真实 Art。
详见[安全边界](docs/SECURITY_BOUNDARIES.md#authenticated-native-local-bridge)。

启动 Loom 后，直接打开 `otter.exe` 即可使用 OCR、翻译等已安装扩展。
Loom 未运行时，本地截图和编辑仍可使用，无需额外的 Loom 集成启动脚本。
普通 Windows 桌面中，前台对话框及实际位于贴图上方的外部窗口优先接收输入；主动截图或操作贴图可重新前置。
不支持在 UAC 安全桌面内截图或覆盖贴图；Otter 会退让输入并取消临时手势，不修改系统安全设置。
选中图片贴图后，`Ctrl+4` 重新识别，`Alt+4` 显示或隐藏 OCR；`Ctrl+5` 重新翻译，
`Alt+5` 显示或隐藏翻译。没有结果时会先生成结果；对应 Loom 能力需已安装、启用并授权。

实时截图 Unit 的“实时投射”面板可发布到已配对的默认 Loom。接收端在支持 Surface 的
Art Unit 参数面板中刷新会话列表、选择会话并显式“加入观看”，沿用已挂载的 Surface
attachment 与服务端鉴权，不自动获得控制权。关闭参数面板保留已打开的观看窗口；
加入尚未完成时关闭面板则取消该次结果。详见 [Live capture](docs/LIVE_CAPTURE.md)。
设备被 Loom 删除后可显式“重新配对”，保留原密钥；批准、刷新和加入仍是独立步骤，
已撤销的旧观看窗口不会复活。
该入口已有聚焦测试，原生两机性能验收仍待完成。
观看窗口提供[有界收端诊断](docs/LIVE_RELAY_DIAGNOSTICS.md)，记录 source/epoch/frame、
接收计数和解码提交阶段，不导出图像或错误正文。实际 EXE/进程 SHA 另行核对，计数不等于显示 FPS。

Ctrl+E → 贴图设置下方的独立投射容器提供投射／被投射 Tab。
托盘“接收投射”先创建空白贴图，并在其中打开同款二维码导入弹窗；导入成功后更新这张贴图。托盘快捷键提示读取当前配置，在右侧独立列对齐。
接收用空白贴图采用灰色背景。托盘“退出”上方的“自启动”可勾选，控制当前 Windows 用户登录后启动 Otter；记录勾选时的 EXE 路径，移动程序后请重新勾选。
被投射端的数据流双按钮为只读；二维码和链接按钮打开同一个贴图内紧凑导入弹窗，默认选中对应 Tab，支持直接切换方式；托盘接收入口复用此面板。
来源行提供投射 ID、复制和退出；远端解除确认后才清空 ID，保留最后图像。

Otter 将透明桌面截图层和可持续编辑的贴图工作区放在同一个应用中。截图后可以继续
贴在桌面、编辑和标注，也可以连接到本地 Art/Loom 工作流。

[二维码投射](docs/QR_PROJECTION.md)可从 Ctrl+E 编辑栏进入，将贴图或 Art 正式图像
同步到另一台 Windows Otter。可选择无需官方登录的共享 HTTPS Loom（仍需设备配对），
或现有 Loom 账号模式；接收端保留独立布局。共享 Loom 支持选择在线设备投送并持续
同步，接收端可配置确认或自动显示。确认提示位于桌面右下角，支持接受、拒绝和
稍后处理。被投射面板提供本机全局的接收投射策略：自动批准、手动批准（默认）、总是拒绝，
重启后保留，切换策略不影响已有贴图同步；Loom 的设备授权与拒收限制仍然有效。
手动互信的离线双 Loom 也已支持投送，并通过
固定主机密钥 SSH 转发完成 PC1/PC3 原生验收；官方会员中继仍预留接口。

自建私有 CA 服务可配置[按 origin 隔离的进程级信任](docs/SECURITY_BOUNDARIES.md#origin-scoped-loom-https-trust)，
让 HTTP 与媒体 WSS 共用校验，不修改 Windows 根证书或设备配对规则；此配置能力不代表两机 LAN 已验收。

投射目标弹窗的设备/设备组勾选框直接开启或取消投射。
每行显示处理中、成功或失败标记；接收端显示或远端解除确认后才显示成功，失败可重试。
设备、设备组、用户图标显示已确认投射数量，打开同一 320×280 弹窗并选择对应 Tab；
切换页面不改变尺寸，小屏自动缩小，列表内部滚动。
较长的目标列表和字体列表均支持浮层滚轮与滚动条拖动；用户下拉显示服务尚未开放。
此 UI 增量已通过聚焦与浏览器验证；隔离候选已通过 PC1/PC3 的共享/跨 Loom
接收策略、编辑、批量关联和停止检查，使用固定 SSH 转发。批量检查使用同一物理
接收端在两个 Loom 上的独立身份。
共享和互信跨 Loom 的 v1 关联现支持主动启用双向标注编辑，由发起端统一切换方向，
提供持久重试与显式冲突选择。编辑会话中的底图固定；账号模式 v2 和不支持的标注
效果不开放此编辑能力。

### 核心能力

#### 截图

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
- 多张 Live 共用采集像素量/频率预算和一个自动 CPU 读回/编码许可。没有远端发布需求时，隐藏或完全移出视口后，
  源采集降为 1 FPS、暂停 JPEG 生产；不支持原生合成的可见贴图限速回退，避免同时开启多路
  不受限的 CPU 流水线。布局检查共用一个时钟及 Unit 几何采样；同窗口区域现在
  [共用一个 WGC 采集源](docs/LIVE_SHARED_SOURCE_CAPTURE.md)，仍保留独立裁剪、刷新、可见性和关闭；
- 自动使用[路线 B GPU 呈现](docs/LIVE_GPU_PRESENTATION.md)：将 WGC 纹理直接送入
  原生交换链，该显示分支不经过 JPEG；复制、保存及原生 Shift 拖拽导出可按需获取无损 GPU
  快照。GPU 健康呈现且没有编码图片需求时跳过连续 CPU 读回和 JPEG 编码；JPEG/raw 发布
  独立于本地可见性按预算生成 JPEG。[C1 H.264](docs/LIVE_RELAY_H264_POC.md) 发布则持有
  独立 GPU 输入需求，在取得实际纹理后释放自身 JPEG 需求；观看端使用原生 MF 解码，
  保留图片兼容回退，不宣称零拷贝或性能实测提升。不支持的组合效果使用新鲜解码帧回退。
  可设置 `HOOK_LIVE_GPU_PREVIEW=0` 强制 JPEG 兼容模式；这不等于对实际帧率的保证；
- 本地实时视图创建在刚才框选的位置，只显示当前捕获画面、主题绿色边框和主题黄色
  边角；拖动任一黄色边角即可移动，单击画面中的按钮会直接操作源程序；与普通 Unit
  一样，`Ctrl`+滚轮围绕指针缩放，`Alt`+滚轮调整透明度；
- 对同权限 Win32/WinForms 源窗口及其经过验证的跨 UI 线程/辅助进程子 HWND，提供
  持续捕获的逻辑隐藏，以及有序鼠标、滚轮、拖动、键盘控制、本地抢回和 watchdog 恢复；
- Live 输入遵循 Windows UIPI 的权限方向：允许同一用户的同级或较低权限源程序，
  不再误拦截管理员 Otter 操作普通程序；仍禁止向更高权限、其他用户/会话和安全桌面
  发送输入。输入被拒绝时显示贴图内短暂提示，不再静默无反应；
- Windows 11 HDR 感知截图，并自动降级到 SDR；
- `Ctrl+3` 长截图；
- 长截图过程中在截图框旁显示当前拼接结果的缩略预览；
- 文件型截图载荷，避免不必要的大型 Base64 传输；
- 原生屏幕取色。

#### 贴图工作区

贴图右键菜单底部的“剪贴板”悬浮展开系统剪贴板历史，仅展示图片和纯文本，
通过系统变更事件更新。选择图片新建贴图，选择文字在当前贴图中心生成可撤销的文本标注。
需要开启 Windows 剪贴板历史；Otter 不自动修改系统设置，也不另外保存剪贴板档案。
二级菜单靠近屏幕边缘时自动上下避让，右侧放不下时改向左展开；剪贴板列表支持滚轮及滚动条拖动。

- 持久化桌面贴图与可聚焦的画布模式；
- 裁剪、橡皮擦、边框、圆角、透明度、旋转、翻转和美化；
- 文本、编号、图形、线段、箭头、画笔、高亮、马赛克和模糊标注；
- 文本与序号的新建、选中属性栏统一为紧凑控件，支持透明色预览、字体选择和 8–999 的字号／半径输入及上下微调；
- 激活文本工具后，单击已有文本可再次编辑内容，点击空白处才新建文本；
- 按真实几何形状命中标注，而不是只按外接矩形判断；
- 铅笔与画笔紧凑属性栏，分别保存粗细、不透明度和平滑度；随速度轻重变化、轻柔边缘与自然收笔的画笔支持撤销、重做和栅格化，详见[自由笔触编辑](docs/FREEHAND_EDITING.md)；
- 多段贝塞尔曲线：双击加节点、拖动两端 `+` 延长、右键白色节点删除，支持撤销和重做；详见[曲线编辑](docs/BEZIER_EDITING.md)；
- 回收站、参考图库、分组、历史记录、撤销和重做；
- 保存、剪贴板和拖出文件采用统一的 Unicode 安全命名规则；
- 使用合成图缓存快速切换缩小视图和完整视图；
- 按住 Shift 将图片原生拖出到资源管理器。

当前快捷键和人工回归矩阵见 [`docs/FEATURES.md`](docs/FEATURES.md)。如果文档和
代码不一致，以当前实现为准。

#### 工作流与本地能力

- 节点画布、连线、分组参数和 Shader 预览；
- Loom 能力发现、Art 执行与结果回传；
- 通过 `--tile` 启动独立[瓷砖终端](docs/TILE_TERMINAL.md)，在选定物理屏幕上呈现 Loom
  管理的图片、Live 内容和声明式 Art，提供端点级输入与宿主 Art 确认、取消；Loom 可对
  已保存墙面执行冻结、黑场和恢复，逐输出报告应用结果并暂停输入。可按真实输出名称
  识别单块屏幕，标识最多显示 10 秒，Escape 只关闭标识并保留输出进程。当前仍为内部开发
  阶段，调度与多机联合验收尚未完成；
- 可选的 Loom OCR（`Ctrl+4` 始终重新识别所选贴图并复制全文，`Alt+4` 显示或隐藏按原文字号缩放的结果并启用点击复制，`Ctrl+E` 切换贴图工具栏且不会关闭 OCR 点击态）；工具栏 `OCR` 主菜单提供缓存全文、保留版式和已选文本复制，普通点击复制单块，`Shift+点击` 可按阅读顺序增减多个文本块；
- OCR 与翻译独立缓存：`Ctrl+5` 使用已有 OCR 翻译，缺少 OCR 时先识别；`Alt+4` / `Alt+5` 切换已有控件，无结果时自动生成并显示。两类控件互斥，翻译隐藏后恢复未被用户主动隐藏的 OCR；切换显示不会重复识别、请求模型或修改原文；
- 所有贴图与 Art 块的通知都绑定到对应贴图区域，在右上角按时间堆叠显示，点击单条即可关闭；
- 同一 `Ctrl+4` 入口自动提供本地二维码/条码识别，`OCR` 工具栏不再重复提供手动扫码项；结果可在属性面板中复制、明确打开 HTTP(S) 地址，并通过 `recognized_url`、`recognized_text`、`recognized_codes` 输出端口连接工作流；
- 通过本地能力桥接可选接入 Talk 语音和 Tea 工单；
- 单实例、托盘驻留、运行日志和独立的紧急退出 watchdog；紧急退出需要连续三次
  `Esc+Delete` 组合键（两个键的按下状态重叠、每轮两个键都松开、相邻轮次间隔小于
  400 ms）。单独连按 Esc 或 Delete、长按和自动重复不会触发整体退出；保留
  `Ctrl+Alt+Shift+F12` 备用紧急退出。

</details>

## 开发

Tauri v2 · SolidJS · TypeScript · Rust

```powershell
npm install
npm run dev:tauri
```

<details>
<summary>运行要求、验证与本地构建</summary>

### 运行与开发要求

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
  -File .\scripts\build-local-otter-exe.ps1 `
  -OutputDir ..\release\Otter\local-build `
  -Force
```

开发规则见 [`CONTRIBUTING.md`](CONTRIBUTING.md)，当前运行时结构见
[`TECHNICAL_ARCHITECTURE.md`](TECHNICAL_ARCHITECTURE.md)。

</details>

## 发布包

<details>
<summary>便携版、签名状态与本地数据目录</summary>

### 包格式

Hook 已更名为 **Otter（水獭）**。以下说明针对当前源码构建；此前已发布的
Hook v0.2.33 等历史包保留原有附件名称和 `hook.exe`，请运行对应包内实际包含的
程序，不要改写旧下载链接。兼容边界见[更名说明](docs/RENAMING.md)。

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

详见 [`UIACCESS_DISTRIBUTION.md`](UIACCESS_DISTRIBUTION.md) 和
[`docs/RELEASE_STRATEGY.md`](docs/RELEASE_STRATEGY.md)。正式发布的干净源码构建、
校验和、SBOM、证明与草稿核验流程见
[`docs/release-provenance.md`](docs/release-provenance.md)，依赖清单与漏洞响应规则见
[`docs/DEPENDENCY_SECURITY.md`](docs/DEPENDENCY_SECURITY.md)。

### 代码签名状态

Free code signing provided by [SignPath.io](https://signpath.io/), certificate
by [SignPath Foundation](https://signpath.org/) 只会在 Otter 项目完成开通、托管签名
请求经过人工审批后适用。除非某个 Release 明确包含已批准的签名安装版，否则当前
便携包应视为未签名产物。

- [代码签名策略](docs/CODE_SIGNING_POLICY.md)
- [隐私策略](docs/PRIVACY_POLICY.md)
- [安全策略](SECURITY.md)
- [治理与签名角色](GOVERNANCE.md)
- [第三方归属说明](THIRD_PARTY_NOTICES.md)

### 本地数据目录

当前公开 Tauri 包标识符是 `com.yamiyu.hook`。Otter 只读写该标识符对应的数据目录，
不会探测、读取或迁移旧标识符的数据目录。

</details>

## 参与贡献

- Issues：<https://github.com/aiaimimi0920/Otter/issues>
- 开发与提交规范：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 文档索引：[`docs/README.md`](docs/README.md)

## 许可证

MIT，详见 [`LICENSE`](LICENSE)。
