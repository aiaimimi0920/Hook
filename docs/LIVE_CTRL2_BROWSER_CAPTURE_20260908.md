# Ctrl+2 网页固定区域：实现、实机通过证据与限制

## 当前状态

**这轮已经修改生产代码并编译候选，不再只是给出诊断报告。**
改变的是用户实际使用的 Ctrl+2 入口，而不是再增加一个必须手动寻找的命令。

**2026-09-08：已获得一轮真实 Hook EXE + OS Ctrl+2 + B 站直播的完整通过结果。**
不是独立浏览器截图原语，也不是旧命令面板或测试种子贴图。
本次运行证明：正常入口创建后，滚动离开原区域与切换标签都能继续显示原直播。
这不等同于所有浏览器、所有页面或连续稳定性验收全部通过。

### 实机证据：browser-live-ctrl2-shell-r9

- 测试脚本退出码 0，`phase.json` 为 `passed`，`summary.json` 为完整 Hook 验收。
- 空画布通过系统 Ctrl+2 调出真实网页框选，可信指针拖选 320 x 180 区域，
  自动创建恰好 1 个浏览器 Live Unit，不需要种子贴图或二次导入。
- 原页面滚动 905.33 CSS 像素，原区域底部为 -300.33，已完全离开视口；
  Hook Live 解码后的图像仍更新，非黑像素为 56,823 / 57,600。
- 激活另一个红色标签后，原页面 `hidden=true`，视频 `paused=false`；
  两次 Hook Live 图像哈希不同，非黑像素分别为 56,818、56,689。
- 已实际查看 `live-scrolled.png` 与 `live-hidden-2.png`，仍是原直播画面，
  可见主持人姿态变化，不是红色新标签、全黑画面或固定快照。
- 证据目录：`Hook/artifacts/browser-live-ctrl2-shell-r9`。

### 未掩盖的失败与限制

r1/r2/r4/r5/r6 在发送快捷键前被精确前台进程检查拒绝；r3 测试 minimize
命令被 ACL 拒绝，已改用已有 `hide_to_tray`，未放宽应用权限。
r7/r8 成功调出框选但没有完成创建；r8 扩展返回 `BROWSER_SELECTION_CANCELLED`，
Hook 一直等不到有效选区。r9 加入只读指针、滚动、可见性和桥接状态诊断后通过，
没有修改生产代码，因此不能声称已定位并修复前两次取消的根因。
后续 r10 复跑未取得测试浏览器前台焦点，未进入产品断言；它不算第二次通过。
本报告只声称一轮完整产品通过，不声称连续多轮稳定通过。

## 这次接通的真实入口

在已启用配套扩展的 Edge 页面中：

```text
Ctrl+2
  -> Hook 识别当前前台 Edge 窗口，保持浏览器前台，不启动窗口像素框选
  -> 准备已受信任的 Loom browser-live 提供方，记录新选区游标
  -> 将这次快捷键操作转交给浏览器扩展的 Ctrl+Shift+2 action
  -> 浏览器取得 activeTab，显示原网页上的区域框选
  -> 用户只框选一次
  -> 原标签 / 原文档 / 原区域的真实 grant 返回 Hook
  -> 自动创建普通 Unit 体系中的 Live 贴图
```

不需要先创建普通贴图，不需要 Ctrl+Shift+P，不需要另点扩展按钮，也不需要
返回执行第二次导入。原有网页命令仍可作为显式入口使用。

非 Edge 程序的 Ctrl+2 保持原生窗口 Live 逻辑；本候选没有声称已经适配所有浏览器。
Edge 分支授权失败时不会静默降级成随当前窗口变化的截图。

### 为什么没有绕过浏览器权限

Hook 没有从 HWND 猜 tab ID，没有给网页注入任意脚本，没有伪造 `browserGrantId`。
它只转交用户发起的键盘操作，后续仍由浏览器自身的 action 和真实框选发放授权。
扩展权限仍为 `activeTab / scripting / debugger / nativeMessaging`，没有新增站点权限。

浏览器权限边界的独立实测使用新建、未登录的 Edge profile：

- 转交快捷键前，扩展读取该 B 站页面的权限为 **false**。
- 发送实际 OS `Ctrl+Shift+2` 后，浏览器发放的权限为 **true**。
- 浏览器实际注册的命令是 `_execute_action: Ctrl+Shift+2`。
- 该独立探针没有执行 Hook 的服务准备，因此 action 后记录了
  `BROWSER_NATIVE_DISCONNECTED`，**没有把它记作生产框选或 Hook 验收通过**。

记录位于 `artifacts/browser-live-action-shortcut-20260908-r2/summary.json`。
完整测试仍要求真正的 Hook 准备、浏览器框选和 Live 图像全部成功。

### 取消、目标和资源边界

- 原生一次性 ticket 绑定窗口句柄和进程 ID，30 秒过期；窗口焦点改变就拒绝转交。
- 转交前等用户松开 Ctrl+2 等按键，不强行释放用户正在按住的键；注入失败清理本批按键。
- 服务准备失败或取消会清理未消费的 ticket，不让后续重试白等 30 秒。
- 每次新截图预留一个全新的 Unit ID；浏览器 Live 最终使用该 ID 创建 Unit，
  不生成伪贴图作为授权垫片。等待期间有碰撞、取消或提供方变更就拒绝继续。
- 浏览器文档身份、原区域、15 秒会话 lease、导航撤销和最后消费者释放仍走原实现。
- 通知沿用最后一个贴图中的标准通知；没有贴图时不创建屏幕中央模态弹窗。

## 已构建的交付物

### Hook

`<hook-repo-root>\..\release\Hook\browser-live-ctrl2-20260908-r2\hook.exe`

- 产品版本：0.2.29；本地开发候选，非正式签名发布。
- 大小：8,003,072 字节。
- SHA-256：`23b036132cdc4524f64bc45081667c3cb214680e78c6e080f70e47f48a1c0ee6`。
- 同目录 `build-provenance.json` 的大小和哈希已重新核对。
- 编译成功；该 EXE 的 headless 自检通过，记录在
  `artifacts/browser-ctrl2-headless-r2/headless-summary.json`。
- 尚未替换正在运行的旧进程。

### Loom 浏览器扩展

`<hook-repo-root>\..\release\Loom\browser-live-ctrl2-20260908-r3\extension`

- 扩展版本：0.1.1，增加浏览器 action 快捷键。
- 已更新到原固定安装路径
  `C:\Users\vmjcv\AppData\Local\Neuro\BrowserLive\extension`，保留原扩展身份及 native host 注册。
- 旧文件备份在候选的 `previous-installed-extension` 中；没有改写用户浏览器 profile。
- **日常 Edge 中已加载的扩展仍需重新加载才能激活新 manifest。** 请在
  `edge://extensions` 确认 Loom Browser Live 已启用并重新加载；
  `edge://extensions/shortcuts` 中应有 `Ctrl+Shift+2`。
- 本次没有修改 Loom 主程序或 browser-live 运行时协议实现，未重启 Loom。
- 初次 r1 安装遇到 PowerShell 空字符串与 CLR null 的差异，已修复更新脚本；
  失败时两个旧文件均已恢复并核对哈希，失败备份没有删除。

## 已完成的代码验证

- Hook：6 个聚焦测试文件、29 项测试通过，覆盖无初始贴图、新 Unit 身份、
  碰撞、并发、取消、失败不降级及原有 browser backend 行为。
- Rust：新增原生快捷键模块的 3 项测试通过；实际构建完成编译验证。
- 生产与测试 TypeScript 检查通过，相关 ESLint 和严格有效行数检查通过。
- 浏览器真实 OS 快捷键授权边界实测完成；相关测试 Edge 进程已清理为 0。
- Loom 依赖安全契约和真实 OSV 扫描通过；未新增依赖或权限。
- Loom browser-live 完整串行测试复跑：70 项，69 通过、0 失败、1 跳过，
  记录为 `Loom/.tmp/browser-ctrl2-final-tests-r2.log`。首次运行的 Windows ACL
  测试超时失败记录保留，没有放宽安全断言；构建结束后复跑通过。
- Hook 严格有效行数检查覆盖 1137 个文件，没有超过 500 行的文件。
- Hook 与 Loom 分别执行 `git diff --check`，均返回 0；工作区分别有
  279、127 项既有及本轮未提交改动，未回退、暂存或提交其他人的修改。
- 再次核对已安装扩展的 manifest 与 worker，均与 r3 交付文件哈希一致，
  manifest 版本为 0.1.1；这不代表日常浏览器已重新加载扩展。

### 当前继续验收所需条件

旧 Hook 已退出，不需要用户再次退出。测试脚本现在可以有界等待 60 秒，
让用户点击独立 B 站测试窗口取得系统前台焦点；随后仍会复查精确进程身份
和用户按键状态，再发送真实 Ctrl+2，不移除输入安全检查。
最近一轮等待已超时，测试窗口已关闭；需要约定用户在场后重新运行。
此次仅修改验收脚本，生产候选仍为上面的 r2，没有伪造新的产品构建。
测试后重新核对：Hook 进程数为 0，上述测试 profile 对应的 Edge 根进程数为 0。
修改后的完整验收脚本 TypeScript 与 ESLint 检查通过；两个独立仓库的
`git diff --check` 均通过。r4 曾在进程自然退出时出现 taskkill 清理竞争报错，
后续独立进程核对未发现这些测试浏览器残留，失败记录仍保留。

静态检查与单元测试不替代产品实机验收；本轮产品证据单独记录在上面的 r9 段落。

## 产品验收脚本与复跑方法

已新增 `scripts/tests/browser-live-ctrl2-shell-probe.ts`，通过原生候选测试脚本调用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\tests\Invoke-BrowserLiveShellProbe.ps1 `
  -HookExe ..\release\Hook\browser-live-ctrl2-20260908-r2\hook.exe `
  -OutputRoot <hook-repo-root>\artifacts\browser-live-ctrl2-shell-r11 `
  -BrowserCtrl2
```

脚本必须在当前 Hook 正常退出后才能运行。它不重命名单实例锁、不杀用户进程、
不把旧 Hook 的运行结果当作新候选验收。

判据是：

1. 空画布，不创建种子贴图，不执行旧命令面板导入。
2. 在真实 B 站直播中发送 OS Ctrl+2，必须出现浏览器提供方的实际框选。
3. 一次拖选后自动出现恰好一个浏览器 Live Unit，检查实际解码图像。
4. 把原播放器区域滚出视口，断言原区域底部已小于零，Live 图像继续变化。
5. 切到红色的另一个真实标签，断言原文档 `hidden=true`，Live 仍显示更新的原直播，
   不能全黑、变成新标签或冻结在旧图。
6. 测试结束释放测试 Hook、测试 Edge 及其隔离 profile 进程。

测试从真实系统快捷键和实际编译 EXE 出发，不通过 `Extensions.triggerAction`
代替 Ctrl+2。滚动阶段使用实际文档滚动并检查几何；拖选由浏览器自动化的可信
指针事件完成，不冒充全程由人手操作。

## 明确不扩大承诺

网页提供方目前仍是只读、约 2 FPS；这轮没有把它宣称为 30/60 FPS 视频通路，
也没有声称网页按钮输入、任意浏览器、DRM、DOM 被移除或页面冻结都已解决。
这轮的验收目标是用户当前要求的“通过正常入口创建后，滚动和切换标签仍保持原内容”。
这两个固定源行为已有上述实机成功证据；选区取消的间歇性原因和长期稳定性
仍需后续调查，不将一次成功扩大为正式发布的全部质量保证。
