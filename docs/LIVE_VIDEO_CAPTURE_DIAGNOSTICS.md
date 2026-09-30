# Live 视频采集诊断指南

普通区域截图、窗口 WGC 捕获和原生贴图呈现是不同的边界。普通截图成功，
或受控视频探针通过，都不能单独证明特定应用的黑屏问题已修复。
当前资源限制见 [GPU 呈现说明](LIVE_GPU_PRESENTATION.md#multi-live-workload-limits)，
同窗口采集复用见 [共享源采集](LIVE_SHARED_SOURCE_CAPTURE.md)。历史优化对比、
失败样本说明及候选版验收记录保留在 Git 历史，不作为当前版本的通过证明。

## 受控视频探针

入口：`scripts/tests/live-browser-video-probe.ts`。使用 Node 22、已安装的
Playwright、Chrome 或 Edge、ffmpeg 和 Rust 工具链。在 Hook 根目录运行：

```powershell
node --experimental-strip-types scripts/tests/live-browser-video-probe.ts

cmd /d /c "set HOOK_BROWSER_VIDEO_CHANNEL=msedge&& node --experimental-strip-types scripts/tests/live-browser-video-probe.ts"
```

探针生成自己的 640x360 / 60 FPS / H.264 非加密视频，以仅监听回环地址的
HTTP 服务播放。浏览器使用独立临时 profile，不读取个人浏览器数据，也不
模拟全局输入。关闭 Playwright 默认的“禁止窗口遮挡后节流”开关，以免
掩盖真实浏览器行为。CDP 必须确认平台硬件解码器且视频帧持续推进。

原生测试调用生产 Live capture worker，验证窗口相对裁剪下的四个阶段：

1. JPEG 路径。
2. GPU 贴图放在源窗口旁边。
3. GPU 贴图覆盖源窗口。
4. 给独立原生合成宿主增加 tao 使用的 DWM 透明配置。

除了非黑像素，还检查视频测试图的颜色变化、两个时刻的帧内容变化、
JPEG/GPU 计数推进和呈现状态。GPU 阶段额外通过普通区域截图路径保存桌面
中心区域的样本，记录实际后端，并检查测试图颜色，不能只判断“不是黑色”。
采样区域仅按测试自有窗口定位，但透明宿主、外部遮挡或桌面采样异常可能
带入其下方的其他内容。只应在不含私人内容的受控桌面执行该桌面探针，
失败样本不得随发行包传播。浏览器和原生窗口在结束后关闭。

输出在 `artifacts/live-browser-video-*`：`browser.json`、`native-summary.json`、
`native.log` 和各阶段 PNG。目录还包含测试 profile 和生成的视频，不能将
整个诊断目录直接当作发行包发布。

### 四路视频预算探针

```powershell
cmd /d /c "set HOOK_BROWSER_VIDEO_MULTI=1&& node --experimental-strip-types scripts/tests/live-browser-video-probe.ts"
```

该模式仍验证 Chrome/Edge 平台硬件解码，但启动四个真实生产 worker 和四个
不同裁剪区域。依次覆盖 JPEG、GPU、原生停用后的 JPEG、隐藏三路、恢复及
关闭一个会话，检查每路更新、尺寸、颜色、全局 CPU 许可次数和最终清理。
它只保存自有源的保留 GPU 纹理，不调用桌面区域采样，也不使用全局键鼠。
GPU 提交数不是显示 FPS；调度预算通过不代表整个电脑的 CPU/GPU 使用率
已有实测上限，也不代替打包后真实 Unit 的布局、点击和快捷键验收。

## 时间指标与结果解释

保留纹理中的视频测试图和帧计数只能证明采集数据。桌面是否真正显示视频
必须由独立桌面采样确认；独立探针通过也不等于用户实际视频应用通过验收。

指标在测试构建中将 QPC 与 WGC `SystemRelativeTime` 相减，采样数有上限。
它是相对合成器时间戳的偏差，不是视频解码到显示器的端到端延迟，也不是
显示器真实 FPS。GPU 路径可出现少量负值，不能解释为“负延迟”。该时钟的
定义见 [Microsoft SystemRelativeTime 文档](https://learn.microsoft.com/en-us/uwp/api/windows.graphics.capture.direct3d11captureframe.systemrelativetime)。

## 验证边界与后续定位

- 探针没有完整复制 Hook 的 WebView、输入遮罩、全屏宿主和用户会话状态。
  独立原生宿主使用 `WS_EX_NOREDIRECTIONBITMAP`，避免测试用 STATIC 窗口
  自己的白色背景覆盖合成视觉。这个测试宿主修正没有应用到生产 Hook 窗口。
- 纯白也能通过“非黑”判断，因此必须检查测试图颜色与实际截图后端，
  不能只用非黑像素证明桌面呈现成功。独立宿主验收不代替生产 Hook UI 验收。
- 桌面采样先检查区域完全位于单一可见显示器内，再按实际 DPI 转换到普通
  截图的逻辑坐标。它仍受遮挡及驱动行为影响，不能把环境失败当作产品黑屏。
- 本探针不覆盖 DRM、HDR、独立播放器的专用视频平面，也不是全面卡顿门禁。
- 需要实际出问题的程序名称、视频页面或本地文件类型，才可继续缩小黑块边界。
  不需要提供登录凭据、Cookie 或包含隐私的完整浏览器日志。

可在退出旧 Hook 后，仅对新进程设置 `HOOK_LIVE_GPU_PREVIEW=0`，比较同一
视频在 JPEG 与 GPU 模式下是否均黑。这只是区分采集和呈现故障的诊断方法，
不是已验证的黑屏修复，也不建议关闭系统或浏览器的硬件加速作为永久方案。
