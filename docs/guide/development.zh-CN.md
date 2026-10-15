# 开发与验证

[English](development.md) · [Documentation / 文档中心](../README.md)

以下命令均在仓库根目录执行；贡献流程与代码归属以[工程贡献规范](../../CONTRIBUTING.md)为准。

Tauri v2 · SolidJS · TypeScript · Rust

```powershell
npm install
npm run dev:tauri
```


## 运行与开发要求

- Windows 10 或 Windows 11；
- WebView2 Runtime；
- 前端开发使用 Node.js 22+；
- 桌面编译使用 Rust stable 与 MSVC 工具链。

只有所选 Windows 11 显示器报告 HDR 支持时才会进入 HDR 路径；不支持或内容仅为
SDR 时会自动降级。详见 [`docs/HDR_CAPTURE.md`](../HDR_CAPTURE.md)。

安装依赖并启动 Tauri 开发版本：

```powershell
npm install
npm run dev:tauri
```

常用检查：

```powershell
npm run typecheck
npm run test:performance
npm run test:parallel
npm test
npm run probe:live-screenshot:phase2
npm run probe:live-screenshot:phase3
cargo fmt --check --manifest-path src-tauri\Cargo.toml
cargo test --manifest-path src-tauri\Cargo.toml
npm run build
```

`npm run verify:local` 会执行完整的串行验证，并继续构建和打包本地 Release；它不
是轻量级的 lint 命令。

实时截图 G2 探针默认在交互式桌面运行 600 秒。它使用同权限、持续变化的 WinForms
夹具验证 WGC 新帧、尺寸变化后的重建、源关闭 fail-closed、会话清理，以及句柄和
私有内存增长上限；证据写入 `artifacts/live-screenshot-phase2/<run-id>`，不提交到
Git。本地 WebView 展示通过 Tauri 原始二进制响应读取有界 JPEG 帧，不把帧塞进
`loom.surface.v1`，也不进行逐帧 JSON/Base64 传输。

G3 探针只覆盖已锁定的 Windows 11、单 SDR 显示器、同权限 Win32/WinForms 范围：
源窗口变成接近透明的合成器窗口后仍产生变化帧，并验证独立输入边沿、精确恢复、
本地抢回、恢复日志执行和 worker 清理。该结果不承诺原生最小化、提权/跨会话、
WPF、WinUI 或任意自定义控件兼容。

直接构建便携 exe：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File .\scripts\build-local-otter-exe.ps1 `
  -OutputDir ..\release\Otter\local-build `
  -Force
```

开发规则见 [`CONTRIBUTING.md`](../../CONTRIBUTING.md)，当前运行时结构见
[`TECHNICAL_ARCHITECTURE.md`](../../TECHNICAL_ARCHITECTURE.md)。
