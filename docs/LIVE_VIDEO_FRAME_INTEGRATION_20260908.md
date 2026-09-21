# Live 视频内容源接线与产品验收进展

2026-09-09 已恢复前台验收，找到 Edge 自动登录弹窗造成的同进程窗口误判，
修复测试环境后连续两次通过。详见 [最新验收报告](LIVE_IDLE_ACCEPTANCE_20260909.md)。
下面保留此前阶段记录，其中等待空闲时段的状态已经过时。

2026-09-08。整体目标尚未完成，当前候选不能标为正式解决版本。

## 当前暂停点：需要前台验收时段

前台验收时段的问题尚未收到答复。连续三个推进回合中该条件仍未解除；期间
已完成上文超时清理实现、回归测试和候选构建，当前继续修改快捷键转发需要
新的真实输入证据，不能用猜测性重试或移除焦点检查替代。

本次只读复核确认 Hook 进程数为 0，没有仍在运行的验收任务；Windows 最近
输入间隔为 0 秒，前台也不属于测试专用 Edge，因此没有重新启动全局快捷键
验收。任务暂停等待约 2 分钟不切换窗口、不操作鼠标键盘的测试时段，目标没有
关闭。用户确认可验收后，从新扩展 r3 与 Hook activation-audit-r1 候选继续。

## 最新实现：共享页面上的视频操作超时清理

在等待前台验收时段期间，继续检查了视频源资源生命周期。发现一个明确缺口：
同页已有 Live 区域时，新增区域的 Runtime.evaluate 若超时，旧区域仍会持有
根调试连接；本地释放对象组之后，未完成的浏览器操作仍可能晚到并分配对象。
此前初始化异常没有强制终止这个状态不确定的共享根连接。

已在 Loom 的 chromiumDebuggerBinding.ts 增加超时保护：视频区域绑定或读取
返回 BROWSER_IFRAME_OPERATION_TIMEOUT 时，关闭自己拥有的根连接，并保留
原始错误。同一根连接上的其他区域也会失效，避免继续使用状态不确定的源。
普通关闭单个区域仍只释放该区域，不影响同页其他有效区域。

新增 videoTimeoutCleanup.test.mjs，模拟一个有效区域旁边的第二次视频分配
超时、对象组清理完成后操作才返回。断言根连接只分离一次、晚到操作不能留下
对象、旧区域不能继续读取，以及监听器归零。该聚焦测试通过；完整 Browser
Live 串行套件 91 项，90 通过、0 失败、1 跳过，见
`Loom/.tmp/browser-live-timeout-suite.log`。直接依赖的 TypeScript 检查、两个
仓库的 strict 行数门禁和 git diff --check 均通过。

新扩展候选为 `release/Loom/browser-live-video-source-20260908-r3/extension`，
保持 0.1.3 候选版本，已构建并更新固定安装目录，保留上一版备份。运行中的
个人 Edge 仍需重新加载扩展才会使用新代码；未宣称当前卡顿已由这项修复解决，
也未把模拟超时测试当作完整产品验收。此轮没有修改 Hook 生产代码或重建 Hook。

## 最新复核：失败边界与前台验收条件

后续 activation-shell-r5、r6 均记录原生 SendInput 发送 6/6 个事件，而浏览器
action 事件计数为 0、视频读取为 0。扩展实际登记的快捷键是 Ctrl+Shift+2。
这类失败发生在浏览器收到扩展 action 之前，未进入视频内容源，不能用改动
视频裁剪或延长采帧超时来解释、解决。新增诊断只记录 Ctrl、Shift、数字 2 的
键码和修饰键状态，不采集其他键入文本；r6 所有页面 frame 均未记录这些事件。

另一类失败与前台变化有关：r4 转入普通桌面框选，OS helper 后续采样显示
前台不再属于测试 Edge。r8 在发送快捷键前即拒绝执行，日志中的前台 Edge
PID 为 42592，测试专用 Edge PID 为 42708。因此已停止连续发送全局输入，
请求一个约 2 分钟的专用前台验收时段；不会向另一个 Edge 进程补发快捷键。

为区分浏览器内容焦点因素，增加可选 HOOK_BROWSER_CONTENT_FOCUS_DIAGNOSTIC
实验，在测试页面临时放置并点击无业务行为的焦点按钮。r7 未取得可播放视频；
r8 记录 document.hasFocus()=true，但在 OS 发送前被上述进程身份检查拒绝。
目前没有该实验能修复入口的证据，未据此修改生产焦点策略。

本段更新只新增验收观测，未构建新产品二进制。前述普通 Ctrl+2 两次通过的
记录仍有效；入口稳定性尚未解决，不能将当前候选改称正式完成版本。

## 后续更新：普通 Ctrl+2 已有真实通过记录，稳定性仍未关闭

新建 Hook 候选 `release/Hook/browser-live-activation-audit-20260908-r1/hook.exe`，
新增原生转发边界日志，仅记录 HWND、PID、请求耗时和 SendInput 事件数量，
不记录页面内容、授权票据或输入文本。没有放宽焦点检查，也没有增加重试注入。

`artifacts/browser-live-activation-shell-r1/summary.json` 首次在不使用诊断回退
的条件下完成普通 Ctrl+2 验收：osCtrl2=true，自动创建贴图、原生窗口可见，
3 轮滚动与切换标签后原直播持续更新；实际视频对象读取 69 次、文档截图 0 次。
原生日志记录请求准备耗时 533 ms、SendInput 成功发送全部 6 个事件。

后续独立运行 r3 再次通过普通 Ctrl+2 和同一组内容保持验收。r2 则仍失败于
选框超时：原生已经发送全部 6 个事件，之后没有视频读取。这将失败边界缩小到
输入发送之后、浏览器选框建立之前；不能再把所有失败归于未构建或失去焦点。
测试现已增加浏览器 action 事件计数和实际快捷键配置记录，以继续定位该边界。

此前 video-source-shell-r6 的日志另有明确 BROWSER_SOURCE_FOCUS_CHANGED
对应提示，与 r2 的发送后超时属于不同证据，不能混为同一个原因。

新 Hook 候选为 0.2.29，8,004,096 字节，SHA-256：
`27e6e4a3502aeea1bda36419f2fed39013548356364707d00bc6c869124dfa91`。
官方本地构建完成并生成 build-provenance.json；headless release smoke 通过。
Rust 转发模块 3 项聚焦测试、cargo fmt、Hook strict 行数检查、git diff
--check 及新增诊断脚本 TypeScript 检查通过。

这些运行证明本方案在实际 Hook、实际 Ctrl+2 和所测 Bilibili 直播间中可以
达到滚动与切换标签后仍更新的目标。入口仍有间歇失败，多路性能、长时稳定性、
其他页面类型和用户日常浏览器加载状态尚未闭环，整体目标保持进行中。

## 已推进的实现

Loom Browser Live 0.1.3 已接入视频元素读取路径：从用户授权的根页面选区解析
同进程 iframe 和相关 OOPIF，固定原视频对象及其内部裁剪区域；滚动后不再
重新按屏幕位置取视频。每个区域独立持有、释放远端对象组，最后一个区域关闭
才释放共享调试连接。无法支持的视频几何条件返回普通文档路径；身份变化或
授权失败不作为成功隐藏。

真实扩展运行暴露了 OOPIF 根节点可能缺席父页面 frame tree 的问题。候选 r2
补充浏览器报告的 parentId、所属父会话以及 DOM.getFrameOwner 所有权验证，
没有开放任意标签页或全局 target 搜索。

## 本次真实验收证据

`artifacts/browser-live-video-source-shell-r5/summary.json` 是一次完整 Hook 窗口
与真实 Bilibili 直播间的运行结果：自动创建 1 个 Live 贴图，无预置贴图；
原选区滚出视口后继续更新，切到另一个标签页后继续更新，往返重复 3 次。
原视频在后台保持未暂停，媒体时间从约 47 秒推进至 73 秒。不同阶段的 PNG
哈希改变，非黑像素检查通过，原生 Hook 窗口保持可见。

运行时记录视频对象读取 65 次，Page.captureScreenshot 为 0 次。因此这次
确实使用了视频内容源。该结果仅证明所测直播间、所测区域及这段运行时间。
没有完成多路性能、长时间稳定性、所有播放器或 DRM 内容验收。

这次测试使用了诊断回退：普通 Ctrl+2 未打开选框，随后向测试专用 Edge
发送 Ctrl+Shift+2 才打开浏览器授权选框。summary 明确记录 osCtrl2=false，
不能将此结果算成用户日常 Ctrl+2 入口通过。

`artifacts/browser-live-video-source-shell-r6` 禁用该回退后再次失败于选框超时，
视频读取次数为 0。其 frontend-evidence.json 确认实际加载的前端包含
activate_browser_live_shortcut 和 trigger-browser-live-capture，尚不足以确认
原生转发未生效的根因。下一步必须追踪原生激活调用及浏览器 action 收到事件
的边界，不能仅增加延迟并宣称修好。

r3 在选框阶段取消；r4 已实际读取 4 帧视频，但 Hook 在断言过程中退出，
没有通过。这些失败证据保留，不能由 r5 的单次成功覆盖。

## 检查与清理

Loom Browser Live 串行测试：90 项，89 通过、0 失败、1 跳过，见
`Loom/.tmp/browser-live-frame-wiring-tests-r2.log`。Hook 诊断脚本和 Loom worker
的聚焦 TypeScript 检查通过。两个仓库的 strict 有效行数检查和 git diff
--check 通过；Loom 仍有 12 个既有 501-700 行例外。

r6 的 taskkill 与退出中的浏览器进程发生竞争，清理脚本即时 CIM 检查报错。
已按完整测试 profile 和 Edge 可执行文件身份补充清理并复核剩余数量为 0。
清理脚本新增有界等待以区别短暂退出状态和真正残留；该等待分支尚未再次
触发实测，不把它当作已通过的产品资源泄漏修复。

## 构建和安装状态

浏览器扩展候选位于
`release/Loom/browser-live-video-source-20260908-r2/extension`，版本 0.1.3，
要求 Chromium 125 或以上。已安装到固定 BrowserLive 扩展目录；本次复核
manifest.json 和 worker.js 与候选文件 SHA-256 一致。个人 Edge 中已运行的
旧 worker 是否重新加载没有验证，不能把磁盘安装等同于用户浏览器已生效。

Hook 验收仍使用 `release/Hook/browser-live-source-audit-20260908-r5/hook.exe`。
本次没有新建 Hook 二进制。前轮 Loom daemon 状态转发修复候选仍未替换日常
运行的 daemon；此限制保留。两个独立仓库均保留原有未提交改动。
