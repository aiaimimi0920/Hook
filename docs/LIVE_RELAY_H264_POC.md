# C1：Windows 连续 H.264 编码 POC

## 目标和当前阶段

2026-10-09 用户明确启动 C1，范围是一源一收、Windows、复用现有授权和连接，保留
raw/JPEG 回退。跟踪 [Loom #91](https://github.com/aiaimimi0920/Loom/issues/91)。

本次先交付独立可运行的硬件编码探针，不自动开启产品 H.264、不捕获用户桌面、不连接
Loom、不退出日常程序。它不是整个 C1 完成，也不是原生双机或物理呈现验收。

Hook 产品 worker 当前仍消费 JPEG，接收端按图片呈现；Loom 已有独立 H.264 连续性和协商
增量，Hook 的图片缓存仍会跳过旧帧。不能直接把 delta 帧交给这条图片路径，否则任意丢帧
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

### GPU 纹理输入增量

在上述探针命令末尾增加 `--gpu`，启用独立 D3D11 合成输入；省略该参数仍运行原 CPU
NV12 对照。两种模式均使用同一独立解码验证器，验证器按报告中的输入类型选择像素合同。

- 创建首个非软件 DXGI adapter 的视频设备，启用 BGRA/video support 和多线程保护。
  用该 adapter 的 LUID 限定硬件 MFT，要求 D3D11-aware，并绑定 DXGI device manager。
  当前不尝试遍历其他硬件 adapter；首个 adapter 不支持时明确失败，不偷偷回退 CPU。
- GPU 清屏生成 24 个 BGRA 灰度画面，经 D3D11 video processor 从 full-range RGB 转
  BT.709 limited-range NV12，再用 DXGI surface buffer 送入硬件编码器；没有像素 CPU
  readback。每帧分配独立纹理，MF sample 持有其引用，不覆盖仍在使用的异步输入。
- 固定 24 帧、最多四个尚未产生输出的输入；这是有界 POC，不是长期运行纹理池。
  未引入 crate、软件编码器或额外 codec 库。
- 首次原生 GPU 合成结果：NVIDIA H.264 Encoder MFT；完整 24 帧和强制 IDR 后 12 帧
  独立解码通过，最大亮度误差 1、色度误差 0（允许误差仍为 4，未放宽原合同）。
- `gpuTextureInput=true` 只代表 GPU 合成纹理输入；`gpuCaptureZeroCopy=false` 和
  `liveRelayIntegrated=false` 保持不变。灰度夹具不证明彩色/HDR 转换正确性或 30 fps 性能。

捕获接入边界已确认：`src-tauri/src/live_gpu/frame.rs::GpuFrame` 持有 texture/device/context，
复制纹理允许复用，不能将可变捕获纹理直接交给异步编码器。本增量不改该 owner；后续接入
必须使用捕获设备的 adapter 身份，并在捕获锁内完成独立输入拷贝或取得明确的纹理租约。

### WGC 捕获与持续编码 owner 增量

`src-tauri/src/live_video/` 提供同线程的连续 `Encoder` 和单源 `capture::Subscription`。
现有 `live_frame_handoff` 在 WGC 回调生命周期内复制独立 BGRA 纹理到一个 latest-only
原始帧槽；只允许丢尚未编码的输入，不通过 JPEG 帧缓存搬运 H.264 access unit。
捕获 reset 清槽并递增 generation，终止不可逆；编码错误或取消后必须销毁 encoder，
不能继续使用失效参考链。COM/MF owner 不可跨线程移动，销毁时先 flush/释放 MFT。

`GpuFrameConsumer` 与 JPEG 的 `EncodedFrameConsumer` 分开：GPU 需求保持隐藏源采集，
但不授予隐藏源 CPU/JPEG admission。释放需求或退出仍使用现有捕获预算的注册身份。
当前编码边界为偶数尺寸、单帧不超过 8,294,400 像素、每边不超过 4096、1..60 fps；
不支持尺寸/设备/驱动时返回明确错误，后续 relay 接线必须选择 JPEG/raw 回退。

原生测试入口 `live_gpu::native_tests::video_capture_tests::native_wgc_continuous_h264_and_stop`
通过真实产品 capture worker 采集自有 HWND（320×240 ROI），不读取其他应用像素：
24 个连续输出与强制 IDR 后 12 帧独立解码通过，亮度误差 1、色度误差 0；停止后 GPU
订阅清空且拒绝取帧。测试 oracle 为选择准确的夹具帧做 readback；编码路径本身不做
readback。它不是网络一源一收或 GPU 呈现验收。该测试默认 ignored，需要显式新目录：

```powershell
$env:HOOK_C1_NATIVE_OUTPUT = 'C:\absolute\unused-wgc-output'
cargo test --locked --lib native_wgc_continuous_h264_and_stop -- --ignored --nocapture --test-threads=1
```

正常 relay worker 尚未申请 H.264 订阅，产品默认仍为 JPEG/raw。Loom 已实现显式 profile、
按序投递、关键帧控制和旧端/墙兼容需求；Hook 产品接线及一源一收仍待完成。
不能将内部 owner 的独立验证记为整个 C1 完成。

### Windows MF decoder owner 增量

`src-tauri/src/live_video/decoder.rs` 提供连接线程持有的持续 decoder，复用现有 COM/MF
生命周期；不引入 crate 或捆绑 codec。它使用 Windows 注册的同步 H.264→NV12 MFT，
再将 limited-range BT.709 NV12 转为 BGRA，供后续接入已有 IPC/图片呈现路径。
**这不是 GPU 解码、零拷贝呈现，也尚未让产品 viewer 自动 offer H.264。**

- 一进程最多一个 decoder，最多四个未输出输入；基线 8-bit 4:2:0、逐行、最多四个参考
  图像、coded surface 至多 8,294,400 像素。额外 viewer 或不支持的类型必须回退图片。
- `decode_bounds.rs` 在调用原生 decoder 之前解析 SPS 的真实 coded/cropped 尺寸和引用
  预算，与 wire 尺寸比对；限制 SPS/PPS、Exp-Golomb、HRD 和 VUI decoded-picture budget。
  不把声明的 width/height 当作 decoder 分配证明。
- C1 是固定 sRGB 原始值、BT.709 limited-range YUV 合同；缺失 VUI 或标准 unspecified
  值继承该合同，不按分辨率猜 BT.601。显式冲突/HDR/保留 transfer=0 均拒绝；MF 输出
  属性若明确宣告不同色彩合同也拒绝。四引用及四个 pending 输入不是 MF 内部恰好只分配
  四张 surface 的证明，内部 DPB 总内存不据此宣称精确上限。
- `decode_output.rs` 在输出类型变化时重新检查尺寸/NV12、分配上限及 sample/stride；
  2D buffer 走有界 contiguous copy，其他 buffer 在锁内逐行读取并对称释放。
- 输出时间戳必须保持顺序；错误或取消使该参考链不可复用。初始化失败和正常退出都释放
  permit、activation、样本与 COM/MF。底层原生调用本身不是可抢占的，测试父进程仍设超时。

真实接入暴露 NVIDIA MFT 在设置 `MF_MT_TRANSFER_FUNCTION` 后仍输出 VUI transfer=0，
且拒绝对应 CodecAPI 设置。源端现仅对**自身已知 sRGB 输入**的 SPS 保留值 0 归一化为
标准 sRGB 值 13，重新进行 emulation-prevention 编码，不改 slice/PPS；网络 decoder 仍
拒绝 transfer=0 和 HDR，不通过放宽接收校验隐藏源端差异。幂等性、非 SPS 字节保持、
拒绝 HDR 的单测和 FFprobe 的 `iec61966-2-1` 实际结果覆盖此边界。

本机新 WGC 320×240 自有窗口码流：产品 MF decoder 完整 24 帧及从强制 IDR 起的 12 帧
均通过，BGRA 最大灰度误差 1（阈值 4），取消后旧参考链不可复用。独立 FFmpeg 同一码流
24/12 帧通过，亮度误差 1、色度误差 0。它不证明任意尺寸、完整彩色/HDR、网络接线或
物理显示；BGRA 转换有红色/灰度边界单测，但不是完整彩色原生验收。

原生 decoder 测试要求先生成上述自有 WGC 码流，并使用新的独立输出目录：

```powershell
$env:HOOK_C1_DECODER_INPUT = 'C:\absolute\owned-wgc-output'
$env:HOOK_C1_DECODER_OUTPUT = 'C:\absolute\unused-decoder-output'
cargo test --locked --lib native_decoder_reads_continuous_wgc_h264_and_restarts_at_idr -- --ignored --nocapture --test-threads=1
```

### 剩余接线顺序

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
WebRTC 依赖。GPU 增量也只覆盖独立合成输入，不等于 Piik 的完整捕获路线，不外推其性能结果。
Windows 系统 codec 的使用不等于 H.264 在所有发行地区的专利许可已经完成审查；正式
分发政策需另行确认，本阶段不捆绑或发布新的 codec 库。
