# Live 贴图 V0.2.10 修复与候选版验收

日期：2026-09-06。结论：本轮三项主线修复已在最终候选二进制上通过真实桌面测试；这不是全仓库门禁全部通过的正式发布。

## 交付版本

以下路径相对于 Neuro 根目录。请退出旧 Hook 后启动 **V0.2.10 r3**，不要继续使用 V0.2.9 或同版本的 r2 候选包。测试结束后已退出测试进程，没有替用户常驻启动新版本。

| 项目 | 本轮交付 |
| --- | --- |
| Hook | [V0.2.10 r3 portable/hook.exe](../../release/Hook/live-unit-native-parity-20260906-r3/V0.2.10/portable/hook.exe) |
| Hook 完整分发包 | [hook-windows-x64-V0.2.10.zip](../../release/Hook/live-unit-native-parity-20260906-r3/V0.2.10/packages/hook-windows-x64-V0.2.10.zip) |
| 配套 Loom | [Loom.exe](../../release/Loom/loom-live-unit-native-parity-20260906-r2/Loom.exe) |

Hook 和 Loom 仍是独立 Git 仓库。本轮生产代码修复集中在 Hook；Loom 使用其当前工作树重新构建配套候选版，没有为本次 Unit 接入改动 Loom 生产代码。既有未提交修改及旧 release 目录均保留，未创建提交、推送或伪造干净来源。

### 二进制身份

| 文件 | SHA-256 |
| --- | --- |
| Hook portable/hook.exe | `1b80f5cfbd5d866d945c27f9d1b407fa2ae8a57afb4335a9a7c9421fb2008c5a` |
| Loom.exe | `77952cf67363243026ad9bd0a65d5d8c3c1cd4dae9775fb5ab4208808c1384f7` |
| Loom runtime/loom-daemon.exe | `3282b4357b9115ccce2ebe66f19c51062c1a5c2a05e9bb4dd279b031cd9f4644` |

Hook 的 8 条 checksum、7 条 manifest 文件大小/摘要记录均匹配；ZIP 内的 hook.exe 与实际测试的 portable/hook.exe 摘要一致。Loom 官方包校验通过，检查 50 个文件。两者 manifest 如实保留 `gitDirty=true` 和 `sourceGitDirty=true`。

证据：[候选包摘要](../artifacts/live-unit-candidate-digests.json)、[Loom 包校验日志](../../Loom/.tmp/live-unit-native-parity-verify-metadata.log)。

## 本轮修复

### 1. Live 不再是独立贴图壳

- 删除本地 Live 的独立浮层组件，将每个 Live 会话接入真正的 graph sticker Unit。
- 直接复用 `UnitView` 的选中态、位置、普通拖动、编辑框、参数面板和 Art 连接入口，而不是再为 Live 实现一套近似行为。
- `Ctrl+E` 打开共享编辑框，`Tab` 打开共享参数面板，`Shift+1` 进入共享 Add Art 流程；Hook 快捷键优先，不再被转发给源程序。
- 仅保留主题绿边框、主题黄拖动边角；没有重新增加本地 Live 会话工具栏。
- Live 帧保存在临时绑定中，不把每一帧写入持久 graph。编辑、复制/保存和 Art 操作在明确边界提交快照。
- 编辑期间固定所见快照并暂停源输入；这时复制/保存不会偷换成后台新帧。退出编辑后继续显示当前 Live 内容。
- 删除 Unit 会停止对应采集；首帧前关闭不再留下空白 Unit。

主要实现：[liveCaptureUnit.ts](../src/services/liveCaptureUnit.ts)、[UnitView.tsx](../src/components/UnitView.tsx)、[UnitStickerImageContent.tsx](../src/components/UnitStickerImageContent.tsx)。

### 2. 拖动和 DPI 回到普通 Unit 路径

- 黄色边角将拖动交给普通 Unit 生命周期，不再维护第二套位置和鼠标按下状态。
- 画布位置/尺寸使用逻辑坐标，源窗口区域仍由源端绑定；移动 Live 和移动源窗口是两件独立的事。
- 保留精确 pointer-up 坐标，原生全局抬起只作为外部释放兜底；取消、失焦和组件销毁都处理输入释放。

主要实现：[UnitLiveCaptureInput.tsx](../src/components/UnitLiveCaptureInput.tsx)、[UnitLiveCaptureInput.css](../src/components/UnitLiveCaptureInput.css)。

### 3. 内容点击和拖动转发给源程序

- 内容输入按实际显示图像矩形映射到绑定区域，并考虑现有裁剪/翻转显示。
- 普通内容点击、双击、按键和滚轮走源输入；黄色边角和 Hook 修饰键操作仍走普通 Unit。
- 修复输入队列时序：先同步预订待发送 move 和 button edge 的顺序，避免 await 期间后续 move 抢到 down 前面。
- move 可合并，button/key 边沿不可合并；释放状态在释放 pointer capture 前更新，避免重入产生过期状态。

主要实现：[liveCaptureController.ts](../src/services/liveCaptureController.ts)、[UnitLiveCaptureInput.tsx](../src/components/UnitLiveCaptureInput.tsx)。

## 最终二进制上的真实桌面验收

测试不是只调用 DOM 的 `.click()`，而是使用原生鼠标/键盘事件创建 Live、拖动和点击；CDP 用于观察实际 UI 与断言。源程序是测试专用 WinForms 窗口，点击次数和滑块数值取自该窗口的真实事件状态。

| 验收项 | 最终结果 |
| --- | --- |
| Ctrl+2 创建 Live | 原生快捷键和框选成功，创建真实 Unit |
| 150% DPI 原尺寸与原位置 | 选区 664 x 414 物理像素；Unit 443 x 276 逻辑像素，按 DPR 1.5 对齐，只有整数取整误差 |
| 初始位置 | Unit 位于框选起点 `(1058.67, 569.33)` 逻辑坐标 |
| 黄色边角拖动 | 移动到 `(1598.67, 619.33)`；松手后位置相同，后续鼠标移动不再带走贴图 |
| 点击源按钮 | 源程序实际点击计数 `0 -> 1`，没有重复点击 |
| 移动源程序后再次点击 | 同一 Live 内容坐标仍命中原按钮，实际计数 `1 -> 2` |
| 源滑块拖动 | 原生输入后源滑块值 `40 -> 56`，收到一次 down 和一次 up |
| Live 自动更新 | 实际显示图像帧继续更新 |
| Tab | 打开实际参数面板，再次按键可关闭 |
| Ctrl+E | 打开普通贴图共享编辑工具栏；编辑期间源输入层关闭，再次按键退出 |
| Shift+1 + 配套 Loom | 加载实际 Art 列表并创建第二个 graph Unit，不以离线提示冒充成功 |
| 退出清理 | 配对测试的 daemon、Art store、bridge 监听均清理；最终复核没有本次候选/夹具残留进程 |

主要证据：

- [最终独立 Live 原生测试](../artifacts/live-unit-native/20260906-032058/summary.json)。
- [最终 Hook + Loom 配对测试](../artifacts/runtime-performance/hook-loom-surface-candidate/20260906-032553-hook-loom-surface-20192c8d39f0/summary.json)。
- [配对测试内的逐步结果](../artifacts/runtime-performance/hook-loom-surface-candidate/20260906-032553-hook-loom-surface-20192c8d39f0/hook-native/summary.json)。
- [实际编辑框截图](../artifacts/runtime-performance/hook-loom-surface-candidate/20260906-032553-hook-loom-surface-20192c8d39f0/hook-native/editor.png)。
- [Live 与新建 Art Unit 截图](../artifacts/runtime-performance/hook-loom-surface-candidate/20260906-032553-hook-loom-surface-20192c8d39f0/hook-native/live-unit.png)。

自动化夹具也做了两处纠正：移动鼠标必须经过低级鼠标钩子，不能用 `SetCursorPos` 的结果冒充完整拖动事件；滑块必须命中真实滑块柄，而不是 TrackBar 整个控件的中心。柄位置依据官方 [TBM_GETTHUMBRECT 文档](https://learn.microsoft.com/en-us/windows/win32/controls/tbm-getthumbrect) 获取。没有为通过错误夹具而扩大产品原生输入层的修改。

## 编译和代码检查

| 检查 | 结果与证据 |
| --- | --- |
| Hook 官方 release 构建 | 通过；[r3 构建日志](../artifacts/live-unit-release-build-r3.log) |
| Loom 官方 release 构建 | 通过；[构建日志](../../Loom/.tmp/live-unit-native-parity-build.log) |
| 聚焦前端回归 | 6 文件、23 测试通过；[日志](../artifacts/live-unit-focused-final.log) |
| ESLint | `npm run lint` 通过 |
| 生产与测试类型检查 | `npm run typecheck`、`npm run typecheck:test` 通过 |
| 有效行数门禁 | 1031 个文件，无 501 行以上有效代码文件；[检查日志](../artifacts/live-unit-final-gates.log) |
| Rust formatter | `cargo fmt --check --manifest-path src-tauri/Cargo.toml` 通过 |
| 依赖安全契约与 OSV 扫描 | 通过现行仓库策略；没有新增依赖，现有安全例外仍生效；[契约](../artifacts/live-unit-security-contract.log)、[扫描](../artifacts/live-unit-security-scan.log) |
| Hook headless 自检 | 版本与摘要匹配、退出码 0；[结果](../artifacts/release-smoke/V0.2.10-live-unit-r3-headless/headless-summary.json) |
| Hook 60 秒原生候选冒烟 | 启动、单实例、响应、设置持久化、重启、正常退出通过；私有内存增长 1.023%，无强制清理；[结果](../artifacts/release-smoke/V0.2.10-live-unit-r3-native/summary.json) |
| 两个独立仓库 diff 检查 | `git diff --check` 均退出 0；[Hook](../artifacts/live-unit-hook-diff-check.log)、[Loom](../artifacts/live-unit-loom-diff-check.log) |

聚焦测试覆盖共享快捷键、拖动入口、原生抬起兜底、精确释放坐标、move/down/up 排序、删除停止采集、临时帧不反复写 graph、编辑快照保持和首帧前关闭。

60 秒候选冒烟是基本生命周期验证，不是长时间 Live 流性能承诺。源码 gate 总命令最后曾被 PowerShell 将 Git 的 CRLF 提示当成异常中止；随后分别重跑两个 `git diff --check`，实际退出码均为 0，没有为提示重写源文件。

## 未通过的门禁与明确边界

1. **全量前端套件没有完成。** 运行约 902 秒后超时终止；已出现 `LongCaptureSessionContract` 和 `HookArchivedDocsSanitizationContract` 两项尚未解决的契约失败，分别涉及旧源码字符串检查和既有文档中的本机路径。版本契约中的旧 `0.2.9` 断言已修正，并包含在上述 23 个通过测试中。不能将聚焦通过写成全量通过。[全量日志](../artifacts/live-unit-frontend-tests.log)
2. **Hook 正式发布 verifier 拒绝脏来源。** 当前候选来自保留中的未提交工作树，正式 `verify-release.ps1` 在 clean-source 门禁拒绝它。未削弱该门禁，也未将 manifest 改成 clean。本文的摘要校验、headless 和 native candidate 验收是候选证据，不替代正式发布资格。[正式 verifier 日志](../artifacts/live-unit-release-verify-headless.log)
3. **Loom 全量 `-RunSmoke` 没有通过。** 隔离重跑中持久化语义已成功，但报告 `daemon B cleanup failed`；其最终候选进程列表为空。包元数据校验和本任务实际 Hook/Loom Art 配对测试通过，不代表整个 Loom smoke 链通过。[持久化 smoke 结果](../../Loom/target/runtime-smoke/persistence/20260906-031315-3090ab2a/summary.json)
4. **应用兼容性不泛化。** 这次证明的是 Windows 同完整性级别、WinForms/窗口消息后端和 150% DPI 基线。没有证明所有 Electron、Qt、自绘、管理员窗口或受保护桌面控件都可点击；也没有证明跨显示器混合 DPI 的所有组合。
5. **继承共享 Unit 不等于每个功能都已单独验收。** 本次重点验证 Ctrl+E、Tab、Shift+1、拖动、点击和源滑块。Art 验证到实际节点创建，不宣称所有插件都已执行完成；Live 不会自动把每一帧作为正式结果持续送入下游。原生文件拖出等其余位图功能没有完整逐项重测。
6. **测试环境限制。** 原生鼠标探针会短暂占用桌面输入；人的同时操作曾使框选提前结束。最终证据来自独占输入、全步骤通过的测试，失败尝试没有删除或冒充通过。

## 用户复测顺序

1. 退出旧 Hook，启动上方配套 Loom，再启动 **V0.2.10 r3** Hook；本地 Live 本身不需要云端。
2. 对普通、非管理员程序按 `Ctrl+2` 框选控件区域，检查贴图与原区域尺寸、位置一致。
3. 拖黄色边角后松手，再移动鼠标，贴图应停在松手位置。
4. 点击 Live 内按钮，检查源程序真实反应；移动源程序窗口后再点击同一按钮。
5. 选中该 Live，依次使用 `Ctrl+E`、`Tab`、`Shift+1` 检查共享编辑框、参数面板和 Add Art。
6. 若特定程序仍有按钮无反应，后续按程序类型、是否管理员、DPI 和具体控件定位兼容性边界，不再另造一套 Live 贴图交互逻辑。

进程与独立仓库状态：[收尾记录](../artifacts/live-unit-final-workspace-state.json)。
