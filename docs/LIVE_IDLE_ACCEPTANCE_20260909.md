# 2026-09-09 空闲时段真实验收

本次在用户提供的空闲时段实际运行了 Hook、Edge 和 Bilibili 直播间。
最新候选在所测场景中连续两次通过普通 Ctrl+2 验收：滚动页面以及切换到
其他标签页后，Live 贴图仍显示原直播画面，并持续更新。

## 找到此前部分验收失败的原因

此前将前台变化主要归因于外部窗口切换，证据不足。今天进一步确认，Edge
会在新建测试 profile 中自动登录 Windows 账户，弹出无标题的同步提示窗口。
提示窗口与直播窗口属于同一个 Edge PID。旧测试 helper 只验证 PID，因此
可能向同步提示窗口发送 Ctrl+2；Hook 随后也向该窗口转发快捷键，浏览器
扩展 action 根本没有触发。这解释了已发送 6/6 个事件却没有选框的一类失败。

具体证据在 `artifacts/browser-live-idle-acceptance-20260909-r3/os-shortcut.log`：
前台 HWND 与直播主窗口 HWND 不同，标题为空；r7 保存的测试窗口截图确认
它是 Edge 同步提示。此类失败不应归咎于用户操作，也不能证明视频内容源失效。

已修复验收脚本：发送前同时验证测试进程和确切主窗口句柄，防止同进程其他
窗口误收快捷键；测试专用 Edge 使用 --disable-sync 和
--disable-features=msImplicitSignin，避免新 profile 自动登录弹窗干扰。
后续两个独立 profile 的 account_info 数量均为 0。没有修改用户日常 Edge
的登录、同步设置或系统策略。

## 两次完整通过的证据

- `artifacts/browser-live-idle-acceptance-20260909-r8/summary.json`：普通 Ctrl+2，
  无 Ctrl+Shift+2 诊断回退、无测试焦点按钮；原生窗口可见；视频对象读取
  69 次，文档截图 0 次。
- `artifacts/browser-live-idle-acceptance-20260909-r9/summary.json`：同样入口与
  条件再次通过；视频对象读取 68 次，文档截图 0 次。

两次都自动创建 Live 贴图，无预置贴图。页面滚动约 905 CSS 像素后，原视频
区域底部位于视口上方约 300 CSS 像素，贴图仍更新。切到另一标签页后，原
视频所在文档报告 hidden=true、paused=false；媒体时间继续推进。每次均
重复 3 轮滚动和标签切换，保存的帧哈希改变，黑屏与错误标签画面检查通过。
人工查看了后台阶段的保存图像，确认包含实际游戏直播画面。

较早 r1、r3 未打开选框，r5、r7 被窗口身份检查拒绝，失败记录均保留；r2
使用过诊断焦点按钮，不计入上述两次无诊断回退结果。r4、r6 也通过，但本报告
以消除自动登录干扰之后的 r8、r9 作为最新证据。

## 版本、检查与边界

本次测试的 Hook 是
`release/Hook/browser-live-activation-audit-20260908-r1/hook.exe`，
扩展是 `release/Loom/browser-live-video-source-20260908-r3/extension`。
已复核固定安装目录中的 manifest.json、worker.js 与 r3 候选哈希一致。
本次修改均为验收脚本，没有重建或冒充发布新的产品二进制。

两个修改过的 TypeScript 诊断入口类型检查通过；PowerShell helper 在真实
运行中完成编译执行；Hook strict 行数检查和 git diff --check 通过。

本次证明的是实际 Bilibili 直播间、实际 Ctrl+2 入口及测试时段内的内容保持。
没有据此宣布任意网页、任意播放器、长期多路运行全部完成，也没有将测试
profile 成功等同于用户日常 Edge 已重新加载新扩展。整体开发目标尚未标记完成。
