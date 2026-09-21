# 用户实际运行路径核查

本记录已转为历史记录：用户已撤销滚动或切换标签后保持原网页内容的需求。
不再要求加载扩展或继续此项验收，见 [范围收敛决定](LIVE_SCOPE_DECISION_20260909.md)。

最新复核：日常 Default、Profile 1 仍未注册 Browser Live 扩展。已明确请求用户
在日常 Edge 中加载固定目录并确认扩展已启用。该接入条件连续三个回合仍未
解除，自动接入尝试未成功；代码修正与候选构建已完成，当前暂停等待这一
实际浏览器状态改变。未将任务标记为完成。

这次你的反馈是对的。实际日志已经证明，你获得的是窗口 Live 截图，没有进入
固定网页内容的路径。我此前在独立测试 profile 中通过验收，却没有完成你日常
Edge profile 的接入验证，这是我的交付漏项。

## 当前证据

读取 `%LOCALAPPDATA%\Hook\logs\hook-runtime.log` 的最近一次用户运行记录：

- 实际启动的是 `release/Hook/browser-live-activation-audit-20260908-r1/hook.exe`，
  版本 0.2.29。因此不能将这次失败归因于你运行了旧 Hook。
- 日志明确出现 `live_capture_source_bound :: source=window width=997 height=682`。
  窗口 Live 会随网页视口滚动，不能满足你的需求。
- 网页入口多次报框选超时或导入仍在进行，随后又有普通桌面框选入口触发。

读取日常 Edge 的 Default 和 Profile 1 扩展注册信息，没有找到 Browser Live
扩展 ID `gmhnbbhnghdgaomkjlnhaoggdllclkoa`，也没有匹配 Loom Browser Live 名称
或固定安装目录的其他扩展注册。日常 Edge 使用默认 user-data-dir。

`%LOCALAPPDATA%\Neuro\BrowserLive\extension` 下存在 0.1.3 文件，仅说明扩展
文件已经放到磁盘。此前测试用 --load-extension 在专用 profile 中加载它，
这不会自动在你的日常 profile 中安装扩展。此前把固定目录文件更新表述为
已安装，没有清楚说明这一差别，导致你拿到的实际运行环境没有接通。

## 需要完成的日常 Edge 接入

1. 在你平时打开直播间的 Edge profile 中打开 `edge://extensions/`。
2. 开启“开发人员模式”，点击“加载解压缩的扩展”。
3. 选择 `C:\Users\vmjcv\AppData\Local\Neuro\BrowserLive\extension`。
4. 确认出现 Loom Browser Live，版本 0.1.3，处于启用状态。
5. 在 `edge://extensions/shortcuts` 确认该扩展操作绑定 Ctrl+Shift+2。
   用户日常入口仍是 Hook 的 Ctrl+2，由 Hook 转发浏览器授权操作。

本次已尝试打开日常 Edge 扩展管理并执行受前台校验保护的操作，但窗口焦点
在工具调用之间改变，因此没有继续向不确定的窗口发送输入，也没有编辑受保护
的 Edge Preferences 或系统策略。上述加载步骤尚未完成，不能再宣称用户环境
已修好。

完成加载后，要直接在这个日常 profile 中验收：按 Ctrl+2 框选直播画面，检查
新日志为 browser_document 内容源，再滚动及切换标签。若仍出现 source=window，
即使贴图可见也应判失败；不能用另一份专用测试 profile 的成功替代。

## 后续修正：防止等待中的网页任务误入窗口截图

已经修正原生快捷键请求的生命周期。此前激活浏览器快捷键时立即删除请求
记录，而前端还在等待网页框选；这时若焦点变化并再次按 Ctrl+2，原生层就可能
开启普通窗口截图。现在保留请求记录直到前端结束或取消，并在检查前台应用
之前拦截重复触发。激活只允许一次，不会重复注入按键；请求仍有 30 秒有效期。

4 项聚焦 Rust 测试通过，包括激活后请求仍保留、其他票据不能消费请求以及
同一请求不能重放输入。cargo fmt、strict 行数检查和 git diff --check 通过。
新候选已完成官方本地构建及 headless 发布检查：

`release/Hook/browser-live-reservation-20260909-r1/hook.exe`

版本 0.2.29，8,004,608 字节，SHA-256：
`d33600629ea445c92e4d866b979aad35b350a31ef044924178104c019b92a80b`。

这项修正防止“网页请求尚在等待，另一次操作却创建窗口源”的混淆，不会凭空
安装浏览器扩展。日常 Edge 扩展接入尚未确认完成，真实网页内容保持验收仍未
闭环；本次没有把 headless 检查作为用户场景通过证据。
