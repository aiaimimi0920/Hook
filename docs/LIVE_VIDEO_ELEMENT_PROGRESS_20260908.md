# Live 视频内容源：超时复现与元素读取原型

后续接线与真实 Hook 验收结果见 [最新进展](LIVE_VIDEO_FRAME_INTEGRATION_20260908.md)。
下文保留原型阶段记录，不代表当前接线状态。

## 当前结论

两项最终需求仍未关闭，尚未发布一个可宣称解决问题的新 Hook 版本。
本轮不再把框选阶段失败、独立浏览器测试或单次成功当作产品完成。

取得的实质进展是：独立复现生产文档截图路径的超时，并实现、实测了一条
绕过页面合成截图、固定原视频元素内容的读取原型。

## 旧路径：真实复现超时

`scripts/tests/bilibili-video-boundary-probe.ts` 现在直接调用 Loom 生产
`documentBinding.ts`，保留其文档身份检查、取消、关闭和默认 5 秒超时。
测试使用独立 Edge profile、真实 `https://live.bilibili.com/6`，不发送全局快捷键，
不使用个人浏览器登录态。它不是 Hook Ctrl+2 验收。

- `artifacts/bilibili-production-binding-20260908-r1`：12 帧，单帧读取
  229-2575 ms，中位数约 336 ms；滚动、切换标签期间原视频继续播放。
- `artifacts/bilibili-production-binding-20260908-r2`：增加后台连续采样后，
  直接在生产绑定代码中触发 `BROWSER_CAPTURE_TIMEOUT`，记录在 failure.json。

这证明文档采集链路本身能够超时，不只是 Hook UI 或成功状态包装的问题。
现有 Loom 提供方另有 4 秒总操作边界，Hook/桥接有 5 秒边界。没有延长这些
时间、删除清理机制或把超时帧当成功帧。该独立复现不能追溯证明此前 r9 的
具体异常，但提供了同类失败的真实、可定位证据。

## 新原型：固定 video 元素及其内部裁剪区域

新增 `Loom/capability-packages/browser-live/extension/videoElementReader.ts`：

- 初始时把选区换算为视频内部的归一化裁剪区域，之后不再随页面滚动坐标改变。
- 保留同一个视频元素，不在切换标签、页面重排时重新查找或猜测另一个播放器。
- 复用一个离屏 canvas 读取视频像素，而不是每帧调用 Page.captureScreenshot。
- 元素移除、currentSrc 改变、像素不可读时明确失败，不返回旧画面冒充实时画面。
- 关闭时清零画布尺寸；测试侧还关闭并释放页面对象句柄与独立浏览器。
- 对多个重叠候选、边框/内边距、不支持的 object-fit/position/transform 和
  letterbox 区域保守返回不支持，不猜测裁剪结果。

原型不绕过 canvas 的 origin-clean 限制，也不承诺 DRM/受保护视频支持。
它不包含播放控制输入映射，不应直接替换含 UI 控件的普通网页 Live 路径。

### iframe 是正式接入的必要部分

第一次、第二次原型运行明确失败为选中视频不在主文档：主文档 video 数量为 0，
实际播放器位于 iframe 中。证据：
`artifacts/bilibili-video-reader-20260908-r2/video-geometry.json`。

第三次测试通过精确找到视频所属 frame、换算其局部坐标，在那个 frame 中创建
读取器。此步骤目前由 Playwright 测试工具执行，**不是已经完成的浏览器扩展授权实现**。
正式接入必须由已授权的 tab/选区定位对应 frame，并正确管理远程对象、frame
导航、跨进程 iframe 和关闭；不能把测试工具的定位能力冒充产品能力。
远程对象需显式释放的协议约束见
[Chrome DevTools Runtime 文档](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/)。

## 新原型实测

证据目录：`artifacts/bilibili-video-reader-20260908-r3`。

- 同一个真实直播间；原区域滚动离开视口，随后三轮滚动/切换标签。
- 额外执行 20 次后台采样，按 500 ms 目标间隔串行读取，不堆积并发请求。
- 共 32 帧，其中 25 帧在原 frame 处于 hidden 时采样；32 个图像哈希各不相同。
- 原视频所有采样点未暂停，媒体时间从约 19.40 秒推进到 52.30 秒。
- 单帧读取耗时约 23-62 ms，中位数约 29 ms。
- 已人工查看最后一帧 `cadence-19-document.png`，显示真实直播游戏画面。

以上耗时是不同运行轮次的观察值，不是同负载严格 A/B 性能倍率，也不是
30/60 FPS、长时间稳定性或多 Live 资源上限的证明。

## 验证与交付边界

新增聚焦回归覆盖裁剪固定、滚动/重排、分辨率变化、源替换、断开元素、
不可读取像素、不支持几何以及幂等关闭；3 项通过。TypeScript 检查通过。
Loom 严格行数门禁通过：1008 文件，仍是 12 个已有例外，没有新增例外。
Hook 严格行数门禁通过：1137 文件，没有超过 500 有效行的文件；两仓库各自
`git diff --check` 通过，修改文件保持 UTF-8 无 BOM。

完整 browser-live 测试第一次并发执行为 66 通过、6 失败、1 跳过，失败集中在
Windows 私有目录/ACL 子进程测试，原始日志保留为
`Loom/.tmp/browser-live-video-reader-tests.log`。未放宽权限检查或修改这些测试。
随后串行运行完整测试为 72 通过、0 失败、1 跳过，日志为
`Loom/.tmp/browser-live-video-reader-tests-serial.log`。这不是并发测试已通过的结论。

本轮没有把原型接到 shipping worker，因此没有把未生效代码打成一个所谓修复版。
此前 r5 Hook 与 daemon 状态修复组件候选的发布状态没有改变。
原生 r14 因按住输入的安全检查退出；r15 未完成框选，不能算通过。
相关 Hook、独立 Edge/WebView2/Node 测试进程结束后已核对没有残留。

## 接下来必须完成

1. 将已授权文档选区安全映射到具体视频所属 frame，不能只查询主文档。
2. 接入元素读取器的对象句柄、单次请求超时、源失效及释放生命周期。
3. 保持普通网页区域和带控件区域的原语义，不能无提示丢掉 UI。
4. 构建并部署到真实 Hook/Loom/扩展入口，再走 Ctrl+2 完整原生验收。
5. 在用户实际直播间验证滚动、切换标签、持续更新和多贴图资源回收。
