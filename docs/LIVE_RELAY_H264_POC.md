# C1：Windows 连续 H.264 编码 POC

## 目标和当前阶段

2026-10-09 用户明确启动 C1，范围是一源一收、Windows、复用现有授权和连接，保留
raw/JPEG 回退。跟踪 [Loom #91](https://github.com/aiaimimi0920/Loom/issues/91)。

本次先交付独立可运行的硬件编码探针，不自动开启产品 H.264、不捕获用户桌面、不连接
Loom、不退出日常程序。它不是整个 C1 完成，也不是原生双机或物理呈现验收。

当前代码的 `h264` 只是 NLLV codec 预留值。源端实际消费 JPEG，接收端按图片呈现，
Loom 与 Hook 的缓存会跳过旧帧。不能直接把 delta 帧交给这条图片路径，否则任意丢帧
可能破坏解码参考链；在协商与恢复接线完成之前，默认产品路径必须保持 raw/JPEG。

## 第一阶段：独立硬件编码探针

入口：`src-tauri/examples/live_h264_probe.rs`。

```powershell
cd src-tauri
cargo test --locked --example live_h264_probe
cargo build --locked --example live_h264_probe
.\target\debug\examples\live_h264_probe.exe --output C:\absolute\unused-output
```

输出目录必须是未使用的绝对路径。输出只有合成视频及机器可读回执；不读写产品设置。
探针使用现有 Windows Media Foundation API，无新 crate、无嵌入第三方 codec 二进制。

- 只枚举 NV12 → H.264 硬件 MFT，并检查硬件 activation 属性和异步接口。
- 固定 320×240、30 fps，24 个合成灰度 NV12 帧，最多四个输入在途。
- 使用 CPU NV12 输入交给硬件编码器；不是 GPU 采集纹理直送或零拷贝。
- 基线 H.264、低延迟；第 12 号输入显式请求 IDR。
- 轮询异步事件有 20 秒截止时间，单 access unit 上限 1 MiB，全部输出上限 4 MiB。
- 验证输出时序、确有 delta 帧、初始和强制关键帧含 SPS/PPS/IDR。
- 所有样本、锁定缓冲、输出事件、activation、MF/COM 均有正常及错误路径释放。
- 硬件不存在或原生调用失败明确报告失败，绝不偷偷换成软件编码并称为 GPU 成功。

`synthetic.h264` 供独立解码验证，`summary.json` 记录编码器、各 access unit 边界和
时间戳。NAL 检查仅验证结构；必须由独立 decoder 验证完整序列和从强制 IDR 开始的
后半序列。验证工具不是产品依赖，不能把外部工具测试冒充已实现 Hook decoder。

独立解码命令（从 Hook 根目录运行，FFmpeg 使用用户已有的可执行文件，不自动下载）：

```powershell
python scripts/verify-live-h264-probe.py --probe-dir C:\absolute\probe-output `
  --ffmpeg C:\absolute\ffmpeg.exe --output-dir C:\absolute\unused-verification
python scripts/tests/test-live-h264-probe.py
```

验证器限定压缩输入、解码像素和输出帧数，并使用新证据目录、不覆盖文件、30 秒子进程
超时。原生探针调用同样应由父进程施加 35 秒整体超时；内部事件循环的截止时间不能
替代对阻塞原生驱动调用的进程级保护。

### 2026-10-09 首次原生结果

- 本机 `NVIDIA H.264 Encoder MFT` 硬件枚举/激活成功；24 个输入均产生顺序输出。
- 初始和第 12 号输入输出包含 SPS/PPS/IDR，其余序列包含真实 delta 帧。
- 用户已有的 FFmpeg 9.0.1 独立解码：完整序列 24 帧，强制 IDR 后半序列 12 帧；
  两者合成像素最大亮度/色度误差均为 0。
- Rust Annex-B 两项测试、Python 解码器预算/像素判定四项测试通过。
- 结果仅属于合成 CPU NV12 输入的硬件编码；未接 GPU 捕获纹理、网络或产品 decoder。
  编码输出仅是测试资源，不随产品发布，不含用户桌面数据。

## 后续接入顺序与完成条件

1. **原生编码成立**：真实硬件输出可独立解码，强制 IDR 能作为中途加入点；可重建并清理。
2. **GPU 输入接入**：复用捕获设备及 adapter 身份，BGRA→NV12，D3D11 纹理与编码器
   生命周期保持同一所有者；设备失败释放并回到现有路径，不做驱动重置。
3. **协商与连续性**：新增显式能力协商，未协商的端不能接收 H.264；明确 legacy 观看端
   出现时的源端回退策略，不假设 Loom 已有 H.264 转 raw 能力。epoch、重连、尺寸变更、
   丢帧或队列溢出都要丢弃失效参考链，等待新的 SPS/PPS/IDR，不把 delta 当独立图片。
4. **观看端 decoder 与呈现**：有界解码队列，停止/撤销取消与帧释放，旧 generation 输出
   不呈现；decoder/硬件不可用显式回退 JPEG/raw。
5. **一源一收最小链路**：用独立候选验证协商、连续画面、late join、回退和停止。
   不启动旧 A3-P 矩阵，不顺带开发账号或官方中继。

每个阶段独立小改动和聚焦证据。全链路完成前不能把 C1 标为完成或在正式入口默认开启。

## Piik 参考与许可边界

本轮联网读取 Piik 固定提交 `1b9f5bd2a27eb32d35e81e8f2c5d8d6e952bbd0a` 的
`native/capture/windows/h264_encoder.{h,cpp}`、`h264_decoder.h` 与根 `LICENSE`（MIT）。
参考点是 hardware-only MFT、异步事件、关键帧请求、输出有界与 activation 清理。
实现使用现有 Windows SDK Rust bindings 独立编写，未复制 Piik 实质源码或引入其
WebRTC 依赖。本探针不等于 Piik 的 GPU texture 路线，不外推其性能结果。
Windows 系统 codec 的使用不等于 H.264 在所有发行地区的专利许可已经完成审查；正式
分发政策需另行确认，本阶段不捆绑或发布新的 codec 库。
