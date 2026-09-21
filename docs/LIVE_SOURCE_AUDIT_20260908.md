# Live 固定内容源：本轮排查与交付状态

后续超时复现、iframe 发现及视频元素读取原型实测见
[LIVE_VIDEO_ELEMENT_PROGRESS_20260908.md](LIVE_VIDEO_ELEMENT_PROGRESS_20260908.md)。
该原型尚未接入正式 Ctrl+2 链路，不代表需求已完成。

## 状态

用户日常 Edge 中的“滚动和切换标签后仍稳定显示原直播”问题保持未完成。
本轮不以旧的单次 r9 实验通过作为完成依据，也不在缺少运行证据时认定用户用了旧版本。

## 已复现并修复的缺陷

网页区域框选器曾监听所有捕获阶段的 `scroll` 事件，并无条件取消。
这包括直播聊天列表等内层容器的自动滚动，而不是只有原网页视口移动。
因此用户正在框选视频时，即使没有滚动网页，也可能收到选区取消。

本轮先添加真实浏览器回归：在拖拽期间让聊天容器滚动。修复前明确失败，
预期存在 1 个框选 dialog，实际为 0；修复后通过。
修改为只有根视口的 scrollX/scrollY 相对拖拽起点发生改变才取消。
拖拽期间真正滚动根页面仍会取消，Escape、超时、显式取消和焦点恢复仍通过。

- 生产修改：`Loom/capability-packages/browser-live/extension/regionPicker.ts`。
- 回归脚本：`Hook/scripts/tests/live-browser-region-picker-probe.ts`。
- 失败证据：`Hook/artifacts/browser-picker-chat-scroll-before`。
- 修复后证据：`Hook/artifacts/browser-picker-chat-scroll-after/summary.json`。

这解释了一类真实存在的取消缺陷，但没有历史事件证据证明之前 r7/r8 的取消
一定由此触发，更不能把它冒充“贴图已创建后跟随滚动/换标签”的根因。

## 实际入口核对结果

本轮核对时没有运行中的 Hook，无法取得用户发生问题时的进程路径。
Loom daemon 中的 Hook bridge 是协议桥接，不是已查明的 Hook EXE 启动路径。
旧候选文件存在，只能证明文件存在，不能证明用户日常启动了它。

为避免继续猜测，本轮新增不影响采集流程的本地诊断：

- 启动时记录当前 EXE 路径、版本和 PID：`runtime_identity`。
- 成功建立 Live 会话时记录实际 `sourceKind` 及尺寸：`live_capture_source_bound`。
- 不记录网页标题、URL、授权 grant、会话 token 或用户手势 token。
- 沿用有界异步日志写入，不在逐帧热路径增加日志，不增加 UI 按钮或悬浮标签。

默认日志位置是 `%LOCALAPPDATA%\Hook\logs\hook-runtime.log`，显式配置的日志目录优先。
源码中的 `browser_document` 表示网页提供方；若实际记录为原生窗口来源，
应当先修复入口和交付问题，而不是再优化浏览器窗口截图的速度。

## 明确仍存在的能力边界

### 第二个确认的交付缺陷：原生窗口仍然隐藏

浏览器入口原先直接注册 `liveCaptureController.start`，创建 Unit 之后没有显示
原生贴图窗口。托盘隐藏状态的 DOM Unit 不等于桌面上可见的 Live。
本轮补充原生 `is_visible` 断言，而不是仅依赖 Playwright 的 DOM 可见性。

最初尝试在 native Ctrl+2 分支提前显示宿主窗口，但实机 r6 明确记录
`BROWSER_SOURCE_FOCUS_CHANGED`，说明显示时序会破坏浏览器授权焦点。
该尝试没有作为完成版本保留；改为先完成浏览器授权和 Unit 创建，再显示
普通贴图宿主窗口。快捷键和显式导入共用同一个后置显示入口。
这一修正随后通过下述原生窗口实机验证，但不代表持续采集已稳定。

随后 r3 诊断候选的 `browser-live-source-audit-shell-r7` 实机通过：
原生窗口起初确实隐藏，Ctrl+2 框选并创建 Unit 后原生窗口可见；原页面滚动
905.33 CSS 像素，原选区底部 -300.33；再连续三轮上下滚动和切换标签，
原视频未暂停、时间推进、Hook 解码图像持续变化。已查看第三轮隐藏标签图像。
这是固定测试直播间的加强验收，不是用户日常实例的复现结论。

为了保持 app.tsx 的严格行数边界，共用浏览器入口注册和后置显示顺序已收回
浏览器入口服务中，补充“成功建立源后才显示、失败不显示”的顺序测试。
不通过压缩代码或新增行数例外规避门禁。中间 r4 构建在发现门禁问题后按
已核实的本次构建进程身份终止，不作为交付物；最终重建使用新目录 r5。

当前网页提供方固定的是主文档身份和文档矩形，并没有绑定原 video 元素身份。
播放器重排、替换、悬浮模式和后台持续产帧，仍不能凭当前代码推定可靠。
本轮没有悄悄复制另一份直播页面，也没有增加一个未经验证的所谓万能播放器捕获通路。

完整 Hook 验收脚本已增加三轮“返回原标签、向上滚回、向下移出原区域、再切换标签”，
并同时检查图像更新和原视频媒体时间。脚本增强不是实机通过结论；每次运行仍须
单独记录结果，且不能替代用户具体页面和实际启动入口的复现。

## 验证

- 新增的真实浏览器聊天滚动回归：修复前失败、修复后通过，浏览器已关闭。
- Hook 聚焦测试：3 个文件、14 项通过，包括运行身份/来源日志边界及浏览器路由。
- 后续补充窗口显示顺序和入口契约后：3 个文件、16 项通过，记录为
  `Hook/artifacts/live-source-audit-tests-r5.log`。
- Hook 生产 TypeScript、相关 ESLint、严格行数门禁通过。
- Loom 严格行数门禁通过：1006 个文件，12 个原有 501-700 行例外，未新增例外。
- Loom 依赖安全契约和 OSV 扫描通过，未新增权限或依赖；沿用既有安全例外，
  不把扫描通过解释为完全不存在历史漏洞。
- 首次 Loom 全量 browser-live 测试：67 通过、2 失败、1 跳过。失败在 Windows
  ACL 子进程检查，记录保留于 `.tmp/browser-live-picker-fix-tests.log`；没有放宽安全检查。
- 构建结束后复跑完整 Loom 测试：69 通过、0 失败、1 跳过，记录为
  `.tmp/browser-live-picker-fix-tests-r2.log`。

## 发布构件

浏览器扩展 0.1.2 已构建至：

`<hook-repo-root>\..\release\Loom\browser-live-picker-fix-20260908-r1\extension`

已通过有备份的更新脚本复制到原固定安装目录，未修改用户浏览器 profile、
native host 注册或扩展权限。日常 Edge 中仍需要重新加载扩展才能使用新代码。

Hook 最终诊断候选已完成编译、构件校验和 headless smoke：

`<hook-repo-root>\..\release\Hook\browser-live-source-audit-20260908-r5\hook.exe`

- 产品版本：0.2.29；大小：8,004,096 字节。
- SHA256：`7b1d71e126f86d5df4ea1626c32857bd7e404a38c0dc57aba387c791627f18d6`。
- `build-provenance.json` 与实际文件的大小、哈希一致。
- headless 记录：`Hook/artifacts/browser-live-source-audit-headless-r5/headless-summary.json`。
- 最终 Hook 严格行数门禁：1137 个文件，无超过 500 有效行的文件。
- Hook 和 Loom 各自 `git diff --check` 通过；两仓库均保留既有未提交工作，
  核对时分别有 281、127 项状态记录，不将全部变更归于本轮。
- 已安装扩展的 manifest.json、worker.js 与本轮 Loom 扩展构件哈希一致。

### 同一最终候选的连续实机验收：一轮通过、一轮失败

`browser-live-source-audit-shell-r8` 通过：真实 OS Ctrl+2、真实浏览器框选、
无种子贴图、原生窗口从隐藏到可见；滚动使原选区完全离开视口，切换标签后
完成额外三轮往返操作。第三轮原视频处于 hidden、未暂停，媒体时间推进到
47.19 秒，Hook 的解码 PNG 仍更新；已人工查看第三轮隐藏标签下的 PNG。

紧接着同一 EXE 的 `browser-live-source-audit-shell-r9` 失败：第一轮重复操作的
`repeat-1-scrolled.png` 已生成，但切换其他标签后，等待新贴图帧达到 15 秒超时，
没有生成 `repeat-1-hidden.png`。这不是通过，也不能用上一轮成功抵消。
运行日志确认该失败来自 r5 EXE，实际来源为 `browser_document`，不是原生窗口截图。

失败链路的源码排查发现：Hook 捕获异常被统一转换为 `browser_capture_failed`，
随后关闭源并停止调度；提供方单次捕获有 4 秒边界，Hook/桥接另有 5 秒边界。
现有 r9 诊断未保留准确异常码，不能断言是哪一层超时，也不能认定放宽超时即可修复。
没有移除资源清理、租约或安全边界来让测试表面通过。

r9 退出后已核对：无运行中的 Hook，也无 r8/r9 专属目录匹配的 Edge、WebView2
或测试 runner 残留。此核对只证明这些测试进程已退出，不等于完整 GPU 泄漏验收。

**r5 是排查候选，不是稳定正式发布版。两项根本需求仍未完成。**

随后尝试 `browser-live-source-audit-shell-r10` 捕获更精确的异常码，但测试在
OS 快捷键阶段因 `Owned caption is occluded` 安全检查停止，没有建立 Live 源。
未绕过遮挡检查向未知前台窗口注入输入；该次不能用于判断采集成功或失败。
结束后再次核对无 Hook 和 r8/r9/r10 专属 Edge、WebView2、Node 进程残留。
下一次排查必须记录停止前的具体提供方错误，不能直接修改 4/5 秒超时常量。

## 下一步的必要输入

### 继续排查：运行时失败被桥接误报成功

r11 开启自动恢复的异常捕获后，在初始贴图更新阶段得到
`BROWSER_INVALID_PROVIDER_RESULT`，随后是清理引起的 `BROWSER_SESSION_CLOSED`。
这次得到的证据不支持直接断言“只是超时”：首先必须修复错误状态丢失。

已确认并修正 Loom 的独立缺陷：`CapabilityRuntimeHost::invoke` 返回 `Ok`
只表示运行时运输/协议调用结束，其内部 `output.status` 仍可能为 Failed 或 Cancelled。
daemon 的 extension bridge 原来忽略内部状态，将其一律封装为 Succeeded，
并把缺失 payload 转换为 null。Hook 因此只能报告无效提供方结果。

新逻辑只允许内部 Succeeded 进入成功输出路径；其他状态返回失败，不传播失败
payload 或 effects。保留类型化错误码，取消映射为 Cancelled；不泄露任意运行时
错误文本。该缺陷确定存在，但还不能据此推断底层采集为何首次失败。

- 修改：`Loom/apps/daemon/src/runtime/capability_extension_bridge.rs`。
- 回归：`Loom/apps/daemon/src/tests/suite/part_33.rs`，覆盖 Failed、Cancelled、
  Accepted、Progress、成功通路以及无错误对象时的保守失败。
- 新回归通过；既有插件安装、启用、调用、卸载生命周期实测通过。
- `cargo fmt --all --check`、Loom 严格行数门禁及 release 编译通过。
- 构件：`release/Loom/browser-live-bridge-status-20260908-r1/loom-daemon.exe`。
  同目录有哈希、大小和构建来源记录；`--help` 实测通过。
  **这是未安装的 daemon 组件候选，不是完整 Loom 正式发布包。**
  没有替换或重启正在运行的日常 Loom daemon，因此不能宣称日常入口已获得该修复。

Hook 验收脚本新增只记录输出类型、原生扩展错误码的有界诊断，不保存帧内容、
授权或 native 消息正文。TypeScript 和严格行数门禁通过。r12 在框选阶段超时，
r13 因实际前台不是测试所有的 Edge 进程而停止；两次均不能算采集验收通过。
已核对 r11/r12/r13 的 Hook、专属 Edge/WebView2/Node 测试进程均退出。

后续先在可控前台条件下用原生消息错误码定位实际失败，再验证修复后的桥接。
不得用这次状态传播修复代替“滚动/切换标签后持续播放”的最终验收。

请提供出问题的直播间地址，以及平时启动 Hook 的入口；也可以从平时的入口
启动 Hook 后告知，我会读取实际进程路径，而不是让用户自行判断版本。
需要先将实际失败和实际来源类型对应起来，再决定修入口、修文档区域绑定，
还是必须推进原播放器内容源。两项根本需求尚未关闭。
