# LiveRelay IPC 后的 raw 帧搬运优化

## 范围与依据

WebView 消费二进制 IPC 结果时避免一次应用层整帧复制；历史背景见
[Loom #91](https://github.com/aiaimimi0920/Loom/issues/91)。该机制不改变 codec、网络、
权限、轮询频率或续期策略，也不能替代独立性能验收。

当前原生 `read_live_relay_frame` 已将 frame buffer 的 payload 所有权转给二进制
`tauri::ipc::Response`；前端以 Uint8Array 视图接收，不是逐像素 JSON。
这属于现有二进制 IPC 合同，不是逐像素 JSON 转换。

原 raw 路径：IPC 字节 → 分配 `54 + payloadBytes` 的数组 → 复制 BGRA 像素 → Blob。
现在：IPC 字节 → `Blob([54 字节 BMP 头, 原始像素视图])`。
JPEG 继续直接交给 `image/jpeg` Blob。屏幕墙等仍需要连续 BMP 字节的调用方保留
`encodeBgraAsBmp` 接口和字节结果，不扩大到其他渲染管线。

1920×1080 BGRA 每帧可省掉一个 8,294,454 字节应用层临时数组和一次 8,294,400 字节
像素复制；最大允许 raw payload 下省掉一次 64 MiB 像素复制。这是操作/分配数量的
确定性差异，不是 RSS、CPU、帧率或端到端延迟的实测收益。Blob 仍具有浏览器快照语义，
不能称零拷贝；不减少 poll/read 两次 IPC 调用，也不改变 80ms start-to-start 预算。

## Piik 参考

历史设计参考固定于 Piik commit
`1b9f5bd2a27eb32d35e81e8f2c5d8d6e952bbd0a`：

- [output_mailbox.h](https://github.com/TNTcraftHIM/Piik/blob/1b9f5bd2a27eb32d35e81e8f2c5d8d6e952bbd0a/native/capture/windows/output_mailbox.h)：pending 帧有界，generation 与停止状态限制迟到工作。
- [nativecapture/protocol.go](https://github.com/TNTcraftHIM/Piik/blob/1b9f5bd2a27eb32d35e81e8f2c5d8d6e952bbd0a/internal/app/nativecapture/protocol.go)：先校验二进制头与大小，再分配 payload。
- [sender-video-track.ts](https://github.com/TNTcraftHIM/Piik/blob/1b9f5bd2a27eb32d35e81e8f2c5d8d6e952bbd0a/src/client/media/sender-video-track.ts)：有界媒体输入和明确取消/停止所有权。

这些是边界设计参考，不是直接可移植的 Tauri IPC 实现。本改动独立编写，没有复制
Piik 实质源码或引入其依赖；不将其 GPU/H.264/WebRTC 性能外推到 Otter。

## 回归验证与限制

修改此路径应验证 BMP 精确字节、top-down 方向、原像素视图直接入 Blob、backing
buffer 非目标字节不泄漏、Blob 快照不受原数组修改影响、非法尺寸/长度拒绝，
以及单在途、迟到帧、停止、续期、取消和 URL 回收。相关入口为：

- `tests/unit/LiveRelayPresentation.test.ts`：呈现、校验与生命周期回归；
- `scripts/test-live-relay-presentation-browser.mjs`：真实 Chromium 解码与像素验证。

数据先经过身份、epoch、尺寸和长度校验。不得借优化改变 generation、终态、超时或
abort 的 URL 回收路径。浏览器像素验证不等于原生 IPC、物理显示或双机网络验收，
更不能证明 raw 波动/重连根因；历史测试数量与执行回执通过 Git 历史查询。
